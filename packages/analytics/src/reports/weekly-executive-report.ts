import BigQueryClient from '../bigquery-config';
import { format } from 'date-fns';

export interface ExecutiveMetrics {
  // Core KPIs
  dau: { current: number; wow_growth: number };
  wau: { current: number; wow_growth: number };
  mau: { current: number; mom_growth: number };
  revenue: { 
    current_mrr: number; 
    mom_growth: number;
    new_mrr: number;
    churned_mrr: number;
  };
  
  // User metrics
  new_users: { count: number; wow_growth: number };
  churned_users: { count: number; churn_rate: number };
  
  // App performance
  app_breakdown: {
    [app: string]: {
      dau: number;
      wau: number;
      growth: number;
    };
  };
  
  // Health indicators
  user_health: {
    champions: number;
    healthy: number;
    at_risk: number;
    dormant: number;
  };
  
  // Cost efficiency
  llm_costs: {
    total_spend: number;
    mom_growth: number;
    cost_per_user: number;
    top_cost_driver: string;
  };
  
  // Key insights
  insights: {
    top_growth_driver: string;
    biggest_concern: string;
    recommended_actions: string[];
  };
}

export class WeeklyExecutiveReport {
  constructor(private bqClient: BigQueryClient) {}
  
  async generateReport(): Promise<ExecutiveMetrics> {
    try {
      const [
        dauMetrics,
        wauMetrics,
        mauMetrics,
        revenueMetrics,
        userHealthMetrics,
        llmCostMetrics,
        appPerformance,
      ] = await Promise.all([
        this.getDauMetrics(),
        this.getWauMetrics(),
        this.getMauMetrics(),
        this.getRevenueMetrics(),
        this.getUserHealthMetrics(),
        this.getLlmCostMetrics(),
        this.getAppPerformanceBreakdown(),
      ]);
      
      const insights = this.generateInsights({
        dauMetrics,
        wauMetrics,
        mauMetrics,
        revenueMetrics,
        userHealthMetrics,
        llmCostMetrics,
        appPerformance,
      });
      
      return {
        dau: dauMetrics,
        wau: wauMetrics,
        mau: mauMetrics,
        revenue: revenueMetrics,
        new_users: await this.getNewUserMetrics(),
        churned_users: await this.getChurnMetrics(),
        app_breakdown: appPerformance,
        user_health: userHealthMetrics,
        llm_costs: llmCostMetrics,
        insights,
      };
    } catch (error) {
      console.error('Error generating executive report:', error);
      throw error;
    }
  }
  
  private async getDauMetrics(): Promise<{ current: number; wow_growth: number }> {
    const query = `
      WITH daily_users AS (
        SELECT 
          activity_date,
          SUM(total_daily_active_users) as dau
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.daily_active_users\`
        WHERE activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
        GROUP BY activity_date
        ORDER BY activity_date DESC
      )
      SELECT 
        dau as current_dau,
        LAG(dau, 7) OVER (ORDER BY activity_date) as dau_week_ago,
        SAFE_DIVIDE(
          dau - LAG(dau, 7) OVER (ORDER BY activity_date),
          LAG(dau, 7) OVER (ORDER BY activity_date)
        ) * 100 as wow_growth
      FROM daily_users
      ORDER BY activity_date DESC
      LIMIT 1
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return {
      current: result.current_dau || 0,
      wow_growth: result.wow_growth || 0,
    };
  }
  
  private async getWauMetrics(): Promise<{ current: number; wow_growth: number }> {
    const query = `
      WITH weekly_users AS (
        SELECT 
          DATE_TRUNC(activity_date, WEEK(MONDAY)) as week_start,
          COUNT(DISTINCT user_id) as wau
        FROM (
          SELECT user_id, DATE(created_at) as activity_date FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().fitness}.workouts\`
          UNION ALL
          SELECT user_id, log_date as activity_date FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().nutrition}.food_logs\`
          UNION ALL
          SELECT user_id, DATE(actual_start_time) as activity_date FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().meetings}.meetings\`
          UNION ALL
          SELECT user_id, transaction_date as activity_date FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().budget}.transactions\`
        )
        WHERE activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 21 DAY)
        GROUP BY week_start
        ORDER BY week_start DESC
      )
      SELECT 
        wau as current_wau,
        LAG(wau, 1) OVER (ORDER BY week_start) as wau_last_week,
        SAFE_DIVIDE(
          wau - LAG(wau, 1) OVER (ORDER BY week_start),
          LAG(wau, 1) OVER (ORDER BY week_start)
        ) * 100 as wow_growth
      FROM weekly_users
      ORDER BY week_start DESC
      LIMIT 1
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return {
      current: result.current_wau || 0,
      wow_growth: result.wow_growth || 0,
    };
  }
  
  private async getMauMetrics(): Promise<{ current: number; mom_growth: number }> {
    const query = `
      WITH monthly_users AS (
        SELECT 
          DATE_TRUNC(activity_date, MONTH) as month_start,
          COUNT(DISTINCT user_id) as mau
        FROM (
          SELECT user_id, DATE(created_at) as activity_date FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().fitness}.workouts\`
          UNION ALL
          SELECT user_id, log_date as activity_date FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().nutrition}.food_logs\`
          UNION ALL
          SELECT user_id, DATE(actual_start_time) as activity_date FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().meetings}.meetings\`
          UNION ALL
          SELECT user_id, transaction_date as activity_date FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().budget}.transactions\`
        )
        WHERE activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
        GROUP BY month_start
        ORDER BY month_start DESC
      )
      SELECT 
        mau as current_mau,
        LAG(mau, 1) OVER (ORDER BY month_start) as mau_last_month,
        SAFE_DIVIDE(
          mau - LAG(mau, 1) OVER (ORDER BY month_start),
          LAG(mau, 1) OVER (ORDER BY month_start)
        ) * 100 as mom_growth
      FROM monthly_users
      ORDER BY month_start DESC
      LIMIT 1
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return {
      current: result.current_mau || 0,
      mom_growth: result.mom_growth || 0,
    };
  }
  
  private async getRevenueMetrics() {
    const query = `
      SELECT 
        revenue_month,
        total_mrr,
        total_new_subscribers,
        total_churned_subscribers,
        mrr_growth_pct as mom_growth,
        net_new_subscribers * avg_arpu as new_mrr,
        total_churned_subscribers * avg_arpu as churned_mrr
      FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.monthly_revenue\`
      WHERE revenue_month = DATE_TRUNC(CURRENT_DATE(), MONTH)
      ORDER BY revenue_month DESC
      LIMIT 1
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return {
      current_mrr: result.total_mrr || 0,
      mom_growth: result.mom_growth || 0,
      new_mrr: result.new_mrr || 0,
      churned_mrr: result.churned_mrr || 0,
    };
  }
  
  private async getNewUserMetrics() {
    const query = `
      WITH weekly_signups AS (
        SELECT 
          DATE_TRUNC(DATE(created_at), WEEK(MONDAY)) as week_start,
          COUNT(*) as new_users
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.users\`
        WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
        GROUP BY week_start
        ORDER BY week_start DESC
      )
      SELECT 
        new_users as count,
        LAG(new_users, 1) OVER (ORDER BY week_start) as last_week,
        SAFE_DIVIDE(
          new_users - LAG(new_users, 1) OVER (ORDER BY week_start),
          LAG(new_users, 1) OVER (ORDER BY week_start)
        ) * 100 as wow_growth
      FROM weekly_signups
      ORDER BY week_start DESC
      LIMIT 1
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return {
      count: result.count || 0,
      wow_growth: result.wow_growth || 0,
    };
  }
  
  private async getChurnMetrics() {
    const query = `
      WITH weekly_churn AS (
        SELECT 
          DATE_TRUNC(DATE(cancelled_at), WEEK(MONDAY)) as week_start,
          COUNT(*) as churned_users,
          -- Approximate churn rate (churned / active subscribers at start of week)
          SAFE_DIVIDE(
            COUNT(*),
            (SELECT COUNT(*) FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.subscriptions\` 
             WHERE status = 'active' AND current_period_start <= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY))
          ) * 100 as churn_rate
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.subscriptions\`
        WHERE DATE(cancelled_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
          AND cancelled_at IS NOT NULL
        GROUP BY week_start
      )
      SELECT *
      FROM weekly_churn
      ORDER BY week_start DESC
      LIMIT 1
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return {
      count: result.churned_users || 0,
      churn_rate: result.churn_rate || 0,
    };
  }
  
  private async getAppPerformanceBreakdown() {
    const query = `
      SELECT 
        app_name,
        AVG(daily_active_users) as avg_dau,
        AVG(daily_active_users) * 7 as estimated_wau,
        AVG(wow_growth_pct) as avg_growth
      FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.daily_active_users\`
      WHERE activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      GROUP BY app_name
      ORDER BY avg_dau DESC
    `;
    
    const results = await this.bqClient.query(query);
    const breakdown: any = {};
    
    results.forEach((row: any) => {
      breakdown[row.app_name] = {
        dau: row.avg_dau || 0,
        wau: row.estimated_wau || 0,
        growth: row.avg_growth || 0,
      };
    });
    
    return breakdown;
  }
  
  private async getUserHealthMetrics() {
    const query = `
      SELECT 
        health_category,
        COUNT(*) as user_count
      FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.user_health_score\`
      WHERE health_category IN ('champion', 'healthy', 'at_risk', 'dormant')
      GROUP BY health_category
    `;
    
    const results = await this.bqClient.query(query);
    const health = {
      champions: 0,
      healthy: 0,
      at_risk: 0,
      dormant: 0,
    };
    
    results.forEach((row: any) => {
      health[row.health_category as keyof typeof health] = row.user_count || 0;
    });
    
    return health;
  }
  
  private async getLlmCostMetrics() {
    const query = `
      WITH monthly_costs AS (
        SELECT 
          DATE_TRUNC(usage_date, MONTH) as month,
          SUM(total_cost_usd) as total_spend,
          COUNT(DISTINCT user_id) as unique_users,
          app_name
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
        WHERE usage_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
        GROUP BY month, app_name
      ),
      current_month AS (
        SELECT 
          SUM(total_spend) as total_spend,
          SUM(unique_users) as total_users,
          SAFE_DIVIDE(SUM(total_spend), SUM(unique_users)) as cost_per_user
        FROM monthly_costs 
        WHERE month = DATE_TRUNC(CURRENT_DATE(), MONTH)
      ),
      last_month AS (
        SELECT SUM(total_spend) as last_month_spend
        FROM monthly_costs 
        WHERE month = DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY), MONTH)
      ),
      top_app AS (
        SELECT app_name
        FROM monthly_costs 
        WHERE month = DATE_TRUNC(CURRENT_DATE(), MONTH)
        ORDER BY total_spend DESC
        LIMIT 1
      )
      SELECT 
        cm.total_spend,
        cm.cost_per_user,
        SAFE_DIVIDE(cm.total_spend - lm.last_month_spend, lm.last_month_spend) * 100 as mom_growth,
        ta.app_name as top_cost_driver
      FROM current_month cm
      CROSS JOIN last_month lm
      CROSS JOIN top_app ta
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return {
      total_spend: result.total_spend || 0,
      mom_growth: result.mom_growth || 0,
      cost_per_user: result.cost_per_user || 0,
      top_cost_driver: result.top_cost_driver || 'unknown',
    };
  }
  
  private generateInsights(data: any) {
    const insights = {
      top_growth_driver: 'N/A',
      biggest_concern: 'N/A',
      recommended_actions: [] as string[],
    };
    
    // Determine top growth driver
    const appGrowth = Object.entries(data.appPerformance).map(([app, metrics]: [string, any]) => ({
      app,
      growth: metrics.growth,
    })).sort((a, b) => b.growth - a.growth);
    
    if (appGrowth.length > 0) {
      insights.top_growth_driver = `${appGrowth[0].app} (${appGrowth[0].growth.toFixed(1)}% growth)`;
    }
    
    // Identify biggest concern
    const concerns = [];
    
    if (data.dauMetrics.wow_growth < -5) {
      concerns.push(`DAU declining ${data.dauMetrics.wow_growth.toFixed(1)}%`);
    }
    if (data.revenueMetrics.mom_growth < 0) {
      concerns.push(`Revenue declining ${data.revenueMetrics.mom_growth.toFixed(1)}%`);
    }
    if (data.userHealthMetrics.at_risk + data.userHealthMetrics.dormant > 
        data.userHealthMetrics.champions + data.userHealthMetrics.healthy) {
      concerns.push('More users at-risk than healthy');
    }
    if (data.llmCostMetrics.mom_growth > 50) {
      concerns.push(`LLM costs growing rapidly ${data.llmCostMetrics.mom_growth.toFixed(1)}%`);
    }
    
    insights.biggest_concern = concerns.length > 0 ? concerns[0] : 'No major concerns identified';
    
    // Generate recommended actions
    if (data.dauMetrics.wow_growth < 0) {
      insights.recommended_actions.push('Investigate user engagement drops and launch retention campaign');
    }
    if (data.userHealthMetrics.at_risk > data.userHealthMetrics.healthy * 0.5) {
      insights.recommended_actions.push('Focus on at-risk user re-engagement initiatives');
    }
    if (data.llmCostMetrics.mom_growth > 30) {
      insights.recommended_actions.push('Review LLM usage efficiency and implement cost controls');
    }
    if (data.revenueMetrics.churned_mrr > data.revenueMetrics.new_mrr) {
      insights.recommended_actions.push('Prioritize churn reduction over new customer acquisition');
    }
    
    if (insights.recommended_actions.length === 0) {
      insights.recommended_actions.push('Continue current growth trajectory and monitor key metrics');
    }
    
    return insights;
  }
  
  async exportToText(): Promise<string> {
    const report = await this.generateReport();
    const date = format(new Date(), 'yyyy-MM-dd');
    
    return `
# Claw Platform - Weekly Executive Report
## Week ending ${date}

### 📈 Core Metrics
- **DAU**: ${report.dau.current.toLocaleString()} (${report.dau.wow_growth > 0 ? '+' : ''}${report.dau.wow_growth.toFixed(1)}% WoW)
- **WAU**: ${report.wau.current.toLocaleString()} (${report.wau.wow_growth > 0 ? '+' : ''}${report.wau.wow_growth.toFixed(1)}% WoW)
- **MAU**: ${report.mau.current.toLocaleString()} (${report.mau.mom_growth > 0 ? '+' : ''}${report.mau.mom_growth.toFixed(1)}% MoM)
- **MRR**: $${report.revenue.current_mrr.toLocaleString()} (${report.revenue.mom_growth > 0 ? '+' : ''}${report.revenue.mom_growth.toFixed(1)}% MoM)

### 👥 User Metrics
- **New Users**: ${report.new_users.count.toLocaleString()} (${report.new_users.wow_growth > 0 ? '+' : ''}${report.new_users.wow_growth.toFixed(1)}% WoW)
- **Churned Users**: ${report.churned_users.count.toLocaleString()} (${report.churned_users.churn_rate.toFixed(2)}% rate)

### 📱 App Performance
${Object.entries(report.app_breakdown).map(([app, metrics]: [string, any]) => 
  `- **${app}**: ${metrics.dau.toLocaleString()} DAU (${metrics.growth > 0 ? '+' : ''}${metrics.growth.toFixed(1)}%)`
).join('\n')}

### ❤️ User Health
- **Champions**: ${report.user_health.champions.toLocaleString()}
- **Healthy**: ${report.user_health.healthy.toLocaleString()}
- **At Risk**: ${report.user_health.at_risk.toLocaleString()}
- **Dormant**: ${report.user_health.dormant.toLocaleString()}

### 💰 LLM Costs
- **Total Spend**: $${report.llm_costs.total_spend.toLocaleString()}
- **Growth**: ${report.llm_costs.mom_growth > 0 ? '+' : ''}${report.llm_costs.mom_growth.toFixed(1)}% MoM
- **Cost/User**: $${report.llm_costs.cost_per_user.toFixed(2)}
- **Top Driver**: ${report.llm_costs.top_cost_driver}

### 🎯 Key Insights
- **Top Growth Driver**: ${report.insights.top_growth_driver}
- **Biggest Concern**: ${report.insights.biggest_concern}

### 📋 Recommended Actions
${report.insights.recommended_actions.map(action => `- ${action}`).join('\n')}

---
*Generated automatically on ${new Date().toISOString()}*
    `.trim();
  }
}

export default WeeklyExecutiveReport;