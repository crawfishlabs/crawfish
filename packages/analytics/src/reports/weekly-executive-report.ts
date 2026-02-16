/**
 * Weekly Executive Report — key metrics summary via Snowflake
 */
import SnowflakeClient from '../snowflake-config';

export class WeeklyExecutiveReport {
  private sf: SnowflakeClient;

  constructor(client?: SnowflakeClient) {
    this.sf = client || new SnowflakeClient();
  }

  async generate() {
    const [users, llm, revenue] = await Promise.all([
      this.sf.query(`
        SELECT app,
          COUNT(DISTINCT CASE WHEN event_date >= DATEADD(day, -7, CURRENT_DATE()) THEN user_id END) AS wau,
          COUNT(DISTINCT CASE WHEN event_date >= DATEADD(day, -14, CURRENT_DATE()) AND event_date < DATEADD(day, -7, CURRENT_DATE()) THEN user_id END) AS prev_wau
        FROM CLAW_ANALYTICS.CROSS_APP.FEATURE_USAGE
        WHERE event_date >= DATEADD(day, -14, CURRENT_DATE())
        GROUP BY app
      `),
      this.sf.query(`
        SELECT app, model,
          SUM(cost_usd) AS total_cost,
          COUNT(*) AS calls
        FROM CLAW_ANALYTICS.CROSS_APP.LLM_USAGE
        WHERE created_at >= DATEADD(day, -7, CURRENT_DATE())
        GROUP BY app, model ORDER BY total_cost DESC
      `),
      this.sf.query(`
        SELECT app,
          COUNT(DISTINCT user_id) AS subscribers,
          SUM(amount_usd) AS revenue
        FROM CLAW_ANALYTICS.CROSS_APP.SUBSCRIPTIONS
        WHERE status = 'active'
        GROUP BY app
      `),
    ]);

    return {
      period: { start: new Date(Date.now() - 7 * 86400000).toISOString(), end: new Date().toISOString() },
      userActivity: users,
      llmCosts: llm,
      revenue,
      generatedAt: new Date().toISOString(),
    };
  }
}
