/**
 * @fileoverview Subscription management and status checking
 */

import * as admin from 'firebase-admin';
import { SubscriptionDocument, SubscriptionStatus, SubscriptionTier } from './types';

/**
 * Get current subscription status for a user
 */
export async function getSubscriptionStatus(userId: string): Promise<SubscriptionDocument | null> {
  try {
    const db = admin.firestore();
    const doc = await db.collection('subscriptions').doc(userId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data() as SubscriptionDocument;
    
    // Check if subscription has expired
    const now = admin.firestore.Timestamp.now();
    if (data.currentPeriodEnd.toMillis() < now.toMillis() && data.status === 'active') {
      await updateSubscriptionStatus(userId, 'expired');
      return { ...data, status: 'expired' };
    }
    
    return data;
  } catch (error) {
    console.error('Error getting subscription status:', error);
    return null;
  }
}

/**
 * Update subscription status
 */
export async function updateSubscriptionStatus(
  userId: string, 
  status: SubscriptionStatus,
  additionalData?: Partial<SubscriptionDocument>
): Promise<void> {
  try {
    const db = admin.firestore();
    const updateData: any = {
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...additionalData
    };
    
    await db.collection('subscriptions').doc(userId).update(updateData);
  } catch (error) {
    console.error('Error updating subscription status:', error);
    throw error;
  }
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(
  userId: string,
  immediate = false
): Promise<void> {
  try {
    const subscription = await getSubscriptionStatus(userId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    const updateData: any = {
      autoRenew: false,
      canceledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    if (immediate) {
      updateData.status = 'canceled';
      updateData.expiresAt = admin.firestore.FieldValue.serverTimestamp();
    } else {
      // Cancel at end of current period
      updateData.status = 'canceled';
      updateData.expiresAt = subscription.currentPeriodEnd;
    }
    
    await updateSubscriptionStatus(userId, updateData.status, updateData);
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw error;
  }
}

/**
 * Restore a subscription
 */
export async function restoreSubscription(userId: string): Promise<void> {
  try {
    const subscription = await getSubscriptionStatus(userId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    const now = admin.firestore.Timestamp.now();
    const newStatus: SubscriptionStatus = now.toMillis() < subscription.currentPeriodEnd.toMillis() 
      ? 'active' 
      : 'expired';
    
    await updateSubscriptionStatus(userId, newStatus, {
      autoRenew: true,
      canceledAt: admin.firestore.FieldValue.delete(),
    });
  } catch (error) {
    console.error('Error restoring subscription:', error);
    throw error;
  }
}

/**
 * Get all active subscriptions
 */
export async function getActiveSubscriptions(): Promise<SubscriptionDocument[]> {
  try {
    const db = admin.firestore();
    const snapshot = await db.collection('subscriptions')
      .where('status', '==', 'active')
      .get();
    
    return snapshot.docs.map(doc => doc.data() as SubscriptionDocument);
  } catch (error) {
    console.error('Error getting active subscriptions:', error);
    return [];
  }
}

/**
 * Check and update expired subscriptions
 */
export async function checkSubscriptionExpiry(): Promise<void> {
  try {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Find subscriptions that should be expired
    const snapshot = await db.collection('subscriptions')
      .where('status', '==', 'active')
      .where('currentPeriodEnd', '<=', now)
      .get();
    
    const batch = db.batch();
    
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: 'expired',
        expiresAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    
    if (snapshot.size > 0) {
      await batch.commit();
      console.log(`Expired ${snapshot.size} subscriptions`);
    }
  } catch (error) {
    console.error('Error checking subscription expiry:', error);
    throw error;
  }
}