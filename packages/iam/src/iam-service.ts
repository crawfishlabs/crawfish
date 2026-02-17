import * as admin from 'firebase-admin';
import * as jwt from 'jsonwebtoken';
import NodeCache from 'node-cache';
import { v4 as uuidv4 } from 'uuid';

import {
  AppId,
  CrawfishUser,
  Entitlements,
  SharedAccess,
  Invitation,
  CrossAppTokenPayload,
  ALL_APP_IDS,
} from './models';
import { PLANS, deriveEntitlements, getPlan } from './plans';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface IAMConfig {
  /** Firebase Admin app initialised against the crawfish-iam project */
  firebaseApp: admin.app.App;
  /** Secret used to sign cross-app JWTs */
  crossAppSecret: string;
  /** Entitlement cache TTL in seconds (default 300 = 5 min) */
  cacheTtlSeconds?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class IAMService {
  private db: admin.firestore.Firestore;
  private auth: admin.auth.Auth;
  private cache: NodeCache;
  private crossAppSecret: string;

  constructor(private config: IAMConfig) {
    this.db = config.firebaseApp.firestore();
    this.auth = config.firebaseApp.auth();
    this.cache = new NodeCache({ stdTTL: config.cacheTtlSeconds ?? 300 });
    this.crossAppSecret = config.crossAppSecret;
  }

  // -----------------------------------------------------------------------
  // User management
  // -----------------------------------------------------------------------

  async createUser(email: string, password: string, planId?: string): Promise<CrawfishUser> {
    const plan = getPlan(planId ?? 'free') ?? PLANS.free;
    const entitlements = deriveEntitlements(plan);

    const firebaseUser = await this.auth.createUser({ email, password });

    const now = new Date();
    const user: CrawfishUser = {
      uid: firebaseUser.uid,
      email,
      createdAt: now,
      lastLoginAt: now,
      plan,
      billingStatus: plan.id === 'free' ? 'free' : 'trial',
      trialEndsAt: plan.id === 'free' ? undefined : new Date(now.getTime() + 14 * 86400000),
      entitlements,
      timezone: 'America/Chicago',
      locale: 'en-US',
      onboardingCompleted: false,
    };

    await this.db.collection('users').doc(user.uid).set(this.serializeUser(user));
    await this.db.doc(`users/${user.uid}/entitlements/current`).set(entitlements);

    return user;
  }

  async getUser(uid: string): Promise<CrawfishUser> {
    const doc = await this.db.collection('users').doc(uid).get();
    if (!doc.exists) throw new Error(`User ${uid} not found`);
    return this.deserializeUser(doc.data()!);
  }

  async updateUser(uid: string, updates: Partial<CrawfishUser>): Promise<void> {
    await this.db.collection('users').doc(uid).update(updates as Record<string, unknown>);
    this.cache.del(`entitlements:${uid}`);
  }

  async deleteUser(uid: string): Promise<void> {
    await this.deleteAllUserData(uid);
  }

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  /**
   * Verify a Firebase ID token. Works for all provider types:
   * - Email/password
   * - Google (google.com)
   * - Apple (apple.com)
   *
   * Firebase Admin SDK handles provider-agnostic verification.
   * The decoded token includes `firebase.sign_in_provider` for audit.
   */
  async verifyToken(idToken: string): Promise<{
    uid: string;
    entitlements: Entitlements;
    provider: string;
    emailVerified: boolean;
  }> {
    const decoded = await this.auth.verifyIdToken(idToken);
    const uid = decoded.uid;
    const provider = (decoded as any).firebase?.sign_in_provider ?? 'unknown';
    const emailVerified = decoded.email_verified ?? false;

    const cached = this.cache.get<Entitlements>(`entitlements:${uid}`);
    if (cached) {
      return { uid, entitlements: cached, provider, emailVerified };
    }

    // Auto-provision IAM user record on first token verify (handles
    // social sign-in where client may not call /auth/register)
    const userDoc = await this.db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      await this.autoProvisionUser(uid, decoded);
    }

    // Update lastLoginAt
    await this.db.collection('users').doc(uid).update({
      lastLoginAt: admin.firestore.Timestamp.now(),
    }).catch(() => {}); // best-effort

    const entitlements = await this.getEntitlements(uid);
    this.cache.set(`entitlements:${uid}`, entitlements);
    return { uid, entitlements, provider, emailVerified };
  }

  /**
   * Auto-provision a user record when they first authenticate via
   * social provider (Google/Apple) without going through /auth/register.
   */
  private async autoProvisionUser(
    uid: string,
    decoded: admin.auth.DecodedIdToken,
  ): Promise<void> {
    const plan = PLANS.free;
    const entitlements = deriveEntitlements(plan);
    const now = new Date();

    const user: CrawfishUser = {
      uid,
      email: decoded.email ?? '',
      displayName: decoded.name,
      photoUrl: decoded.picture,
      createdAt: now,
      lastLoginAt: now,
      plan,
      billingStatus: 'free',
      entitlements,
      timezone: 'America/Chicago',
      locale: 'en-US',
      onboardingCompleted: false,
    };

    await this.db.collection('users').doc(uid).set(this.serializeUser(user));
    await this.db.doc(`users/${uid}/entitlements/current`).set(entitlements);
  }

  // -----------------------------------------------------------------------
  // Entitlements
  // -----------------------------------------------------------------------

  async getEntitlements(uid: string): Promise<Entitlements> {
    const doc = await this.db.doc(`users/${uid}/entitlements/current`).get();
    if (!doc.exists) {
      // Derive from plan
      const user = await this.getUser(uid);
      const entitlements = deriveEntitlements(user.plan);
      await this.db.doc(`users/${uid}/entitlements/current`).set(entitlements);
      return entitlements;
    }
    return doc.data() as Entitlements;
  }

  async hasAppAccess(uid: string, appId: AppId): Promise<boolean> {
    const ent = await this.getEntitlements(uid);
    return ent.apps[appId]?.hasAccess ?? false;
  }

  async hasFeature(uid: string, feature: string): Promise<boolean> {
    const ent = await this.getEntitlements(uid);
    return !!ent.globalFeatures[feature];
  }

  async checkAIQuota(
    uid: string,
    appId: AppId,
  ): Promise<{ allowed: boolean; remaining: number; resetsAt: Date }> {
    const ent = await this.getEntitlements(uid);
    const limit = ent.apps[appId]?.aiQueriesPerDay ?? 3;

    // Unlimited
    if (limit === -1) {
      return { allowed: true, remaining: Infinity, resetsAt: this.nextMidnight() };
    }

    const today = this.todayString();
    const usageRef = this.db.doc(`users/${uid}/ai_usage/${today}`);
    const usageDoc = await usageRef.get();
    const used = usageDoc.exists ? (usageDoc.data()?.[appId] ?? 0) : 0;

    return {
      allowed: used < limit,
      remaining: Math.max(0, limit - used),
      resetsAt: this.nextMidnight(),
    };
  }

  async consumeAIQuota(uid: string, appId: AppId): Promise<void> {
    const today = this.todayString();
    const usageRef = this.db.doc(`users/${uid}/ai_usage/${today}`);
    await usageRef.set(
      { [appId]: admin.firestore.FieldValue.increment(1) },
      { merge: true },
    );
  }

  // -----------------------------------------------------------------------
  // Plan management
  // -----------------------------------------------------------------------

  async changePlan(uid: string, newPlanId: string): Promise<void> {
    const plan = getPlan(newPlanId);
    if (!plan) throw new Error(`Unknown plan: ${newPlanId}`);

    const entitlements = deriveEntitlements(plan);

    const batch = this.db.batch();
    batch.update(this.db.doc(`users/${uid}`), {
      plan,
      billingStatus: plan.id === 'free' ? 'free' : 'active',
      entitlements,
    });
    batch.set(this.db.doc(`users/${uid}/entitlements/current`), entitlements);
    await batch.commit();

    this.cache.del(`entitlements:${uid}`);
  }

  async upgradeToPro(uid: string, appId: AppId): Promise<void> {
    const planMap: Record<AppId, string> = {
      fitness: 'fitness_pro',
      nutrition: 'nutrition_pro',
      budget: 'budget_pro',
      meetings: 'meetings_pro',
    };
    await this.changePlan(uid, planMap[appId]);
  }

  async downgradeToFree(uid: string, _appId: AppId): Promise<void> {
    await this.changePlan(uid, 'free');
  }

  // -----------------------------------------------------------------------
  // Sharing & permissions
  // -----------------------------------------------------------------------

  async shareResource(
    ownerUid: string,
    toEmail: string,
    resourceType: string,
    resourceId: string,
    role: string,
    appId: AppId,
  ): Promise<Invitation> {
    const invitation: Invitation = {
      id: uuidv4(),
      fromUid: ownerUid,
      toEmail,
      resourceType,
      resourceId,
      role,
      appId,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86400000), // 7 days
    };

    await this.db.collection('invitations').doc(invitation.id).set(invitation);
    return invitation;
  }

  async acceptInvitation(invitationId: string, uid: string): Promise<SharedAccess> {
    const invDoc = await this.db.collection('invitations').doc(invitationId).get();
    if (!invDoc.exists) throw new Error('Invitation not found');

    const inv = invDoc.data() as Invitation;
    if (inv.status !== 'pending') throw new Error(`Invitation is ${inv.status}`);
    if (new Date(inv.expiresAt) < new Date()) {
      await this.db.collection('invitations').doc(invitationId).update({ status: 'expired' });
      throw new Error('Invitation expired');
    }

    const access: SharedAccess = {
      id: uuidv4(),
      resourceType: inv.resourceType as SharedAccess['resourceType'],
      resourceId: inv.resourceId,
      ownerUid: inv.fromUid,
      sharedWithUid: uid,
      role: inv.role as SharedAccess['role'],
      appId: inv.appId,
      grantedAt: new Date(),
    };

    const batch = this.db.batch();
    batch.set(this.db.collection('shared_access').doc(access.id), access);
    batch.update(this.db.collection('invitations').doc(invitationId), { status: 'accepted' });
    await batch.commit();

    return access;
  }

  async revokeAccess(sharedAccessId: string, requestorUid: string): Promise<void> {
    const doc = await this.db.collection('shared_access').doc(sharedAccessId).get();
    if (!doc.exists) throw new Error('Shared access not found');

    const access = doc.data() as SharedAccess;
    if (access.ownerUid !== requestorUid && access.sharedWithUid !== requestorUid) {
      throw new Error('Permission denied');
    }

    await this.db.collection('shared_access').doc(sharedAccessId).delete();
  }

  async getSharedResources(uid: string): Promise<SharedAccess[]> {
    const owned = await this.db
      .collection('shared_access')
      .where('ownerUid', '==', uid)
      .get();
    const shared = await this.db
      .collection('shared_access')
      .where('sharedWithUid', '==', uid)
      .get();

    const results: SharedAccess[] = [];
    owned.forEach((d) => results.push(d.data() as SharedAccess));
    shared.forEach((d) => results.push(d.data() as SharedAccess));
    return results;
  }

  async checkPermission(
    uid: string,
    resourceType: string,
    resourceId: string,
    action: string,
  ): Promise<boolean> {
    // Owner always has permission
    const accessDocs = await this.db
      .collection('shared_access')
      .where('resourceId', '==', resourceId)
      .where('resourceType', '==', resourceType)
      .get();

    for (const doc of accessDocs.docs) {
      const access = doc.data() as SharedAccess;
      if (access.ownerUid === uid) return true;
      if (access.sharedWithUid === uid) {
        return this.roleAllowsAction(access.role, action);
      }
    }

    return false;
  }

  // -----------------------------------------------------------------------
  // Cross-app SSO
  // -----------------------------------------------------------------------

  async createCrossAppToken(uid: string, targetAppId: AppId): Promise<string> {
    const hasAccess = await this.hasAppAccess(uid, targetAppId);
    if (!hasAccess) throw new Error(`No access to ${targetAppId}`);

    const payload: CrossAppTokenPayload = {
      uid,
      targetApp: targetAppId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, // 5 min
    };

    return jwt.sign(payload, this.crossAppSecret);
  }

  verifyCrossAppToken(token: string): CrossAppTokenPayload {
    return jwt.verify(token, this.crossAppSecret) as CrossAppTokenPayload;
  }

  // -----------------------------------------------------------------------
  // GDPR
  // -----------------------------------------------------------------------

  async exportUserData(uid: string): Promise<{ url: string }> {
    // In production, this would gather data from all app projects and create
    // a downloadable archive. For now return a placeholder signed URL.
    const bucket = this.config.firebaseApp.storage().bucket();
    const file = bucket.file(`exports/${uid}/data-export.json`);

    const user = await this.getUser(uid);
    const sharedResources = await this.getSharedResources(uid);

    await file.save(JSON.stringify({ user, sharedResources }, null, 2));

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 3600000,
    });

    return { url };
  }

  async deleteAllUserData(uid: string): Promise<void> {
    // Delete Firestore data
    const userRef = this.db.collection('users').doc(uid);

    // Delete subcollections
    const subcollections = await userRef.listCollections();
    for (const sub of subcollections) {
      const docs = await sub.listDocuments();
      const batch = this.db.batch();
      docs.forEach((d) => batch.delete(d));
      await batch.commit();
    }

    // Delete shared access
    const shared = await this.db.collection('shared_access').where('ownerUid', '==', uid).get();
    const sharedWith = await this.db.collection('shared_access').where('sharedWithUid', '==', uid).get();
    const invitations = await this.db.collection('invitations').where('fromUid', '==', uid).get();

    const batch = this.db.batch();
    shared.forEach((d) => batch.delete(d.ref));
    sharedWith.forEach((d) => batch.delete(d.ref));
    invitations.forEach((d) => batch.delete(d.ref));
    batch.delete(userRef);
    await batch.commit();

    // Delete Firebase Auth user
    await this.auth.deleteUser(uid);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private roleAllowsAction(role: string, action: string): boolean {
    const permissions: Record<string, string[]> = {
      owner: ['read', 'write', 'delete', 'share', 'admin'],
      admin: ['read', 'write', 'delete', 'share'],
      editor: ['read', 'write'],
      viewer: ['read'],
    };
    return (permissions[role] ?? []).includes(action);
  }

  private todayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private nextMidnight(): Date {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d;
  }

  private serializeUser(user: CrawfishUser): Record<string, unknown> {
    return {
      ...user,
      createdAt: admin.firestore.Timestamp.fromDate(user.createdAt),
      lastLoginAt: admin.firestore.Timestamp.fromDate(user.lastLoginAt),
      trialEndsAt: user.trialEndsAt
        ? admin.firestore.Timestamp.fromDate(user.trialEndsAt)
        : null,
    };
  }

  private deserializeUser(data: Record<string, unknown>): CrawfishUser {
    return {
      ...data,
      createdAt: (data.createdAt as admin.firestore.Timestamp).toDate(),
      lastLoginAt: (data.lastLoginAt as admin.firestore.Timestamp).toDate(),
      trialEndsAt: data.trialEndsAt
        ? (data.trialEndsAt as admin.firestore.Timestamp).toDate()
        : undefined,
    } as CrawfishUser;
  }
}
