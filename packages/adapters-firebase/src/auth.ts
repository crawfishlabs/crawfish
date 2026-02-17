/**
 * Firebase Auth implementation of CrawfishAuth.
 */
import * as admin from 'firebase-admin';
import type { CrawfishAuth, AuthUser, TokenPayload } from '@claw/core';

export class FirebaseAuthAdapter implements CrawfishAuth {
  private auth: admin.auth.Auth;

  constructor(app?: admin.app.App) {
    this.auth = (app ?? admin.app()).auth();
  }

  async verifyToken(token: string): Promise<TokenPayload> {
    const decoded = await this.auth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      claims: decoded,
      expiresAt: new Date(decoded.exp * 1000),
    };
  }

  async createUser(email: string, password: string, displayName?: string): Promise<AuthUser> {
    const user = await this.auth.createUser({ email, password, displayName });
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: user.emailVerified,
      disabled: user.disabled,
    };
  }

  async getUser(uid: string): Promise<AuthUser | null> {
    try {
      const user = await this.auth.getUser(uid);
      return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        emailVerified: user.emailVerified,
        disabled: user.disabled,
      };
    } catch {
      return null;
    }
  }

  async deleteUser(uid: string): Promise<void> {
    await this.auth.deleteUser(uid);
  }

  async setCustomClaims(uid: string, claims: Record<string, unknown>): Promise<void> {
    await this.auth.setCustomClaims(uid, claims);
  }
}
