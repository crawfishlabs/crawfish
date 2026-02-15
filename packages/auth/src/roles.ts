/**
 * @fileoverview User Role Management System
 * @description Manages free/pro/admin roles and permissions
 */

import * as admin from 'firebase-admin';
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './middleware';

/**
 * Available user roles in the Claw platform
 */
export type UserRole = 'free' | 'pro' | 'admin';

/**
 * Permissions associated with each role
 */
export interface RolePermissions {
  /** Maximum daily LLM API calls */
  maxDailyLLMCalls: number;
  /** Maximum photos that can be analyzed per day */
  maxDailyPhotoAnalysis: number;
  /** Access to premium coaching features */
  premiumCoaching: boolean;
  /** Access to advanced nutrition analysis */
  advancedNutrition: boolean;
  /** Access to workout program generation */
  workoutPrograms: boolean;
  /** Can export data */
  dataExport: boolean;
  /** Can access admin features */
  adminAccess: boolean;
  /** Maximum memory retention in days */
  maxMemoryRetention: number;
}

/**
 * Role permission mappings
 */
export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  free: {
    maxDailyLLMCalls: 10,
    maxDailyPhotoAnalysis: 5,
    premiumCoaching: false,
    advancedNutrition: false,
    workoutPrograms: false,
    dataExport: false,
    adminAccess: false,
    maxMemoryRetention: 30, // 30 days
  },
  pro: {
    maxDailyLLMCalls: 100,
    maxDailyPhotoAnalysis: 50,
    premiumCoaching: true,
    advancedNutrition: true,
    workoutPrograms: true,
    dataExport: true,
    adminAccess: false,
    maxMemoryRetention: 365, // 1 year
  },
  admin: {
    maxDailyLLMCalls: -1, // unlimited
    maxDailyPhotoAnalysis: -1, // unlimited
    premiumCoaching: true,
    advancedNutrition: true,
    workoutPrograms: true,
    dataExport: true,
    adminAccess: true,
    maxMemoryRetention: -1, // unlimited
  },
};

/**
 * Check if a user has a specific role
 * 
 * @param userId - Firebase user ID
 * @param requiredRole - Role to check for
 * @returns Promise resolving to true if user has the role
 */
export async function hasRole(userId: string, requiredRole: UserRole): Promise<boolean> {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return false;
    }
    
    const userData = userDoc.data();
    const userRole = userData?.role as UserRole;
    
    // Admin has access to everything
    if (userRole === 'admin') {
      return true;
    }
    
    // Exact role match
    if (userRole === requiredRole) {
      return true;
    }
    
    // Pro users can access free features
    if (requiredRole === 'free' && userRole === 'pro') {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking user role:', error);
    return false;
  }
}

/**
 * Express middleware to require a minimum role for a route
 * 
 * @param requiredRole - Minimum role required
 * @returns Express middleware function
 * 
 * @example
 * ```typescript
 * app.get('/api/premium-feature', requireRole('pro'), (req, res) => {
 *   // Only pro and admin users can access this
 * });
 * ```
 */
export function requireRole(requiredRole: UserRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.userId) {
      res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authentication required' 
      });
      return;
    }
    
    const hasRequiredRole = await hasRole(authReq.userId, requiredRole);
    
    if (!hasRequiredRole) {
      res.status(403).json({ 
        error: 'Forbidden', 
        message: `${requiredRole} role required` 
      });
      return;
    }
    
    next();
  };
}

/**
 * Get role permissions for a user
 * 
 * @param userId - Firebase user ID
 * @returns Promise resolving to user's role permissions
 */
export async function getRolePermissions(userId: string): Promise<RolePermissions | null> {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return null;
    }
    
    const userData = userDoc.data();
    const userRole = userData?.role as UserRole;
    
    return ROLE_PERMISSIONS[userRole] || ROLE_PERMISSIONS.free;
  } catch (error) {
    console.error('Error getting role permissions:', error);
    return ROLE_PERMISSIONS.free; // Default to free tier on error
  }
}

/**
 * Upgrade a user's role (e.g., free → pro)
 * 
 * @param userId - Firebase user ID
 * @param newRole - New role to assign
 * @param subscriptionExpiresAt - When the subscription expires (null for permanent)
 * @returns Promise resolving to success status
 */
export async function upgradeUserRole(
  userId: string,
  newRole: UserRole,
  subscriptionExpiresAt: Date | null = null
): Promise<boolean> {
  try {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(userId);
    
    await userRef.update({
      role: newRole,
      subscriptionStatus: newRole === 'free' ? 'inactive' : 'active',
      subscriptionExpiresAt: subscriptionExpiresAt 
        ? admin.firestore.Timestamp.fromDate(subscriptionExpiresAt)
        : null,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    
    console.log(`Upgraded user ${userId} to ${newRole} role`);
    return true;
  } catch (error) {
    console.error('Error upgrading user role:', error);
    return false;
  }
}

/**
 * Downgrade a user's role (e.g., pro → free when subscription expires)
 * 
 * @param userId - Firebase user ID
 * @returns Promise resolving to success status
 */
export async function downgradeUserRole(userId: string): Promise<boolean> {
  try {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(userId);
    
    await userRef.update({
      role: 'free',
      subscriptionStatus: 'inactive',
      subscriptionExpiresAt: null,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    
    console.log(`Downgraded user ${userId} to free role`);
    return true;
  } catch (error) {
    console.error('Error downgrading user role:', error);
    return false;
  }
}

/**
 * Check if a user's subscription has expired and downgrade if needed
 * 
 * @param userId - Firebase user ID
 * @returns Promise resolving to current role after check
 */
export async function checkAndUpdateExpiredSubscription(userId: string): Promise<UserRole> {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return 'free';
    }
    
    const userData = userDoc.data();
    const userRole = userData?.role as UserRole;
    const expiresAt = userData?.subscriptionExpiresAt;
    
    // If no expiry date or admin role, no action needed
    if (!expiresAt || userRole === 'admin') {
      return userRole;
    }
    
    // Check if subscription has expired
    const now = admin.firestore.Timestamp.now();
    if (expiresAt.toMillis() < now.toMillis()) {
      await downgradeUserRole(userId);
      return 'free';
    }
    
    return userRole;
  } catch (error) {
    console.error('Error checking subscription expiry:', error);
    return 'free';
  }
}