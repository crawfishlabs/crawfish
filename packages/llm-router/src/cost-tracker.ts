/**
 * @fileoverview LLM cost tracking and logging with current pricing
 * @description Tracks every LLM API call for cost analysis, usage monitoring, and budget enforcement
 */

import * as admin from 'firebase-admin';
import { 
  LLMCallRecord, 
  DailyCostSummary, 
  RequestType, 
  LLMProvider, 
  LLMModel,
  RoutingPreference 
} from './types';

/**
 * Current pricing data for all models (as of Feb 2026)
 * Prices are per 1,000 tokens
 */
const MODEL_PRICING: Record<LLMProvider, Record<string, { inputTokenCost: number; outputTokenCost: number }>> = {
  anthropic: {
    'claude-opus-4-6': {
      inputTokenCost: 0.015,    // $15 per 1M tokens
      outputTokenCost: 0.075,   // $75 per 1M tokens
    },
    'claude-sonnet-4-20250514': {
      inputTokenCost: 0.003,    // $3 per 1M tokens
      outputTokenCost: 0.015,   // $15 per 1M tokens
    },
    'claude-haiku-3-5': {
      inputTokenCost: 0.00025,  // $0.25 per 1M tokens
      outputTokenCost: 0.00125, // $1.25 per 1M tokens
    },
    // Legacy model pricing (for backward compatibility)
    'claude-3-haiku-20240307': {
      inputTokenCost: 0.00025,
      outputTokenCost: 0.00125,
    },
    'claude-3-sonnet-20240229': {
      inputTokenCost: 0.003,
      outputTokenCost: 0.015,
    },
    'claude-3-opus-20240229': {
      inputTokenCost: 0.015,
      outputTokenCost: 0.075,
    },
    'claude-3.5-sonnet-20241022': {
      inputTokenCost: 0.003,
      outputTokenCost: 0.015,
    },
  },
  openai: {
    'gpt-4o': {
      inputTokenCost: 0.0025,   // $2.50 per 1M tokens
      outputTokenCost: 0.010,   // $10 per 1M tokens
    },
    'gpt-4o-mini': {
      inputTokenCost: 0.00015,  // $0.15 per 1M tokens
      outputTokenCost: 0.0006,  // $0.60 per 1M tokens
    },
    'gpt-4.1': {
      inputTokenCost: 0.003,    // $3 per 1M tokens (estimated)
      outputTokenCost: 0.012,   // $12 per 1M tokens (estimated)
    },
    'gpt-4.1-mini': {
      inputTokenCost: 0.0002,   // $0.20 per 1M tokens (estimated)
      outputTokenCost: 0.0008,  // $0.80 per 1M tokens (estimated)
    },
    'o3': {
      inputTokenCost: 0.020,    // $20 per 1M tokens (reasoning model)
      outputTokenCost: 0.080,   // $80 per 1M tokens (reasoning model)
    },
    'o4-mini': {
      inputTokenCost: 0.001,    // $1 per 1M tokens (cheap reasoning)
      outputTokenCost: 0.004,   // $4 per 1M tokens (cheap reasoning)
    },
    // Legacy models
    'gpt-4-turbo': {
      inputTokenCost: 0.010,
      outputTokenCost: 0.030,
    },
    'gpt-3.5-turbo': {
      inputTokenCost: 0.0005,
      outputTokenCost: 0.0015,
    },
    // Whisper pricing (per minute, converted to token equivalent)
    'whisper': {
      inputTokenCost: 0.006,    // $0.006 per minute
      outputTokenCost: 0,       // No output cost for transcription
    },
  },
  google: {
    'gemini-2.5-pro': {
      inputTokenCost: 0.00125,  // $1.25 per 1M tokens
      outputTokenCost: 0.010,   // $10 per 1M tokens
    },
    'gemini-2.5-flash': {
      inputTokenCost: 0.00015,  // $0.15 per 1M tokens
      outputTokenCost: 0.0006,  // $0.60 per 1M tokens
    },
    'gemini-2.0-flash': {
      inputTokenCost: 0.0001,   // $0.10 per 1M tokens (very cheap)
      outputTokenCost: 0.0004,  // $0.40 per 1M tokens (very cheap)
    },
    // Legacy models
    'gemini-1.5-flash': {
      inputTokenCost: 0.00015,
      outputTokenCost: 0.0006,
    },
    'gemini-1.5-pro': {
      inputTokenCost: 0.00125,
      outputTokenCost: 0.010,
    },
    'gemini-1.0-pro': {
      inputTokenCost: 0.0005,
      outputTokenCost: 0.0015,
    },
  },
};

/**
 * Track an LLM API call to Firestore with enhanced tracking
 */
export async function trackLLMCall(
  callData: Omit<LLMCallRecord, 'timestamp'> & { timestamp: admin.firestore.Timestamp | Date }
): Promise<boolean> {
  try {
    const db = admin.firestore();
    
    // Ensure timestamp is Firestore timestamp
    const timestamp = callData.timestamp instanceof Date 
      ? admin.firestore.Timestamp.fromDate(callData.timestamp)
      : callData.timestamp;
    
    const record: LLMCallRecord = {
      ...callData,
      timestamp,
    };
    
    // Add to llm_calls collection
    await db.collection('llm_calls').add(record);
    
    // Update real-time usage tracking for budget enforcement
    if (record.success && record.userId) {
      await updateUserDailyCosts(record.userId, record.cost, record.requestType);
    }
    
    console.log(`Tracked LLM call: ${record.provider}/${record.model} (${record.routingPreference || 'default'}) - $${record.cost.toFixed(4)}`);
    
    if (record.preferenceDowngraded) {
      console.log(`  ⚠️  Preference downgraded due to budget constraints`);
    }
    
    return true;
    
  } catch (error) {
    console.error('Failed to track LLM call:', error);
    return false;
  }
}

/**
 * Update user's daily cost tracking for budget enforcement
 */
async function updateUserDailyCosts(userId: string, cost: number, requestType: RequestType): Promise<void> {
  try {
    const db = admin.firestore();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const docId = `${userId}_${today}`;
    
    const userDayRef = db.collection('user_daily_costs').doc(docId);
    
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(userDayRef);
      
      if (doc.exists) {
        const data = doc.data()!;
        transaction.update(userDayRef, {
          totalCost: data.totalCost + cost,
          totalCalls: data.totalCalls + 1,
          lastUpdated: admin.firestore.Timestamp.now(),
          [`requestTypes.${requestType}`]: (data.requestTypes?.[requestType] || 0) + cost,
        });
      } else {
        transaction.set(userDayRef, {
          userId,
          date: today,
          totalCost: cost,
          totalCalls: 1,
          requestTypes: { [requestType]: cost },
          createdAt: admin.firestore.Timestamp.now(),
          lastUpdated: admin.firestore.Timestamp.now(),
        });
      }
    });
    
  } catch (error) {
    console.error('Failed to update user daily costs:', error);
  }
}

/**
 * Get cost estimate for a potential API call with current pricing
 */
export function getCostEstimate(
  provider: LLMProvider,
  model: LLMModel,
  estimatedInputTokens: number,
  estimatedOutputTokens: number = 0
): number {
  try {
    const providerPricing = MODEL_PRICING[provider];
    if (!providerPricing) {
      console.warn(`No pricing data for provider: ${provider}`);
      return 0;
    }
    
    const modelPricing = providerPricing[model];
    if (!modelPricing) {
      console.warn(`No pricing data for model: ${provider}/${model}`);
      return 0;
    }
    
    const inputCost = (estimatedInputTokens / 1000) * modelPricing.inputTokenCost;
    const outputCost = (estimatedOutputTokens / 1000) * modelPricing.outputTokenCost;
    
    return inputCost + outputCost;
    
  } catch (error) {
    console.error('Error calculating cost estimate:', error);
    return 0;
  }
}

/**
 * Get exact cost for completed API call
 */
export function calculateActualCost(
  provider: LLMProvider,
  model: LLMModel,
  inputTokens: number,
  outputTokens: number
): number {
  return getCostEstimate(provider, model, inputTokens, outputTokens);
}

/**
 * Get cost comparison between different routing preferences
 */
export function getCostComparison(
  requestType: RequestType,
  estimatedInputTokens: number,
  estimatedOutputTokens: number
): {
  quality: { provider: string; model: string; cost: number };
  balanced: { provider: string; model: string; cost: number };
  cost: { provider: string; model: string; cost: number };
} {
  // This would require importing the routing table from router.ts
  // For now, return placeholder data
  return {
    quality: { provider: 'anthropic', model: 'claude-opus-4-6', cost: 0 },
    balanced: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', cost: 0 },
    cost: { provider: 'anthropic', model: 'claude-haiku-3-5', cost: 0 },
  };
}

/**
 * Get usage statistics for a user within a date range with enhanced tracking
 */
export async function getUserUsage(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalCost: number;
  totalTokens: number;
  totalCalls: number;
  byRequestType: { [key: string]: { cost: number; tokens: number; calls: number } };
  byProvider: { [key: string]: { cost: number; tokens: number; calls: number } };
  byPreference: { [key: string]: { cost: number; tokens: number; calls: number } };
  downgradedCalls: number;
  avgLatency: number;
  successRate: number;
}> {
  try {
    const db = admin.firestore();
    
    const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
    const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);
    
    const query = await db.collection('llm_calls')
      .where('userId', '==', userId)
      .where('timestamp', '>=', startTimestamp)
      .where('timestamp', '<=', endTimestamp)
      .get();
    
    const stats = {
      totalCost: 0,
      totalTokens: 0,
      totalCalls: 0,
      byRequestType: {} as { [key: string]: { cost: number; tokens: number; calls: number } },
      byProvider: {} as { [key: string]: { cost: number; tokens: number; calls: number } },
      byPreference: {} as { [key: string]: { cost: number; tokens: number; calls: number } },
      downgradedCalls: 0,
      avgLatency: 0,
      successRate: 0,
    };
    
    let totalLatency = 0;
    let successfulCalls = 0;
    
    query.docs.forEach(doc => {
      const data = doc.data() as LLMCallRecord;
      
      stats.totalCalls += 1;
      totalLatency += data.latencyMs || 0;
      
      if (data.success) {
        successfulCalls += 1;
        stats.totalCost += data.cost;
        stats.totalTokens += data.totalTokens;
        
        // By request type
        if (!stats.byRequestType[data.requestType]) {
          stats.byRequestType[data.requestType] = { cost: 0, tokens: 0, calls: 0 };
        }
        stats.byRequestType[data.requestType].cost += data.cost;
        stats.byRequestType[data.requestType].tokens += data.totalTokens;
        stats.byRequestType[data.requestType].calls += 1;
        
        // By provider
        if (!stats.byProvider[data.provider]) {
          stats.byProvider[data.provider] = { cost: 0, tokens: 0, calls: 0 };
        }
        stats.byProvider[data.provider].cost += data.cost;
        stats.byProvider[data.provider].tokens += data.totalTokens;
        stats.byProvider[data.provider].calls += 1;
        
        // By routing preference
        const preference = data.routingPreference || 'default';
        if (!stats.byPreference[preference]) {
          stats.byPreference[preference] = { cost: 0, tokens: 0, calls: 0 };
        }
        stats.byPreference[preference].cost += data.cost;
        stats.byPreference[preference].tokens += data.totalTokens;
        stats.byPreference[preference].calls += 1;
      }
      
      if (data.preferenceDowngraded) {
        stats.downgradedCalls += 1;
      }
    });
    
    stats.avgLatency = stats.totalCalls > 0 ? totalLatency / stats.totalCalls : 0;
    stats.successRate = stats.totalCalls > 0 ? successfulCalls / stats.totalCalls : 0;
    
    return stats;
    
  } catch (error) {
    console.error('Error getting user usage:', error);
    throw error;
  }
}

/**
 * Check if user is within their usage limits with budget enforcement
 */
export async function checkUsageLimits(
  userId: string,
  requestType: RequestType
): Promise<{
  withinLimits: boolean;
  dailyCallCount: number;
  dailyLimit: number;
  costToday: number;
  dailyCostLimit: number;
  userRole: string;
  percentOfDailyLimit: number;
  percentOfCostLimit: number;
  recommendedAction?: string;
}> {
  try {
    const db = admin.firestore();
    
    // Get user role and limits
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const userRole = userData?.role || 'free';
    
    // Define limits by role
    const limits = {
      free: { dailyCalls: 10, dailyCost: 1.00 },
      pro: { dailyCalls: 100, dailyCost: 10.00 },
      premium: { dailyCalls: 500, dailyCost: 50.00 },
      admin: { dailyCalls: -1, dailyCost: -1 }, // unlimited
    };
    
    const userLimits = limits[userRole as keyof typeof limits] || limits.free;
    
    // Get today's usage from fast cache
    const today = new Date().toISOString().split('T')[0];
    const docId = `${userId}_${today}`;
    
    const userDayDoc = await db.collection('user_daily_costs').doc(docId).get();
    const todayUsage = userDayDoc.exists ? userDayDoc.data()! : { totalCost: 0, totalCalls: 0 };
    
    const withinCallLimit = userLimits.dailyCalls === -1 || todayUsage.totalCalls < userLimits.dailyCalls;
    const withinCostLimit = userLimits.dailyCost === -1 || todayUsage.totalCost < userLimits.dailyCost;
    
    const percentOfDailyLimit = userLimits.dailyCalls === -1 ? 0 : (todayUsage.totalCalls / userLimits.dailyCalls) * 100;
    const percentOfCostLimit = userLimits.dailyCost === -1 ? 0 : (todayUsage.totalCost / userLimits.dailyCost) * 100;
    
    let recommendedAction: string | undefined;
    
    if (percentOfCostLimit > 95) {
      recommendedAction = 'Daily cost limit nearly exceeded. Consider upgrading plan.';
    } else if (percentOfCostLimit > 80) {
      recommendedAction = 'Approaching daily cost limit. Router may auto-downgrade to cost preference.';
    } else if (percentOfDailyLimit > 90) {
      recommendedAction = 'Approaching daily call limit.';
    }
    
    return {
      withinLimits: withinCallLimit && withinCostLimit,
      dailyCallCount: todayUsage.totalCalls,
      dailyLimit: userLimits.dailyCalls,
      costToday: todayUsage.totalCost,
      dailyCostLimit: userLimits.dailyCost,
      userRole,
      percentOfDailyLimit,
      percentOfCostLimit,
      recommendedAction,
    };
    
  } catch (error) {
    console.error('Error checking usage limits:', error);
    // Default to allowing the request if we can't check
    return {
      withinLimits: true,
      dailyCallCount: 0,
      dailyLimit: 10,
      costToday: 0,
      dailyCostLimit: 1.00,
      userRole: 'free',
      percentOfDailyLimit: 0,
      percentOfCostLimit: 0,
    };
  }
}

/**
 * Generate daily cost aggregation with enhanced metrics
 */
export async function aggregateDailyCosts(date?: Date): Promise<DailyCostSummary> {
  try {
    const db = admin.firestore();
    
    // Default to yesterday if no date provided
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    // Get start and end of day
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const startTimestamp = admin.firestore.Timestamp.fromDate(startOfDay);
    const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);
    
    // Query all calls for the day
    const query = await db.collection('llm_calls')
      .where('timestamp', '>=', startTimestamp)
      .where('timestamp', '<=', endTimestamp)
      .get();
    
    const summary: DailyCostSummary = {
      date: dateStr,
      totalCost: 0,
      totalTokens: 0,
      totalCalls: 0,
      byProvider: {},
      byRequestType: {},
      byPreference: {},
      topUsers: [],
      generatedAt: admin.firestore.Timestamp.now(),
    };
    
    const userCosts: { [userId: string]: { cost: number; calls: number } } = {};
    let successfulCalls = 0;
    let downgradedCalls = 0;
    
    query.docs.forEach(doc => {
      const data = doc.data() as LLMCallRecord;
      
      // Total aggregation
      summary.totalCalls += 1;
      
      if (data.success) {
        successfulCalls += 1;
        summary.totalCost += data.cost;
        summary.totalTokens += data.totalTokens;
        
        // By provider
        if (!summary.byProvider[data.provider]) {
          summary.byProvider[data.provider] = { cost: 0, tokens: 0, calls: 0 };
        }
        summary.byProvider[data.provider].cost += data.cost;
        summary.byProvider[data.provider].tokens += data.totalTokens;
        summary.byProvider[data.provider].calls += 1;
        
        // By request type
        if (!summary.byRequestType[data.requestType]) {
          summary.byRequestType[data.requestType] = { cost: 0, tokens: 0, calls: 0 };
        }
        summary.byRequestType[data.requestType].cost += data.cost;
        summary.byRequestType[data.requestType].tokens += data.totalTokens;
        summary.byRequestType[data.requestType].calls += 1;
        
        // By routing preference
        const preference = data.routingPreference || 'default';
        if (!summary.byPreference[preference]) {
          summary.byPreference[preference] = { cost: 0, tokens: 0, calls: 0 };
        }
        summary.byPreference[preference].cost += data.cost;
        summary.byPreference[preference].tokens += data.totalTokens;
        summary.byPreference[preference].calls += 1;
        
        // User costs for top users
        if (!userCosts[data.userId]) {
          userCosts[data.userId] = { cost: 0, calls: 0 };
        }
        userCosts[data.userId].cost += data.cost;
        userCosts[data.userId].calls += 1;
      }
      
      if (data.preferenceDowngraded) {
        downgradedCalls += 1;
      }
    });
    
    // Get top 10 users by cost
    summary.topUsers = Object.entries(userCosts)
      .map(([userId, stats]) => ({
        userId,
        cost: stats.cost,
        calls: stats.calls,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
    
    // Add additional metrics
    const summaryWithMetrics = {
      ...summary,
      successRate: summary.totalCalls > 0 ? successfulCalls / summary.totalCalls : 0,
      downgradedCalls,
      averageCostPerCall: successfulCalls > 0 ? summary.totalCost / successfulCalls : 0,
      averageTokensPerCall: successfulCalls > 0 ? summary.totalTokens / successfulCalls : 0,
    };
    
    // Save to finops_daily collection
    await db.collection('finops_daily').doc(dateStr).set(summaryWithMetrics);
    
    console.log(`Daily cost aggregation completed for ${dateStr}:`);
    console.log(`  Total: $${summary.totalCost.toFixed(4)} (${summary.totalCalls} calls, ${successfulCalls} successful)`);
    console.log(`  Downgrades: ${downgradedCalls} (${((downgradedCalls / summary.totalCalls) * 100).toFixed(1)}%)`);
    console.log(`  Top provider: ${Object.entries(summary.byProvider).sort((a, b) => b[1].cost - a[1].cost)[0]?.[0] || 'none'}`);
    
    return summary;
    
  } catch (error) {
    console.error('Error aggregating daily costs:', error);
    throw error;
  }
}

/**
 * Get spending summary with routing preference breakdown
 */
export async function getSpendingSummary(
  startDate: Date,
  endDate: Date,
  granularity: 'daily' | 'monthly' = 'daily'
): Promise<{
  totalCost: number;
  totalTokens: number;
  totalCalls: number;
  successfulCalls: number;
  averageCostPerCall: number;
  averageCostPerDay: number;
  downgradedCalls: number;
  savingsFromDowngrades: number;
  byPreference: { [preference: string]: { cost: number; tokens: number; calls: number } };
  breakdown: Array<{
    date: string;
    cost: number;
    tokens: number;
    calls: number;
    successRate: number;
  }>;
}> {
  try {
    const db = admin.firestore();
    
    // Query finops_daily collection for the date range
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const query = await db.collection('finops_daily')
      .where('date', '>=', startDateStr)
      .where('date', '<=', endDateStr)
      .orderBy('date')
      .get();
    
    let totalCost = 0;
    let totalTokens = 0;
    let totalCalls = 0;
    let successfulCalls = 0;
    let downgradedCalls = 0;
    const byPreference: { [preference: string]: { cost: number; tokens: number; calls: number } } = {};
    const breakdown: Array<{
      date: string;
      cost: number;
      tokens: number;
      calls: number;
      successRate: number;
    }> = [];
    
    query.docs.forEach(doc => {
      const data = doc.data() as DailyCostSummary & {
        successRate?: number;
        downgradedCalls?: number;
      };
      
      totalCost += data.totalCost;
      totalTokens += data.totalTokens;
      totalCalls += data.totalCalls;
      successfulCalls += Math.round(data.totalCalls * (data.successRate || 1));
      downgradedCalls += data.downgradedCalls || 0;
      
      // Aggregate by preference
      if (data.byPreference) {
        Object.entries(data.byPreference).forEach(([preference, stats]) => {
          if (!byPreference[preference]) {
            byPreference[preference] = { cost: 0, tokens: 0, calls: 0 };
          }
          byPreference[preference].cost += stats.cost;
          byPreference[preference].tokens += stats.tokens;
          byPreference[preference].calls += stats.calls;
        });
      }
      
      breakdown.push({
        date: data.date,
        cost: data.totalCost,
        tokens: data.totalTokens,
        calls: data.totalCalls,
        successRate: data.successRate || 1,
      });
    });
    
    const dayCount = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // Estimate savings from downgrades (rough calculation)
    const savingsFromDowngrades = downgradedCalls * 0.01; // Assume $0.01 saved per downgrade
    
    return {
      totalCost,
      totalTokens,
      totalCalls,
      successfulCalls,
      averageCostPerCall: successfulCalls > 0 ? totalCost / successfulCalls : 0,
      averageCostPerDay: totalCost / dayCount,
      downgradedCalls,
      savingsFromDowngrades,
      byPreference,
      breakdown,
    };
    
  } catch (error) {
    console.error('Error getting spending summary:', error);
    throw error;
  }
}

/**
 * Get cost trends and predictions
 */
export async function getCostTrends(days: number = 30): Promise<{
  trend: 'increasing' | 'decreasing' | 'stable';
  trendPercentage: number;
  projectedMonthlyCost: number;
  topCostDrivers: Array<{
    type: 'provider' | 'requestType' | 'preference';
    name: string;
    cost: number;
    percentage: number;
  }>;
}> {
  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    
    const summary = await getSpendingSummary(startDate, endDate);
    
    // Simple trend calculation (compare first half vs second half)
    const midPoint = Math.floor(summary.breakdown.length / 2);
    const firstHalf = summary.breakdown.slice(0, midPoint);
    const secondHalf = summary.breakdown.slice(midPoint);
    
    const firstHalfAvg = firstHalf.reduce((sum, day) => sum + day.cost, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, day) => sum + day.cost, 0) / secondHalf.length;
    
    const trendPercentage = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0;
    
    let trend: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(trendPercentage) < 5) {
      trend = 'stable';
    } else if (trendPercentage > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }
    
    // Project monthly cost
    const projectedMonthlyCost = summary.averageCostPerDay * 30;
    
    // Top cost drivers (simplified)
    const topCostDrivers: Array<{
      type: 'provider' | 'requestType' | 'preference';
      name: string;
      cost: number;
      percentage: number;
    }> = [];
    
    // Add top preferences
    Object.entries(summary.byPreference)
      .sort((a, b) => b[1].cost - a[1].cost)
      .slice(0, 3)
      .forEach(([preference, stats]) => {
        topCostDrivers.push({
          type: 'preference',
          name: preference,
          cost: stats.cost,
          percentage: (stats.cost / summary.totalCost) * 100,
        });
      });
    
    return {
      trend,
      trendPercentage,
      projectedMonthlyCost,
      topCostDrivers,
    };
    
  } catch (error) {
    console.error('Error getting cost trends:', error);
    throw error;
  }
}

/**
 * Alert when approaching budget limits
 */
export async function checkBudgetAlerts(userId?: string): Promise<Array<{
  type: 'user' | 'app' | 'global';
  level: 'warning' | 'critical';
  message: string;
  currentUsage: number;
  limit: number;
  percentage: number;
}>> {
  const alerts: Array<{
    type: 'user' | 'app' | 'global';
    level: 'warning' | 'critical';
    message: string;
    currentUsage: number;
    limit: number;
    percentage: number;
  }> = [];
  
  try {
    if (userId) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const usage = await getUserUsage(userId, today, tomorrow);
      const limits = await checkUsageLimits(userId, 'cross:daily-overview'); // Use a generic request type
      
      if (limits.percentOfCostLimit > 80) {
        alerts.push({
          type: 'user',
          level: limits.percentOfCostLimit > 95 ? 'critical' : 'warning',
          message: `User ${userId} at ${limits.percentOfCostLimit.toFixed(1)}% of daily cost limit`,
          currentUsage: limits.costToday,
          limit: limits.dailyCostLimit,
          percentage: limits.percentOfCostLimit,
        });
      }
    }
    
    return alerts;
    
  } catch (error) {
    console.error('Error checking budget alerts:', error);
    return alerts;
  }
}