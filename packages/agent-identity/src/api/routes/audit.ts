// ============================================================================
// Audit Routes
// ============================================================================

import { Hono } from 'hono';
import type { AuditLog } from '../../audit.js';

export function auditRoutes(audit: AuditLog) {
  const app = new Hono();

  app.get('/', async (c) => {
    const entries = await audit.query({
      service: c.req.query('service') || undefined,
      since: c.req.query('since') || undefined,
      limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : 100,
    });
    return c.json(entries);
  });

  return app;
}
