/**
 * @fileoverview Apple App Store receipt verification and webhook handling
 */

import * as admin from 'firebase-admin';
import { AppleReceiptData, AppleServerNotification, AppleInAppPurchase } from './types';

// Types for node-apple-receipt-verify
interface VerifyResult {
  receipt: AppleReceiptData;
  status: number;
  isRetryable: boolean;
}

/**
 * Verify an Apple App Store receipt
 */
export async function verifyAppleReceipt(
  receiptData: string,
  production = true
): Promise<VerifyResult> {
  try {
    // Import dynamically to handle potential missing package
    const appleReceiptVerify = require('node-apple-receipt-verify');
    
    const config = {
      secret: process.env.APPLE_SHARED_SECRET, // Your app's shared secret from App Store Connect
      environment: production ? ['production'] : ['sandbox'],
      verbose: false,
      extended: true,
    };

    appleReceiptVerify.config(config);
    
    return new Promise((resolve, reject) => {
      appleReceiptVerify.validate(receiptData, (err: any, products: any) => {
        if (err) {
          reject(new Error(`Receipt verification failed: ${err.message}`));
          return;
        }
        
        resolve({
          receipt: products,
          status: 0,
          isRetryable: false
        });
      });
    });
  } catch (error) {
    throw new Error(`Receipt verification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handle Apple App Store Server-to-Server notification webhook
 */
export async function handleAppleWebhook(
  notification: AppleServerNotification
): Promise<void> {
  try {
    const { notification_type, unified_receipt } = notification;
    const { latest_receipt_info } = unified_receipt;
    
    if (!latest_receipt_info || latest_receipt_info.length === 0) {
      console.warn('No receipt info in webhook notification');
      return;
    }

    const latestReceipt = latest_receipt_info[0];
    const userId = await getUserIdFromTransaction(latestReceipt.original_transaction_id);
    
    if (!userId) {
      console.error('Could not find user for transaction:', latestReceipt.original_transaction_id);
      return;
    }

    switch (notification_type) {
      case 'INITIAL_BUY':
      case 'DID_RENEW':
        await activateSubscription(userId, latestReceipt);
        break;
      case 'CANCEL':
      case 'DID_FAIL_TO_RENEW':
        await deactivateSubscription(userId, latestReceipt);
        break;
      case 'GRACE_PERIOD_EXPIRED':
        await expireSubscription(userId, latestReceipt);
        break;
      default:
        console.log('Unhandled notification type:', notification_type);
    }
  } catch (error) {
    console.error('Error processing Apple webhook:', error);
    throw error;
  }
}

/**
 * Get user ID from original transaction ID
 */
async function getUserIdFromTransaction(originalTransactionId: string): Promise<string | null> {
  try {
    const db = admin.firestore();
    const snapshot = await db.collection('subscriptions')
      .where('originalTransactionId', '==', originalTransactionId)
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return null;
    }
    
    return snapshot.docs[0].data().userId;
  } catch (error) {
    console.error('Error finding user by transaction ID:', error);
    return null;
  }
}

/**
 * Activate subscription
 */
async function activateSubscription(userId: string, receipt: AppleInAppPurchase): Promise<void> {
  try {
    const db = admin.firestore();
    const subscriptionRef = db.collection('subscriptions').doc(userId);
    
    const currentPeriodEnd = receipt.expires_date_ms 
      ? admin.firestore.Timestamp.fromMillis(parseInt(receipt.expires_date_ms))
      : admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); // 30 days default
    
    await subscriptionRef.set({
      userId,
      status: 'active',
      provider: 'apple',
      providerSubscriptionId: receipt.transaction_id,
      originalTransactionId: receipt.original_transaction_id,
      productId: receipt.product_id,
      currentPeriodEnd,
      autoRenew: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.error('Error activating subscription:', error);
    throw error;
  }
}

/**
 * Deactivate subscription
 */
async function deactivateSubscription(userId: string, receipt: AppleInAppPurchase): Promise<void> {
  try {
    const db = admin.firestore();
    const subscriptionRef = db.collection('subscriptions').doc(userId);
    
    await subscriptionRef.update({
      status: 'canceled',
      canceledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('Error deactivating subscription:', error);
    throw error;
  }
}

/**
 * Expire subscription
 */
async function expireSubscription(userId: string, receipt: AppleInAppPurchase): Promise<void> {
  try {
    const db = admin.firestore();
    const subscriptionRef = db.collection('subscriptions').doc(userId);
    
    await subscriptionRef.update({
      status: 'expired',
      expiresAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('Error expiring subscription:', error);
    throw error;
  }
}