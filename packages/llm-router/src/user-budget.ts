/**
 * @fileoverview Per-user AI budget enforcement system
 * @description Manages user AI budgets, spending tracking, and tier-based limits
 */

import * as admin from 'firebase-admin';
import { RequestType, LLMProvider, LLMModel } from './types';

/**
 * User AI budget document structure (Firestore: users/{userId}/billing/ai-budget)
 */
export interface UserAIBudget {
  userId: string;
  tier: 'free' | 'pro' | 'pro_plus' | 'enterprise';
  period: string; // '2027-01' (YYYY-MM)
  budgetUsd: number; // 3.00 for Pro, 10.00 for Pro+
  spentUsd: number; // running total
  degradedSpendUsd: number; // spend AFTER hitting budget (tracked separately)
  maxDegradedUsd: number; // 5.00 — hard block after this
  status: 'premium' | 'degraded' | 'blocked';
  degradedAt?: string; // ISO timestamp when they entered degraded
  blockedAt?: string; // ISO timestamp when blocked
  callCount: number;
  callCountDegraded: number;
  lastCallAt: string;
  resetAt: string; // first of next month
  createdAt: string;
  updatedAt: string;
}

/**
 * Budget check result for pre-flight validation
 */
export interface BudgetCheckResult {
  allowed: boolean;
  status: 'premium' | 'degraded' | 'blocked';
  remaining: number;
  routingPreference: 'quality' | 'cost';
  resetAt: string;
  budgetUsd: number;
  spentUsd: number;
  degradedSpendUsd: number;
}

/**
 * Tier configuration for budget limits
 */
const TIER_CONFIG = {
  free: { budgetUsd: 0, maxDegradedUsd: 0, allowAI: false },
  pro: { budgetUsd: 3.00, maxDegradedUsd: 5.00, allowAI: true },
  pro_plus: { budgetUsd: 10.00, maxDegradedUsd: 5.00, allowAI: true },
  enterprise: { budgetUsd: 100.00, maxDegradedUsd: 50.00, allowAI: true },
} as const;

/**
 * Get current month period string (YYYY-MM)
 */
function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get first day of next month as ISO string
 */
function getNextMonthResetDate(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}

/**
 * Get user's subscription tier from Firestore
 */
async function getUserTier(userId: string): Promise<keyof typeof TIER_CONFIG> {
  try {
    const db = admin.firestore();
    
    // Try to get subscription from the subscriptions collection
    const subscriptionDoc = await db.collection('subscriptions').doc(userId).get();
    
    if (subscriptionDoc.exists) {
      const subscription = subscriptionDoc.data();
      const status = subscription?.status;
      const tier = subscription?.tier;
      
      // Map subscription tiers to budget tiers
      if (status === 'active') {
        switch (tier) {
          case 'pro':
          case 'pro_annual':
            return 'pro';
          case 'enterprise':
            return 'enterprise';
          // Add pro_plus when it exists in the subscription system
          default:
            return 'free';
        }
      }
    }
    
    // Fallback to user document
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      const role = userData?.role || 'free';
      
      // Map user roles to budget tiers
      switch (role) {
        case 'pro':
        case 'premium':
          return 'pro';
        case 'enterprise':
        case 'admin':
          return 'enterprise';
        default:
          return 'free';
      }
    }
    
    return 'free';
  } catch (error) {
    console.error('Error getting user tier:', error);
    return 'free';
  }
}

/**
 * Get or create user budget document for current month
 */
export async function getUserBudget(userId: string): Promise<UserAIBudget> {
  try {
    const db = admin.firestore();
    const currentPeriod = getCurrentPeriod();
    const budgetDocPath = `users/${userId}/billing/ai-budget`;
    
    const budgetDoc = await db.doc(budgetDocPath).get();
    
    if (budgetDoc.exists) {
      const data = budgetDoc.data() as UserAIBudget;
      
      // If it's a new month, reset the budget
      if (data.period !== currentPeriod) {
        const tier = await getUserTier(userId);
        const tierConfig = TIER_CONFIG[tier];
        const now = new Date().toISOString();
        const resetAt = getNextMonthResetDate();
        
        const newBudget: UserAIBudget = {
          userId,
          tier,
          period: currentPeriod,
          budgetUsd: tierConfig.budgetUsd,
          spentUsd: 0,
          degradedSpendUsd: 0,
          maxDegradedUsd: tierConfig.maxDegradedUsd,
          status: tierConfig.allowAI ? 'premium' : 'blocked',
          callCount: 0,
          callCountDegraded: 0,
          lastCallAt: now,
          resetAt,
          createdAt: data.createdAt || now,
          updatedAt: now,
        };
        
        await db.doc(budgetDocPath).set(newBudget);
        return newBudget;
      }
      
      return data;
    } else {
      // Create new budget document
      const tier = await getUserTier(userId);
      const tierConfig = TIER_CONFIG[tier];
      const now = new Date().toISOString();
      const resetAt = getNextMonthResetDate();
      
      const newBudget: UserAIBudget = {
        userId,
        tier,
        period: currentPeriod,
        budgetUsd: tierConfig.budgetUsd,
        spentUsd: 0,
        degradedSpendUsd: 0,
        maxDegradedUsd: tierConfig.maxDegradedUsd,
        status: tierConfig.allowAI ? 'premium' : 'blocked',
        callCount: 0,
        callCountDegraded: 0,
        lastCallAt: now,
        resetAt,
        createdAt: now,
        updatedAt: now,
      };
      
      await db.doc(budgetDocPath).set(newBudget);
      return newBudget;
    }
  } catch (error) {
    console.error('Error getting user budget:', error);
    throw error;
  }
}

/**
 * Check budget status before making an AI call (pre-flight check)
 */
export async function checkBudget(userId: string): Promise<BudgetCheckResult> {
  try {
    const budget = await getUserBudget(userId);
    
    // Free tier users are blocked from AI
    if (budget.tier === 'free') {
      return {
        allowed: false,
        status: 'blocked',
        remaining: 0,
        routingPreference: 'cost',
        resetAt: budget.resetAt,
        budgetUsd: budget.budgetUsd,
        spentUsd: budget.spentUsd,
        degradedSpendUsd: budget.degradedSpendUsd,
      };
    }
    
    // Check if user is blocked (exceeded degraded spend limit)
    if (budget.status === 'blocked') {
      return {
        allowed: false,
        status: 'blocked',
        remaining: 0,
        routingPreference: 'cost',
        resetAt: budget.resetAt,
        budgetUsd: budget.budgetUsd,
        spentUsd: budget.spentUsd,
        degradedSpendUsd: budget.degradedSpendUsd,
      };
    }
    
    // Check if user is in degraded mode (over budget but under degraded limit)
    if (budget.status === 'degraded') {
      const degradedRemaining = budget.maxDegradedUsd - budget.degradedSpendUsd;
      
      return {
        allowed: degradedRemaining > 0,
        status: degradedRemaining > 0 ? 'degraded' : 'blocked',
        remaining: Math.max(0, degradedRemaining),
        routingPreference: 'cost',
        resetAt: budget.resetAt,
        budgetUsd: budget.budgetUsd,
        spentUsd: budget.spentUsd,
        degradedSpendUsd: budget.degradedSpendUsd,
      };
    }
    
    // Premium status - check remaining budget
    const remaining = Math.max(0, budget.budgetUsd - budget.spentUsd);
    
    return {
      allowed: true,
      status: 'premium',
      remaining,
      routingPreference: remaining > (budget.budgetUsd * 0.2) ? 'quality' : 'cost', // Switch to cost when <20% remaining
      resetAt: budget.resetAt,
      budgetUsd: budget.budgetUsd,
      spentUsd: budget.spentUsd,
      degradedSpendUsd: budget.degradedSpendUsd,
    };
  } catch (error) {
    console.error('Error checking budget:', error);
    // Default to blocked on error for safety
    return {
      allowed: false,
      status: 'blocked',
      remaining: 0,
      routingPreference: 'cost',
      resetAt: getNextMonthResetDate(),
      budgetUsd: 0,
      spentUsd: 0,
      degradedSpendUsd: 0,
    };
  }
}

/**
 * Deduct cost from user budget after successful AI call
 */
export async function deductBudget(
  userId: string,
  costUsd: number,
  taskType: string,
  model: string
): Promise<UserAIBudget> {
  try {
    const db = admin.firestore();
    const budgetDocPath = `users/${userId}/billing/ai-budget`;
    
    return await db.runTransaction(async (transaction) => {
      const budgetDoc = await transaction.get(db.doc(budgetDocPath));
      
      if (!budgetDoc.exists) {
        throw new Error('Budget document not found');
      }
      
      const budget = budgetDoc.data() as UserAIBudget;
      const now = new Date().toISOString();
      
      // Determine where to deduct the cost from
      let newBudget: UserAIBudget;
      
      if (budget.status === 'premium') {
        // Deduct from main budget
        const newSpent = budget.spentUsd + costUsd;
        const newCallCount = budget.callCount + 1;
        
        // Check if this puts us over budget
        if (newSpent > budget.budgetUsd) {
          // Enter degraded mode
          const overage = newSpent - budget.budgetUsd;
          
          newBudget = {
            ...budget,
            spentUsd: budget.budgetUsd, // Cap at budget limit
            degradedSpendUsd: overage, // Start tracking degraded spend
            status: 'degraded',
            degradedAt: now,
            callCount: newCallCount,
            callCountDegraded: 1,
            lastCallAt: now,
            updatedAt: now,
          };
          
          // Fire alert for entering degraded mode
          await fireStatusChangeAlert(userId, newBudget, 'degraded');
        } else {
          // Still in premium
          newBudget = {
            ...budget,
            spentUsd: newSpent,
            callCount: newCallCount,
            lastCallAt: now,
            updatedAt: now,
          };
        }
      } else if (budget.status === 'degraded') {
        // Deduct from degraded budget
        const newDegradedSpend = budget.degradedSpendUsd + costUsd;
        const newCallCount = budget.callCount + 1;
        const newDegradedCallCount = budget.callCountDegraded + 1;
        
        // Check if this blocks the user
        if (newDegradedSpend > budget.maxDegradedUsd) {
          newBudget = {
            ...budget,
            degradedSpendUsd: budget.maxDegradedUsd, // Cap at degraded limit
            status: 'blocked',
            blockedAt: now,
            callCount: newCallCount,
            callCountDegraded: newDegradedCallCount,
            lastCallAt: now,
            updatedAt: now,
          };
          
          // Fire alert for getting blocked
          await fireStatusChangeAlert(userId, newBudget, 'blocked');
        } else {
          // Still degraded
          newBudget = {
            ...budget,
            degradedSpendUsd: newDegradedSpend,
            callCount: newCallCount,
            callCountDegraded: newDegradedCallCount,
            lastCallAt: now,
            updatedAt: now,
          };
        }
      } else {
        // Blocked users shouldn't get here, but handle gracefully
        throw new Error('Cannot deduct from blocked user budget');
      }
      
      transaction.set(db.doc(budgetDocPath), newBudget);
      return newBudget;
    });
  } catch (error) {
    console.error('Error deducting budget:', error);
    throw error;
  }
}

/**
 * Fire alert when user status changes (degraded or blocked)
 */
async function fireStatusChangeAlert(
  userId: string,
  budget: UserAIBudget,
  newStatus: 'degraded' | 'blocked'
): Promise<void> {
  try {
    // Log the status change
    console.log(`User ${userId} budget status changed to ${newStatus}:`, {
      tier: budget.tier,
      spentUsd: budget.spentUsd,
      degradedSpendUsd: budget.degradedSpendUsd,
      callCount: budget.callCount,
    });
    
    // Dynamically import to avoid circular dependency
    const { sendBudgetAlert } = await import('./budget-alerts');
    await sendBudgetAlert(budget, newStatus);
  } catch (error) {
    console.error('Error firing status change alert:', error);
  }
}

/**
 * Reset all user budgets for a new month (scheduled job)
 */
export async function resetMonthlyBudgets(): Promise<{ resetCount: number; errorCount: number }> {
  try {
    const db = admin.firestore();
    const currentPeriod = getCurrentPeriod();
    const resetAt = getNextMonthResetDate();
    const now = new Date().toISOString();
    
    // Query all budget documents that need resetting
    // Note: This requires a collection group query since budgets are in subcollections
    const budgetQuery = await db.collectionGroup('billing')
      .where('period', '!=', currentPeriod)
      .get();
    
    let resetCount = 0;
    let errorCount = 0;
    const batch = db.batch();
    
    for (const doc of budgetQuery.docs) {
      if (doc.id !== 'ai-budget') continue; // Only reset AI budget docs
      
      try {
        const budget = doc.data() as UserAIBudget;
        const tier = await getUserTier(budget.userId);
        const tierConfig = TIER_CONFIG[tier];
        
        const resetBudget: UserAIBudget = {
          ...budget,
          tier, // Update tier in case it changed
          period: currentPeriod,
          budgetUsd: tierConfig.budgetUsd,
          spentUsd: 0,
          degradedSpendUsd: 0,
          maxDegradedUsd: tierConfig.maxDegradedUsd,
          status: tierConfig.allowAI ? 'premium' : 'blocked',
          callCount: 0,
          callCountDegraded: 0,
          resetAt,
          updatedAt: now,
          // Clear status change timestamps for new month
          degradedAt: undefined,
          blockedAt: undefined,
        };
        
        batch.set(doc.ref, resetBudget);
        resetCount++;
      } catch (error) {
        console.error(`Error resetting budget for ${doc.ref.path}:`, error);
        errorCount++;
      }
    }
    
    if (resetCount > 0) {
      await batch.commit();
      console.log(`Reset ${resetCount} user budgets for period ${currentPeriod}`);
    }
    
    return { resetCount, errorCount };
  } catch (error) {
    console.error('Error resetting monthly budgets:', error);
    return { resetCount: 0, errorCount: 1 };
  }
}

/**
 * Upgrade user's tier and immediately increase budget
 */
export async function upgradeTier(userId: string, newTier: keyof typeof TIER_CONFIG): Promise<UserAIBudget> {
  try {
    const db = admin.firestore();
    const budgetDocPath = `users/${userId}/billing/ai-budget`;
    
    return await db.runTransaction(async (transaction) => {
      const budgetDoc = await transaction.get(db.doc(budgetDocPath));
      
      let budget: UserAIBudget;
      if (budgetDoc.exists) {
        budget = budgetDoc.data() as UserAIBudget;
      } else {
        // Create new budget if it doesn't exist
        budget = await getUserBudget(userId);
      }
      
      const tierConfig = TIER_CONFIG[newTier];
      const now = new Date().toISOString();
      
      // Upgrade budget immediately
      const upgradedBudget: UserAIBudget = {
        ...budget,
        tier: newTier,
        budgetUsd: tierConfig.budgetUsd,
        maxDegradedUsd: tierConfig.maxDegradedUsd,
        status: tierConfig.allowAI ? 'premium' : 'blocked',
        // Reset degraded state if they upgrade from blocked
        degradedAt: budget.status === 'blocked' ? undefined : budget.degradedAt,
        blockedAt: undefined,
        updatedAt: now,
      };
      
      transaction.set(db.doc(budgetDocPath), upgradedBudget);
      return upgradedBudget;
    });
  } catch (error) {
    console.error('Error upgrading user tier:', error);
    throw error;
  }
}

/**
 * Get budget usage breakdown for analytics
 */
export interface BudgetUsageBreakdown {
  userId: string;
  tier: string;
  period: string;
  budgetUtilization: number; // Percentage of budget used
  totalSpend: number;
  callDistribution: {
    premium: number;
    degraded: number;
  };
  daysUntilReset: number;
  status: 'premium' | 'degraded' | 'blocked';
  projectedMonthlySpend: number;
}

/**
 * Generate usage breakdown for a user
 */
export async function getUserBudgetBreakdown(userId: string): Promise<BudgetUsageBreakdown> {
  try {
    const budget = await getUserBudget(userId);
    
    const totalSpend = budget.spentUsd + budget.degradedSpendUsd;
    const budgetUtilization = budget.budgetUsd > 0 ? (budget.spentUsd / budget.budgetUsd) * 100 : 0;
    
    // Calculate days until reset
    const resetDate = new Date(budget.resetAt);
    const now = new Date();
    const daysUntilReset = Math.max(0, Math.ceil((resetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    
    // Calculate projected monthly spend based on current usage
    const currentDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projectedMonthlySpend = currentDay > 0 ? (totalSpend / currentDay) * daysInMonth : totalSpend;
    
    return {
      userId,
      tier: budget.tier,
      period: budget.period,
      budgetUtilization,
      totalSpend,
      callDistribution: {
        premium: budget.callCount - budget.callCountDegraded,
        degraded: budget.callCountDegraded,
      },
      daysUntilReset,
      status: budget.status,
      projectedMonthlySpend,
    };
  } catch (error) {
    console.error('Error getting budget breakdown:', error);
    throw error;
  }
}