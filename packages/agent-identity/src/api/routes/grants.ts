// ============================================================================
// Grant Routes — Request, approve, deny access
// ============================================================================

import { Hono } from 'hono';
import type { GrantQueue } from '../../grants.js';
import type { NotificationDispatcher } from '../../notifications.js';
import type { AuditLog } from '../../audit.js';

export interface GrantRouteDeps {
  grants: GrantQueue;
  notifications: NotificationDispatcher;
  audit: AuditLog;
  agentName: string;
  principal: string;
  dashboardUrl: string;
  buildOAuthUrl: (service: string, state: string) => string | null;
}

export function grantRoutes(deps: GrantRouteDeps) {
  const app = new Hono();

  // Agent requests access to a service
  app.post('/request', async (c) => {
    const body = await c.req.json<{
      service: string;
      scopes?: string[];
      method?: string;
      org?: string;
      team?: string;
      reason?: string;
    }>();

    if (!body.service) {
      return c.json({ error: 'service is required' }, 400);
    }

    const grant = await deps.grants.create({
      service: body.service,
      method: body.method,
      scopes: body.scopes,
      org: body.org,
      team: body.team,
      reason: body.reason,
      agent: deps.agentName,
      principal: deps.principal,
    });

    await deps.audit.log({
      action: 'grant.requested' as any,
      service: body.service,
      outcome: 'pending',
      metadata: { grant_id: grant.id, scopes: body.scopes, reason: body.reason },
    });

    // Notify human
    await deps.notifications.notifyGrantRequest(grant, deps.dashboardUrl);

    return c.json({
      grant_id: grant.id,
      status: grant.status,
      message: `Access request for ${body.service} submitted. Waiting for approval.`,
    }, 201);
  });

  // Get a specific grant
  app.get('/:id', async (c) => {
    const grant = await deps.grants.get(c.req.param('id'));
    if (!grant) return c.json({ error: 'Grant not found' }, 404);
    return c.json(grant);
  });

  // List pending grants (human dashboard)
  app.get('/pending', async (c) => {
    // Hono matches routes top-down; /pending is tried before /:id
  });

  // Approve a grant (human)
  app.post('/:id/approve', async (c) => {
    const grant = await deps.grants.approve(c.req.param('id'), deps.principal);
    if (!grant) {
      return c.json({ error: 'Grant not found or not pending' }, 404);
    }

    await deps.audit.log({
      action: 'grant.approved' as any,
      service: grant.service,
      outcome: 'success',
      metadata: { grant_id: grant.id },
    });

    // For OAuth services, build the authorization URL
    const oauthUrl = deps.buildOAuthUrl(grant.service, grant.oauth_state!);
    if (oauthUrl) {
      return c.json({
        grant_id: grant.id,
        status: 'approved',
        oauth_url: oauthUrl,
        message: `Approved. Complete OAuth authorization at the provided URL.`,
      });
    }

    // For non-OAuth (API key), just mark as approved — human will paste key
    return c.json({
      grant_id: grant.id,
      status: 'approved',
      message: 'Approved. Provide the API key to complete setup.',
    });
  });

  // Deny a grant (human)
  app.post('/:id/deny', async (c) => {
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}));
    const grant = await deps.grants.deny(c.req.param('id'), body.reason, deps.principal);
    if (!grant) {
      return c.json({ error: 'Grant not found or not pending' }, 404);
    }

    await deps.audit.log({
      action: 'grant.denied' as any,
      service: grant.service,
      outcome: 'success',
      metadata: { grant_id: grant.id, reason: body.reason },
    });

    return c.json({
      grant_id: grant.id,
      status: 'denied',
      message: `Access to ${grant.service} denied.`,
    });
  });

  return app;
}

// Separate pending route (to avoid /:id conflict)
export function pendingRoute(deps: GrantRouteDeps) {
  const app = new Hono();
  app.get('/', async (c) => {
    const pending = await deps.grants.pending();
    return c.json(pending);
  });
  return app;
}
