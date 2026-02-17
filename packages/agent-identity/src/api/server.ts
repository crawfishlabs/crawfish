// ============================================================================
// API Server — Hono application
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Vault } from '../vault.js';
import { AuditLog } from '../audit.js';
import { GrantQueue } from '../grants.js';
import { Orchestrator } from '../orchestrator.js';
import { TOTPManager } from '../totp.js';
import { NotificationDispatcher, TelegramNotifier, EmailNotifier } from '../notifications.js';
import { loadConfig } from '../config.js';
import { agentAuth, humanAuth, combinedAuth } from './middleware/auth.js';
import { grantRoutes, pendingRoute } from './routes/grants.js';
import { credentialRoutes } from './routes/credentials.js';
import { oauthRoutes } from './routes/oauth.js';
import { auditRoutes } from './routes/audit.js';
import { dashboardRoutes } from './routes/dashboard.js';
import type { AgentIdentity } from '../types.js';

export interface ServerConfig {
  port?: number;
  host?: string;
  configPath?: string;
  agentToken?: string;
  humanToken?: string;
  baseUrl?: string;
}

export async function createServer(opts?: ServerConfig) {
  const config = await loadConfig({ configPath: opts?.configPath });

  const agentToken = opts?.agentToken || process.env.CRAWFISH_AGENT_TOKEN || '';
  const humanToken = opts?.humanToken || process.env.CRAWFISH_HUMAN_TOKEN || '';
  const baseUrl = opts?.baseUrl || process.env.CRAWFISH_BASE_URL || `http://localhost:${opts?.port || 7890}`;

  if (!agentToken) {
    console.warn('[server] CRAWFISH_AGENT_TOKEN not set — agent API auth disabled');
  }
  if (!humanToken) {
    console.warn('[server] CRAWFISH_HUMAN_TOKEN not set — dashboard auth disabled');
  }

  // Initialize core services
  const audit = new AuditLog({
    path: config.audit?.path || '~/.crawfish/agent-audit.jsonl',
    principal: config.agent.owner,
    agent: config.agent.name,
  });

  const vault = new Vault({
    vaultPath: config.identity?.authenticator?.vault_path || '~/.crawfish/vault.enc',
    audit,
  });

  const grants = new GrantQueue({
    path: (config.audit?.path || '~/.crawfish/agent-audit.jsonl').replace('agent-audit.jsonl', 'grants.json'),
  });

  const notifications = new NotificationDispatcher();
  notifications.addChannel(new TelegramNotifier());
  notifications.addChannel(new EmailNotifier({ to: config.agent.owner }));

  const orchestrator = new Orchestrator({
    vault,
    audit,
    config,
    approvalCallback: async (message) => {
      // In server mode, approval happens via dashboard — not inline
      console.log(`[orchestrator] Approval needed: ${message}`);
      return true;
    },
  });

  // OAuth URL builder
  function buildOAuthUrl(service: string, state: string): string | null {
    const redirectUri = `${baseUrl}/v1/oauth/${service}/callback`;
    const clientId = getClientId(service);
    if (!clientId) return null;

    const urls: Record<string, string> = {
      github: `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent((config.services?.[service]?.scopes || []).join(' '))}`,
      vercel: `https://vercel.com/integrations/${clientId}/new?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
    };
    return urls[service] || null;
  }

  function getClientId(service: string): string | null {
    const envKeys: Record<string, string> = {
      github: 'GITHUB_CLIENT_ID',
      vercel: 'VERCEL_CLIENT_ID',
    };
    return process.env[envKeys[service] || ''] || null;
  }

  function getClientCredentials(service: string) {
    const ids: Record<string, [string, string]> = {
      github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
      vercel: ['VERCEL_CLIENT_ID', 'VERCEL_CLIENT_SECRET'],
    };
    const keys = ids[service];
    if (!keys) return null;
    const clientId = process.env[keys[0]];
    const clientSecret = process.env[keys[1]];
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  // Build Hono app
  const app = new Hono();

  // Global middleware
  app.use('*', cors());
  app.use('*', logger());

  // Health check (no auth)
  app.get('/health', (c) => c.json({ status: 'ok', agent: config.agent.name }));

  // Agent-facing API (bearer token auth)
  const agentApi = new Hono();
  if (agentToken) {
    agentApi.use('*', agentAuth(agentToken));
  }
  agentApi.route('/grants', grantRoutes({
    grants,
    notifications,
    audit,
    agentName: config.agent.name,
    principal: config.agent.owner,
    dashboardUrl: `${baseUrl}/dashboard`,
    buildOAuthUrl,
  }));
  agentApi.get('/grants/pending', async (c) => {
    const pending = await grants.pending();
    return c.json(pending);
  });
  agentApi.route('/credentials', credentialRoutes({ vault, grants, audit, orchestrator }));
  agentApi.route('/audit', auditRoutes(audit));
  agentApi.get('/status', async (c) => {
    const results = await orchestrator.status();
    return c.json({ agent: config.agent.name, services: results });
  });

  // OAuth callbacks (no auth — they come from provider redirects)
  agentApi.route('/oauth', oauthRoutes({
    vault,
    grants,
    audit,
    getClientCredentials,
    callbackBaseUrl: baseUrl,
  }));

  app.route('/v1', agentApi);

  // Dashboard (human auth)
  const dashboard = new Hono();
  if (humanToken) {
    dashboard.use('*', humanAuth(humanToken));
  }
  dashboard.route('/', dashboardRoutes({
    grants,
    vault,
    audit,
    agentName: config.agent.name,
    buildOAuthUrl,
  }));

  app.route('/dashboard', dashboard);

  // Root redirect
  app.get('/', (c) => c.redirect('/dashboard'));

  return { app, config, vault, audit, grants, orchestrator, notifications };
}

/** Start the server on Node.js */
export async function startServer(opts?: ServerConfig) {
  const port = opts?.port || parseInt(process.env.PORT || '7890');
  const host = opts?.host || process.env.HOST || '0.0.0.0';

  const { app, config } = await createServer({ ...opts, port });

  const { serve } = await import('@hono/node-server');
  const server = serve({ fetch: app.fetch, port, hostname: host });

  console.log(`\n🦞 Agent Identity server running`);
  console.log(`   Agent: ${config.agent.name}`);
  console.log(`   API:   http://${host}:${port}/v1`);
  console.log(`   Dashboard: http://${host}:${port}/dashboard\n`);

  return server;
}
