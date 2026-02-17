/**
 * @claw/iam — Unified Identity & Access Management Models
 *
 * Central type definitions for the Crawfish IAM system.
 * All apps import these types; the IAM Firestore project is the source of truth.
 */

// ---------------------------------------------------------------------------
// App identifiers
// ---------------------------------------------------------------------------

export type AppId = 'fitness' | 'nutrition' | 'budget' | 'meetings';

export const ALL_APP_IDS: AppId[] = ['fitness', 'nutrition', 'budget', 'meetings'];

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type PlanTier = 'free' | 'individual' | 'bundle' | 'all_access';

export interface Plan {
  id: string;
  name: string;
  tier: PlanTier;
  priceMonthly: number;
  priceYearly: number;
  apps: AppId[];
  features: Record<string, boolean | number>;
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

export interface AppEntitlement {
  hasAccess: boolean;
  tier: 'free' | 'pro';
  expiresAt?: Date;
  aiQueriesPerDay: number;
  storageGb: number;
  features: Record<string, boolean | number>;
}

export interface Entitlements {
  apps: Record<AppId, AppEntitlement>;
  globalFeatures: Record<string, boolean | number>;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export type BillingStatus = 'active' | 'past_due' | 'cancelled' | 'trial' | 'free';

export interface CrawfishUser {
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
  createdAt: Date;
  lastLoginAt: Date;

  // Plan & billing
  plan: Plan;
  billingStatus: BillingStatus;
  trialEndsAt?: Date;
  stripeCustomerId?: string;

  // App entitlements
  entitlements: Entitlements;

  // Preferences
  timezone: string;
  locale: string;

  // Metadata
  referralSource?: string;
  onboardingCompleted: boolean;
}

// ---------------------------------------------------------------------------
// Sharing & Permissions
// ---------------------------------------------------------------------------

export type SharedResourceType = 'budget' | 'fitness_program' | 'meal_plan';
export type SharedRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface SharedAccess {
  id: string;
  resourceType: SharedResourceType;
  resourceId: string;
  ownerUid: string;
  sharedWithUid: string;
  role: SharedRole;
  appId: AppId;
  grantedAt: Date;
  expiresAt?: Date;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface Invitation {
  id: string;
  fromUid: string;
  toEmail: string;
  resourceType: string;
  resourceId: string;
  role: string;
  appId: AppId;
  status: InvitationStatus;
  createdAt: Date;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// AI Usage tracking
// ---------------------------------------------------------------------------

export interface AIUsageRecord {
  date: string;          // YYYY-MM-DD
  appId: AppId;
  queriesUsed: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Cross-app token payload
// ---------------------------------------------------------------------------

export interface CrossAppTokenPayload {
  uid: string;
  targetApp: AppId;
  iat: number;
  exp: number;
}
