/**
 * @fileoverview Firestore CRUD operations for memory management
 * @description Core functions for storing and retrieving user memory data
 */

import * as admin from 'firebase-admin';
import { 
  DailyLog, 
  UserContext, 
  WeeklyMemorySummary, 
  MonthlyMemorySummary, 
  MealEntry, 
  WorkoutEntry,
  MemoryTier 
} from './types';

/**
 * Get complete user context data for AI interactions
 * 
 * @param userId - Firebase user ID
 * @param memoryDepthDays - Number of days of history to include (default: 30)
 * @returns Promise resolving to user context data
 * 
 * @example
 * ```typescript
 * const context = await getUserContext('user123', 14);
 * console.log(`User has ${context.recentLogs.length} recent logs`);
 * ```
 */
export async function getUserContext(
  userId: string, 
  memoryDepthDays: number = 30
): Promise<UserContext | null> {
  try {
    const db = admin.firestore();
    
    // Get user document for goals and preferences
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.error(`User document not found: ${userId}`);
      return null;
    }
    
    const userData = userDoc.data()!;
    
    // Calculate date range for recent logs
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - memoryDepthDays);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // Get recent daily logs
    const dailyLogsQuery = await db
      .collection('users')
      .doc(userId)
      .collection('daily-logs')
      .where('date', '>=', startDateStr)
      .where('date', '<=', endDateStr)
      .orderBy('date', 'desc')
      .get();
    
    const recentLogs: DailyLog[] = dailyLogsQuery.docs.map(doc => ({
      date: doc.id,
      ...doc.data()
    } as DailyLog));
    
    // Get weekly summaries (last 12 weeks)
    const weeklyQuery = await db
      .collection('users')
      .doc(userId)
      .collection('memory-summaries')
      .doc('weekly')
      .collection('summaries')
      .orderBy('weekStart', 'desc')
      .limit(12)
      .get();
    
    const weeklySummaries: WeeklyMemorySummary[] = weeklyQuery.docs.map(doc => 
      doc.data() as WeeklyMemorySummary
    );
    
    // Get monthly summaries (last 6 months)
    const monthlyQuery = await db
      .collection('users')
      .doc(userId)
      .collection('memory-summaries')
      .doc('monthly')
      .collection('summaries')
      .orderBy('month', 'desc')
      .limit(6)
      .get();
    
    const monthlySummaries: MonthlyMemorySummary[] = monthlyQuery.docs.map(doc =>
      doc.data() as MonthlyMemorySummary
    );
    
    // Calculate progress metrics
    const weightProgress = calculateWeightProgress(recentLogs);
    const consistencyScore = calculateConsistencyScore(recentLogs);
    
    // Get current stats from most recent log
    const latestLog = recentLogs[0];
    const currentStats = {
      weight: latestLog?.weight || null,
      bodyFat: null, // TODO: Add body composition tracking
      muscleMass: null,
    };
    
    return {
      goals: userData.preferences?.goals || [],
      dietaryRestrictions: userData.preferences?.dietaryRestrictions || [],
      workoutPreferences: userData.preferences?.workoutPreferences || [],
      recentLogs,
      weeklySummaries,
      monthlySummaries,
      currentStats,
      progress: {
        weightChange: weightProgress,
        strengthProgress: 'Tracking in progress', // TODO: Implement strength tracking
        consistencyScore,
      },
    };
    
  } catch (error) {
    console.error('Error getting user context:', error);
    return null;
  }
}

/**
 * Update or create a daily log entry
 * 
 * @param userId - Firebase user ID
 * @param date - Date in YYYY-MM-DD format
 * @param updates - Partial daily log data to update
 * @returns Promise resolving to success status
 */
export async function updateDailyLog(
  userId: string,
  date: string,
  updates: Partial<DailyLog>
): Promise<boolean> {
  try {
    const db = admin.firestore();
    const dailyLogRef = db
      .collection('users')
      .doc(userId)
      .collection('daily-logs')
      .doc(date);
    
    const existingLog = await dailyLogRef.get();
    
    if (existingLog.exists) {
      // Update existing log
      await dailyLogRef.update({
        ...updates,
        updatedAt: admin.firestore.Timestamp.now(),
      });
    } else {
      // Create new log
      const newLog: DailyLog = {
        date,
        meals: [],
        workouts: [],
        notes: [],
        mood: null,
        weight: null,
        sleep: null,
        water: null,
        goalProgress: {
          calories: null,
          protein: null,
          steps: null,
        },
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        ...updates,
      };
      
      await dailyLogRef.set(newLog);
    }
    
    console.log(`Updated daily log for ${userId} on ${date}`);
    return true;
  } catch (error) {
    console.error('Error updating daily log:', error);
    return false;
  }
}

/**
 * Get memory summary (weekly or monthly)
 * 
 * @param userId - Firebase user ID
 * @param type - Summary type ('weekly' or 'monthly')
 * @param identifier - Week start date (YYYY-MM-DD) or month (YYYY-MM)
 * @returns Promise resolving to memory summary
 */
export async function getMemorySummary(
  userId: string,
  type: 'weekly' | 'monthly',
  identifier: string
): Promise<WeeklyMemorySummary | MonthlyMemorySummary | null> {
  try {
    const db = admin.firestore();
    const summaryDoc = await db
      .collection('users')
      .doc(userId)
      .collection('memory-summaries')
      .doc(type)
      .collection('summaries')
      .doc(identifier)
      .get();
    
    if (!summaryDoc.exists) {
      return null;
    }
    
    return summaryDoc.data() as WeeklyMemorySummary | MonthlyMemorySummary;
  } catch (error) {
    console.error('Error getting memory summary:', error);
    return null;
  }
}

/**
 * Update or create a memory summary
 * 
 * @param userId - Firebase user ID
 * @param type - Summary type ('weekly' or 'monthly')
 * @param identifier - Week start date (YYYY-MM-DD) or month (YYYY-MM)
 * @param summary - Summary data
 * @returns Promise resolving to success status
 */
export async function updateMemorySummary(
  userId: string,
  type: 'weekly' | 'monthly',
  identifier: string,
  summary: WeeklyMemorySummary | MonthlyMemorySummary
): Promise<boolean> {
  try {
    const db = admin.firestore();
    const summaryRef = db
      .collection('users')
      .doc(userId)
      .collection('memory-summaries')
      .doc(type)
      .collection('summaries')
      .doc(identifier);
    
    await summaryRef.set(summary);
    
    console.log(`Updated ${type} memory summary for ${userId}: ${identifier}`);
    return true;
  } catch (error) {
    console.error('Error updating memory summary:', error);
    return false;
  }
}

/**
 * Create a new daily log entry
 * 
 * @param userId - Firebase user ID
 * @param date - Date in YYYY-MM-DD format
 * @returns Promise resolving to success status
 */
export async function createDailyLog(
  userId: string,
  date: string
): Promise<boolean> {
  const newLog: DailyLog = {
    date,
    meals: [],
    workouts: [],
    notes: [],
    mood: null,
    weight: null,
    sleep: null,
    water: null,
    goalProgress: {
      calories: null,
      protein: null,
      steps: null,
    },
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  };
  
  return await updateDailyLog(userId, date, newLog);
}

/**
 * Delete a daily log entry
 * 
 * @param userId - Firebase user ID
 * @param date - Date in YYYY-MM-DD format
 * @returns Promise resolving to success status
 */
export async function deleteDailyLog(
  userId: string,
  date: string
): Promise<boolean> {
  try {
    const db = admin.firestore();
    await db
      .collection('users')
      .doc(userId)
      .collection('daily-logs')
      .doc(date)
      .delete();
    
    console.log(`Deleted daily log for ${userId} on ${date}`);
    return true;
  } catch (error) {
    console.error('Error deleting daily log:', error);
    return false;
  }
}

/**
 * Calculate weight progress over the last 30 days
 * 
 * @param recentLogs - Array of recent daily logs
 * @returns Weight change in kg (positive = gained, negative = lost)
 */
function calculateWeightProgress(recentLogs: DailyLog[]): number {
  const logsWithWeight = recentLogs.filter(log => log.weight !== null);
  
  if (logsWithWeight.length < 2) {
    return 0;
  }
  
  // Get oldest and newest weight measurements
  const sortedLogs = logsWithWeight.sort((a, b) => a.date.localeCompare(b.date));
  const oldestWeight = sortedLogs[0].weight!;
  const newestWeight = sortedLogs[sortedLogs.length - 1].weight!;
  
  return newestWeight - oldestWeight;
}

/**
 * Calculate consistency score based on logging frequency
 * 
 * @param recentLogs - Array of recent daily logs
 * @returns Consistency score from 0-100
 */
function calculateConsistencyScore(recentLogs: DailyLog[]): number {
  if (recentLogs.length === 0) {
    return 0;
  }
  
  const daysWithData = recentLogs.filter(log => 
    log.meals.length > 0 || log.workouts.length > 0 || log.notes.length > 0
  ).length;
  
  const totalDays = Math.min(recentLogs.length, 30); // Last 30 days max
  
  return Math.round((daysWithData / totalDays) * 100);
}