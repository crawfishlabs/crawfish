/**
 * Daily Cost Report — LLM spend tracking with budget alerts via Snowflake
 */
import SnowflakeClient from '../snowflake-config';

export class DailyCostReport {
  private sf: SnowflakeClient;

  constructor(client?: SnowflakeClient) {
    this.sf = client || new SnowflakeClient();
  }

  async generate(budgetUsd: number = 100) {
    const [daily, byModel, byApp] = await Promise.all([
      this.sf.query(`
        SELECT DATE_TRUNC('day', created_at) AS day,
          SUM(cost_usd) AS cost, COUNT(*) AS calls
        FROM CLAW_ANALYTICS.CROSS_APP.LLM_USAGE
        WHERE created_at >= DATEADD(day, -30, CURRENT_DATE())
        GROUP BY day ORDER BY day DESC
      `),
      this.sf.query(`
        SELECT model, SUM(cost_usd) AS cost, COUNT(*) AS calls,
          AVG(cost_usd) AS avg_cost
        FROM CLAW_ANALYTICS.CROSS_APP.LLM_USAGE
        WHERE created_at >= DATEADD(day, -1, CURRENT_DATE())
        GROUP BY model ORDER BY cost DESC
      `),
      this.sf.query(`
        SELECT app, SUM(cost_usd) AS cost, COUNT(*) AS calls
        FROM CLAW_ANALYTICS.CROSS_APP.LLM_USAGE
        WHERE created_at >= DATEADD(day, -1, CURRENT_DATE())
        GROUP BY app ORDER BY cost DESC
      `),
    ]);

    const todayCost = daily[0]?.cost || 0;
    const monthCost = daily.reduce((sum: number, d: any) => sum + (d.cost || 0), 0);

    return {
      today: { cost: todayCost, calls: daily[0]?.calls || 0, byModel, byApp },
      month: { cost: monthCost, budget: budgetUsd, utilization: monthCost / budgetUsd },
      alert: monthCost > budgetUsd * 0.8 ? `⚠️ LLM spend at ${Math.round(monthCost / budgetUsd * 100)}% of $${budgetUsd} budget` : null,
      trend: daily,
      generatedAt: new Date().toISOString(),
    };
  }
}
