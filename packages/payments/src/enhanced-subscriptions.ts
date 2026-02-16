/**
 * @fileoverview Enhanced Subscription Management with RevenueCat + Stripe
 * @description Unified subscription management across iOS/macOS (RevenueCat) and web (Stripe)
 */

import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import axios from 'axios';

// Subscription tiers
export type AppTier = 'free' | 'pro';
export type AppId = 'fitness' | 'nutrition' | 'meetings' | 'budget';

export interface Subscription {
  userId: string;
  app: AppId;
  tier: AppTier;
  platform: 'ios' | 'macos' | 'web' | 'android';
  provider: 'apple' | 'google' | 'stripe';
  productId: string;
  expiresAt: admin.firestore.Timestamp;
  autoRenew: boolean;
  trialEndsAt?: admin.firestore.Timestamp;
  cancelledAt?: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface RevenueCatEvent {
  api_version: string;
  event: {
    type: string;
    id: string;
    app_user_id: string;
    environment: string;
    event_timestamp_ms: number;
    original_app_user_id: string;
    product_id: string;
    period_type: string;
    purchased_at_ms: number;
    expiration_at_ms?: number;
    auto_renew_status?: boolean;
    is_family_share?: boolean;
    country_code?: string;
    price?: number;
    currency?: string;
    is_trial_conversion?: boolean;
    cancel_reason?: string;
  };
}

export interface StripeEvent {
  id: string;
  object: string;
  api_version: string;
  created: number;
  data: {
    object: any;
    previous_attributes?: any;
  };
  livemode: boolean;
  pending_webhooks: number;
  request: {
    id: string;
    idempotency_key?: string;
  };
  type: string;
}

export interface BundlePricing {
  individualTotal: number;
  bundlePrice: number;
  savings: number;
  savingsPercent: number;
  eligibleApps: AppId[];
}

// Pricing configuration
export const PRICING = {
  fitness: { monthly: 6.99, yearly: 69.99 },
  nutrition: { monthly: 6.99, yearly: 69.99 },
  meetings: { monthly: 9.99, yearly: 99.99 },
  budget: { monthly: 7.99, yearly: 79.99 },
  bundle: { monthly: 19.99, yearly: 199.99 }, // All 4 apps
};

// Product ID mappings
export const PRODUCT_IDS = {
  // iOS/macOS (RevenueCat)
  ios: {
    fitness_monthly: 'claw_fitness_monthly',
    fitness_yearly: 'claw_fitness_yearly',
    nutrition_monthly: 'claw_nutrition_monthly',
    nutrition_yearly: 'claw_nutrition_yearly',
    meetings_monthly: 'claw_meetings_monthly',
    meetings_yearly: 'claw_meetings_yearly',
    budget_monthly: 'claw_budget_monthly',
    budget_yearly: 'claw_budget_yearly',
    bundle_monthly: 'claw_bundle_monthly',
    bundle_yearly: 'claw_bundle_yearly',
  },
  // Web (Stripe)
  stripe: {
    fitness_monthly: 'price_fitness_monthly',
    fitness_yearly: 'price_fitness_yearly',
    nutrition_monthly: 'price_nutrition_monthly',
    nutrition_yearly: 'price_nutrition_yearly',
    meetings_monthly: 'price_meetings_monthly',
    meetings_yearly: 'price_meetings_yearly',
    budget_monthly: 'price_budget_monthly',
    budget_yearly: 'price_budget_yearly',
    bundle_monthly: 'price_bundle_monthly',
    bundle_yearly: 'price_bundle_yearly',
  }
};

export class SubscriptionManager {
  private stripe: Stripe;
  private revenueCatApiKey: string;
  private db: admin.firestore.Firestore;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
    });
    this.revenueCatApiKey = process.env.REVENUECAT_API_KEY!;
    this.db = admin.firestore();
  }

  /**
   * Check if user has pro access for an app
   */
  async hasAccess(userId: string, app: AppId): Promise<boolean> {
    try {
      const subscription = await this.getActiveSubscription(userId, app);
      if (!subscription) return false;

      const now = admin.firestore.Timestamp.now();
      return subscription.expiresAt.toMillis() > now.toMillis() && 
             subscription.tier === 'pro';
    } catch (error) {
      console.error('Error checking access:', error);
      return false;
    }
  }

  /**
   * Get all active subscriptions for a user
   */
  async getSubscriptions(userId: string): Promise<Subscription[]> {
    try {
      const snapshot = await this.db.collection('subscriptions')
        .where('userId', '==', userId)
        .get();

      const subscriptions = snapshot.docs.map(doc => doc.data() as Subscription);
      
      // Filter out expired subscriptions
      const now = admin.firestore.Timestamp.now();
      return subscriptions.filter(sub => 
        sub.expiresAt.toMillis() > now.toMillis() && 
        !sub.cancelledAt
      );
    } catch (error) {
      console.error('Error getting subscriptions:', error);
      return [];
    }
  }

  /**
   * Get active subscription for a specific app
   */
  private async getActiveSubscription(userId: string, app: AppId): Promise<Subscription | null> {
    try {
      const snapshot = await this.db.collection('subscriptions')
        .where('userId', '==', userId)
        .where('app', '==', app)
        .orderBy('expiresAt', 'desc')
        .limit(1)
        .get();

      if (snapshot.empty) return null;
      
      const subscription = snapshot.docs[0].data() as Subscription;
      const now = admin.firestore.Timestamp.now();
      
      // Check if subscription is still active
      if (subscription.expiresAt.toMillis() <= now.toMillis() || subscription.cancelledAt) {
        return null;
      }
      
      return subscription;
    } catch (error) {
      console.error('Error getting active subscription:', error);
      return null;
    }
  }

  /**
   * RevenueCat webhook handler (iOS/macOS purchases)
   */
  async handleRevenueCatWebhook(event: RevenueCatEvent): Promise<void> {
    try {
      const { event: eventData } = event;
      const userId = eventData.app_user_id;
      const productId = eventData.product_id;

      // Map product ID to app
      const app = this.mapProductIdToApp(productId);
      if (!app) {
        console.warn('Unknown product ID:', productId);
        return;
      }

      const subscriptionData: Partial<Subscription> = {
        userId,
        app,
        tier: 'pro',
        platform: this.getPlatformFromProductId(productId),
        provider: 'apple', // Assuming Apple for RevenueCat
        productId,
        autoRenew: eventData.auto_renew_status ?? true,
        updatedAt: admin.firestore.Timestamp.now()
      };

      switch (eventData.type) {
        case 'INITIAL_PURCHASE':
        case 'RENEWAL':
          subscriptionData.expiresAt = eventData.expiration_at_ms ?
            admin.firestore.Timestamp.fromMillis(eventData.expiration_at_ms) :
            admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days
          
          if (eventData.type === 'INITIAL_PURCHASE') {
            subscriptionData.createdAt = admin.firestore.Timestamp.fromMillis(eventData.purchased_at_ms);
          }

          await this.upsertSubscription(userId, app, subscriptionData);
          break;

        case 'CANCELLATION':
          subscriptionData.cancelledAt = admin.firestore.Timestamp.now();
          subscriptionData.autoRenew = false;
          await this.upsertSubscription(userId, app, subscriptionData);
          break;

        case 'UNCANCELLATION':
          subscriptionData.cancelledAt = admin.firestore.FieldValue.delete() as any;
          subscriptionData.autoRenew = true;
          await this.upsertSubscription(userId, app, subscriptionData);
          break;

        case 'EXPIRATION':
          // Mark as expired - subscription remains but access is revoked
          await this.markSubscriptionExpired(userId, app);
          break;

        default:
          console.log('Unhandled RevenueCat event type:', eventData.type);
      }
    } catch (error) {
      console.error('Error handling RevenueCat webhook:', error);
      throw error;
    }
  }

  /**
   * Stripe webhook handler (web purchases)
   */
  async handleStripeWebhook(event: StripeEvent): Promise<void> {
    try {
      const { type, data } = event;

      switch (type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleStripeSubscriptionChange(data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleStripeSubscriptionDeleted(data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handleStripePaymentSucceeded(data.object);
          break;

        case 'invoice.payment_failed':
          await this.handleStripePaymentFailed(data.object);
          break;

        default:
          console.log('Unhandled Stripe event type:', type);
      }
    } catch (error) {
      console.error('Error handling Stripe webhook:', error);
      throw error;
    }
  }

  /**
   * Create Stripe checkout session for web purchases
   */
  async createCheckoutSession(
    userId: string, 
    app: AppId, 
    period: 'monthly' | 'yearly'
  ): Promise<string> {
    try {
      const priceId = PRODUCT_IDS.stripe[`${app}_${period}` as keyof typeof PRODUCT_IDS.stripe];
      
      if (!priceId) {
        throw new Error(`No price ID found for ${app} ${period}`);
      }

      const session = await this.stripe.checkout.sessions.create({
        customer_email: undefined, // Will be populated from user record if needed
        payment_method_types: ['card'],
        line_items: [{
          price: priceId,
          quantity: 1,
        }],
        mode: 'subscription',
        success_url: `${process.env.CLIENT_URL}/${app}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/${app}/pricing`,
        metadata: {
          userId,
          app,
          period
        },
        subscription_data: {
          metadata: {
            userId,
            app,
            period
          }
        }
      });

      return session.url!;
    } catch (error) {
      console.error('Error creating Stripe checkout session:', error);
      throw error;
    }
  }

  /**
   * Create Stripe customer portal session for subscription management
   */
  async createPortalSession(userId: string): Promise<string> {
    try {
      // Find Stripe customer ID from existing subscription
      const subscriptions = await this.getSubscriptions(userId);
      const stripeSubscription = subscriptions.find(sub => sub.provider === 'stripe');
      
      if (!stripeSubscription) {
        throw new Error('No Stripe subscription found for user');
      }

      // Get customer ID from Stripe subscription
      const subscription = await this.stripe.subscriptions.retrieve(stripeSubscription.productId);
      const customerId = subscription.customer as string;

      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.CLIENT_URL}/account/billing`,
      });

      return session.url;
    } catch (error) {
      console.error('Error creating Stripe portal session:', error);
      throw error;
    }
  }

  /**
   * Bundle discount logic - calculate savings for multiple apps
   */
  async getBundlePricing(userId: string): Promise<BundlePricing> {
    try {
      const subscriptions = await this.getSubscriptions(userId);
      const subscribedApps = subscriptions.map(sub => sub.app);
      const unsubscribedApps = (['fitness', 'nutrition', 'meetings', 'budget'] as AppId[])
        .filter(app => !subscribedApps.includes(app));

      // Calculate individual pricing for unsubscribed apps
      const individualMonthlyTotal = unsubscribedApps.reduce((total, app) => {
        return total + PRICING[app].monthly;
      }, 0);

      const bundlePrice = PRICING.bundle.monthly;
      const savings = Math.max(0, individualMonthlyTotal - bundlePrice);
      const savingsPercent = individualMonthlyTotal > 0 ? 
        Math.round((savings / individualMonthlyTotal) * 100) : 0;

      return {
        individualTotal: individualMonthlyTotal,
        bundlePrice,
        savings,
        savingsPercent,
        eligibleApps: unsubscribedApps
      };
    } catch (error) {
      console.error('Error calculating bundle pricing:', error);
      return {
        individualTotal: 0,
        bundlePrice: PRICING.bundle.monthly,
        savings: 0,
        savingsPercent: 0,
        eligibleApps: []
      };
    }
  }

  /**
   * Middleware to require pro access for an app
   */
  requirePro(app: AppId) {
    return async (req: any, res: any, next: any) => {
      try {
        const userId = req.user?.uid;
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const hasAccess = await this.hasAccess(userId, app);
        if (!hasAccess) {
          return res.status(403).json({ 
            error: 'Pro subscription required',
            app,
            upgradeUrl: `${process.env.CLIENT_URL}/${app}/pricing`
          });
        }

        next();
      } catch (error) {
        console.error('Error checking pro access:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    };
  }

  // Private helper methods

  private async upsertSubscription(
    userId: string, 
    app: AppId, 
    data: Partial<Subscription>
  ): Promise<void> {
    const docId = `${userId}_${app}`;
    const docRef = this.db.collection('subscriptions').doc(docId);
    
    const existing = await docRef.get();
    if (existing.exists) {
      await docRef.update(data);
    } else {
      await docRef.set({
        ...data,
        createdAt: admin.firestore.Timestamp.now()
      });
    }
  }

  private async markSubscriptionExpired(userId: string, app: AppId): Promise<void> {
    const docId = `${userId}_${app}`;
    await this.db.collection('subscriptions').doc(docId).update({
      expiresAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    });
  }

  private mapProductIdToApp(productId: string): AppId | null {
    if (productId.includes('fitness')) return 'fitness';
    if (productId.includes('nutrition')) return 'nutrition';
    if (productId.includes('meetings')) return 'meetings';
    if (productId.includes('budget')) return 'budget';
    if (productId.includes('bundle')) {
      // For bundle, we'd need special handling to grant access to all apps
      return 'fitness'; // Placeholder - bundle logic would be more complex
    }
    return null;
  }

  private getPlatformFromProductId(productId: string): 'ios' | 'macos' | 'web' | 'android' {
    // This would be more sophisticated in practice
    return productId.includes('mac') ? 'macos' : 'ios';
  }

  private async handleStripeSubscriptionChange(subscription: any): Promise<void> {
    const userId = subscription.metadata?.userId;
    const app = subscription.metadata?.app as AppId;
    
    if (!userId || !app) {
      console.warn('Missing userId or app in Stripe subscription metadata');
      return;
    }

    const subscriptionData: Partial<Subscription> = {
      userId,
      app,
      tier: 'pro',
      platform: 'web',
      provider: 'stripe',
      productId: subscription.id,
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(subscription.current_period_end * 1000)),
      autoRenew: !subscription.cancel_at_period_end,
      updatedAt: admin.firestore.Timestamp.now()
    };

    if (subscription.canceled_at) {
      subscriptionData.cancelledAt = admin.firestore.Timestamp.fromDate(
        new Date(subscription.canceled_at * 1000)
      );
    }

    await this.upsertSubscription(userId, app, subscriptionData);
  }

  private async handleStripeSubscriptionDeleted(subscription: any): Promise<void> {
    const userId = subscription.metadata?.userId;
    const app = subscription.metadata?.app as AppId;
    
    if (!userId || !app) return;

    await this.markSubscriptionExpired(userId, app);
  }

  private async handleStripePaymentSucceeded(invoice: any): Promise<void> {
    // Handle successful payment - potentially extend subscription or update status
    console.log('Stripe payment succeeded:', invoice.id);
  }

  private async handleStripePaymentFailed(invoice: any): Promise<void> {
    // Handle failed payment - potentially notify user or update subscription status
    console.log('Stripe payment failed:', invoice.id);
  }
}