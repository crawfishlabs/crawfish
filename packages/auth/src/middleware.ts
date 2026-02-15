/**
 * @fileoverview Firebase Auth Express Middleware
 * @description Validates Firebase Auth ID tokens and extracts user information
 */

import { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';

export interface AuthenticatedRequest extends Request {
  /** Firebase user ID extracted from the authentication token */
  userId: string;
  /** Firebase ID token for additional verification if needed */
  idToken: string;
}

/**
 * Express middleware that validates Firebase Auth ID tokens
 * 
 * Extracts the Authorization header, validates the Firebase ID token,
 * and adds userId to the request object. Returns 401 if token is missing or invalid.
 * 
 * @example
 * ```typescript
 * import express from 'express';
 * import { authMiddleware } from '@claw/auth';
 * 
 * const app = express();
 * app.use('/api', authMiddleware);
 * ```
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Missing or invalid authorization header' 
      });
      return;
    }

    const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Add user information to request object
    (req as AuthenticatedRequest).userId = decodedToken.uid;
    (req as AuthenticatedRequest).idToken = idToken;
    
    next();
  } catch (error) {
    console.error('Firebase Auth verification failed:', error);
    res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Invalid or expired token' 
    });
  }
};

/**
 * Optional middleware for endpoints that support both authenticated and anonymous access
 * 
 * Similar to authMiddleware but doesn't return 401 if no token is provided.
 * Sets userId to null for anonymous requests.
 */
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Anonymous access - continue without user ID
      (req as AuthenticatedRequest).userId = null as any;
      (req as AuthenticatedRequest).idToken = null as any;
      next();
      return;
    }

    const idToken = authHeader.substring(7);
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    (req as AuthenticatedRequest).userId = decodedToken.uid;
    (req as AuthenticatedRequest).idToken = idToken;
    
    next();
  } catch (error) {
    console.error('Optional auth verification failed:', error);
    // For optional auth, continue as anonymous on token errors
    (req as AuthenticatedRequest).userId = null as any;
    (req as AuthenticatedRequest).idToken = null as any;
    next();
  }
};