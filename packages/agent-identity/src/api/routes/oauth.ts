// ============================================================================
// OAuth Callback Routes — Handle redirects from service providers
// ============================================================================

import { Hono } from 'hono';
import type { Vault } from '../../vault.js';
import type { GrantQueue } from '../../grants.js';
import type { AuditLog } from '../../audit.js';
import type { OAuthToken, ServiceCredential } from '../../types.js';

export interface OAuthRouteDeps {
  vault: Vault;
  grants: GrantQueue;
  audit: AuditLog;
  getClientCredentials: (service: string) => { clientId: string; clientSecret: string } | null;
  callbackBaseUrl: string;
}

export function oauthRoutes(deps: OAuthRouteDeps) {
  const app = new Hono();

  // OAuth callback — handles redirect from GitHub, Vercel, etc.
  app.get('/:service/callback', async (c) => {
    const service = c.req.param('service');
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      return c.html(errorPage(service, `OAuth error: ${error}`));
    }

    if (!code || !state) {
      return c.html(errorPage(service, 'Missing code or state parameter'));
    }

    // Find the grant by OAuth state
    const grant = await deps.grants.findByOAuthState(state);
    if (!grant) {
      return c.html(errorPage(service, 'Invalid or expired OAuth state. Try approving again.'));
    }

    // Exchange code for token
    const creds = deps.getClientCredentials(service);
    if (!creds) {
      return c.html(errorPage(service, `No client credentials configured for ${service}`));
    }

    try {
      const token = await exchangeCode(service, code, creds, deps.callbackBaseUrl);

      // Store in vault
      const credential: ServiceCredential = {
        service,
        type: 'oauth',
        created_at: new Date().toISOString(),
        expires_at: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000).toISOString()
          : null,
        data: token,
      };
      await deps.vault.set(service, credential);

      // Activate the grant
      await deps.grants.activate(grant.id);

      await deps.audit.log({
        action: 'credential.create',
        service,
        outcome: 'success',
        metadata: { grant_id: grant.id, method: 'oauth' },
      });

      return c.html(successPage(service));
    } catch (err: any) {
      await deps.audit.log({
        action: 'credential.create',
        service,
        outcome: 'failure',
        metadata: { grant_id: grant.id, error: err.message },
      });
      return c.html(errorPage(service, err.message));
    }
  });

  return app;
}

// ─── Token Exchange ──────────────────────────────────────────────

async function exchangeCode(
  service: string,
  code: string,
  creds: { clientId: string; clientSecret: string },
  callbackBaseUrl: string
): Promise<OAuthToken> {
  const tokenUrls: Record<string, string> = {
    github: 'https://github.com/login/oauth/access_token',
    vercel: 'https://api.vercel.com/v2/oauth/access_token',
  };

  const tokenUrl = tokenUrls[service];
  if (!tokenUrl) throw new Error(`Unknown OAuth service: ${service}`);

  const redirectUri = `${callbackBaseUrl}/v1/oauth/${service}/callback`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const data = await response.json() as any;
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  if (!data.access_token) throw new Error('No access_token in response');

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type || 'bearer',
    scope: data.scope || '',
    expires_in: data.expires_in,
  };
}

// ─── Simple HTML pages (no framework needed) ─────────────────────

function successPage(service: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1"><title>✅ Connected</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.card{text-align:center;padding:2rem;max-width:400px}h1{font-size:3rem;margin:0}.service{color:#22c55e;text-transform:capitalize}
p{color:#a1a1aa;line-height:1.6}
</style></head>
<body><div class="card">
<h1>✅</h1>
<h2><span class="service">${service}</span> Connected</h2>
<p>Your agent now has access. You can close this tab.</p>
<p style="font-size:0.85rem;margin-top:2rem">The credential has been encrypted and stored in the vault.</p>
</div></body></html>`;
}

function errorPage(service: string, error: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1"><title>❌ Error</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.card{text-align:center;padding:2rem;max-width:400px}h1{font-size:3rem;margin:0}.service{color:#ef4444;text-transform:capitalize}
p{color:#a1a1aa;line-height:1.6}.error{color:#fca5a5;background:#1c1c1c;padding:1rem;border-radius:0.5rem;font-size:0.9rem}
</style></head>
<body><div class="card">
<h1>❌</h1>
<h2><span class="service">${service}</span> Connection Failed</h2>
<p class="error">${error}</p>
<p>Go back to the dashboard and try again.</p>
</div></body></html>`;
}
