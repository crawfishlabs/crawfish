/**
 * @fileoverview Webhook Routes for RevenueCat and Stripe
 * @description Express routes for handling subscription webhooks from RevenueCat (iOS/macOS) and Stripe (web)
 */

import { Router, Request, Response } from 'express';
import { SubscriptionManager, RevenueCatEvent, StripeEvent } from './enhanced-subscriptions';
import { StripeConfigManager } from './stripe-config';
import { RevenueCatConfigManager } from './revenuecat-config';
import * as admin from 'firebase-admin';

const router = Router();

// Initialize managers
const subscriptionManager = new SubscriptionManager();
const stripeConfig = new StripeConfigManager();
const revenueCatConfig = new RevenueCatConfigManager();

// Middleware to capture raw body for webhook signature validation
const rawBodyParser = (req: Request, res: Response, next: any) => {
  req.body = '';
  req.on('data', (chunk) => {
    req.body += chunk;
  });
  req.on('end', () => {
    next();
  });
};

// Error handler for webhook routes
const handleWebhookError = (error: any, res: Response, source: string) => {
  console.error(`${source} webhook error:`, error);
  
  // Always return 200 to prevent retries for unrecoverable errors
  if (error.message.includes('Invalid signature')) {
    return res.status(401).send('Invalid signature');
  }
  
  // Log error but return success to prevent infinite retries
  res.status(200).json({ 
    received: true, 
    error: error.message 
  });
};

/**
 * RevenueCat webhook handler for iOS/macOS subscription events
 */
router.post('/webhooks/revenuecat', rawBodyParser, async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-revenuecat-signature'] as string;
    const payload = req.body;

    // Validate webhook signature
    if (!revenueCatConfig.validateWebhookSignature(payload, signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const event: RevenueCatEvent = JSON.parse(payload);
    
    // Log webhook event for debugging
    console.log('RevenueCat webhook received:', {
      type: event.event.type,
      userId: event.event.app_user_id,
      productId: event.event.product_id,
      environment: event.event.environment
    });

    // Process the webhook event
    await subscriptionManager.handleRevenueCatWebhook(event);
    
    // Store webhook event for audit trail
    await storeWebhookEvent('revenuecat', event.event.id, event, 'processed');

    res.status(200).json({ 
      received: true,
      eventId: event.event.id,
      eventType: event.event.type
    });
  } catch (error) {
    handleWebhookError(error, res, 'RevenueCat');
  }
});

/**
 * Stripe webhook handler for web subscription events
 */
router.post('/webhooks/stripe', rawBodyParser, async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    const payload = req.body;

    // Validate webhook signature and construct event
    const event = stripeConfig.validateWebhookSignature(payload, signature);
    
    // Log webhook event for debugging
    console.log('Stripe webhook received:', {
      id: event.id,
      type: event.type,
      livemode: event.livemode
    });

    // Process the webhook event
    await subscriptionManager.handleStripeWebhook(event as StripeEvent);
    
    // Store webhook event for audit trail
    await storeWebhookEvent('stripe', event.id, event, 'processed');

    res.status(200).json({ 
      received: true,
      eventId: event.id,
      eventType: event.type
    });
  } catch (error) {
    handleWebhookError(error, res, 'Stripe');
  }
});

/**
 * Get user's active subscriptions
 */
router.get('/subscriptions', async (req: Request, res: Response) => {
  try {
    // This would typically use auth middleware to get user ID
    const userId = req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const subscriptions = await subscriptionManager.getSubscriptions(userId);
    
    res.json({ 
      subscriptions: subscriptions.map(sub => ({
        app: sub.app,
        tier: sub.tier,
        platform: sub.platform,
        provider: sub.provider,
        expiresAt: sub.expiresAt,
        autoRenew: sub.autoRenew,
        trialEndsAt: sub.trialEndsAt,
        cancelledAt: sub.cancelledAt
      }))
    });
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create Stripe checkout session for web purchases
 */
router.post('/subscriptions/checkout', async (req: Request, res: Response) => {
  try {
    const { userId, app, period } = req.body;
    
    if (!userId || !app || !period) {
      return res.status(400).json({ 
        error: 'userId, app, and period are required' 
      });
    }

    if (!['monthly', 'yearly'].includes(period)) {
      return res.status(400).json({ 
        error: 'period must be monthly or yearly' 
      });
    }

    const apps = ['fitness', 'nutrition', 'meetings', 'budget', 'bundle'];
    if (!apps.includes(app)) {
      return res.status(400).json({ 
        error: `app must be one of: ${apps.join(', ')}` 
      });
    }

    const checkoutUrl = await subscriptionManager.createCheckoutSession(userId, app, period);
    
    res.json({ 
      checkout_url: checkoutUrl,
      app,
      period
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * Create Stripe customer portal session for subscription management
 */
router.post('/subscriptions/portal', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const portalUrl = await subscriptionManager.createPortalSession(userId);
    
    res.json({ 
      portal_url: portalUrl 
    });
  } catch (error) {
    console.error('Error creating portal session:', error);
    
    if (error.message.includes('No Stripe subscription found')) {
      return res.status(404).json({ error: 'No Stripe subscription found for user' });
    }
    
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

/**
 * Check subscription access for an app
 */
router.get('/subscriptions/:app/access', async (req: Request, res: Response) => {
  try {
    const { app } = req.params;
    const userId = req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const apps = ['fitness', 'nutrition', 'meetings', 'budget'];
    if (!apps.includes(app)) {
      return res.status(400).json({ 
        error: `app must be one of: ${apps.join(', ')}` 
      });
    }

    const hasAccess = await subscriptionManager.hasAccess(userId, app as any);
    
    res.json({ 
      hasAccess,
      app,
      userId
    });
  } catch (error) {
    console.error('Error checking subscription access:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get bundle pricing and savings information
 */
router.get('/subscriptions/bundle/pricing', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const bundlePricing = await subscriptionManager.getBundlePricing(userId);
    
    res.json(bundlePricing);
  } catch (error) {
    console.error('Error getting bundle pricing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Webhook health check endpoint
 */
router.get('/webhooks/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    webhooks: {
      revenuecat: {
        endpoint: '/api/v1/webhooks/revenuecat',
        configured: !!process.env.REVENUECAT_WEBHOOK_SECRET
      },
      stripe: {
        endpoint: '/api/v1/webhooks/stripe', 
        configured: !!process.env.STRIPE_WEBHOOK_SECRET
      }
    }
  });
});

/**
 * Get webhook event history (for debugging)
 */
router.get('/webhooks/events', async (req: Request, res: Response) => {
  try {
    const { source, limit = '50' } = req.query;
    
    let query = admin.firestore().collection('webhook_events')
      .orderBy('receivedAt', 'desc')
      .limit(parseInt(limit as string));

    if (source) {
      query = query.where('source', '==', source);
    }

    const snapshot = await query.get();
    const events = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({ events });
  } catch (error) {
    console.error('Error getting webhook events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to store webhook events for audit trail
async function storeWebhookEvent(
  source: 'revenuecat' | 'stripe',
  eventId: string,
  data: any,
  status: 'processed' | 'failed' | 'skipped'
): Promise<void> {
  try {
    await admin.firestore().collection('webhook_events').doc(eventId).set({
      eventId,
      source,
      status,
      data,
      receivedAt: admin.firestore.Timestamp.now(),
      processedAt: admin.firestore.Timestamp.now()
    });
  } catch (error) {
    console.error('Error storing webhook event:', error);
    // Don't throw - webhook processing should continue even if audit fails
  }
}

export default router;