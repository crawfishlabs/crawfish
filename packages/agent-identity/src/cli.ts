#!/usr/bin/env node
// ============================================================================
// CLI — crawfish-identity
// ============================================================================

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentIdentityService } from './index.js';
import { Vault } from './vault.js';
import { generateDefaultConfig } from './config.js';

const USAGE = `
crawfish-identity — Identity layer for AI agents

Usage:
  crawfish-identity init [--agent <name>] [--owner <email>] [--domain <domain>]
  crawfish-identity grant <service> [--scopes <s1,s2>] [--org <org>] [--token <token>]
  crawfish-identity revoke <service>
  crawfish-identity revoke --all [--reason <reason>]
  crawfish-identity list
  crawfish-identity status
  crawfish-identity audit [--since <duration>] [--service <name>]
  crawfish-identity totp <service>

Environment:
  CRAWFISH_VAULT_KEY     Master encryption key (required)
  GITHUB_CLIENT_ID       GitHub OAuth App client ID
  VERCEL_CLIENT_ID       Vercel integration client ID
  VERCEL_CLIENT_SECRET   Vercel integration client secret
`.trim();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  // Parse flags
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[key] = value;
    } else if (!flags._positional) {
      flags._positional = args[i];
    }
  }

  switch (command) {
    case 'init':
      await cmdInit(flags);
      break;
    case 'grant':
      await cmdGrant(flags._positional || flags.service || '', flags);
      break;
    case 'revoke':
      await cmdRevoke(flags._positional || flags.service || '', flags);
      break;
    case 'list':
      await cmdList();
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'audit':
      await cmdAudit(flags);
      break;
    case 'totp':
      await cmdTotp(flags._positional || '');
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

async function cmdInit(flags: Record<string, string>) {
  const agentName = flags.agent || 'agent';
  const owner = flags.owner || 'owner@example.com';
  const domain = flags.domain;

  // Generate vault key
  const vaultKey = Vault.generateKey();
  console.log('🔑 Generated vault key (save this securely):');
  console.log(`   export CRAWFISH_VAULT_KEY="${vaultKey}"\n`);

  // Generate config
  const configContent = generateDefaultConfig({ agentName, owner, domain });
  const configPath = resolve('agent-identity.yaml');
  await writeFile(configPath, configContent);
  console.log(`📝 Config written to: ${configPath}`);
  console.log(`\n✅ Initialized! Next steps:`);
  console.log(`   1. Set the vault key: export CRAWFISH_VAULT_KEY="${vaultKey}"`);
  console.log(`   2. Edit agent-identity.yaml with your settings`);
  console.log(`   3. Grant access: crawfish-identity grant github`);
}

async function cmdGrant(service: string, flags: Record<string, string>) {
  if (!service) {
    console.error('Usage: crawfish-identity grant <service>');
    process.exit(1);
  }

  const identity = await AgentIdentityService.create();

  // For API token injection
  if (flags.token) {
    const { VercelProvider } = await import('./providers/vercel.js');
    if (service === 'vercel') {
      const provider = new VercelProvider();
      const credential = await provider.storeToken(flags.token, flags.team);
      await identity.vault.set(service, credential);
      console.log(`✅ ${service} token stored in vault`);
      return;
    }
    // Generic API key storage
    await identity.vault.set(service, {
      service,
      type: 'api-key',
      created_at: new Date().toISOString(),
      expires_at: null,
      data: { key: flags.token, label: flags.label || 'manual' },
    });
    console.log(`✅ ${service} API key stored in vault`);
    return;
  }

  const result = await identity.orchestrator.grant({
    service,
    method: (flags.method as any) || 'oauth',
    scopes: flags.scopes?.split(',') || [],
    org: flags.org,
    team: flags.team,
    expiry_days: flags.expiry ? parseInt(flags.expiry) : undefined,
  });

  console.log(result.message);
  if (!result.success) process.exit(1);
}

async function cmdRevoke(service: string, flags: Record<string, string>) {
  const identity = await AgentIdentityService.create();

  if (flags.all === 'true') {
    const revoked = await identity.orchestrator.revokeAll(flags.reason);
    console.log(`✅ Revoked ${revoked.length} credentials: ${revoked.join(', ') || 'none'}`);
    return;
  }

  if (!service) {
    console.error('Usage: crawfish-identity revoke <service> or --all');
    process.exit(1);
  }

  const success = await identity.orchestrator.revoke(service, flags.reason);
  console.log(success ? `✅ ${service} credentials revoked` : `⚠️ No credentials found for ${service}`);
}

async function cmdList() {
  const identity = await AgentIdentityService.create();
  const creds = await identity.vault.list();

  if (creds.length === 0) {
    console.log('No credentials stored.');
    return;
  }

  console.log('Service          Type        Expires');
  console.log('───────────────  ──────────  ─────────────────────');
  for (const c of creds) {
    const expires = c.expires_at
      ? new Date(c.expires_at).toLocaleDateString()
      : 'never';
    console.log(
      `${c.service.padEnd(17)}${c.type.padEnd(12)}${expires}`
    );
  }
}

async function cmdStatus() {
  const identity = await AgentIdentityService.create();
  const results = await identity.orchestrator.status();

  if (results.length === 0) {
    console.log('No credentials to test.');
    return;
  }

  for (const r of results) {
    const icon = r.valid ? '✅' : '❌';
    console.log(`${icon} ${r.service}: ${r.info || (r.valid ? 'OK' : 'FAILED')}`);
  }
}

async function cmdAudit(flags: Record<string, string>) {
  const identity = await AgentIdentityService.create();
  const entries = await identity.audit.query({
    service: flags.service,
    since: flags.since,
    limit: flags.limit ? parseInt(flags.limit) : 50,
  });

  if (entries.length === 0) {
    console.log('No audit entries found.');
    return;
  }

  for (const e of entries) {
    const time = new Date(e.ts).toLocaleString();
    console.log(`${time}  ${e.action.padEnd(22)}  ${e.service.padEnd(12)}  ${e.outcome}`);
  }
}

async function cmdTotp(service: string) {
  if (!service) {
    console.error('Usage: crawfish-identity totp <service>');
    process.exit(1);
  }

  const identity = await AgentIdentityService.create();
  const code = await identity.totp.getCode(service);
  console.log(code);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
