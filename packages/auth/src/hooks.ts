/**
 * @fileoverview Firebase Auth User Creation Hooks
 * @description Firestore triggers for automatic user provisioning
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { UserRole } from './roles';

/**
 * User data structure created on user registration
 */
export interface UserDocument {
  /** User's email address */
  email: string;
  /** Display name from Firebase Auth */
  displayName: string | null;
  /** Profile photo URL from Firebase Auth */
  photoURL: string | null;
  /** User's subscription role (free/pro/admin) */
  role: UserRole;
  /** Account creation timestamp */
  createdAt: admin.firestore.Timestamp;
  /** Last activity timestamp */
  lastActiveAt: admin.firestore.Timestamp;
  /** User's subscription status */
  subscriptionStatus: 'active' | 'inactive' | 'trial';
  /** Subscription expiry date (null for free tier) */
  subscriptionExpiresAt: admin.firestore.Timestamp | null;
}

/**
 * Memory store structure created for each new user
 */
export interface UserMemoryStore {
  /** User's daily nutrition and workout logs */
  dailyLogs: {
    [date: string]: {
      meals: any[];
      workouts: any[];
      notes: string[];
      mood: number | null;
      weight: number | null;
    };
  };
  /** Long-term memory summaries for AI coaching */
  memorySummaries: {
    weekly: any[];
    monthly: any[];
  };
  /** User preferences and goals */
  preferences: {
    goals: string[];
    dietaryRestrictions: string[];
    workoutPreferences: string[];
    units: 'metric' | 'imperial';
  };
  /** Context scoping settings */
  contextSettings: {
    memoryDepth: number;
    shareDataWithCoach: boolean;
  };
}

/**
 * Firebase Cloud Function triggered on user creation
 * 
 * Automatically provisions:
 * - User document in /users/{userId}
 * - Memory store structure
 * - Default preferences
 * - Free tier role assignment
 * 
 * @example Deploy this function:
 * ```bash
 * firebase deploy --only functions:createUserHook
 * ```
 */
export const createUserHook = functions.auth.user().onCreate(async (user) => {
  const db = admin.firestore();
  const userId = user.uid;
  
  console.log(`Provisioning new user: ${userId} (${user.email})`);
  
  try {
    // Create user document
    const userDoc: UserDocument = {
      email: user.email || '',
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      role: 'free',
      createdAt: admin.firestore.Timestamp.now(),
      lastActiveAt: admin.firestore.Timestamp.now(),
      subscriptionStatus: 'inactive',
      subscriptionExpiresAt: null,
    };
    
    // Create memory store structure
    const memoryStore: UserMemoryStore = {
      dailyLogs: {},
      memorySummaries: {
        weekly: [],
        monthly: [],
      },
      preferences: {
        goals: [],
        dietaryRestrictions: [],
        workoutPreferences: [],
        units: 'metric',
      },
      contextSettings: {
        memoryDepth: 30, // days
        shareDataWithCoach: true,
      },
    };
    
    // Write to Firestore in a batch
    const batch = db.batch();
    
    // User document
    const userRef = db.collection('users').doc(userId);
    batch.set(userRef, userDoc);
    
    // Memory store document
    const memoryRef = db.collection('users').doc(userId).collection('memory').doc('store');
    batch.set(memoryRef, memoryStore);
    
    // Create initial daily log for today
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const dailyLogRef = db.collection('users').doc(userId).collection('daily-logs').doc(today);
    batch.set(dailyLogRef, {
      date: today,
      meals: [],
      workouts: [],
      notes: [`Welcome to Claw! Account created on ${new Date().toLocaleDateString()}`],
      mood: null,
      weight: null,
      createdAt: admin.firestore.Timestamp.now(),
    });
    
    await batch.commit();
    
    console.log(`Successfully provisioned user: ${userId}`);
    
    // Optional: Send welcome email or notification
    // await sendWelcomeNotification(user.email, user.displayName);
    
  } catch (error) {
    console.error(`Failed to provision user ${userId}:`, error);
    throw new functions.https.HttpsError('internal', 'Failed to create user account');
  }
});

/**
 * Firebase Cloud Function triggered on user deletion
 * 
 * Cleans up all user data when account is deleted
 */
export const deleteUserHook = functions.auth.user().onDelete(async (user) => {
  const db = admin.firestore();
  const userId = user.uid;
  
  console.log(`Cleaning up deleted user: ${userId}`);
  
  try {
    // Delete all user data
    const batch = db.batch();
    
    // Delete user document
    const userRef = db.collection('users').doc(userId);
    batch.delete(userRef);
    
    // Note: Subcollections need to be deleted recursively
    // This is a simplified example - in production, use a recursive delete function
    
    await batch.commit();
    console.log(`Successfully cleaned up user: ${userId}`);
    
  } catch (error) {
    console.error(`Failed to cleanup user ${userId}:`, error);
  }
});