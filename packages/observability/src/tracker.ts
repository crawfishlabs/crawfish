/**
 * @fileoverview Cost tracking and observability for LLM operations
 */

import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { CostEntry, LLMProvider, ModelName, UserCostData, DailyCostSummary } from './types';

/**
 * Cost per 1K tokens by provider and model (in USD)
 */
const TOKEN_COSTS: Record<LLMProvider, Record<string, { input: number; output: number }>> = {
  openai: {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
  },
  anthropic: {
    'claude-3-opus': { input: 0.015, output: 0.075 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  },
  google: {
    'gemini-pro': { input: 0.0005, output: 0.0015 },
    'gemini-pro-vision': { input: 0.0005, output: 0.0015 },
  },
};

/**
 * Calculate cost for a model call
 */
export function calculateCost(
  provider: LLMProvider,
  model: ModelName,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = TOKEN_COSTS[provider]?.[model];
  if (!costs) {
    console.warn(`Unknown model cost: ${provider}/${model}, using default`);
    return (inputTokens + outputTokens) * 0.001 / 1000; // Fallback: $1 per 1M tokens
  }
  
  const inputCost = (inputTokens / 1000) * costs.input;
  const outputCost = (outputTokens / 1000) * costs.output;
  
  return inputCost + outputCost;
}

/**
 * Track LLM usage and cost
 */
export async function trackLLMUsage(
  userId: string,
  provider: LLMProvider,
  model: ModelName,
  inputTokens: number,
  outputTokens: number,
  feature: string,
  metadata?: any
): Promise<CostEntry> {
  try {
    const cost = calculateCost(provider, model, inputTokens, outputTokens);
    
    const entry: CostEntry = {
      id: uuidv4(),
      userId,
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
      feature,
      timestamp: admin.firestore.Timestamp.now(),
      metadata,
    };
    
    const db = admin.firestore();
    await db.collection('cost_tracking').doc(entry.id).set(entry);
    
    // Update user daily/monthly totals
    await updateUserCostData(userId, cost, feature);
    
    // Update daily summary
    await updateDailySummary(provider, model, feature, cost, inputTokens + outputTokens);
    
    return entry;
  } catch (error) {
    console.error('Error tracking LLM usage:', error);
    throw error;
  }
}

/**
 * Update user cost data
 */
async function updateUserCostData(userId: string, cost: number, feature: string): Promise<void> {
  try {
    const db = admin.firestore();
    const userCostRef = db.collection('user_costs').doc(userId);
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(userCostRef);
      const data = doc.exists ? doc.data() as UserCostData : null;
      
      const lastReset = data?.lastReset?.toDate();
      const isNewDay = !lastReset || lastReset.toDateString() !== today.toDateString();
      
      const updateData: Partial<UserCostData> = {
        userId,
        monthlyTotal: (data?.monthlyTotal || 0) + cost,
        dailyTotal: isNewDay ? cost : (data?.dailyTotal || 0) + cost,
        lastReset: isNewDay ? admin.firestore.Timestamp.now() : data?.lastReset,
        usage: {
          mealScan: data?.usage?.mealScan || 0,
          coachChat: data?.usage?.coachChat || 0,
          workoutAnalysis: data?.usage?.workoutAnalysis || 0,
          ...data?.usage,
          [feature]: (data?.usage?.[feature as keyof typeof data.usage] || 0) + cost,
        },
        updatedAt: admin.firestore.Timestamp.now(),
      };
      
      transaction.set(userCostRef, updateData, { merge: true });
    });
  } catch (error) {
    console.error('Error updating user cost data:', error);
    throw error;
  }
}

/**
 * Update daily summary
 */
async function updateDailySummary(
  provider: LLMProvider,
  model: ModelName,
  feature: string,
  cost: number,
  tokens: number
): Promise<void> {
  try {
    const db = admin.firestore();
    const today = new Date().toISOString().split('T')[0];
    const summaryRef = db.collection('daily_summaries').doc(today);
    
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(summaryRef);
      const data = doc.exists ? doc.data() as DailyCostSummary : null;
      
      const updateData: Partial<DailyCostSummary> = {
        date: today,
        totalCost: (data?.totalCost || 0) + cost,
        totalTokens: (data?.totalTokens || 0) + tokens,
        byProvider: {
          ...data?.byProvider,
          [provider]: {
            cost: ((data?.byProvider?.[provider]?.cost || 0) + cost),
            tokens: ((data?.byProvider?.[provider]?.tokens || 0) + tokens),
            calls: ((data?.byProvider?.[provider]?.calls || 0) + 1),
          },
        },
        byFeature: {
          ...data?.byFeature,
          [feature]: {
            cost: ((data?.byFeature?.[feature]?.cost || 0) + cost),
            tokens: ((data?.byFeature?.[feature]?.tokens || 0) + tokens),
            calls: ((data?.byFeature?.[feature]?.calls || 0) + 1),
          },
        },
        updatedAt: admin.firestore.Timestamp.now(),
      };
      
      transaction.set(summaryRef, updateData, { merge: true });
    });
  } catch (error) {
    console.error('Error updating daily summary:', error);
    throw error;
  }
}

/**
 * Get user cost data
 */
export async function getUserCostData(userId: string): Promise<UserCostData | null> {
  try {
    const db = admin.firestore();
    const doc = await db.collection('user_costs').doc(userId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    return doc.data() as UserCostData;
  } catch (error) {
    console.error('Error getting user cost data:', error);
    return null;
  }
}

/**
 * Get daily cost summary
 */
export async function getDailySummary(date: string): Promise<DailyCostSummary | null> {
  try {
    const db = admin.firestore();
    const doc = await db.collection('daily_summaries').doc(date).get();
    
    if (!doc.exists) {
      return null;
    }
    
    return doc.data() as DailyCostSummary;
  } catch (error) {
    console.error('Error getting daily summary:', error);
    return null;
  }
}