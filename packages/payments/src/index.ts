/**
 * @fileoverview Claw Platform Payments Module
 * @description Payment processing, subscription management, and IAP handling
 */

export * from './types';

// Legacy subscription management
export { handleAppleWebhook, verifyAppleReceipt } from './storekit';
export { 
  getSubscriptionStatus, 
  updateSubscriptionStatus, 
  cancelSubscription,
  restoreSubscription,
  getActiveSubscriptions,
  checkSubscriptionExpiry 
} from './subscriptions';

// Enhanced subscription management with RevenueCat + Stripe
export {
  AppTier,
  AppId,
  Subscription,
  RevenueCatEvent,
  StripeEvent,
  BundlePricing,
  SubscriptionManager,
  PRICING,
  PRODUCT_IDS
} from './enhanced-subscriptions';

// Stripe configuration and management
export {
  StripeProductConfig,
  StripePriceConfig,
  StripeConfigManager,
  STRIPE_PRODUCTS,
  STRIPE_PRICES,
  STRIPE_WEBHOOK_EVENTS
} from './stripe-config';

// RevenueCat configuration and management
export {
  RevenueCatOffering,
  RevenueCatPackage,
  RevenueCatEntitlement,
  RevenueCatProduct,
  RevenueCatConfigManager,
  REVENUECAT_OFFERINGS,
  REVENUECAT_ENTITLEMENTS,
  REVENUECAT_PRODUCTS,
  REVENUECAT_WEBHOOK_EVENTS
} from './revenuecat-config';

// Webhook routes
export { default as webhookRoutes } from './webhook-routes';