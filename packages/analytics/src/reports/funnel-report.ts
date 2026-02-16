/**
 * Funnel Report — signup → trial → paid conversion by app via Snowflake
 */
import SnowflakeClient from '../snowflake-config';

export class FunnelReport {
  private sf: SnowflakeClient;

  constructor(client?: SnowflakeClient) {
    this.sf = client || new SnowflakeClient();
  }

  async generate(startDate: string, endDate: string, app?: string) {
    const appFilter = app ? `AND app = '${app}'` : '';

    const rows = await this.sf.query(`
      WITH signups AS (
        SELECT user_id, app, MIN(created_at) AS signup_date
        FROM CLAW_ANALYTICS.CROSS_APP.USERS
        WHERE created_at BETWEEN '${startDate}' AND '${endDate}' ${appFilter}
        GROUP BY user_id, app
      ),
      trials AS (
        SELECT user_id, app, MIN(trial_start) AS trial_date
        FROM CLAW_ANALYTICS.CROSS_APP.SUBSCRIPTIONS
        WHERE trial_start IS NOT NULL ${appFilter}
        GROUP BY user_id, app
      ),
      conversions AS (
        SELECT user_id, app, MIN(paid_start) AS paid_date
        FROM CLAW_ANALYTICS.CROSS_APP.SUBSCRIPTIONS
        WHERE status = 'active' AND paid_start IS NOT NULL ${appFilter}
        GROUP BY user_id, app
      )
      SELECT
        s.app,
        COUNT(DISTINCT s.user_id) AS signups,
        COUNT(DISTINCT t.user_id) AS trials,
        COUNT(DISTINCT c.user_id) AS paid,
        DIV0(COUNT(DISTINCT t.user_id), COUNT(DISTINCT s.user_id)) AS signup_to_trial,
        DIV0(COUNT(DISTINCT c.user_id), COUNT(DISTINCT t.user_id)) AS trial_to_paid,
        DIV0(COUNT(DISTINCT c.user_id), COUNT(DISTINCT s.user_id)) AS signup_to_paid
      FROM signups s
      LEFT JOIN trials t ON s.user_id = t.user_id AND s.app = t.app
      LEFT JOIN conversions c ON s.user_id = c.user_id AND s.app = c.app
      GROUP BY s.app
      ORDER BY s.app
    `);

    return { period: { start: startDate, end: endDate }, funnels: rows, generatedAt: new Date().toISOString() };
  }
}
