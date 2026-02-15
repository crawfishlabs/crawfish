/**
 * @fileoverview Weekly memory refresh job logic
 * @description Scheduled functions for generating memory summaries and data cleanup
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { 
  WeeklyMemorySummary, 
  MonthlyMemorySummary, 
  DailyLog, 
  MemoryRefreshConfig 
} from './types';
import { getUserContext, updateMemorySummary, deleteDailyLog } from './store';

/**
 * Weekly memory refresh Cloud Function
 * 
 * Runs every Sunday at 2 AM UTC to:
 * - Generate weekly summaries for all users
 * - Clean up old daily logs based on retention policy
 * 
 * @example Deploy:
 * ```bash
 * firebase deploy --only functions:scheduleWeeklyRefresh
 * ```
 */
export const scheduleWeeklyRefresh = functions.pubsub
  .schedule('0 2 * * 0') // Every Sunday at 2 AM UTC
  .timeZone('UTC')
  .onRun(async (context) => {
    console.log('Starting weekly memory refresh job');
    
    try {
      const db = admin.firestore();
      
      // Get all users who need weekly refresh
      const usersQuery = await db.collection('users')
        .where('subscriptionStatus', 'in', ['active', 'trial', 'inactive'])
        .get();
      
      const refreshPromises = usersQuery.docs.map(userDoc => 
        processWeeklyRefreshForUser(userDoc.id)
      );
      
      await Promise.allSettled(refreshPromises);
      
      console.log(`Completed weekly refresh for ${usersQuery.size} users`);
    } catch (error) {
      console.error('Weekly refresh job failed:', error);
      throw error;
    }
  });

/**
 * Monthly memory refresh Cloud Function
 * 
 * Runs on the 1st of each month at 3 AM UTC to:
 * - Generate monthly summaries
 * - Archive old weekly summaries
 * 
 * @example Deploy:
 * ```bash
 * firebase deploy --only functions:scheduleMonthlyRefresh
 * ```
 */
export const scheduleMonthlyRefresh = functions.pubsub
  .schedule('0 3 1 * *') // 1st of each month at 3 AM UTC
  .timeZone('UTC')
  .onRun(async (context) => {
    console.log('Starting monthly memory refresh job');
    
    try {
      const db = admin.firestore();
      
      // Get all users who need monthly refresh
      const usersQuery = await db.collection('users')
        .where('subscriptionStatus', 'in', ['active', 'trial'])
        .get();
      
      const refreshPromises = usersQuery.docs.map(userDoc => 
        processMonthlyRefreshForUser(userDoc.id)
      );
      
      await Promise.allSettled(refreshPromises);
      
      console.log(`Completed monthly refresh for ${usersQuery.size} users`);
    } catch (error) {
      console.error('Monthly refresh job failed:', error);
      throw error;
    }
  });

/**
 * Manual memory refresh function for individual users
 * 
 * Can be triggered via HTTP request for immediate refresh
 * 
 * @param userId - Firebase user ID
 * @param type - Type of refresh ('weekly' or 'monthly')
 * @returns Promise resolving to success status
 */
export async function processMemoryRefresh(
  userId: string,
  type: 'weekly' | 'monthly'
): Promise<boolean> {
  try {
    if (type === 'weekly') {
      return await processWeeklyRefreshForUser(userId);
    } else {
      return await processMonthlyRefreshForUser(userId);
    }
  } catch (error) {
    console.error(`Memory refresh failed for user ${userId}:`, error);
    return false;
  }
}

/**
 * Process weekly memory refresh for a single user
 * 
 * @param userId - Firebase user ID
 * @returns Promise resolving to success status
 */
async function processWeeklyRefreshForUser(userId: string): Promise<boolean> {
  try {
    console.log(`Processing weekly refresh for user: ${userId}`);
    
    // Get last week's date range
    const { weekStart, weekEnd } = getLastWeekDateRange();
    
    // Check if summary already exists
    const existingSummary = await getWeeklySummary(userId, weekStart);
    if (existingSummary) {
      console.log(`Weekly summary already exists for ${userId} week ${weekStart}`);
      return true;
    }
    
    // Get user context for the week
    const userContext = await getUserContext(userId, 14); // 2 weeks of data
    if (!userContext) {
      console.log(`No context found for user ${userId}, skipping`);
      return false;
    }
    
    // Filter logs to the specific week
    const weekLogs = userContext.recentLogs.filter(log => 
      log.date >= weekStart && log.date <= weekEnd
    );
    
    if (weekLogs.length === 0) {
      console.log(`No activity for user ${userId} in week ${weekStart}, skipping`);
      return true;
    }
    
    // Generate AI summary (this would call the LLM router)
    const weeklySum = await generateWeeklySummary(userId, weekLogs, userContext);
    
    // Save the summary
    const success = await updateMemorySummary(userId, 'weekly', weekStart, weeklySum);
    
    // Clean up old daily logs based on retention policy
    await cleanupOldDailyLogs(userId);
    
    console.log(`Completed weekly refresh for user ${userId}`);
    return success;
    
  } catch (error) {
    console.error(`Weekly refresh failed for user ${userId}:`, error);
    return false;
  }
}

/**
 * Process monthly memory refresh for a single user
 * 
 * @param userId - Firebase user ID
 * @returns Promise resolving to success status
 */
async function processMonthlyRefreshForUser(userId: string): Promise<boolean> {
  try {
    console.log(`Processing monthly refresh for user: ${userId}`);
    
    // Get last month's identifier
    const lastMonth = getLastMonthIdentifier();
    
    // Check if summary already exists
    const existingSummary = await getMonthlySum(userId, lastMonth);
    if (existingSummary) {
      console.log(`Monthly summary already exists for ${userId} month ${lastMonth}`);
      return true;
    }
    
    // Get user context for the month
    const userContext = await getUserContext(userId, 60); // 2 months of data
    if (!userContext) {
      console.log(`No context found for user ${userId}, skipping`);
      return false;
    }
    
    // Get weekly summaries for the month
    const monthWeeklySummaries = userContext.weeklySummaries.filter(summary =>
      summary.weekStart.startsWith(lastMonth)
    );
    
    if (monthWeeklySummaries.length === 0) {
      console.log(`No weekly summaries for user ${userId} in month ${lastMonth}, skipping`);
      return true;
    }
    
    // Generate AI summary from weekly summaries
    const monthlySum = await generateMonthlySummary(userId, monthWeeklySummaries, userContext);
    
    // Save the summary
    const success = await updateMemorySummary(userId, 'monthly', lastMonth, monthlySum);
    
    console.log(`Completed monthly refresh for user ${userId}`);
    return success;
    
  } catch (error) {
    console.error(`Monthly refresh failed for user ${userId}:`, error);
    return false;
  }
}

/**
 * Get date range for last complete week (Monday to Sunday)
 * 
 * @returns Object with weekStart and weekEnd in YYYY-MM-DD format
 */
function getLastWeekDateRange(): { weekStart: string; weekEnd: string } {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Calculate last Monday
  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - dayOfWeek - 6); // Go back to last Monday
  
  // Calculate last Sunday
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  
  return {
    weekStart: lastMonday.toISOString().split('T')[0],
    weekEnd: lastSunday.toISOString().split('T')[0],
  };
}

/**
 * Get identifier for last complete month (YYYY-MM)
 * 
 * @returns Month identifier in YYYY-MM format
 */
function getLastMonthIdentifier(): string {
  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  
  return lastMonth.toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Generate weekly summary using AI
 * 
 * @param userId - Firebase user ID
 * @param weekLogs - Daily logs for the week
 * @param context - Full user context
 * @returns Promise resolving to weekly summary
 */
async function generateWeeklySummary(
  userId: string,
  weekLogs: DailyLog[],
  context: any
): Promise<WeeklyMemorySummary> {
  // TODO: This would integrate with @claw/llm-router
  // For now, return a basic summary structure
  
  const weekStart = weekLogs[0]?.date || '';
  const weekEnd = weekLogs[weekLogs.length - 1]?.date || '';
  
  // Calculate basic stats
  const totalMeals = weekLogs.reduce((sum, log) => sum + log.meals.length, 0);
  const totalWorkouts = weekLogs.reduce((sum, log) => sum + log.workouts.length, 0);
  const averageMood = calculateAverageMood(weekLogs);
  
  return {
    weekStart,
    weekEnd,
    summary: `Week of ${weekStart}: Logged ${totalMeals} meals and ${totalWorkouts} workouts. Average mood: ${averageMood.toFixed(1)}/10.`,
    insights: [
      `Most active on ${getMostActiveDay(weekLogs)}`,
      `Consistent meal logging: ${totalMeals > 14 ? 'Good' : 'Could improve'}`,
    ],
    goalProgress: `Made progress on ${totalWorkouts > 0 ? 'fitness' : 'nutrition tracking'}`,
    recommendations: [
      totalWorkouts < 3 ? 'Try to increase workout frequency next week' : 'Great workout consistency!',
      totalMeals < 14 ? 'Improve meal logging consistency' : 'Excellent meal tracking',
    ],
    generatedAt: admin.firestore.Timestamp.now(),
  };
}

/**
 * Generate monthly summary from weekly summaries
 * 
 * @param userId - Firebase user ID
 * @param weeklySummaries - Weekly summaries for the month
 * @param context - Full user context
 * @returns Promise resolving to monthly summary
 */
async function generateMonthlySummary(
  userId: string,
  weeklySummaries: WeeklyMemorySummary[],
  context: any
): Promise<MonthlyMemorySummary> {
  // TODO: This would integrate with @claw/llm-router
  // For now, return a basic summary structure
  
  const month = weeklySummaries[0]?.weekStart.slice(0, 7) || '';
  
  return {
    month,
    summary: `Month of ${month}: Completed ${weeklySummaries.length} weeks of tracking.`,
    achievements: [
      'Maintained consistent logging',
      'Improved workout frequency',
    ],
    challenges: [
      'Weekend meal tracking needs improvement',
    ],
    trends: {
      fitness: 'Increasing workout intensity',
      nutrition: 'More balanced meals',
      mood: 'Stable and improving',
    },
    nextMonthGoals: [
      'Increase protein intake',
      'Add more cardio workouts',
    ],
    generatedAt: admin.firestore.Timestamp.now(),
  };
}

/**
 * Clean up old daily logs based on user retention policy
 * 
 * @param userId - Firebase user ID
 */
async function cleanupOldDailyLogs(userId: string): Promise<void> {
  try {
    const db = admin.firestore();
    
    // Get user's retention policy
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const maxRetentionDays = getRetentionDays(userData?.role);
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxRetentionDays);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    
    // Find old logs to delete
    const oldLogsQuery = await db
      .collection('users')
      .doc(userId)
      .collection('daily-logs')
      .where('date', '<', cutoffDateStr)
      .get();
    
    // Delete old logs in batches
    const batch = db.batch();
    oldLogsQuery.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    if (oldLogsQuery.size > 0) {
      await batch.commit();
      console.log(`Cleaned up ${oldLogsQuery.size} old daily logs for user ${userId}`);
    }
    
  } catch (error) {
    console.error(`Failed to cleanup old logs for user ${userId}:`, error);
  }
}

/**
 * Get retention days based on user role
 * 
 * @param role - User role (free/pro/admin)
 * @returns Number of days to retain daily logs
 */
function getRetentionDays(role: string): number {
  switch (role) {
    case 'admin':
      return 365; // 1 year
    case 'pro':
      return 180; // 6 months
    case 'free':
    default:
      return 60; // 2 months
  }
}

// Helper functions
async function getWeeklySummary(userId: string, weekStart: string) {
  const db = admin.firestore();
  const doc = await db
    .collection('users')
    .doc(userId)
    .collection('memory-summaries')
    .doc('weekly')
    .collection('summaries')
    .doc(weekStart)
    .get();
  
  return doc.exists ? doc.data() : null;
}

async function getMonthlySum(userId: string, month: string) {
  const db = admin.firestore();
  const doc = await db
    .collection('users')
    .doc(userId)
    .collection('memory-summaries')
    .doc('monthly')
    .collection('summaries')
    .doc(month)
    .get();
  
  return doc.exists ? doc.data() : null;
}

function calculateAverageMood(logs: DailyLog[]): number {
  const moodLogs = logs.filter(log => log.mood !== null);
  if (moodLogs.length === 0) return 5; // Default neutral
  
  const sum = moodLogs.reduce((total, log) => total + log.mood!, 0);
  return sum / moodLogs.length;
}

function getMostActiveDay(logs: DailyLog[]): string {
  let mostActive = logs[0];
  let maxActivity = 0;
  
  logs.forEach(log => {
    const activity = log.meals.length + log.workouts.length;
    if (activity > maxActivity) {
      maxActivity = activity;
      mostActive = log;
    }
  });
  
  const date = new Date(mostActive.date);
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}