import BigQueryClient from '../bigquery-config';
import { format } from 'date-fns';

export interface DailyCostMetrics {
  // Overall cost metrics
  total_spend_today: number;
  total_spend_yesterday: number;
  day_over_day_change: number;
  
  // Monthly tracking
  month_to_date_spend: number;
  monthly_budget: number;
  budget_utilization_pct: number;
  projected_monthly_spend: number;
  budget_alert_level: 'green' | 'yellow' | 'red';
  
  // Cost breakdown
  cost_by_app: {
    [app: string]: {
      today: number;
      yesterday: number;
      change_pct: number;
      mtd: number;
    };
  };
  
  cost_by_model: {
    [model: string]: {
      today: number;
      requests: number;
      avg_cost_per_request: number;
      efficiency_trend: 'improving' | 'stable' | 'declining';
    };
  };
  
  cost_by_task: {
    [task: string]: {
      today: number;
      volume: number;
      cost_per_task: number;
    };
  };
  
  // Efficiency metrics
  tokens_per_dollar: number;
  requests_per_dollar: number;
  cost_per_active_user: number;
  
  // Alerts and anomalies
  alerts: {
    type: 'budget' | 'anomaly' | 'efficiency';
    severity: 'low' | 'medium' | 'high';
    message: string;
    value: number;
    threshold: number;
  }[];
  
  // Top cost drivers
  top_cost_drivers: {
    category: string;
    subcategory: string;
    cost: number;
    pct_of_total: number;
  }[];
  
  // Projections
  weekly_projection: number;
  monthly_projection: number;
  quarterly_projection: number;
}

export class DailyCostReport {
  private monthlyBudget: number = 1000; // Default $1000/month budget
  
  constructor(
    private bqClient: BigQueryClient,
    monthlyBudget?: number
  ) {
    if (monthlyBudget) {
      this.monthlyBudget = monthlyBudget;
    }
  }
  
  async generateReport(): Promise<DailyCostMetrics> {
    try {
      const [
        dailySpend,
        monthlySpend,
        costByApp,
        costByModel,
        costByTask,
        efficiencyMetrics,
        anomalies,
      ] = await Promise.all([
        this.getDailySpendMetrics(),
        this.getMonthlySpendMetrics(),
        this.getCostByApp(),
        this.getCostByModel(),
        this.getCostByTask(),
        this.getEfficiencyMetrics(),
        this.detectAnomalies(),
      ]);
      
      const alerts = this.generateAlerts(dailySpend, monthlySpend, anomalies);
      const topCostDrivers = this.calculateTopCostDrivers(costByApp, costByModel, costByTask);
      const projections = this.calculateProjections(dailySpend, monthlySpend);
      
      return {
        total_spend_today: dailySpend.today,
        total_spend_yesterday: dailySpend.yesterday,
        day_over_day_change: dailySpend.change_pct,
        
        month_to_date_spend: monthlySpend.mtd,
        monthly_budget: this.monthlyBudget,
        budget_utilization_pct: (monthlySpend.mtd / this.monthlyBudget) * 100,
        projected_monthly_spend: projections.monthly_projection,
        budget_alert_level: this.getBudgetAlertLevel(monthlySpend.mtd),
        
        cost_by_app: costByApp,
        cost_by_model: costByModel,
        cost_by_task: costByTask,
        
        tokens_per_dollar: efficiencyMetrics.tokens_per_dollar,
        requests_per_dollar: efficiencyMetrics.requests_per_dollar,
        cost_per_active_user: efficiencyMetrics.cost_per_active_user,
        
        alerts,
        top_cost_drivers: topCostDrivers,
        
        weekly_projection: projections.weekly_projection,
        monthly_projection: projections.monthly_projection,
        quarterly_projection: projections.quarterly_projection,
      };
    } catch (error) {
      console.error('Error generating daily cost report:', error);
      throw error;
    }
  }
  
  private async getDailySpendMetrics() {
    const query = `
      WITH daily_costs AS (
        SELECT 
          usage_date,
          SUM(total_cost_usd) as daily_spend
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
        WHERE usage_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
        GROUP BY usage_date
        ORDER BY usage_date DESC
      )
      SELECT 
        MAX(CASE WHEN usage_date = CURRENT_DATE() THEN daily_spend END) as today,
        MAX(CASE WHEN usage_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN daily_spend END) as yesterday
      FROM daily_costs
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    const today = result.today || 0;
    const yesterday = result.yesterday || 0;
    const change_pct = yesterday > 0 ? ((today - yesterday) / yesterday) * 100 : 0;
    
    return { today, yesterday, change_pct };
  }
  
  private async getMonthlySpendMetrics() {
    const query = `
      SELECT 
        SUM(total_cost_usd) as mtd_spend
      FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
      WHERE usage_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return { mtd: result.mtd_spend || 0 };
  }
  
  private async getCostByApp() {
    const query = `
      WITH app_costs AS (
        SELECT 
          usage_date,
          app_name,
          SUM(total_cost_usd) as daily_cost
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
        WHERE usage_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
        GROUP BY usage_date, app_name
      ),
      monthly_costs AS (
        SELECT 
          app_name,
          SUM(total_cost_usd) as mtd_cost
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
        WHERE usage_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)
        GROUP BY app_name
      )
      SELECT 
        ac.app_name,
        MAX(CASE WHEN ac.usage_date = CURRENT_DATE() THEN ac.daily_cost END) as today,
        MAX(CASE WHEN ac.usage_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN ac.daily_cost END) as yesterday,
        mc.mtd_cost
      FROM app_costs ac
      LEFT JOIN monthly_costs mc ON ac.app_name = mc.app_name
      GROUP BY ac.app_name, mc.mtd_cost
      ORDER BY today DESC NULLS LAST
    `;
    
    const results = await this.bqClient.query(query);
    const costByApp: any = {};
    
    results.forEach((row: any) => {
      const today = row.today || 0;
      const yesterday = row.yesterday || 0;
      const change_pct = yesterday > 0 ? ((today - yesterday) / yesterday) * 100 : 0;
      
      costByApp[row.app_name] = {
        today,
        yesterday,
        change_pct,
        mtd: row.mtd_cost || 0,
      };
    });
    
    return costByApp;
  }
  
  private async getCostByModel() {
    const query = `
      WITH model_metrics AS (
        SELECT 
          model_name,
          SUM(CASE WHEN usage_date = CURRENT_DATE() THEN total_cost_usd END) as today_cost,
          SUM(CASE WHEN usage_date = CURRENT_DATE() THEN total_requests END) as today_requests,
          
          -- 7-day efficiency trend
          AVG(CASE 
            WHEN usage_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) 
            THEN cost_per_1k_tokens 
          END) as avg_cost_per_1k_tokens_7d,
          
          AVG(CASE 
            WHEN usage_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY) 
            AND usage_date < DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            THEN cost_per_1k_tokens 
          END) as avg_cost_per_1k_tokens_prev_7d
          
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
        WHERE usage_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
        GROUP BY model_name
      )
      SELECT 
        model_name,
        today_cost,
        today_requests,
        SAFE_DIVIDE(today_cost, today_requests) as avg_cost_per_request,
        
        -- Efficiency trend
        CASE 
          WHEN avg_cost_per_1k_tokens_prev_7d = 0 THEN 'stable'
          WHEN avg_cost_per_1k_tokens_7d < avg_cost_per_1k_tokens_prev_7d * 0.95 THEN 'improving'
          WHEN avg_cost_per_1k_tokens_7d > avg_cost_per_1k_tokens_prev_7d * 1.05 THEN 'declining'
          ELSE 'stable'
        END as efficiency_trend
        
      FROM model_metrics
      WHERE today_cost > 0
      ORDER BY today_cost DESC
    `;
    
    const results = await this.bqClient.query(query);
    const costByModel: any = {};
    
    results.forEach((row: any) => {
      costByModel[row.model_name] = {
        today: row.today_cost || 0,
        requests: row.today_requests || 0,
        avg_cost_per_request: row.avg_cost_per_request || 0,
        efficiency_trend: row.efficiency_trend || 'stable',
      };
    });
    
    return costByModel;
  }
  
  private async getCostByTask() {
    const query = `
      SELECT 
        task_type,
        SUM(total_cost_usd) as today_cost,
        SUM(total_requests) as today_volume,
        AVG(avg_cost_per_request) as cost_per_task
      FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
      WHERE usage_date = CURRENT_DATE()
      GROUP BY task_type
      ORDER BY today_cost DESC
    `;
    
    const results = await this.bqClient.query(query);
    const costByTask: any = {};
    
    results.forEach((row: any) => {
      costByTask[row.task_type] = {
        today: row.today_cost || 0,
        volume: row.today_volume || 0,
        cost_per_task: row.cost_per_task || 0,
      };
    });
    
    return costByTask;
  }
  
  private async getEfficiencyMetrics() {
    const query = `
      WITH today_metrics AS (
        SELECT 
          SUM(total_cost_usd) as total_cost,
          SUM(total_tokens) as total_tokens,
          SUM(total_requests) as total_requests,
          COUNT(DISTINCT user_id) as active_users
        FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
        WHERE usage_date = CURRENT_DATE()
      )
      SELECT 
        SAFE_DIVIDE(total_tokens, total_cost) as tokens_per_dollar,
        SAFE_DIVIDE(total_requests, total_cost) as requests_per_dollar,
        SAFE_DIVIDE(total_cost, active_users) as cost_per_active_user
      FROM today_metrics
    `;
    
    const results = await this.bqClient.query(query);
    const result = results[0] || {};
    
    return {
      tokens_per_dollar: result.tokens_per_dollar || 0,
      requests_per_dollar: result.requests_per_dollar || 0,
      cost_per_active_user: result.cost_per_active_user || 0,
    };
  }
  
  private async detectAnomalies() {
    const query = `
      SELECT 
        usage_date,
        app_name,
        task_type,
        total_cost_usd,
        cost_anomaly_detected
      FROM \`${this.bqClient.getConfig().projectId}.${this.bqClient.getDatasets().crossApp}.llm_cost_by_task\`
      WHERE usage_date = CURRENT_DATE()
        AND cost_anomaly_detected = true
      ORDER BY total_cost_usd DESC
    `;
    
    const results = await this.bqClient.query(query);
    return results.map((row: any) => ({
      app: row.app_name,
      task: row.task_type,
      cost: row.total_cost_usd,
      detected: row.cost_anomaly_detected,
    }));
  }
  
  private generateAlerts(dailySpend: any, monthlySpend: any, anomalies: any[]) {
    const alerts = [];
    
    // Budget alerts
    const budgetUtilization = (monthlySpend.mtd / this.monthlyBudget) * 100;
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const dayOfMonth = new Date().getDate();
    const expectedUtilization = (dayOfMonth / daysInMonth) * 100;
    
    if (budgetUtilization > 90) {
      alerts.push({
        type: 'budget' as const,
        severity: 'high' as const,
        message: 'Monthly budget almost exhausted',
        value: budgetUtilization,
        threshold: 90,
      });
    } else if (budgetUtilization > 75) {
      alerts.push({
        type: 'budget' as const,
        severity: 'medium' as const,
        message: 'Monthly budget usage high',
        value: budgetUtilization,
        threshold: 75,
      });
    } else if (budgetUtilization > expectedUtilization * 1.2) {
      alerts.push({
        type: 'budget' as const,
        severity: 'low' as const,
        message: 'Spending ahead of expected pace',
        value: budgetUtilization,
        threshold: expectedUtilization * 1.2,
      });
    }
    
    // Day-over-day anomalies
    if (dailySpend.change_pct > 100) {
      alerts.push({
        type: 'anomaly' as const,
        severity: 'high' as const,
        message: 'Daily spending doubled compared to yesterday',
        value: dailySpend.change_pct,
        threshold: 100,
      });
    } else if (dailySpend.change_pct > 50) {
      alerts.push({
        type: 'anomaly' as const,
        severity: 'medium' as const,
        message: 'Daily spending up significantly',
        value: dailySpend.change_pct,
        threshold: 50,
      });
    }
    
    // Detected anomalies from BigQuery
    anomalies.forEach(anomaly => {
      alerts.push({
        type: 'anomaly' as const,
        severity: 'medium' as const,
        message: `Unusual spending in ${anomaly.app}/${anomaly.task}`,
        value: anomaly.cost,
        threshold: 0, // Threshold already applied in anomaly detection
      });
    });
    
    return alerts;
  }
  
  private calculateTopCostDrivers(costByApp: any, costByModel: any, costByTask: any) {
    const drivers = [];
    
    // Add app costs
    Object.entries(costByApp).forEach(([app, data]: [string, any]) => {
      if (data.today > 0) {
        drivers.push({
          category: 'app',
          subcategory: app,
          cost: data.today,
          pct_of_total: 0, // Will calculate below
        });
      }
    });
    
    // Add model costs
    Object.entries(costByModel).forEach(([model, data]: [string, any]) => {
      if (data.today > 0) {
        drivers.push({
          category: 'model',
          subcategory: model,
          cost: data.today,
          pct_of_total: 0,
        });
      }
    });
    
    // Add task costs
    Object.entries(costByTask).forEach(([task, data]: [string, any]) => {
      if (data.today > 0) {
        drivers.push({
          category: 'task',
          subcategory: task,
          cost: data.today,
          pct_of_total: 0,
        });
      }
    });
    
    // Calculate percentages and sort
    const totalCost = drivers.reduce((sum, driver) => sum + driver.cost, 0);
    drivers.forEach(driver => {
      driver.pct_of_total = totalCost > 0 ? (driver.cost / totalCost) * 100 : 0;
    });
    
    return drivers.sort((a, b) => b.cost - a.cost).slice(0, 10); // Top 10
  }
  
  private calculateProjections(dailySpend: any, monthlySpend: any) {
    const dailyAverage = monthlySpend.mtd / new Date().getDate();
    const daysRemaining = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
    
    return {
      weekly_projection: dailyAverage * 7,
      monthly_projection: monthlySpend.mtd + (dailyAverage * daysRemaining),
      quarterly_projection: (monthlySpend.mtd + (dailyAverage * daysRemaining)) * 3,
    };
  }
  
  private getBudgetAlertLevel(mtdSpend: number): 'green' | 'yellow' | 'red' {
    const utilization = (mtdSpend / this.monthlyBudget) * 100;
    
    if (utilization > 90) return 'red';
    if (utilization > 75) return 'yellow';
    return 'green';
  }
  
  async exportToText(): Promise<string> {
    const report = await this.generateReport();
    const date = format(new Date(), 'yyyy-MM-dd');
    
    const alertIcon = report.budget_alert_level === 'red' ? '🔴' : 
                     report.budget_alert_level === 'yellow' ? '🟡' : '🟢';
    
    return `
# Daily LLM Cost Report - ${date}

## 📊 Cost Summary
- **Today**: $${report.total_spend_today.toFixed(2)}
- **Yesterday**: $${report.total_spend_yesterday.toFixed(2)}
- **Change**: ${report.day_over_day_change > 0 ? '+' : ''}${report.day_over_day_change.toFixed(1)}%

## 💰 Budget Tracking ${alertIcon}
- **Month-to-Date**: $${report.month_to_date_spend.toFixed(2)}
- **Monthly Budget**: $${report.monthly_budget.toFixed(2)}
- **Utilization**: ${report.budget_utilization_pct.toFixed(1)}%
- **Projected Monthly**: $${report.projected_monthly_spend.toFixed(2)}

## 📱 Cost by App
${Object.entries(report.cost_by_app).map(([app, data]: [string, any]) => 
  `- **${app}**: $${data.today.toFixed(2)} (${data.change_pct > 0 ? '+' : ''}${data.change_pct.toFixed(1)}%)`
).join('\n')}

## 🤖 Top Models Today
${Object.entries(report.cost_by_model)
  .sort(([,a]: [string, any], [,b]: [string, any]) => b.today - a.today)
  .slice(0, 5)
  .map(([model, data]: [string, any]) => 
    `- **${model}**: $${data.today.toFixed(2)} (${data.requests} requests, ${data.efficiency_trend})`
  ).join('\n')}

## ⚡ Efficiency Metrics
- **Tokens per $**: ${Math.round(report.tokens_per_dollar)}
- **Requests per $**: ${Math.round(report.requests_per_dollar)}
- **Cost per Active User**: $${report.cost_per_active_user.toFixed(2)}

## 🚨 Alerts
${report.alerts.length > 0 ? 
  report.alerts.map(alert => 
    `- **${alert.severity.toUpperCase()}**: ${alert.message} (${alert.value.toFixed(1)})`
  ).join('\n') : 
  '- No alerts today ✅'
}

## 📈 Top Cost Drivers
${report.top_cost_drivers.slice(0, 5).map(driver => 
  `- **${driver.subcategory}** (${driver.category}): $${driver.cost.toFixed(2)} (${driver.pct_of_total.toFixed(1)}%)`
).join('\n')}

## 🔮 Projections
- **Weekly**: $${report.weekly_projection.toFixed(2)}
- **Monthly**: $${report.monthly_projection.toFixed(2)}
- **Quarterly**: $${report.quarterly_projection.toFixed(2)}

---
*Report generated at ${new Date().toISOString()}*
    `.trim();
  }
}

export default DailyCostReport;