/**
 * @fileoverview Scheduled jobs for budget management and reporting
 * @description Cloud Functions and cron jobs for budget maintenance and analytics
 */

import * as admin from 'firebase-admin';
import { resetMonthlyBudgets, getUserBudget, getUserBudgetBreakdown } from './user-budget';
import { checkApproachingLimits, identifyHighUsageUsers } from './budget-alerts';

/**
 * Monthly budget reset job (runs on 1st of each month at 00:00 UTC)
 * This should be deployed as a Cloud Function with a scheduled trigger
 */
export async function resetMonthlyBudgetsJob(): Promise<{
  success: boolean;
  resetCount: number;
  errorCount: number;
  message: string;
}> {
  console.log('Starting monthly budget reset job...');
  
  try {
    const result = await resetMonthlyBudgets();
    
    const message = `Monthly budget reset completed: ${result.resetCount} budgets reset, ${result.errorCount} errors`;
    console.log(message);
    
    // Log the job execution to Firestore for monitoring
    const db = admin.firestore();
    await db.collection('_job_logs').add({
      jobType: 'monthly_budget_reset',
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      result,
      success: true,
      message,
    });
    
    return {
      success: true,
      resetCount: result.resetCount,
      errorCount: result.errorCount,
      message,
    };
    
  } catch (error) {
    const errorMessage = `Monthly budget reset failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMessage, error);
    
    // Log the failure
    const db = admin.firestore();
    await db.collection('_job_logs').add({
      jobType: 'monthly_budget_reset',
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      success: false,
      error: errorMessage,
    });
    
    return {
      success: false,
      resetCount: 0,
      errorCount: 1,
      message: errorMessage,
    };
  }
}

/**
 * Daily budget report job (runs daily at 02:00 UTC)
 * Provides summary of AI spend, users in degraded/blocked states
 */
export async function dailyBudgetReportJob(): Promise<{
  success: boolean;
  report: DailyBudgetReport;
  message: string;
}> {
  console.log('Starting daily budget report job...');
  
  try {
    const db = admin.firestore();
    const currentPeriod = getCurrentPeriod();
    
    // Query all budget documents for current period
    const budgetQuery = await db.collectionGroup('billing').get();
    
    const report: DailyBudgetReport = {
      date: new Date().toISOString().split('T')[0],
      period: currentPeriod,
      totalUsers: 0,
      usersByTier: { free: 0, pro: 0, pro_plus: 0, enterprise: 0 },
      usersByStatus: { premium: 0, degraded: 0, blocked: 0 },
      totalSpend: 0,
      totalCalls: 0,
      averageSpendPerUser: 0,
      topSpenders: [],
      usersInDegraded: 0,
      usersBlocked: 0,
      projectedMonthlySpend: 0,
      generatedAt: new Date().toISOString(),
    };
    
    const userSpends: Array<{ userId: string; spend: number; tier: string; calls: number }> = [];
    
    for (const doc of budgetQuery.docs) {
      if (doc.id !== 'ai-budget') continue;
      
      const budget = doc.data();
      if (budget.period !== currentPeriod) continue;
      
      report.totalUsers++;
      
      // Count by tier
      const tier = budget.tier as keyof typeof report.usersByTier;
      if (tier in report.usersByTier) {
        report.usersByTier[tier]++;
      }
      
      // Count by status
      const status = budget.status as keyof typeof report.usersByStatus;
      if (status in report.usersByStatus) {
        report.usersByStatus[status]++;
      }
      
      const totalSpend = budget.spentUsd + budget.degradedSpendUsd;
      report.totalSpend += totalSpend;
      report.totalCalls += budget.callCount;
      
      userSpends.push({
        userId: budget.userId,
        spend: totalSpend,
        tier: budget.tier,
        calls: budget.callCount,
      });
      
      if (budget.status === 'degraded') {
        report.usersInDegraded++;
      } else if (budget.status === 'blocked') {
        report.usersBlocked++;
      }
    }
    
    // Calculate averages
    report.averageSpendPerUser = report.totalUsers > 0 ? report.totalSpend / report.totalUsers : 0;
    
    // Get top 10 spenders
    report.topSpenders = userSpends
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10)
      .map(user => ({
        userId: user.userId,
        spend: user.spend,
        tier: user.tier,
        calls: user.calls,
      }));
    
    // Project monthly spend
    const dayOfMonth = new Date().getDate();
    report.projectedMonthlySpend = dayOfMonth > 0 ? (report.totalSpend / dayOfMonth) * 30 : report.totalSpend;
    
    // Store report
    await db.collection('_budget_reports').doc(`daily_${report.date}`).set(report);
    
    const message = `Daily budget report generated: ${report.totalUsers} users, $${report.totalSpend.toFixed(2)} spent, ${report.usersInDegraded} degraded, ${report.usersBlocked} blocked`;
    console.log(message);
    
    // Log job execution
    await db.collection('_job_logs').add({
      jobType: 'daily_budget_report',
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      success: true,
      message,
      reportId: `daily_${report.date}`,
    });
    
    return { success: true, report, message };
    
  } catch (error) {
    const errorMessage = `Daily budget report failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMessage, error);
    
    const db = admin.firestore();
    await db.collection('_job_logs').add({
      jobType: 'daily_budget_report',
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      success: false,
      error: errorMessage,
    });
    
    return {
      success: false,
      report: {} as DailyBudgetReport,
      message: errorMessage,
    };
  }
}

/**
 * Weekly power user report (runs every Monday at 01:00 UTC)
 * Identifies users who regularly hit budget caps - upgrade candidates
 */
export async function weeklyPowerUserReportJob(): Promise<{
  success: boolean;
  report: PowerUserReport;
  message: string;
}> {
  console.log('Starting weekly power user report job...');
  
  try {
    const db = admin.firestore();
    
    // Get high usage users
    const highUsageUsers = await identifyHighUsageUsers();
    
    // Get users who hit degraded/blocked status this month
    const currentPeriod = getCurrentPeriod();
    const budgetQuery = await db.collectionGroup('billing')
      .where('period', '==', currentPeriod)
      .where('status', 'in', ['degraded', 'blocked'])
      .get();
    
    const powerUsers: Array<{
      userId: string;
      tier: string;
      totalSpend: number;
      callCount: number;
      status: string;
      recommendation: string;
      upgradeCandidate: boolean;
      repeatUser: boolean;
    }> = [];
    
    // Process degraded/blocked users
    for (const doc of budgetQuery.docs) {
      if (doc.id !== 'ai-budget') continue;
      
      const budget = doc.data();
      const totalSpend = budget.spentUsd + budget.degradedSpendUsd;
      
      // Check if this user was also degraded/blocked last month (repeat user)
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const lastMonthPeriod = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
      
      let repeatUser = false;
      try {
        const lastMonthBudget = await db.doc(`users/${budget.userId}/billing/ai-budget-${lastMonthPeriod}`).get();
        if (lastMonthBudget.exists) {
          const lastBudgetData = lastMonthBudget.data();
          repeatUser = lastBudgetData?.status === 'degraded' || lastBudgetData?.status === 'blocked';
        }
      } catch (error) {
        console.warn(`Could not check last month for user ${budget.userId}:`, error);
      }
      
      let recommendation = '';
      let upgradeCandidate = false;
      
      if (budget.tier === 'pro' && totalSpend > 8) {
        recommendation = 'Strong Pro+ upgrade candidate - spending exceeds Pro+ budget levels';
        upgradeCandidate = true;
      } else if (budget.tier === 'pro' && totalSpend > 5) {
        recommendation = 'Pro+ upgrade candidate - high usage pattern';
        upgradeCandidate = true;
      } else if (budget.tier === 'pro_plus' && totalSpend > 20) {
        recommendation = 'Enterprise upgrade candidate - very high usage';
        upgradeCandidate = true;
      } else if (repeatUser) {
        recommendation = 'Repeat power user - consider upgrade outreach';
        upgradeCandidate = true;
      } else {
        recommendation = 'Monitor usage pattern';
      }
      
      powerUsers.push({
        userId: budget.userId,
        tier: budget.tier,
        totalSpend,
        callCount: budget.callCount,
        status: budget.status,
        recommendation,
        upgradeCandidate,
        repeatUser,
      });
    }
    
    // Add high usage users who haven't hit limits yet
    for (const highUser of highUsageUsers) {
      const existing = powerUsers.find(u => u.userId === highUser.userId);
      if (!existing) {
        powerUsers.push({
          userId: highUser.userId,
          tier: highUser.tier,
          totalSpend: highUser.totalSpend,
          callCount: highUser.callCount,
          status: 'premium',
          recommendation: highUser.recommendation,
          upgradeCandidate: true,
          repeatUser: false,
        });
      }
    }
    
    // Sort by total spend
    powerUsers.sort((a, b) => b.totalSpend - a.totalSpend);
    
    const report: PowerUserReport = {
      weekOf: getStartOfWeek().toISOString().split('T')[0],
      period: currentPeriod,
      totalPowerUsers: powerUsers.length,
      upgradeCandidates: powerUsers.filter(u => u.upgradeCandidate).length,
      repeatUsers: powerUsers.filter(u => u.repeatUser).length,
      topUsers: powerUsers.slice(0, 25), // Top 25 power users
      byTier: {
        pro: powerUsers.filter(u => u.tier === 'pro').length,
        pro_plus: powerUsers.filter(u => u.tier === 'pro_plus').length,
        enterprise: powerUsers.filter(u => u.tier === 'enterprise').length,
      },
      totalRevenuePotential: calculateRevenuePotential(powerUsers),
      generatedAt: new Date().toISOString(),
    };
    
    // Store report
    await db.collection('_budget_reports').doc(`weekly_${report.weekOf}`).set(report);
    
    const message = `Weekly power user report generated: ${report.totalPowerUsers} power users, ${report.upgradeCandidates} upgrade candidates`;
    console.log(message);
    
    // Log job execution
    await db.collection('_job_logs').add({
      jobType: 'weekly_power_user_report',
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      success: true,
      message,
      reportId: `weekly_${report.weekOf}`,
    });
    
    return { success: true, report, message };
    
  } catch (error) {
    const errorMessage = `Weekly power user report failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMessage, error);
    
    const db = admin.firestore();
    await db.collection('_job_logs').add({
      jobType: 'weekly_power_user_report',
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      success: false,
      error: errorMessage,
    });
    
    return {
      success: false,
      report: {} as PowerUserReport,
      message: errorMessage,
    };
  }
}

/**
 * Hourly alert check job (runs every hour)
 * Checks for users approaching their limits and sends preventive alerts
 */
export async function hourlyAlertCheckJob(): Promise<{
  success: boolean;
  alertsSent: number;
  message: string;
}> {
  try {
    const alertsSent = await checkApproachingLimits();
    
    const message = `Hourly alert check completed: ${alertsSent} alerts sent`;
    console.log(message);
    
    // Log job execution
    const db = admin.firestore();
    await db.collection('_job_logs').add({
      jobType: 'hourly_alert_check',
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      success: true,
      message,
      alertsSent,
    });
    
    return { success: true, alertsSent, message };
    
  } catch (error) {
    const errorMessage = `Hourly alert check failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMessage, error);
    
    const db = admin.firestore();
    await db.collection('_job_logs').add({
      jobType: 'hourly_alert_check',
      executedAt: admin.firestore.FieldValue.serverTimestamp(),
      success: false,
      error: errorMessage,
    });
    
    return {
      success: false,
      alertsSent: 0,
      message: errorMessage,
    };
  }
}

/**
 * Helper functions
 */

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getStartOfWeek(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);
  return startOfWeek;
}

function calculateRevenuePotential(powerUsers: Array<{ tier: string; upgradeCandidate: boolean }>): number {
  let potential = 0;
  
  for (const user of powerUsers) {
    if (!user.upgradeCandidate) continue;
    
    switch (user.tier) {
      case 'pro':
        // Pro to Pro+ = $7/month additional
        potential += 7;
        break;
      case 'pro_plus':
        // Pro+ to Enterprise = assume $40/month additional
        potential += 40;
        break;
    }
  }
  
  return potential;
}

/**
 * Type definitions for reports
 */

export interface DailyBudgetReport {
  date: string;
  period: string;
  totalUsers: number;
  usersByTier: {
    free: number;
    pro: number;
    pro_plus: number;
    enterprise: number;
  };
  usersByStatus: {
    premium: number;
    degraded: number;
    blocked: number;
  };
  totalSpend: number;
  totalCalls: number;
  averageSpendPerUser: number;
  topSpenders: Array<{
    userId: string;
    spend: number;
    tier: string;
    calls: number;
  }>;
  usersInDegraded: number;
  usersBlocked: number;
  projectedMonthlySpend: number;
  generatedAt: string;
}

export interface PowerUserReport {
  weekOf: string;
  period: string;
  totalPowerUsers: number;
  upgradeCandidates: number;
  repeatUsers: number;
  topUsers: Array<{
    userId: string;
    tier: string;
    totalSpend: number;
    callCount: number;
    status: string;
    recommendation: string;
    upgradeCandidate: boolean;
    repeatUser: boolean;
  }>;
  byTier: {
    pro: number;
    pro_plus: number;
    enterprise: number;
  };
  totalRevenuePotential: number;
  generatedAt: string;
}