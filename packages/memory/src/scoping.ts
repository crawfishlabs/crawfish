/**
 * @fileoverview Context scoping by request type
 * @description Returns only relevant user data based on the type of AI request
 */

import * as admin from 'firebase-admin';
import { 
  RequestType, 
  ScopedContext, 
  UserContext, 
  DailyLog, 
  MealEntry, 
  WorkoutEntry 
} from './types';
import { getUserContext } from './store';

/**
 * Get scoped context data based on request type
 * 
 * Returns only the subset of user data relevant to the specific request type.
 * This helps reduce token usage and improves AI response relevance.
 * 
 * @param userId - Firebase user ID
 * @param requestType - Type of request determining data scope
 * @param memoryDepthDays - How many days of history to include (optional)
 * @returns Promise resolving to scoped context data
 * 
 * @example
 * ```typescript
 * // For meal scanning - only returns recent meals and nutrition data
 * const context = await getScopedContext('user123', 'meal-scan');
 * 
 * // For coaching chat - returns comprehensive data
 * const context = await getScopedContext('user123', 'coach-chat');
 * ```
 */
export async function getScopedContext(
  userId: string,
  requestType: RequestType,
  memoryDepthDays?: number
): Promise<ScopedContext | null> {
  try {
    // Get full user context
    const fullContext = await getUserContext(userId, memoryDepthDays);
    if (!fullContext) {
      return null;
    }
    
    // Apply scoping based on request type
    const scopedData = await getContextForRequestType(fullContext, requestType);
    
    return {
      requestType,
      user: {
        goals: fullContext.goals,
        dietaryRestrictions: fullContext.dietaryRestrictions,
        preferences: {
          workoutPreferences: fullContext.workoutPreferences,
        },
      },
      recentData: scopedData.recentData,
      summaries: scopedData.summaries,
      generatedAt: admin.firestore.Timestamp.now(),
    };
    
  } catch (error) {
    console.error('Error getting scoped context:', error);
    return null;
  }
}

/**
 * Apply context scoping rules for specific request types
 * 
 * @param fullContext - Complete user context
 * @param requestType - Type of request determining scope
 * @returns Scoped data relevant to request type
 */
export async function getContextForRequestType(
  fullContext: UserContext,
  requestType: RequestType
): Promise<{
  recentData: ScopedContext['recentData'];
  summaries?: ScopedContext['summaries'];
}> {
  switch (requestType) {
    case 'meal-scan':
      return getMealScanContext(fullContext);
    
    case 'meal-log':
      return getMealLogContext(fullContext);
    
    case 'coach-chat':
      return getCoachChatContext(fullContext);
    
    case 'workout':
      return getWorkoutContext(fullContext);
    
    case 'weekly-review':
      return getWeeklyReviewContext(fullContext);
    
    default:
      console.warn(`Unknown request type: ${requestType}, returning minimal context`);
      return {
        recentData: {
          logs: fullContext.recentLogs.slice(0, 3), // Last 3 days only
        },
      };
  }
}

/**
 * Context for meal photo scanning and analysis
 * 
 * Focus: Recent meals, dietary restrictions, nutrition goals
 */
function getMealScanContext(context: UserContext): {
  recentData: ScopedContext['recentData'];
  summaries?: ScopedContext['summaries'];
} {
  // Get recent meals from last 7 days
  const recentMeals: MealEntry[] = [];
  const last7Days = context.recentLogs.slice(0, 7);
  
  last7Days.forEach(log => {
    recentMeals.push(...log.meals);
  });
  
  // Sort by timestamp, most recent first
  recentMeals.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
  
  return {
    recentData: {
      meals: recentMeals.slice(0, 10), // Last 10 meals
      logs: last7Days, // For daily nutrition totals
    },
  };
}

/**
 * Context for manual meal logging
 * 
 * Focus: Today's meals, nutrition targets, recent patterns
 */
function getMealLogContext(context: UserContext): {
  recentData: ScopedContext['recentData'];
  summaries?: ScopedContext['summaries'];
} {
  const today = new Date().toISOString().split('T')[0];
  const todayLog = context.recentLogs.find(log => log.date === today);
  
  // Get recent meals for pattern recognition
  const recentMeals: MealEntry[] = [];
  const last3Days = context.recentLogs.slice(0, 3);
  
  last3Days.forEach(log => {
    recentMeals.push(...log.meals);
  });
  
  return {
    recentData: {
      meals: recentMeals,
      logs: [todayLog].filter(Boolean) as DailyLog[], // Today's log only
    },
  };
}

/**
 * Context for AI coaching conversations
 * 
 * Focus: Comprehensive data for personalized advice
 */
function getCoachChatContext(context: UserContext): {
  recentData: ScopedContext['recentData'];
  summaries?: ScopedContext['summaries'];
} {
  // Get recent meals and workouts
  const recentMeals: MealEntry[] = [];
  const recentWorkouts: WorkoutEntry[] = [];
  const last14Days = context.recentLogs.slice(0, 14);
  
  last14Days.forEach(log => {
    recentMeals.push(...log.meals);
    recentWorkouts.push(...log.workouts);
  });
  
  return {
    recentData: {
      meals: recentMeals.slice(0, 20), // Last 20 meals
      workouts: recentWorkouts.slice(0, 15), // Last 15 workouts
      logs: last14Days, // Full logs for comprehensive analysis
    },
    summaries: {
      weekly: context.weeklySummaries.slice(0, 4), // Last 4 weeks
      monthly: context.monthlySummaries.slice(0, 2), // Last 2 months
    },
  };
}

/**
 * Context for workout logging and analysis
 * 
 * Focus: Recent workouts, fitness goals, progress tracking
 */
function getWorkoutContext(context: UserContext): {
  recentData: ScopedContext['recentData'];
  summaries?: ScopedContext['summaries'];
} {
  // Get recent workouts from last 14 days
  const recentWorkouts: WorkoutEntry[] = [];
  const last14Days = context.recentLogs.slice(0, 14);
  
  last14Days.forEach(log => {
    recentWorkouts.push(...log.workouts);
  });
  
  // Sort by timestamp, most recent first
  recentWorkouts.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
  
  return {
    recentData: {
      workouts: recentWorkouts, // All recent workouts
      logs: last14Days.filter(log => log.workouts.length > 0), // Days with workouts
    },
    summaries: {
      weekly: context.weeklySummaries.slice(0, 2), // Last 2 weeks for progress
    },
  };
}

/**
 * Context for weekly review and planning
 * 
 * Focus: Weekly patterns, progress analysis, goal setting
 */
function getWeeklyReviewContext(context: UserContext): {
  recentData: ScopedContext['recentData'];
  summaries?: ScopedContext['summaries'];
} {
  // Get full week of data (7 days)
  const lastWeek = context.recentLogs.slice(0, 7);
  
  // Get all meals and workouts from the week
  const weekMeals: MealEntry[] = [];
  const weekWorkouts: WorkoutEntry[] = [];
  
  lastWeek.forEach(log => {
    weekMeals.push(...log.meals);
    weekWorkouts.push(...log.workouts);
  });
  
  return {
    recentData: {
      meals: weekMeals,
      workouts: weekWorkouts,
      logs: lastWeek,
    },
    summaries: {
      weekly: context.weeklySummaries.slice(0, 8), // Last 8 weeks for trends
      monthly: context.monthlySummaries.slice(0, 3), // Last 3 months for context
    },
  };
}

/**
 * Get memory depth configuration based on user role/tier
 * 
 * @param userId - Firebase user ID
 * @returns Number of days of memory to retain
 */
export async function getMemoryDepthForUser(userId: string): Promise<number> {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return 7; // Default to 1 week for new users
    }
    
    const userData = userDoc.data()!;
    const userRole = userData.role;
    
    // Memory depth based on subscription tier
    switch (userRole) {
      case 'admin':
        return 365; // 1 year
      case 'pro':
        return 90; // 3 months
      case 'free':
      default:
        return 30; // 1 month
    }
  } catch (error) {
    console.error('Error getting memory depth for user:', error);
    return 7; // Fallback to 1 week
  }
}