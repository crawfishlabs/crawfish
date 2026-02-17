#!/usr/bin/env node
// ============================================================================
// CLI — Thin wrapper around the Agent Identity API
// ============================================================================

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Vault } from './vault.js';
import { generateDefaultConfig } from './config.js';

const USAGE = `
crawfish-identity — Identity layer for AI agents

Usage:
  crawfish-identity server [--port <port>]        Start the API server
  crawfish-identity init [--agent <name>] ...      Initialize config + keys
  crawfish-identity grant <service>                Request access (via API)
  crawfish-identity revoke <service>               Revoke access (via API)
  crawfish-identity revoke --all                   Revoke everything
  crawfish-identity list                           List credentials
  crawfish-identity status                         Test all credentials
  crawfish-identity audit [--since <duration>]     View audit log

Environment:
  CRAWFISH_VAULT_KEY       Master encryption key
  CRAWFISH_AGENT_TOKEN     Agent API bearer token
  CRAWFISH_BASE_URL        API server URL (default: http://localhost:7890)
`.trim();

const BASE_URL = process.env.CRAWFISH_BASE_URL || 'http://localhost:7890';
const AGENT_TOKEN = process.env.CRAWFISH_AGENT_TOKEN || '';

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${BASE_URL}/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${AGENT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok && data.error) {
    throw new Error(data.error);
  }
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[key] = value;
    } else if (!flags._pos) {
      flags._pos = args[i];
    }
  }

  switch (command) {
    case 'server': {
      const { startServer } = await import('./api/server.js');
      await startServer({ port: flags.port ? parseInt(flags.port) : undefined });
      break;
    }

    case 'init': {
      const agentName = flags.agent || 'agent';
      const owner = flags.owner || 'owner@example.com';
      const vaultKey = Vault.generateKey();
      const agentToken = Vault.generateKey().slice(0, 32);
      const humanToken = Vault.generateKey().slice(0, 32);

      console.log('🔑 Generated keys (save these securely):\n');
      console.log(`   export CRAWFISH_VAULT_KEY="${vaultKey}"`);
      console.log(`   export CRAWFISH_AGENT_TOKEN="${agentToken}"`);
      console.log(`   export CRAWFISH_HUMAN_TOKEN="${humanToken}"\n`);

      const configContent = generateDefaultConfig({ agentName, owner, domain: flags.domain });
      const configPath = resolve('agent-identity.yaml');
      await writeFile(configPath, configContent);
      console.log(`📝 Config: ${configPath}`);
      console.log(`\n✅ Next: set env vars, then run: crawfish-identity server`);
      break;
    }

    case 'grant': {
      const service = flags._pos;
      if (!service) { console.error('Usage: crawfish-identity grant <service>'); process.exit(1); }
      const result = await api('POST', '/grants/request', {
        service,
        scopes: flags.scopes?.split(','),
        org: flags.org,
        team: flags.team,
        reason: flags.reason,
      });
      console.log(`📤 ${result.message}`);
      console.log(`   Grant ID: ${result.grant_id}`);

      if (flags.wait === 'true' || !flags.wait) {
        console.log('\n⏳ Waiting for approval (check dashboard or notifications)...');
        while (true) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const cred = await api('GET', `/credentials/${service}`);
            console.log(`\n✅ ${service} access granted!`);
            break;
          } catch {
            process.stdout.write('.');
          }
        }
      }
      break;
    }

    case 'revoke': {
      if (flags.all === 'true') {
        const result = await api('DELETE', `/credentials?reason=${flags.reason || 'cli'}`);
        console.log(`✅ Revoked: ${result.revoked.join(', ') || 'none'}`);
      } else {
        const service = flags._pos;
        if (!service) { console.error('Usage: crawfish-identity revoke <service>'); process.exit(1); }
        await api('DELETE', `/credentials/${service}`);
        console.log(`✅ ${service} revoked`);
      }
      break;
    }

    case 'list': {
      const creds = await api('GET', '/credentials');
      if (creds.length === 0) { console.log('No credentials.'); break; }
      console.log('Service          Type        Expires');
      console.log('───────────────  ──────────  ─────────────────────');
      for (const c of creds) {
        const exp = c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'never';
        console.log(`${c.service.padEnd(17)}${c.type.padEnd(12)}${exp}`);
      }
      break;
    }

    case 'status': {
      const result = await api('GET', '/status');
      console.log(`Agent: ${result.agent}\n`);
      for (const s of result.services) {
        console.log(`${s.valid ? '✅' : '❌'} ${s.service}: ${s.info || (s.valid ? 'OK' : 'FAILED')}`);
      }
      break;
    }

    case 'audit': {
      const params = new URLSearchParams();
      if (flags.since) params.set('since', flags.since);
      if (flags.service) params.set('service', flags.service);
      if (flags.limit) params.set('limit', flags.limit);
      const entries = await api('GET', `/audit?${params}`);
      for (const e of entries) {
        console.log(`${new Date(e.ts).toLocaleString()}  ${e.action.padEnd(22)}  ${e.service.padEnd(12)}  ${e.outcome}`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
