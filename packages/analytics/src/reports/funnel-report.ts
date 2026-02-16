/**
 * Funnel Report — signup → trial → paid conversion by app
 */
import { BigQuery } from '@google-cloud/bigquery';

export class FunnelReport {
  private bq: BigQuery;
  private project: string;

  constructor(projectId?: string) {
    this.project = projectId || process.env.GOOGLE_CLOUD_PROJECT || '';
    this.bq = new BigQuery({ projectId: this.project });
  }

  async generate(startDate: string, endDate: string, app?: string) {
    const appFilter = app ? `AND app = '${app}'` : '';

    const query = `
      WITH signups AS (
        SELECT user_id, app, MIN(created_at) as signup_date
        FROM \`${this.project}.claw_cross_app.users\`
        WHERE created_at BETWEEN '${startDate}' AND '${endDate}' ${appFilter}
        GROUP BY user_id, app
      ),
      trials AS (
        SELECT user_id, app, MIN(trial_start) as trial_date
        FROM \`${this.project}.claw_cross_app.subscriptions\`
        WHERE trial_start IS NOT NULL ${appFilter}
        GROUP BY user_id, app
      ),
      conversions AS (
        SELECT user_id, app, MIN(paid_start) as paid_date
        FROM \`${this.project}.claw_cross_app.subscriptions\`
        WHERE status = 'active' AND paid_start IS NOT NULL ${appFilter}
        GROUP BY user_id, app
      )
      SELECT
        s.app,
        COUNT(DISTINCT s.user_id) as signups,
        COUNT(DISTINCT t.user_id) as trials,
        COUNT(DISTINCT c.user_id) as paid,
        SAFE_DIVIDE(COUNT(DISTINCT t.user_id), COUNT(DISTINCT s.user_id)) as signup_to_trial,
        SAFE_DIVIDE(COUNT(DISTINCT c.user_id), COUNT(DISTINCT t.user_id)) as trial_to_paid,
        SAFE_DIVIDE(COUNT(DISTINCT c.user_id), COUNT(DISTINCT s.user_id)) as signup_to_paid
      FROM signups s
      LEFT JOIN trials t ON s.user_id = t.user_id AND s.app = t.app
      LEFT JOIN conversions c ON s.user_id = c.user_id AND s.app = c.app
      GROUP BY s.app
      ORDER BY s.app
    `;

    const [rows] = await this.bq.query({ query });
    return {
      period: { start: startDate, end: endDate },
      funnels: rows,
      generatedAt: new Date().toISOString(),
    };
  }
}
