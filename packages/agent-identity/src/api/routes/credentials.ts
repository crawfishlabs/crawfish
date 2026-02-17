// ============================================================================
// Credential Routes — Retrieve and revoke credentials
// ============================================================================

import { Hono } from 'hono';
import type { Vault } from '../../vault.js';
import type { GrantQueue } from '../../grants.js';
import type { AuditLog } from '../../audit.js';
import type { Orchestrator } from '../../orchestrator.js';

export interface CredentialRouteDeps {
  vault: Vault;
  grants: GrantQueue;
  audit: AuditLog;
  orchestrator: Orchestrator;
}

export function credentialRoutes(deps: CredentialRouteDeps) {
  const app = new Hono();

  // List all credentials (summary, no secrets)
  app.get('/', async (c) => {
    const creds = await deps.vault.list();
    return c.json(creds);
  });

  // Get a specific credential (returns actual token — agent-only)
  app.get('/:service', async (c) => {
    const service = c.req.param('service');
    const credential = await deps.vault.get(service);
    if (!credential) {
      return c.json({ error: `No credential for ${service}` }, 404);
    }

    // Check expiry
    if (credential.expires_at && new Date(credential.expires_at) < new Date()) {
      return c.json({
        error: `Credential for ${service} has expired`,
        expired_at: credential.expires_at,
      }, 410);
    }

    return c.json(credential);
  });

  // Revoke a specific credential
  app.delete('/:service', async (c) => {
    const service = c.req.param('service');
    const reason = c.req.query('reason') || 'manual';
    const success = await deps.orchestrator.revoke(service, reason);
    if (!success) {
      return c.json({ error: `No credential for ${service}` }, 404);
    }
    await deps.grants.revoke(service);
    return c.json({ revoked: true, service });
  });

  // Revoke ALL credentials (emergency)
  app.delete('/', async (c) => {
    const reason = c.req.query('reason') || 'revoke-all';
    const revoked = await deps.orchestrator.revokeAll(reason);
    return c.json({ revoked });
  });

  return app;
}
