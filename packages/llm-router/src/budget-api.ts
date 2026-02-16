/**
 * @fileoverview API routes for budget management and monitoring
 * @description Express routes for user budget status and admin budget oversight
 */

import { Router, Request, Response } from 'express';
import { 
  getUserBudget, 
  getUserBudgetBreakdown, 
  upgradeTier, 
  checkBudget 
} from './user-budget';
import { generateUsageBreakdown } from './budget-alerts';
import { RequestWithBudget } from './budget-middleware';
import * as admin from 'firebase-admin';

const router = Router();

/**
 * User-facing budget status endpoint
 * GET /api/v1/budget
 */
router.get('/budget', async (req: RequestWithBudget, res: Response) => {
  try {
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    
    // Get current budget status
    const budget = await getUserBudget(userId);
    const budgetCheck = await checkBudget(userId);
    const breakdown = await getUserBudgetBreakdown(userId);
    
    // Calculate additional metrics
    const totalSpend = budget.spentUsd + budget.degradedSpendUsd;
    const percentUsed = budget.budgetUsd > 0 ? (budget.spentUsd / budget.budgetUsd) * 100 : 0;
    const daysUntilReset = breakdown.daysUntilReset;
    
    // Determine upgrade information
    let upgradeAvailable = false;
    let upgradeTier: string | undefined;
    let upgradePrice: string | undefined;
    
    if (budget.tier === 'free') {
      upgradeAvailable = true;
      upgradeTier = 'Pro';
      upgradePrice = '$6.99/month';
    } else if (budget.tier === 'pro') {
      upgradeAvailable = true;
      upgradeTier = 'Pro+';
      upgradePrice = '$16.99/month';
    } else if (budget.tier === 'pro_plus') {
      upgradeAvailable = true;
      upgradeTier = 'Enterprise';
      upgradePrice = 'Contact sales';
    }
    
    // Generate user-friendly message based on status
    let message: string | undefined;
    
    switch (budget.status) {
      case 'blocked':
        if (budget.tier === 'free') {
          message = 'Upgrade to Pro to start using AI coaching features.';
        } else {
          message = `You've reached your AI limit for this month. Upgrade to ${upgradeTier} for more AI coaching.`;
        }
        break;
        
      case 'degraded':
        message = "You're now using our efficient AI engine to help you stay within budget. Responses will be more concise but still helpful.";
        break;
        
      case 'premium':
        if (percentUsed > 80) {
          message = `You've used ${Math.round(percentUsed)}% of your AI budget. Consider upgrading for unlimited access.`;
        }
        break;
    }
    
    const response: AIBudgetStatus = {
      status: budgetCheck.allowed ? budget.status : 'blocked',
      spentUsd: totalSpend,
      budgetUsd: budget.budgetUsd,
      percentUsed: Math.round(percentUsed),
      resetAt: budget.resetAt,
      daysUntilReset,
      callCount: budget.callCount,
      tier: budget.tier,
      message,
      upgradeAvailable,
      upgradeTier,
      upgradePrice,
      routingPreference: budgetCheck.routingPreference,
      projectedMonthlySpend: breakdown.projectedMonthlySpend,
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Error getting budget status:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Unable to fetch budget status',
    });
  }
});

/**
 * User budget history endpoint
 * GET /api/v1/budget/history?months=3
 */
router.get('/budget/history', async (req: RequestWithBudget, res: Response) => {
  try {
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    
    const monthsParam = req.query.months as string;
    const months = monthsParam ? parseInt(monthsParam) : 3;
    
    if (months < 1 || months > 12) {
      return res.status(400).json({
        error: 'invalid_parameter',
        message: 'Months must be between 1 and 12',
      });
    }
    
    const db = admin.firestore();
    const history: Array<{
      period: string;
      budgetUsd: number;
      spentUsd: number;
      degradedSpendUsd: number;
      totalSpend: number;
      callCount: number;
      status: string;
      tier: string;
    }> = [];
    
    // Get historical budget data
    for (let i = 0; i < months; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      try {
        let budgetDoc;
        if (i === 0) {
          // Current month - use main budget document
          budgetDoc = await db.doc(`users/${userId}/billing/ai-budget`).get();
        } else {
          // Historical month - check if we have archived data
          budgetDoc = await db.doc(`users/${userId}/billing/ai-budget-${period}`).get();
        }
        
        if (budgetDoc.exists) {
          const budget = budgetDoc.data()!;
          const totalSpend = budget.spentUsd + budget.degradedSpendUsd;
          
          history.push({
            period,
            budgetUsd: budget.budgetUsd,
            spentUsd: budget.spentUsd,
            degradedSpendUsd: budget.degradedSpendUsd,
            totalSpend,
            callCount: budget.callCount,
            status: budget.status,
            tier: budget.tier,
          });
        } else {
          // No data for this month
          history.push({
            period,
            budgetUsd: 0,
            spentUsd: 0,
            degradedSpendUsd: 0,
            totalSpend: 0,
            callCount: 0,
            status: 'unknown',
            tier: 'free',
          });
        }
      } catch (error) {
        console.warn(`Error getting budget for period ${period}:`, error);
      }
    }
    
    // Reverse to show oldest first
    history.reverse();
    
    res.json({
      userId,
      months: history.length,
      history,
    });
    
  } catch (error) {
    console.error('Error getting budget history:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Unable to fetch budget history',
    });
  }
});

/**
 * User usage breakdown endpoint
 * GET /api/v1/budget/usage
 */
router.get('/budget/usage', async (req: RequestWithBudget, res: Response) => {
  try {
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    
    const period = req.query.period as string | undefined;
    const usage = await generateUsageBreakdown(userId, period);
    
    // Convert usage breakdown to user-friendly format
    const topTaskTypes = Object.entries(usage.byTaskType)
      .map(([taskType, stats]) => ({
        taskType: getTaskTypeDisplayName(taskType),
        count: stats.count,
        cost: stats.cost,
        percentage: usage.totalCost > 0 ? Math.round((stats.cost / usage.totalCost) * 100) : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
    
    const topModels = Object.entries(usage.byModel)
      .map(([model, stats]) => ({
        model: getModelDisplayName(model),
        count: stats.count,
        cost: stats.cost,
        percentage: usage.totalCost > 0 ? Math.round((stats.cost / usage.totalCost) * 100) : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
    
    res.json({
      userId,
      period: usage.period,
      totalCalls: usage.totalCalls,
      totalCost: usage.totalCost,
      averageCostPerCall: usage.averageCostPerCall,
      topTaskTypes,
      topModels,
      topDays: usage.topDays,
    });
    
  } catch (error) {
    console.error('Error getting usage breakdown:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Unable to fetch usage breakdown',
    });
  }
});

// Admin endpoints (require admin privileges)

/**
 * Admin budget alerts endpoint
 * GET /api/v1/admin/budget/alerts?limit=50&type=degraded
 */
router.get('/admin/budget/alerts', requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const alertType = req.query.type as string;
    const days = parseInt(req.query.days as string) || 7;
    
    const db = admin.firestore();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    let query = db.collection('_alerts')
      .doc('budget')
      .collection('alerts')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(limit, 100));
    
    if (alertType) {
      query = query.where('type', '==', alertType);
    }
    
    const alertsSnapshot = await query.get();
    
    const alerts = alertsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    res.json({
      alerts,
      count: alerts.length,
      filters: { alertType, days, limit },
    });
    
  } catch (error) {
    console.error('Error getting budget alerts:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Unable to fetch budget alerts',
    });
  }
});

/**
 * Admin budget overview endpoint
 * GET /api/v1/admin/budget/overview
 */
router.get('/admin/budget/overview', requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = admin.firestore();
    const currentPeriod = getCurrentPeriod();
    
    // Get latest daily report
    const today = new Date().toISOString().split('T')[0];
    const reportDoc = await db.collection('_budget_reports').doc(`daily_${today}`).get();
    
    let overview;
    
    if (reportDoc.exists) {
      overview = reportDoc.data();
    } else {
      // Fallback: generate overview from live data
      const budgetQuery = await db.collectionGroup('billing')
        .where('period', '==', currentPeriod)
        .get();
      
      overview = {
        date: today,
        period: currentPeriod,
        totalUsers: 0,
        totalSpend: 0,
        totalCalls: 0,
        usersInDegraded: 0,
        usersBlocked: 0,
        usersByTier: { free: 0, pro: 0, pro_plus: 0, enterprise: 0 },
        usersByStatus: { premium: 0, degraded: 0, blocked: 0 },
      };
      
      budgetQuery.docs.forEach(doc => {
        if (doc.id !== 'ai-budget') return;
        
        const budget = doc.data();
        overview.totalUsers++;
        overview.totalSpend += budget.spentUsd + budget.degradedSpendUsd;
        overview.totalCalls += budget.callCount;
        
        if (budget.tier in overview.usersByTier) {
          overview.usersByTier[budget.tier]++;
        }
        
        if (budget.status in overview.usersByStatus) {
          overview.usersByStatus[budget.status]++;
        }
        
        if (budget.status === 'degraded') overview.usersInDegraded++;
        if (budget.status === 'blocked') overview.usersBlocked++;
      });
    }
    
    res.json(overview);
    
  } catch (error) {
    console.error('Error getting budget overview:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Unable to fetch budget overview',
    });
  }
});

/**
 * Admin manual budget adjustment endpoint
 * POST /api/v1/admin/budget/:userId/adjust
 */
router.post('/admin/budget/:userId/adjust', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { action, amount, reason } = req.body;
    
    if (!userId || !action) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'User ID and action are required',
      });
    }
    
    const validActions = ['add_budget', 'reset_spend', 'upgrade_tier', 'unblock'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        error: 'invalid_action',
        message: `Action must be one of: ${validActions.join(', ')}`,
      });
    }
    
    const db = admin.firestore();
    const adminUserId = req.user?.uid || 'unknown';
    
    let result;
    
    switch (action) {
      case 'add_budget':
        if (!amount || amount <= 0) {
          return res.status(400).json({
            error: 'invalid_amount',
            message: 'Amount must be positive',
          });
        }
        
        result = await adjustUserBudget(userId, amount);
        break;
        
      case 'reset_spend':
        result = await resetUserSpend(userId);
        break;
        
      case 'upgrade_tier':
        const { newTier } = req.body;
        if (!newTier || !['pro', 'pro_plus', 'enterprise'].includes(newTier)) {
          return res.status(400).json({
            error: 'invalid_tier',
            message: 'New tier must be pro, pro_plus, or enterprise',
          });
        }
        
        result = await upgradeTier(userId, newTier);
        break;
        
      case 'unblock':
        result = await unblockUser(userId);
        break;
    }
    
    // Log the admin action
    await db.collection('_admin_actions').add({
      adminUserId,
      targetUserId: userId,
      action,
      amount,
      reason: reason || 'No reason provided',
      result,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    res.json({
      success: true,
      action,
      result,
      message: `Budget adjustment completed for user ${userId}`,
    });
    
  } catch (error) {
    console.error('Error adjusting user budget:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Unable to adjust user budget',
    });
  }
});

/**
 * Helper functions
 */

function requireAdmin(req: RequestWithBudget, res: Response, next: Function) {
  const userRole = req.user?.role;
  
  if (userRole !== 'admin' && userRole !== 'enterprise') {
    return res.status(403).json({
      error: 'insufficient_privileges',
      message: 'Admin privileges required',
    });
  }
  
  next();
}

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getTaskTypeDisplayName(taskType: string): string {
  const displayNames: Record<string, string> = {
    'fitness:coach-chat': 'Fitness Coaching',
    'nutrition:coach-chat': 'Nutrition Coaching',
    'nutrition:meal-scan': 'Meal Scanning',
    'meetings:analyze': 'Meeting Analysis',
    'budget:coach-chat': 'Financial Coaching',
    'budget:categorize': 'Transaction Categorization',
    'coach-chat': 'AI Coaching',
    'meal-scan': 'Meal Scanning',
  };
  
  return displayNames[taskType] || taskType;
}

function getModelDisplayName(model: string): string {
  const displayNames: Record<string, string> = {
    'claude-opus-4-6': 'Claude Opus 4.6',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'claude-haiku-3-5': 'Claude Haiku 3.5',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
  };
  
  return displayNames[model] || model;
}

async function adjustUserBudget(userId: string, additionalBudget: number) {
  const db = admin.firestore();
  const budgetDocPath = `users/${userId}/billing/ai-budget`;
  
  return await db.runTransaction(async (transaction) => {
    const budgetDoc = await transaction.get(db.doc(budgetDocPath));
    
    if (!budgetDoc.exists) {
      throw new Error('Budget document not found');
    }
    
    const budget = budgetDoc.data()!;
    const newBudget = {
      ...budget,
      budgetUsd: budget.budgetUsd + additionalBudget,
      updatedAt: new Date().toISOString(),
    };
    
    transaction.set(db.doc(budgetDocPath), newBudget);
    return newBudget;
  });
}

async function resetUserSpend(userId: string) {
  const db = admin.firestore();
  const budgetDocPath = `users/${userId}/billing/ai-budget`;
  
  return await db.runTransaction(async (transaction) => {
    const budgetDoc = await transaction.get(db.doc(budgetDocPath));
    
    if (!budgetDoc.exists) {
      throw new Error('Budget document not found');
    }
    
    const budget = budgetDoc.data()!;
    const newBudget = {
      ...budget,
      spentUsd: 0,
      degradedSpendUsd: 0,
      status: 'premium',
      degradedAt: undefined,
      blockedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    
    transaction.set(db.doc(budgetDocPath), newBudget);
    return newBudget;
  });
}

async function unblockUser(userId: string) {
  return await resetUserSpend(userId);
}

/**
 * Response types for API endpoints
 */

export interface AIBudgetStatus {
  status: 'premium' | 'degraded' | 'blocked' | 'free';
  spentUsd: number;
  budgetUsd: number;
  percentUsed: number;
  resetAt: string;
  daysUntilReset: number;
  callCount: number;
  tier: string;
  message?: string;
  upgradeAvailable: boolean;
  upgradeTier?: string;
  upgradePrice?: string;
  routingPreference: 'quality' | 'cost';
  projectedMonthlySpend: number;
}

export default router;