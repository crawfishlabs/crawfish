/**
 * Dashboard API — REST endpoints for Command Center analytics
 * Uses Snowflake for all queries with 5-minute cache
 */
import { Router, Request, Response } from 'express';
import SnowflakeClient from '../snowflake-config';

interface CacheEntry { data: any; expiry: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (entry && entry.expiry > Date.now()) return entry.data;
  cache.delete(key);
  return null;
}
function setCache(key: string, data: any) {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

export class DashboardAPI {
  public router: Router;
  private sf: SnowflakeClient;

  constructor(client?: SnowflakeClient) {
    this.sf = client || new SnowflakeClient();
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.router.get('/overview', this.overview.bind(this));
    this.router.get('/costs', this.costs.bind(this));
    this.router.get('/cohorts', this.cohorts.bind(this));
    this.router.get('/:app/metrics', this.appMetrics.bind(this));
  }

  private async overview(_req: Request, res: Response) {
    const cached = getCached('overview');
    if (cached) return res.json(cached);
    try {
      const rows = await this.sf.query(`
        SELECT
          app,
          COUNT(DISTINCT user_id) AS dau,
          COUNT(DISTINCT CASE WHEN event_date >= DATEADD(day, -7, CURRENT_DATE()) THEN user_id END) AS wau,
          COUNT(DISTINCT CASE WHEN event_date >= DATEADD(day, -30, CURRENT_DATE()) THEN user_id END) AS mau
        FROM CLAW_ANALYTICS.CROSS_APP.FEATURE_USAGE
        WHERE event_date >= DATEADD(day, -30, CURRENT_DATE())
        GROUP BY app
      `);
      const result = { metrics: rows, generatedAt: new Date().toISOString() };
      setCache('overview', result);
      res.json(result);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  }

  private async costs(_req: Request, res: Response) {
    const cached = getCached('costs');
    if (cached) return res.json(cached);
    try {
      const rows = await this.sf.query(`
        SELECT
          app,
          model,
          task_type,
          COUNT(*) AS call_count,
          SUM(cost_usd) AS total_cost,
          AVG(cost_usd) AS avg_cost,
          SUM(input_tokens) AS total_input_tokens,
          SUM(output_tokens) AS total_output_tokens
        FROM CLAW_ANALYTICS.CROSS_APP.LLM_USAGE
        WHERE created_at >= DATEADD(day, -30, CURRENT_DATE())
        GROUP BY app, model, task_type
        ORDER BY total_cost DESC
      `);
      const result = { costs: rows, generatedAt: new Date().toISOString() };
      setCache('costs', result);
      res.json(result);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  }

  private async cohorts(_req: Request, res: Response) {
    const cached = getCached('cohorts');
    if (cached) return res.json(cached);
    try {
      const rows = await this.sf.query(`
        SELECT
          DATE_TRUNC('week', first_seen) AS cohort_week,
          app,
          COUNT(DISTINCT user_id) AS cohort_size,
          COUNT(DISTINCT CASE WHEN DATEDIFF(day, first_seen, last_seen) >= 7 THEN user_id END) AS retained_7d,
          COUNT(DISTINCT CASE WHEN DATEDIFF(day, first_seen, last_seen) >= 30 THEN user_id END) AS retained_30d
        FROM (
          SELECT user_id, app,
            MIN(event_date) AS first_seen,
            MAX(event_date) AS last_seen
          FROM CLAW_ANALYTICS.CROSS_APP.FEATURE_USAGE
          GROUP BY user_id, app
        )
        GROUP BY cohort_week, app
        ORDER BY cohort_week DESC
      `);
      const result = { cohorts: rows, generatedAt: new Date().toISOString() };
      setCache('cohorts', result);
      res.json(result);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  }

  private async appMetrics(req: Request, res: Response) {
    const app = req.params.app;
    const cacheKey = `app:${app}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const schemaMap: Record<string, string> = {
      fitness: 'FITNESS', nutrition: 'NUTRITION', meetings: 'MEETINGS', budget: 'BUDGET',
    };
    const schema = schemaMap[app];
    if (!schema) return res.status(404).json({ error: `Unknown app: ${app}` });

    try {
      // Generic per-app metrics — count of primary entities
      const rows = await this.sf.query(`
        SELECT
          COUNT(*) AS total_records,
          COUNT(DISTINCT user_id) AS unique_users,
          MIN(created_at) AS earliest,
          MAX(created_at) AS latest
        FROM CLAW_ANALYTICS.${schema}.${app === 'fitness' ? 'WORKOUTS' : app === 'nutrition' ? 'FOOD_LOGS' : app === 'meetings' ? 'MEETINGS' : 'TRANSACTIONS'}
      `);
      const result = { app, metrics: rows[0] || {}, generatedAt: new Date().toISOString() };
      setCache(cacheKey, result);
      res.json(result);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  }
}
