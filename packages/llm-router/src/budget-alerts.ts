/**
 * @fileoverview Budget alert system for user notifications and admin monitoring
 * @description Handles alerts when users enter degraded/blocked status and provides usage analytics
 */

import * as admin from 'firebase-admin';
import { UserAIBudget } from './user-budget';
import { RequestType } from './types';

/**
 * Budget alert data structure
 */
export interface BudgetAlert {
  type: 'degraded' | 'blocked' | 'high_usage' | 'approaching_limit';
  userId: string;
  userEmail: string;
  tier: string;
  spentUsd: number;
  budgetUsd: number;
  degradedSpendUsd: number;
  callCount: number;
  period: string;
  topTaskTypes: Array<{
    taskType: string;
    count: number;
    cost: number;
    percentage: number;
  }>;
  recommendation: string;
  createdAt: string;
  metadata?: {
    daysSinceStartOfMonth: number;
    projectedMonthlySpend: number;
    previousMonthSpend?: number;
    isRepeatOffender?: boolean;
  };
}

/**
 * Usage breakdown for alert generation
 */
export interface UsageBreakdown {
  userId: string;
  period: string;
  totalCalls: number;
  totalCost: number;
  byTaskType: Record<string, { count: number; cost: number }>;
  byModel: Record<string, { count: number; cost: number }>;
  topDays: Array<{ date: string; calls: number; cost: number }>;
  averageCostPerCall: number;
}

/**
 * Get user email for alert notifications
 */
async function getUserEmail(userId: string): Promise<string> {
  try {
    const userRecord = await admin.auth().getUser(userId);
    return userRecord.email || 'unknown@example.com';
  } catch (error) {
    console.warn(`Could not get email for user ${userId}:`, error);
    return 'unknown@example.com';
  }
}

/**
 * Generate usage breakdown for a user in the current period
 */
export async function generateUsageBreakdown(userId: string, period?: string): Promise<UsageBreakdown> {
  try {
    const db = admin.firestore();
    
    // Use current period if not specified
    const targetPeriod = period || getCurrentPeriod();
    
    // Query LLM calls for the user in the current period
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    
    const startTimestamp = admin.firestore.Timestamp.fromDate(startOfMonth);
    const endTimestamp = admin.firestore.Timestamp.fromDate(endOfMonth);
    
    const callsQuery = await db.collection('llm_calls')
      .where('userId', '==', userId)
      .where('timestamp', '>=', startTimestamp)
      .where('timestamp', '<', endTimestamp)
      .where('success', '==', true)
      .get();
    
    const breakdown: UsageBreakdown = {
      userId,
      period: targetPeriod,
      totalCalls: 0,
      totalCost: 0,
      byTaskType: {},
      byModel: {},
      topDays: [],
      averageCostPerCall: 0,
    };
    
    const dayStats: Record<string, { calls: number; cost: number }> = {};
    
    callsQuery.docs.forEach(doc => {
      const call = doc.data();
      
      breakdown.totalCalls++;
      breakdown.totalCost += call.cost;
      
      // By task type
      const taskType = call.requestType;
      if (!breakdown.byTaskType[taskType]) {
        breakdown.byTaskType[taskType] = { count: 0, cost: 0 };
      }
      breakdown.byTaskType[taskType].count++;
      breakdown.byTaskType[taskType].cost += call.cost;
      
      // By model
      const model = call.model;
      if (!breakdown.byModel[model]) {
        breakdown.byModel[model] = { count: 0, cost: 0 };
      }
      breakdown.byModel[model].count++;
      breakdown.byModel[model].cost += call.cost;
      
      // By day
      const callDate = call.timestamp.toDate().toISOString().split('T')[0];
      if (!dayStats[callDate]) {
        dayStats[callDate] = { calls: 0, cost: 0 };
      }
      dayStats[callDate].calls++;
      dayStats[callDate].cost += call.cost;
    });
    
    // Sort top days by cost
    breakdown.topDays = Object.entries(dayStats)
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
    
    breakdown.averageCostPerCall = breakdown.totalCalls > 0 ? breakdown.totalCost / breakdown.totalCalls : 0;
    
    return breakdown;
    
  } catch (error) {
    console.error('Error generating usage breakdown:', error);
    return {
      userId,
      period: period || getCurrentPeriod(),
      totalCalls: 0,
      totalCost: 0,
      byTaskType: {},
      byModel: {},
      topDays: [],
      averageCostPerCall: 0,
    };
  }
}

/**
 * Get current period string (YYYY-MM)
 */
function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Generate recommendation based on usage patterns
 */
function generateRecommendation(alert: BudgetAlert, usage: UsageBreakdown): string {
  const { type, tier, spentUsd, budgetUsd, callCount } = alert;
  const { averageCostPerCall, byTaskType } = usage;
  
  // Find most expensive task types
  const expensiveTaskTypes = Object.entries(byTaskType)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 3)
    .map(([taskType]) => taskType);
  
  const recommendations: string[] = [];
  
  switch (type) {
    case 'degraded':
      recommendations.push('User has entered degraded AI mode (cheaper models).');
      if (tier === 'pro') {
        recommendations.push('Consider upgrading to Pro+ for higher AI budget ($10/month vs $3/month).');
      }
      break;
      
    case 'blocked':
      recommendations.push('User is blocked from AI features for the rest of this month.');
      if (tier === 'pro') {
        recommendations.push('Consider upgrading to Pro+ or Enterprise for higher limits.');
      }
      recommendations.push('High-value user candidate - consider outreach.');
      break;
      
    case 'high_usage':
      if (averageCostPerCall > 0.05) {
        recommendations.push('User has high per-call costs. Consider coaching on prompt efficiency.');
      }
      if (expensiveTaskTypes.includes('nutrition:coach-chat') || expensiveTaskTypes.includes('fitness:coach-chat')) {
        recommendations.push('Heavy coaching chat user - good upgrade candidate.');
      }
      break;
      
    case 'approaching_limit':
      recommendations.push('User approaching budget limit. Pre-emptive upgrade outreach recommended.');
      break;
  }
  
  // Days left in month context
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysRemaining = daysInMonth - dayOfMonth;
  
  if (daysRemaining > 15 && type === 'degraded') {
    recommendations.push('Hit budget early in month - strong upgrade candidate.');
  }
  
  // Call frequency analysis
  if (callCount > 100 && tier === 'pro') {
    recommendations.push('Power user (100+ calls) - Enterprise tier candidate.');
  }
  
  return recommendations.join(' ');
}

/**
 * Send budget alert (stores in Firestore and potentially sends notifications)
 */
export async function sendBudgetAlert(budget: UserAIBudget, alertType: BudgetAlert['type']): Promise<void> {
  try {
    const db = admin.firestore();
    
    // Get user email
    const userEmail = await getUserEmail(budget.userId);
    
    // Generate usage breakdown
    const usage = await generateUsageBreakdown(budget.userId, budget.period);
    
    // Create top task types array
    const topTaskTypes = Object.entries(usage.byTaskType)
      .map(([taskType, stats]) => ({
        taskType,
        count: stats.count,
        cost: stats.cost,
        percentage: usage.totalCost > 0 ? (stats.cost / usage.totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
    
    // Calculate metadata
    const now = new Date();
    const daysSinceStartOfMonth = now.getDate();
    const projectedMonthlySpend = daysSinceStartOfMonth > 0 
      ? (budget.spentUsd + budget.degradedSpendUsd) / daysSinceStartOfMonth * 30
      : budget.spentUsd + budget.degradedSpendUsd;
    
    // Check if user was blocked last month (repeat offender)
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastMonthPeriod = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    
    let previousMonthSpend: number | undefined;
    let isRepeatOffender = false;
    
    try {
      const lastMonthBudget = await db.doc(`users/${budget.userId}/billing/ai-budget-${lastMonthPeriod}`).get();
      if (lastMonthBudget.exists) {
        const lastBudgetData = lastMonthBudget.data();
        previousMonthSpend = (lastBudgetData?.spentUsd || 0) + (lastBudgetData?.degradedSpendUsd || 0);
        isRepeatOffender = lastBudgetData?.status === 'blocked';
      }
    } catch (error) {
      console.warn('Could not fetch previous month budget:', error);
    }
    
    const alert: BudgetAlert = {
      type: alertType,
      userId: budget.userId,
      userEmail,
      tier: budget.tier,
      spentUsd: budget.spentUsd,
      budgetUsd: budget.budgetUsd,
      degradedSpendUsd: budget.degradedSpendUsd,
      callCount: budget.callCount,
      period: budget.period,
      topTaskTypes,
      recommendation: '',
      createdAt: new Date().toISOString(),
      metadata: {
        daysSinceStartOfMonth,
        projectedMonthlySpend,
        previousMonthSpend,
        isRepeatOffender,
      },
    };
    
    // Generate recommendation
    alert.recommendation = generateRecommendation(alert, usage);
    
    // Store alert in Firestore for Command Center
    const alertId = `${budget.userId}_${budget.period}_${alertType}_${Date.now()}`;
    await db.collection('_alerts').doc('budget').collection('alerts').doc(alertId).set(alert);
    
    // Send push notification to user (if enabled)
    await sendUserNotification(alert);
    
    // Log for monitoring
    console.log(`Budget alert sent: ${alertType} for user ${budget.userId} (${budget.tier}) - $${(budget.spentUsd + budget.degradedSpendUsd).toFixed(2)} spent`);
    
  } catch (error) {
    console.error('Error sending budget alert:', error);
  }
}

/**
 * Send push notification to user about budget status
 */
async function sendUserNotification(alert: BudgetAlert): Promise<void> {
  try {
    const db = admin.firestore();
    
    // Check user notification preferences
    const userDoc = await db.collection('users').doc(alert.userId).get();
    const userData = userDoc.data();
    const notificationPrefs = userData?.preferences?.notifications;
    
    if (notificationPrefs?.budgetAlerts === false) {
      console.log(`User ${alert.userId} has budget alerts disabled`);
      return;
    }
    
    let title: string;
    let body: string;
    
    switch (alert.type) {
      case 'degraded':
        title = "AI Budget Alert";
        body = "You've reached your AI budget limit. We've switched you to our efficient AI engine to help you stay within budget.";
        break;
        
      case 'blocked':
        title = "AI Budget Exhausted";
        body = "You've used up your AI budget for this month. Upgrade to Pro+ to continue using AI features.";
        break;
        
      case 'approaching_limit':
        title = "AI Budget Warning";
        body = `You've used ${Math.round((alert.spentUsd / alert.budgetUsd) * 100)}% of your AI budget. Consider upgrading to Pro+ for more AI coaching.`;
        break;
        
      default:
        return; // Don't notify for other alert types
    }
    
    // Create notification document for in-app display
    const notification = {
      userId: alert.userId,
      title,
      body,
      type: 'budget_alert',
      data: {
        alertType: alert.type,
        spentUsd: alert.spentUsd,
        budgetUsd: alert.budgetUsd,
        upgradeUrl: '/settings/subscription',
      },
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await db.collection('notifications').add(notification);
    
    // Send FCM push notification if user has tokens
    const tokensSnapshot = await db.collection('users').doc(alert.userId)
      .collection('fcm_tokens').get();
    
    if (!tokensSnapshot.empty) {
      const tokens = tokensSnapshot.docs
        .map(doc => doc.data().token)
        .filter(token => token);
      
      if (tokens.length > 0) {
        const message = {
          notification: { title, body },
          data: {
            type: 'budget_alert',
            alertType: alert.type,
            upgradeUrl: '/settings/subscription',
          },
          tokens,
        };
        
        await admin.messaging().sendEachForMulticast(message);
        console.log(`Push notification sent to ${tokens.length} devices for user ${alert.userId}`);
      }
    }
    
  } catch (error) {
    console.error('Error sending user notification:', error);
  }
}

/**
 * Check for users approaching their budget limits (preventive alerts)
 */
export async function checkApproachingLimits(): Promise<number> {
  try {
    const db = admin.firestore();
    
    // Find all users who are at 80%+ of their budget but not yet degraded
    const budgetQuery = await db.collectionGroup('billing').get();
    
    let alertCount = 0;
    
    for (const doc of budgetQuery.docs) {
      if (doc.id !== 'ai-budget') continue;
      
      const budget = doc.data() as UserAIBudget;
      
      // Skip if already degraded/blocked or free tier
      if (budget.status !== 'premium' || budget.budgetUsd === 0) {
        continue;
      }
      
      const usagePercentage = budget.spentUsd / budget.budgetUsd;
      
      // Alert at 80% usage
      if (usagePercentage >= 0.8) {
        // Check if we already sent an approaching limit alert this month
        const existingAlertQuery = await db.collection('_alerts')
          .doc('budget')
          .collection('alerts')
          .where('userId', '==', budget.userId)
          .where('period', '==', budget.period)
          .where('type', '==', 'approaching_limit')
          .get();
        
        if (existingAlertQuery.empty) {
          await sendBudgetAlert(budget, 'approaching_limit');
          alertCount++;
        }
      }
    }
    
    console.log(`Checked approaching limits: sent ${alertCount} alerts`);
    return alertCount;
    
  } catch (error) {
    console.error('Error checking approaching limits:', error);
    return 0;
  }
}

/**
 * Identify high-usage users who haven't hit their budget yet (upsell candidates)
 */
export async function identifyHighUsageUsers(): Promise<Array<{
  userId: string;
  userEmail: string;
  tier: string;
  callCount: number;
  totalSpend: number;
  projectedMonthlySpend: number;
  topFeatures: string[];
  recommendation: string;
}>> {
  try {
    const db = admin.firestore();
    
    // Get current month's high-usage users
    const currentPeriod = getCurrentPeriod();
    const budgetQuery = await db.collectionGroup('billing')
      .where('period', '==', currentPeriod)
      .get();
    
    const highUsageUsers: Array<{
      userId: string;
      userEmail: string;
      tier: string;
      callCount: number;
      totalSpend: number;
      projectedMonthlySpend: number;
      topFeatures: string[];
      recommendation: string;
    }> = [];
    
    const now = new Date();
    const dayOfMonth = now.getDate();
    
    for (const doc of budgetQuery.docs) {
      if (doc.id !== 'ai-budget') continue;
      
      const budget = doc.data() as UserAIBudget;
      
      // Skip if already at high tier or blocked
      if (budget.tier === 'enterprise' || budget.status === 'blocked') {
        continue;
      }
      
      const totalSpend = budget.spentUsd + budget.degradedSpendUsd;
      const projectedMonthlySpend = dayOfMonth > 0 ? (totalSpend / dayOfMonth) * 30 : totalSpend;
      
      // Identify high usage (either by calls or projected spend)
      const isHighUsage = 
        budget.callCount > 50 || // More than 50 calls
        projectedMonthlySpend > budget.budgetUsd * 1.5 || // Projected to spend 1.5x their budget
        (budget.tier === 'pro' && projectedMonthlySpend > 8); // Pro users projected to spend more than Pro+ budget
      
      if (isHighUsage) {
        const userEmail = await getUserEmail(budget.userId);
        const usage = await generateUsageBreakdown(budget.userId);
        
        // Get top features
        const topFeatures = Object.entries(usage.byTaskType)
          .sort((a, b) => b[1].cost - a[1].cost)
          .slice(0, 3)
          .map(([taskType]) => taskType);
        
        // Generate recommendation
        let recommendation = '';
        if (budget.tier === 'pro' && projectedMonthlySpend > 10) {
          recommendation = 'Strong Enterprise tier candidate - high usage and projected spend.';
        } else if (budget.tier === 'pro') {
          recommendation = 'Pro+ upgrade candidate - approaching Pro+ budget levels.';
        } else if (budget.tier === 'free' && budget.callCount > 0) {
          recommendation = 'Free user with API calls - investigate how they bypassed budget limits.';
        }
        
        highUsageUsers.push({
          userId: budget.userId,
          userEmail,
          tier: budget.tier,
          callCount: budget.callCount,
          totalSpend,
          projectedMonthlySpend,
          topFeatures,
          recommendation,
        });
      }
    }
    
    // Sort by projected spend (highest first)
    highUsageUsers.sort((a, b) => b.projectedMonthlySpend - a.projectedMonthlySpend);
    
    console.log(`Identified ${highUsageUsers.length} high-usage users for potential upsell`);
    
    return highUsageUsers.slice(0, 20); // Top 20
    
  } catch (error) {
    console.error('Error identifying high-usage users:', error);
    return [];
  }
}