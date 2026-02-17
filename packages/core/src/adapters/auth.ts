/**
 * @claw/core — Authentication Adapter
 *
 * Abstracts user authentication and token verification.
 * Implementations: FirebaseAuth, Auth0Adapter, ClerkAdapter, etc.
 */

export interface AuthUser {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  emailVerified?: boolean;
  disabled?: boolean;
}

export interface TokenPayload {
  uid: string;
  email?: string;
  claims?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface CrawfishAuth {
  /** Verify a bearer token and return the decoded payload. */
  verifyToken(token: string): Promise<TokenPayload>;

  /** Create a new user account. */
  createUser(email: string, password: string, displayName?: string): Promise<AuthUser>;

  /** Get user by UID. */
  getUser(uid: string): Promise<AuthUser | null>;

  /** Delete a user account. */
  deleteUser(uid: string): Promise<void>;

  /** Set custom claims on a user (for role-based access). */
  setCustomClaims?(uid: string, claims: Record<string, unknown>): Promise<void>;
}
