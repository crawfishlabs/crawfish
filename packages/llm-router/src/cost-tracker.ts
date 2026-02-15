/**
 * @fileoverview LLM cost tracking and logging to Firestore
 * @description Tracks every LLM API call for cost analysis and usage monitoring
 */

import * as admin from 'firebase-admin';
import { 
  LLMCallRecord, 
  DailyCostSummary, 
  RequestType, 
  LLMProvider, 
  LLMModel 
} from './types';

/**
 * Track an LLM API call to Firestore
 * 
 * Logs detailed information about each API call for cost tracking,
 * usage analysis, and billing purposes.
 * 
 * @param callData - LLM call record data
 * @returns Promise resolving to success status
 * 
 * @example
 * ```typescript
 * await trackLLMCall({
 *   requestId: 'req123',
 *   userId: 'user456',
 *   requestType: 'meal-scan',
 *   provider: 'openai',
 *   model: 'gpt-4o-mini',
 *   inputTokens: 150,
 *   outputTokens: 75,
 *   totalTokens: 225,
 *   cost: 0.0034,
 *   latencyMs: 1200,
 *   success: true,
 *   timestamp: admin.firestore.Timestamp.now()
 * });
 * ```
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
    
    console.log(`Tracked LLM call: ${record.provider}/${record.model} - $${record.cost.toFixed(4)}`);
    return true;
    
  } catch (error) {
    console.error('Failed to track LLM call:', error);
    return false;
  }
}

/**
 * Get cost estimate for a potential API call
 * 
 * @param provider - LLM provider
 * @param model - Model to use
 * @param estimatedInputTokens - Estimated input tokens
 * @param estimatedOutputTokens - Estimated output tokens
 * @returns Estimated cost in USD
 */
export function getCostEstimate(
  provider: LLMProvider,
  model: LLMModel,
  estimatedInputTokens: number,
  estimatedOutputTokens: number = 0
): number {
  try {
    // Import provider classes to get pricing
    let pricing: { inputTokenCost: number; outputTokenCost: number } | null = null;
    
    switch (provider) {
      case 'anthropic':
        const { AnthropicProvider } = require('./providers/anthropic');
        pricing = AnthropicProvider.getPricing(model);
        break;
      case 'openai':
        const { OpenAIProvider } = require('./providers/openai');
        pricing = OpenAIProvider.getPricing(model);
        break;
      case 'google':
        const { GoogleProvider } = require('./providers/google');
        pricing = GoogleProvider.getPricing(model);
        break;
    }
    
    if (!pricing) {
      console.warn(`No pricing data for ${provider}/${model}`);
      return 0;
    }
    
    const inputCost = (estimatedInputTokens / 1000) * pricing.inputTokenCost;
    const outputCost = (estimatedOutputTokens / 1000) * pricing.outputTokenCost;
    
    return inputCost + outputCost;
    
  } catch (error) {
    console.error('Error calculating cost estimate:', error);
    return 0;
  }
}

/**
 * Get usage statistics for a user within a date range
 * 
 * @param userId - Firebase user ID
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (inclusive)
 * @returns Promise resolving to usage statistics
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
}> {
  try {
    const db = admin.firestore();
    
    const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
    const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);
    
    const query = await db.collection('llm_calls')
      .where('userId', '==', userId)
      .where('timestamp', '>=', startTimestamp)
      .where('timestamp', '<=', endTimestamp)
      .where('success', '==', true) // Only count successful calls
      .get();
    
    const stats = {
      totalCost: 0,
      totalTokens: 0,
      totalCalls: 0,
      byRequestType: {} as { [key: string]: { cost: number; tokens: number; calls: number } },
      byProvider: {} as { [key: string]: { cost: number; tokens: number; calls: number } },
    };
    
    query.docs.forEach(doc => {
      const data = doc.data() as LLMCallRecord;
      
      stats.totalCost += data.cost;
      stats.totalTokens += data.totalTokens;
      stats.totalCalls += 1;
      
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
    });
    
    return stats;
    
  } catch (error) {
    console.error('Error getting user usage:', error);
    throw error;
  }
}

/**
 * Check if user is within their daily usage limits
 * 
 * @param userId - Firebase user ID
 * @param requestType - Type of request being made
 * @returns Promise resolving to usage check result
 */
export async function checkUsageLimits(
  userId: string,
  requestType: RequestType
): Promise<{
  withinLimits: boolean;
  dailyCallCount: number;
  dailyLimit: number;
  costToday: number;
  userRole: string;
}> {
  try {
    const db = admin.firestore();
    
    // Get user role to determine limits
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const userRole = userData?.role || 'free';
    
    // Define daily limits by role
    const dailyLimits = {
      free: 10,
      pro: 100,
      admin: -1, // unlimited
    };
    
    const dailyLimit = dailyLimits[userRole as keyof typeof dailyLimits] || dailyLimits.free;
    
    // Get today's usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayUsage = await getUserUsage(userId, today, tomorrow);
    
    return {
      withinLimits: dailyLimit === -1 || todayUsage.totalCalls < dailyLimit,
      dailyCallCount: todayUsage.totalCalls,
      dailyLimit,
      costToday: todayUsage.totalCost,
      userRole,
    };
    
  } catch (error) {
    console.error('Error checking usage limits:', error);
    // Default to allowing the request if we can't check
    return {
      withinLimits: true,
      dailyCallCount: 0,
      dailyLimit: 10,
      costToday: 0,
      userRole: 'free',
    };
  }
}

/**
 * Generate daily cost aggregation for finops reporting
 * 
 * @param date - Date to aggregate (defaults to yesterday)
 * @returns Promise resolving to daily cost summary
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
    
    // Query all successful calls for the day
    const query = await db.collection('llm_calls')
      .where('timestamp', '>=', startTimestamp)
      .where('timestamp', '<=', endTimestamp)
      .where('success', '==', true)
      .get();
    
    const summary: DailyCostSummary = {
      date: dateStr,
      totalCost: 0,
      totalTokens: 0,
      totalCalls: 0,
      byProvider: {},
      byRequestType: {},
      topUsers: [],
      generatedAt: admin.firestore.Timestamp.now(),
    };
    
    const userCosts: { [userId: string]: { cost: number; calls: number } } = {};
    
    query.docs.forEach(doc => {
      const data = doc.data() as LLMCallRecord;
      
      // Total aggregation
      summary.totalCost += data.cost;
      summary.totalTokens += data.totalTokens;
      summary.totalCalls += 1;
      
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
      
      // User costs for top users
      if (!userCosts[data.userId]) {
        userCosts[data.userId] = { cost: 0, calls: 0 };
      }
      userCosts[data.userId].cost += data.cost;
      userCosts[data.userId].calls += 1;
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
    
    // Save to finops_daily collection
    await db.collection('finops_daily').doc(dateStr).set(summary);
    
    console.log(`Daily cost aggregation completed for ${dateStr}: $${summary.totalCost.toFixed(4)}`);
    
    return summary;
    
  } catch (error) {
    console.error('Error aggregating daily costs:', error);
    throw error;
  }
}

/**
 * Get spending summary for a date range
 * 
 * @param startDate - Start date
 * @param endDate - End date
 * @param granularity - 'daily' or 'monthly'
 * @returns Promise resolving to spending summary
 */
export async function getSpendingSummary(
  startDate: Date,
  endDate: Date,
  granularity: 'daily' | 'monthly' = 'daily'
): Promise<{
  totalCost: number;
  totalTokens: number;
  totalCalls: number;
  averageCostPerCall: number;
  averageCostPerDay: number;
  breakdown: Array<{
    date: string;
    cost: number;
    tokens: number;
    calls: number;
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
    const breakdown: Array<{
      date: string;
      cost: number;
      tokens: number;
      calls: number;
    }> = [];
    
    query.docs.forEach(doc => {
      const data = doc.data() as DailyCostSummary;
      
      totalCost += data.totalCost;
      totalTokens += data.totalTokens;
      totalCalls += data.totalCalls;
      
      breakdown.push({
        date: data.date,
        cost: data.totalCost,
        tokens: data.totalTokens,
        calls: data.totalCalls,
      });
    });
    
    const dayCount = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    return {
      totalCost,
      totalTokens,
      totalCalls,
      averageCostPerCall: totalCalls > 0 ? totalCost / totalCalls : 0,
      averageCostPerDay: totalCost / dayCount,
      breakdown,
    };
    
  } catch (error) {
    console.error('Error getting spending summary:', error);
    throw error;
  }
}