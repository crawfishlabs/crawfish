// ============================================================================
// Dashboard Routes — Server-rendered HTML pages for human management
// ============================================================================

import { Hono } from 'hono';
import type { GrantQueue, Grant } from '../../grants.js';
import type { Vault } from '../../vault.js';
import type { AuditLog } from '../../audit.js';

export interface DashboardDeps {
  grants: GrantQueue;
  vault: Vault;
  audit: AuditLog;
  agentName: string;
  buildOAuthUrl: (service: string, state: string) => string | null;
}

export function dashboardRoutes(deps: DashboardDeps) {
  const app = new Hono();

  // Dashboard home
  app.get('/', async (c) => {
    const pending = await deps.grants.pending();
    const credentials = await deps.vault.list();
    const recentAudit = await deps.audit.query({ limit: 10 });

    return c.html(layout('Dashboard', `
      <section>
        <h2>⏳ Pending Requests ${pending.length > 0 ? `<span class="badge">${pending.length}</span>` : ''}</h2>
        ${pending.length === 0 ? '<p class="muted">No pending requests</p>' : ''}
        ${pending.map(g => grantCard(g)).join('')}
      </section>

      <section>
        <h2>🔑 Active Credentials</h2>
        ${credentials.length === 0 ? '<p class="muted">No active credentials</p>' : ''}
        <div class="cred-list">
          ${credentials.map(c => `
            <div class="cred-item">
              <div class="cred-name">${c.service}</div>
              <div class="cred-meta">${c.type} · ${c.expires_at ? `expires ${new Date(c.expires_at).toLocaleDateString()}` : 'no expiry'}</div>
              <form method="POST" action="/dashboard/revoke/${c.service}" class="inline">
                <button type="submit" class="btn btn-danger btn-sm">Revoke</button>
              </form>
            </div>
          `).join('')}
        </div>
        ${credentials.length > 0 ? `
          <form method="POST" action="/dashboard/revoke-all" style="margin-top:1rem">
            <button type="submit" class="btn btn-danger">⚠️ Revoke All</button>
          </form>
        ` : ''}
      </section>

      <section>
        <h2>📋 Recent Activity</h2>
        <table>
          <thead><tr><th>Time</th><th>Action</th><th>Service</th><th>Result</th></tr></thead>
          <tbody>
            ${recentAudit.map(e => `
              <tr>
                <td>${new Date(e.ts).toLocaleString()}</td>
                <td>${e.action}</td>
                <td>${e.service}</td>
                <td><span class="status-${e.outcome}">${e.outcome}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    `));
  });

  // Grant detail / approval page
  app.get('/grants/:id', async (c) => {
    const grant = await deps.grants.get(c.req.param('id'));
    if (!grant) return c.html(layout('Not Found', '<p>Grant not found.</p>'), 404);

    return c.html(layout(`Grant: ${grant.service}`, `
      <div class="grant-detail">
        <h2>${serviceIcon(grant.service)} ${grant.service}</h2>
        <dl>
          <dt>Status</dt><dd><span class="status-${grant.status}">${grant.status}</span></dd>
          <dt>Agent</dt><dd>${grant.agent}</dd>
          <dt>Scopes</dt><dd>${grant.scopes.join(', ') || 'default'}</dd>
          ${grant.org ? `<dt>Org</dt><dd>${grant.org}</dd>` : ''}
          ${grant.reason ? `<dt>Reason</dt><dd>"${grant.reason}"</dd>` : ''}
          <dt>Requested</dt><dd>${new Date(grant.created_at).toLocaleString()}</dd>
        </dl>

        ${grant.status === 'pending' ? `
          <div class="actions">
            <form method="POST" action="/dashboard/grants/${grant.id}/approve" class="inline">
              <button type="submit" class="btn btn-primary btn-lg">✅ Approve</button>
            </form>
            <form method="POST" action="/dashboard/grants/${grant.id}/deny" class="inline">
              <button type="submit" class="btn btn-danger btn-lg">❌ Deny</button>
            </form>
          </div>
        ` : ''}

        ${grant.status === 'approved' && grant.oauth_state ? `
          <div class="actions">
            <p>Grant approved. Complete the OAuth flow:</p>
            <a href="${deps.buildOAuthUrl(grant.service, grant.oauth_state) || '#'}" class="btn btn-primary btn-lg">
              Connect ${grant.service} →
            </a>
          </div>
        ` : ''}
      </div>
    `));
  });

  // Approve action (form POST)
  app.post('/grants/:id/approve', async (c) => {
    const grant = await deps.grants.approve(c.req.param('id'));
    if (!grant) return c.redirect('/dashboard');

    // If OAuth service, redirect to OAuth consent
    const oauthUrl = deps.buildOAuthUrl(grant.service, grant.oauth_state!);
    if (oauthUrl) {
      return c.redirect(oauthUrl);
    }

    return c.redirect(`/dashboard/grants/${grant.id}`);
  });

  // Deny action
  app.post('/grants/:id/deny', async (c) => {
    await deps.grants.deny(c.req.param('id'));
    return c.redirect('/dashboard');
  });

  // Revoke single credential
  app.post('/revoke/:service', async (c) => {
    const service = c.req.param('service');
    await deps.vault.delete(service);
    await deps.grants.revoke(service);
    return c.redirect('/dashboard');
  });

  // Revoke all
  app.post('/revoke-all', async (c) => {
    const creds = await deps.vault.list();
    for (const cr of creds) {
      await deps.vault.delete(cr.service);
      await deps.grants.revoke(cr.service);
    }
    return c.redirect('/dashboard');
  });

  return app;
}

// ─── HTML Helpers ────────────────────────────────────────────────

function serviceIcon(service: string): string {
  const icons: Record<string, string> = {
    github: '🐙', vercel: '▲', npm: '📦', aws: '☁️', stripe: '💳',
    cloudflare: '🟠', linear: '🔷', notion: '📝', slack: '💬',
  };
  return icons[service] || '🔌';
}

function grantCard(g: Grant): string {
  return `
    <a href="/dashboard/grants/${g.id}" class="grant-card">
      <div class="grant-service">${serviceIcon(g.service)} ${g.service}</div>
      <div class="grant-scopes">${g.scopes.join(', ') || 'default scopes'}</div>
      ${g.reason ? `<div class="grant-reason">"${g.reason}"</div>` : ''}
      <div class="grant-time">${timeAgo(g.created_at)}</div>
    </a>
  `;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Agent Identity</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fafafa;line-height:1.6;padding:1rem;max-width:640px;margin:0 auto}
h1{font-size:1.5rem;margin-bottom:0.5rem}
h2{font-size:1.2rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem}
section{margin-bottom:2rem;padding:1.5rem;background:#111;border-radius:0.75rem;border:1px solid #222}
.muted{color:#666}
.badge{background:#eab308;color:#000;font-size:0.75rem;padding:0.15rem 0.5rem;border-radius:999px;font-weight:700}
.btn{display:inline-block;padding:0.6rem 1.2rem;border:none;border-radius:0.5rem;font-size:0.95rem;cursor:pointer;text-decoration:none;font-weight:600;transition:opacity 0.15s}
.btn:hover{opacity:0.85}
.btn-primary{background:#3b82f6;color:#fff}
.btn-danger{background:#ef4444;color:#fff}
.btn-sm{padding:0.3rem 0.75rem;font-size:0.8rem}
.btn-lg{padding:0.75rem 1.5rem;font-size:1.1rem}
.inline{display:inline}
.actions{margin-top:1.5rem;display:flex;gap:1rem;flex-wrap:wrap}
.grant-card{display:block;padding:1rem;background:#1a1a1a;border:1px solid #333;border-radius:0.5rem;margin-bottom:0.75rem;text-decoration:none;color:inherit;transition:border-color 0.15s}
.grant-card:hover{border-color:#3b82f6}
.grant-service{font-weight:700;font-size:1.1rem}
.grant-scopes{color:#a1a1aa;font-size:0.85rem;margin-top:0.25rem}
.grant-reason{color:#d4d4d8;font-style:italic;font-size:0.85rem;margin-top:0.25rem}
.grant-time{color:#666;font-size:0.8rem;margin-top:0.5rem}
.grant-detail dl{display:grid;grid-template-columns:auto 1fr;gap:0.5rem 1rem;margin:1rem 0}
.grant-detail dt{color:#888;font-weight:600}
.cred-item{display:flex;align-items:center;gap:1rem;padding:0.75rem;background:#1a1a1a;border-radius:0.5rem;margin-bottom:0.5rem}
.cred-name{font-weight:700;min-width:100px}
.cred-meta{color:#888;font-size:0.85rem;flex:1}
.status-success,.status-active{color:#22c55e}
.status-failure,.status-denied,.status-revoked{color:#ef4444}
.status-pending{color:#eab308}
table{width:100%;border-collapse:collapse;font-size:0.85rem}
th,td{text-align:left;padding:0.5rem;border-bottom:1px solid #222}
th{color:#888;font-weight:600}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid #222}
header a{color:#888;text-decoration:none;font-size:0.85rem}
</style>
</head>
<body>
<header>
  <h1>🦞 Agent Identity</h1>
  <a href="/dashboard">Dashboard</a>
</header>
${body}
</body>
</html>`;
}
