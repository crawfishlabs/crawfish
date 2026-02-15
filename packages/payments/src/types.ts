/**
 * @fileoverview TypeScript types for payment and subscription management
 * @description Defines interfaces for Apple IAP, subscription handling, and payment tracking
 */

import * as admin from 'firebase-admin';

/**
 * Subscription tiers available in the app
 */
export type SubscriptionTier = 'free' | 'pro' | 'pro_annual';

/**
 * Subscription status values
 */
export type SubscriptionStatus = 
  | 'active' 
  | 'inactive' 
  | 'trial' 
  | 'canceled' 
  | 'expired' 
  | 'grace_period' 
  | 'billing_retry';

/**
 * Payment providers
 */
export type PaymentProvider = 'apple' | 'google' | 'stripe' | 'manual';

/**
 * Apple App Store receipt data
 */
export interface AppleReceiptData {
  /** Bundle ID of the app */
  bundle_id: string;
  /** Application version */
  application_version: string;
  /** Receipt creation date */
  receipt_creation_date: string;
  /** Receipt expiration date */
  receipt_expiration_date?: string;
  /** In-app purchase receipts */
  in_app: AppleInAppPurchase[];
  /** Latest receipt info */
  latest_receipt_info?: AppleInAppPurchase[];
  /** Pending renewal info */
  pending_renewal_info?: ApplePendingRenewal[];
}

/**
 * Apple In-App Purchase data
 */
export interface AppleInAppPurchase {
  /** Product identifier */
  product_id: string;
  /** Transaction ID */
  transaction_id: string;
  /** Original transaction ID */
  original_transaction_id: string;
  /** Purchase date */
  purchase_date: string;
  /** Purchase date in milliseconds */
  purchase_date_ms: string;
  /** Expiry date */
  expires_date?: string;
  /** Expiry date in milliseconds */
  expires_date_ms?: string;
  /** Cancellation date */
  cancellation_date?: string;
  /** Quantity purchased */
  quantity: string;
  /** Whether this is a trial */
  is_trial_period: string;
  /** Whether this is in intro offer period */
  is_in_intro_offer_period: string;
  /** Web order line item ID */
  web_order_line_item_id?: string;
}

/**
 * Apple pending renewal info
 */
export interface ApplePendingRenewal {
  /** Original transaction ID */
  original_transaction_id: string;
  /** Product ID */
  product_id: string;
  /** Auto-renew status */
  auto_renew_status: string;
  /** Auto-renew product ID */
  auto_renew_product_id?: string;
  /** Expiration intent */
  expiration_intent?: string;
  /** Grace period expiry date */
  grace_period_expires_date?: string;
  /** Price consent status */
  price_consent_status?: string;
}

/**
 * App Store Server-to-Server notification
 */
export interface AppleServerNotification {
  /** Notification type */
  notification_type: string;
  /** Environment (sandbox or production) */
  environment: string;
  /** Password for verification */
  password: string;
  /** Unified receipt data */
  unified_receipt: {
    environment: string;
    latest_receipt: string;
    latest_receipt_info: AppleInAppPurchase[];
    pending_renewal_info: ApplePendingRenewal[];
    status: number;
  };
  /** Auto-renew status */
  auto_renew_status?: boolean;
  /** Auto-renew product ID */
  auto_renew_product_id?: string;
  /** Notification UUID */
  notification_uuid?: string;
}

/**
 * Subscription document stored in Firestore
 */
export interface SubscriptionDocument {
  /** User ID who owns the subscription */
  userId: string;
  /** Current subscription tier */
  tier: SubscriptionTier;
  /** Current subscription status */
  status: SubscriptionStatus;
  /** Payment provider */
  provider: PaymentProvider;
  /** Provider-specific subscription ID */
  providerSubscriptionId: string;
  /** Original transaction ID */
  originalTransactionId: string;
  /** Product ID purchased */
  productId: string;
  /** Subscription start date */
  startDate: admin.firestore.Timestamp;
  /** Current period end date */
  currentPeriodEnd: admin.firestore.Timestamp;
  /** Trial end date (if applicable) */
  trialEndDate?: admin.firestore.Timestamp;
  /** Auto-renewal enabled */
  autoRenew: boolean;
  /** Price paid (in USD) */
  price: number;
  /** Currency code */
  currency: string;
  /** Grace period end (if applicable) */
  gracePeriodEnd?: admin.firestore.Timestamp;
  /** Cancellation date */
  canceledAt?: admin.firestore.Timestamp;
  /** Expiry date */
  expiresAt?: admin.firestore.Timestamp;
  /** Last updated timestamp */
  updatedAt: admin.firestore.Timestamp;
  /** Created timestamp */
  createdAt: admin.firestore.Timestamp;
  /** Additional metadata */
  metadata?: {
    environment?: string;
    introOffer?: boolean;
    trialPeriod?: boolean;
    familySharing?: boolean;
  };
}

/**
 * Payment transaction record
 */
export interface PaymentTransaction {
  /** Transaction ID */
  transactionId: string;
  /** User ID */
  userId: string;
  /** Payment provider */
  provider: PaymentProvider;
  /** Transaction type */
  type: 'purchase' | 'renewal' | 'refund' | 'cancellation';
  /** Product ID */
  productId: string;
  /** Amount in cents */
  amount: number;
  /** Currency code */
  currency: string;
  /** Transaction status */
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  /** Transaction date */
  transactionDate: admin.firestore.Timestamp;
  /** Receipt data (provider-specific) */
  receiptData?: any;
  /** Error message (if failed) */
  error?: string;
  /** Created timestamp */
  createdAt: admin.firestore.Timestamp;
}

/**
 * Product configuration for IAP products
 */
export interface ProductConfig {
  /** Product identifier */
  productId: string;
  /** Product type */
  type: 'consumable' | 'non_consumable' | 'auto_renewable_subscription' | 'non_renewable_subscription';
  /** Subscription tier this product unlocks */
  tier: SubscriptionTier;
  /** Price in USD */
  priceUsd: number;
  /** Duration for subscriptions (in days) */
  durationDays?: number;
  /** Trial period (in days) */
  trialDays?: number;
  /** Whether this is active */
  active: boolean;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
}

/**
 * Subscription usage stats
 */
export interface SubscriptionUsage {
  /** User ID */
  userId: string;
  /** Date of usage (YYYY-MM-DD) */
  date: string;
  /** Number of LLM API calls */
  llmCalls: number;
  /** Number of photo analyses */
  photoAnalyses: number;
  /** Total cost incurred */
  totalCost: number;
  /** Usage by feature */
  featureUsage: {
    mealScan: number;
    coachChat: number;
    workoutAnalysis: number;
  };
  /** Timestamp */
  timestamp: admin.firestore.Timestamp;
}

/**
 * Webhook event for processing
 */
export interface WebhookEvent {
  /** Event ID */
  eventId: string;
  /** Event type */
  type: string;
  /** Provider that sent the webhook */
  provider: PaymentProvider;
  /** Raw webhook data */
  data: any;
  /** Processing status */
  status: 'pending' | 'processed' | 'failed' | 'skipped';
  /** Processing attempts */
  attempts: number;
  /** Error message (if failed) */
  error?: string;
  /** Received timestamp */
  receivedAt: admin.firestore.Timestamp;
  /** Processed timestamp */
  processedAt?: admin.firestore.Timestamp;
}