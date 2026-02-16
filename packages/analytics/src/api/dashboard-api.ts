import express from 'express';
import NodeCache from 'node-cache';
import BigQueryClient from '../bigquery-config';
import { readFileSync } from 'fs';
import { join } from 'path';

const router = express.Router();

// 5-minute cache for dashboard queries
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

interface CacheStats {
  hits: number;
  misses: number;
}

const cacheStats: CacheStats = { hits: 0, misses: 0 };

/**
 * Initialize the dashboard API with BigQuery client
 */
export function createDashboardAPI(bqClient: BigQueryClient) {
  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      cache: {
        keys: cache.keys().length,
        stats: cacheStats,
      },
    });
  });

  // Analytics Overview - DAU/WAU/MAU, revenue, key metrics
  router.get('/overview', async (req, res) => {
    try {
      const cacheKey = 'analytics_overview';
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        cacheStats.hits++;
        return res.json(cachedData);
      }

      cacheStats.misses++;

      // Load and execute overview queries
      const overviewQuery = loadSQLTemplate('overview.sql', bqClient);
      
      const [
        dauResults,
        wauResults, 
        mauResults,
        revenueResults,
        cohortResults,
      ] = await Promise.all([
        bqClient.query(overviewQuery.dau),
        bqClient.query(overviewQuery.wau),
        bqClient.query(overviewQuery.mau),
        bqClient.query(overviewQuery.revenue),
        bqClient.query(overviewQuery.cohorts),
      ]);

      // Aggregate current period metrics
      const currentDate = new Date();
      const currentMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
      
      // Calculate totals across all apps
      const currentDAU = dauResults
        .filter(row => row.activity_date === formatDate(currentDate))
        .reduce((sum, row) => sum + (row.daily_active_users || 0), 0);
        
      const currentWAU = wauResults
        .filter(row => isCurrentWeek(row.week_start, currentDate))
        .reduce((sum, row) => sum + (row.weekly_active_users || 0), 0);
        
      const currentMAU = mauResults
        .filter(row => row.month_start && row.month_start.startsWith(currentMonth))
        .reduce((sum, row) => sum + (row.monthly_active_users || 0), 0);

      const currentMRR = revenueResults
        .filter(row => row.revenue_month && row.revenue_month.startsWith(currentMonth))
        .reduce((sum, row) => sum + (row.monthly_recurring_revenue || 0), 0);

      // Calculate growth rates
      const dauGrowth = calculateGrowthRate(dauResults, 'daily_active_users', 7);
      const wauGrowth = calculateGrowthRate(wauResults, 'weekly_active_users', 4);  
      const mauGrowth = calculateGrowthRate(mauResults, 'monthly_active_users', 1);
      const mrrGrowth = calculateGrowthRate(revenueResults, 'monthly_recurring_revenue', 1);

      const overview = {
        metrics: {
          dau: { current: currentDAU, growth: dauGrowth },
          wau: { current: currentWAU, growth: wauGrowth },
          mau: { current: currentMAU, growth: mauGrowth },
          mrr: { current: currentMRR, growth: mrrGrowth },
        },
        breakdown: {
          dau_by_app: groupByApp(dauResults, 'daily_active_users'),
          wau_by_app: groupByApp(wauResults, 'weekly_active_users'),
          mau_by_app: groupByApp(mauResults, 'monthly_active_users'),
          revenue_by_app: groupByApp(revenueResults, 'monthly_recurring_revenue'),
        },
        cohorts: processCohortData(cohortResults),
        last_updated: new Date().toISOString(),
      };

      cache.set(cacheKey, overview);
      res.json(overview);
    } catch (error) {
      console.error('Error fetching analytics overview:', error);
      res.status(500).json({ error: 'Failed to fetch analytics overview' });
    }
  });

  // Per-app deep dive metrics
  router.get('/:app/metrics', async (req, res) => {
    try {
      const { app } = req.params;
      const validApps = ['fitness', 'nutrition', 'meetings', 'budget'];
      
      if (!validApps.includes(app)) {
        return res.status(400).json({ error: 'Invalid app name' });
      }

      const cacheKey = `app_metrics_${app}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        cacheStats.hits++;
        return res.json(cachedData);
      }

      cacheStats.misses++;

      // Load app-specific query
      const appQuery = loadSQLTemplate(`${app}-analytics.sql`, bqClient);
      const results = await bqClient.query(appQuery);

      // Load user engagement metrics
      const engagementQuery = `
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as events,
          COUNT(DISTINCT user_id) as active_users,
          AVG(CASE WHEN duration_seconds > 0 THEN duration_seconds END) as avg_session_duration
        FROM \`${bqClient.getConfig().projectId}.${bqClient.getDatasets().crossApp}.feature_usage\`
        WHERE app_name = '${app}'
          AND DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `;
      
      const engagementResults = await bqClient.query(engagementQuery);

      const metrics = {
        app_name: app,
        core_metrics: results,
        engagement: engagementResults,
        summary: {
          total_users: results.length > 0 ? Math.max(...results.map(r => r.user_count || 0)) : 0,
          events_last_30d: engagementResults.reduce((sum, row) => sum + (row.events || 0), 0),
          avg_session_duration: engagementResults.reduce((sum, row) => sum + (row.avg_session_duration || 0), 0) / engagementResults.length || 0,
        },
        last_updated: new Date().toISOString(),
      };

      cache.set(cacheKey, metrics);
      res.json(metrics);
    } catch (error) {
      console.error(`Error fetching metrics for ${req.params.app}:`, error);
      res.status(500).json({ error: 'Failed to fetch app metrics' });
    }
  });

  // LLM cost breakdown
  router.get('/costs', async (req, res) => {
    try {
      const cacheKey = 'llm_costs';
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        cacheStats.hits++;
        return res.json(cachedData);
      }

      cacheStats.misses++;

      const costQuery = `
        WITH daily_costs AS (
          SELECT 
            DATE(created_at) as date,
            app_name,
            model_name,
            provider,
            task_type,
            SUM(cost_cents) / 100.0 as cost_usd,
            SUM(total_tokens) as tokens,
            COUNT(*) as requests,
            SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful_requests,
            AVG(latency_ms) as avg_latency_ms
          FROM \`${bqClient.getConfig().projectId}.${bqClient.getDatasets().crossApp}.llm_usage\`
          WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
          GROUP BY date, app_name, model_name, provider, task_type
        ),
        
        monthly_costs AS (
          SELECT 
            DATE_TRUNC(DATE(created_at), MONTH) as month,
            app_name,
            model_name,
            provider,
            SUM(cost_cents) / 100.0 as cost_usd,
            SUM(total_tokens) as tokens,
            COUNT(*) as requests
          FROM \`${bqClient.getConfig().projectId}.${bqClient.getDatasets().crossApp}.llm_usage\`
          WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
          GROUP BY month, app_name, model_name, provider
        )
        
        SELECT 'daily' as period_type, * FROM daily_costs
        UNION ALL
        SELECT 'monthly' as period_type, * FROM monthly_costs
        ORDER BY date DESC, app_name, model_name
      `;

      const costResults = await bqClient.query(costQuery);
      
      const dailyCosts = costResults.filter(row => row.period_type === 'daily');
      const monthlyCosts = costResults.filter(row => row.period_type === 'monthly');

      // Calculate current month spend
      const currentDate = new Date();
      const currentMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
      
      const currentMonthSpend = dailyCosts
        .filter(row => row.date && row.date.startsWith(currentMonth))
        .reduce((sum, row) => sum + (row.cost_usd || 0), 0);

      // Budget tracking (assume $1000/month budget)
      const monthlyBudget = 1000;
      const budgetUsedPct = (currentMonthSpend / monthlyBudget) * 100;

      const costs = {
        summary: {
          current_month_spend: currentMonthSpend,
          monthly_budget: monthlyBudget, 
          budget_used_pct: budgetUsedPct,
          top_cost_driver: getTopCostDriver(dailyCosts),
        },
        daily_breakdown: groupByDateAndApp(dailyCosts),
        monthly_trends: groupByMonthAndApp(monthlyCosts),
        cost_by_model: groupByModel(dailyCosts),
        cost_by_task: groupByTask(dailyCosts),
        efficiency_metrics: {
          cost_per_1k_tokens: calculateCostPer1kTokens(dailyCosts),
          avg_request_cost: calculateAvgRequestCost(dailyCosts),
          success_rate: calculateSuccessRate(dailyCosts),
        },
        last_updated: new Date().toISOString(),
      };

      cache.set(cacheKey, costs);
      res.json(costs);
    } catch (error) {
      console.error('Error fetching LLM costs:', error);
      res.status(500).json({ error: 'Failed to fetch LLM costs' });
    }
  });

  // User retention cohorts
  router.get('/cohorts', async (req, res) => {
    try {
      const cacheKey = 'retention_cohorts';
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        cacheStats.hits++;
        return res.json(cachedData);
      }

      cacheStats.misses++;

      // Use the cohorts query from overview.sql
      const overviewQuery = loadSQLTemplate('overview.sql', bqClient);
      const cohortResults = await bqClient.query(overviewQuery.cohorts);

      const cohorts = {
        cohort_table: processCohortTable(cohortResults),
        summary: {
          avg_retention_month1: calculateAvgRetention(cohortResults, 1),
          avg_retention_month3: calculateAvgRetention(cohortResults, 3),
          avg_retention_month6: calculateAvgRetention(cohortResults, 6),
          best_cohort: getBestPerformingCohort(cohortResults),
        },
        last_updated: new Date().toISOString(),
      };

      cache.set(cacheKey, cohorts);
      res.json(cohorts);
    } catch (error) {
      console.error('Error fetching retention cohorts:', error);
      res.status(500).json({ error: 'Failed to fetch retention cohorts' });
    }
  });

  return router;
}

// Helper functions
function loadSQLTemplate(filename: string, bqClient: BigQueryClient): any {
  const filePath = join(__dirname, '..', 'queries', filename);
  let sql = readFileSync(filePath, 'utf-8');
  
  // Replace template variables
  const config = bqClient.getConfig();
  sql = sql.replace(/\{\{PROJECT_ID\}\}/g, config.projectId);
  sql = sql.replace(/\{\{DATASET_PREFIX\}\}/g, config.datasetPrefix);

  // Split multiple queries if needed (simplified approach)
  if (filename === 'overview.sql') {
    const queries = sql.split('-- Daily Active Users')[1]
      .split('-- Weekly Active Users');
    
    return {
      dau: '-- Daily Active Users' + queries[0],
      wau: '-- Weekly Active Users' + queries[1].split('-- Monthly Active Users')[0],
      mau: sql.split('-- Monthly Active Users')[1].split('-- User Retention Cohorts')[0],
      cohorts: sql.split('-- User Retention Cohorts')[1].split('-- Revenue by App')[0],
      revenue: sql.split('-- Revenue by App')[1],
    };
  }
  
  return sql;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function isCurrentWeek(weekStart: string, currentDate: Date): boolean {
  const current = new Date(currentDate);
  const week = new Date(weekStart);
  const diffTime = Math.abs(current.getTime() - week.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays <= 7;
}

function calculateGrowthRate(data: any[], metric: string, periodsBack: number): number {
  if (data.length < periodsBack + 1) return 0;
  
  const current = data[0][metric] || 0;
  const previous = data[periodsBack][metric] || 0;
  
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function groupByApp(data: any[], metric: string): any {
  const result: any = {};
  data.forEach(row => {
    if (!result[row.app_name]) result[row.app_name] = 0;
    result[row.app_name] += row[metric] || 0;
  });
  return result;
}

function processCohortData(data: any[]): any {
  // Group cohort data by cohort month
  const cohorts: any = {};
  data.forEach(row => {
    const month = row.cohort_month;
    if (!cohorts[month]) cohorts[month] = {};
    cohorts[month][`month_${row.period_number}`] = {
      users: row.active_users,
      retention_rate: row.retention_rate,
    };
  });
  return cohorts;
}

function groupByDateAndApp(data: any[]): any {
  const result: any = {};
  data.forEach(row => {
    const date = row.date;
    if (!result[date]) result[date] = {};
    if (!result[date][row.app_name]) result[date][row.app_name] = 0;
    result[date][row.app_name] += row.cost_usd || 0;
  });
  return result;
}

function groupByMonthAndApp(data: any[]): any {
  const result: any = {};
  data.forEach(row => {
    const month = row.month;
    if (!result[month]) result[month] = {};
    if (!result[month][row.app_name]) result[month][row.app_name] = 0;
    result[month][row.app_name] += row.cost_usd || 0;
  });
  return result;
}

function groupByModel(data: any[]): any {
  const result: any = {};
  data.forEach(row => {
    if (!result[row.model_name]) result[row.model_name] = 0;
    result[row.model_name] += row.cost_usd || 0;
  });
  return result;
}

function groupByTask(data: any[]): any {
  const result: any = {};
  data.forEach(row => {
    if (!result[row.task_type]) result[row.task_type] = 0;
    result[row.task_type] += row.cost_usd || 0;
  });
  return result;
}

function getTopCostDriver(data: any[]): string {
  const byApp = groupByApp(data, 'cost_usd');
  const sortedApps = Object.entries(byApp).sort((a: any, b: any) => b[1] - a[1]);
  return sortedApps[0] ? sortedApps[0][0] : 'N/A';
}

function calculateCostPer1kTokens(data: any[]): number {
  const totalCost = data.reduce((sum, row) => sum + (row.cost_usd || 0), 0);
  const totalTokens = data.reduce((sum, row) => sum + (row.tokens || 0), 0);
  return totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0;
}

function calculateAvgRequestCost(data: any[]): number {
  const totalCost = data.reduce((sum, row) => sum + (row.cost_usd || 0), 0);
  const totalRequests = data.reduce((sum, row) => sum + (row.requests || 0), 0);
  return totalRequests > 0 ? totalCost / totalRequests : 0;
}

function calculateSuccessRate(data: any[]): number {
  const totalRequests = data.reduce((sum, row) => sum + (row.requests || 0), 0);
  const successfulRequests = data.reduce((sum, row) => sum + (row.successful_requests || 0), 0);
  return totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;
}

function processCohortTable(data: any[]): any {
  const result: any = {};
  data.forEach(row => {
    if (!result[row.cohort_month]) {
      result[row.cohort_month] = { cohort_size: row.cohort_size, periods: {} };
    }
    result[row.cohort_month].periods[row.period_number] = {
      active_users: row.active_users,
      retention_rate: row.retention_rate,
    };
  });
  return result;
}

function calculateAvgRetention(data: any[], periodNumber: number): number {
  const relevantData = data.filter(row => row.period_number === periodNumber);
  if (relevantData.length === 0) return 0;
  
  const avgRetention = relevantData.reduce((sum, row) => sum + (row.retention_rate || 0), 0) / relevantData.length;
  return avgRetention;
}

function getBestPerformingCohort(data: any[]): any {
  const cohortRetention: any = {};
  
  // Calculate average retention for each cohort across all periods
  data.forEach(row => {
    if (!cohortRetention[row.cohort_month]) {
      cohortRetention[row.cohort_month] = { total: 0, count: 0 };
    }
    cohortRetention[row.cohort_month].total += row.retention_rate || 0;
    cohortRetention[row.cohort_month].count += 1;
  });
  
  let bestCohort = null;
  let bestRetention = 0;
  
  Object.entries(cohortRetention).forEach(([cohort, data]: [string, any]) => {
    const avgRetention = data.total / data.count;
    if (avgRetention > bestRetention) {
      bestRetention = avgRetention;
      bestCohort = cohort;
    }
  });
  
  return { cohort: bestCohort, avg_retention: bestRetention };
}

export default router;