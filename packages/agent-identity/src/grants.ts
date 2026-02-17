// ============================================================================
// Grant Queue — Tracks pending/approved/denied grant requests
// ============================================================================

import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type GrantStatus = 'pending' | 'approved' | 'active' | 'denied' | 'revoked' | 'expired';

export interface Grant {
  id: string;
  service: string;
  method: string;
  scopes: string[];
  org?: string;
  team?: string;
  reason?: string;
  agent: string;
  principal: string;
  status: GrantStatus;
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
  deny_reason?: string;
  /** OAuth state parameter, used to correlate callback */
  oauth_state?: string;
}

export class GrantQueue {
  private grants: Map<string, Grant> = new Map();
  private path: string;
  private loaded = false;

  constructor(opts: { path: string }) {
    this.path = opts.path.replace('~', process.env.HOME || '');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.path, 'utf8');
      const data = JSON.parse(raw) as Grant[];
      for (const g of data) this.grants.set(g.id, g);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const data = [...this.grants.values()];
    await writeFile(this.path, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async create(opts: {
    service: string;
    method?: string;
    scopes?: string[];
    org?: string;
    team?: string;
    reason?: string;
    agent: string;
    principal: string;
  }): Promise<Grant> {
    await this.load();
    const grant: Grant = {
      id: `g_${randomBytes(8).toString('hex')}`,
      service: opts.service,
      method: opts.method || 'oauth',
      scopes: opts.scopes || [],
      org: opts.org,
      team: opts.team,
      reason: opts.reason,
      agent: opts.agent,
      principal: opts.principal,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    this.grants.set(grant.id, grant);
    await this.save();
    return grant;
  }

  async get(id: string): Promise<Grant | undefined> {
    await this.load();
    return this.grants.get(id);
  }

  async pending(): Promise<Grant[]> {
    await this.load();
    return [...this.grants.values()].filter(g => g.status === 'pending');
  }

  async byService(service: string): Promise<Grant | undefined> {
    await this.load();
    // Return most recent active or pending grant for this service
    return [...this.grants.values()]
      .filter(g => g.service === service && (g.status === 'active' || g.status === 'pending'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  }

  async approve(id: string, resolvedBy?: string): Promise<Grant | undefined> {
    await this.load();
    const grant = this.grants.get(id);
    if (!grant || grant.status !== 'pending') return undefined;
    grant.status = 'approved';
    grant.resolved_at = new Date().toISOString();
    grant.resolved_by = resolvedBy;
    grant.oauth_state = randomBytes(16).toString('hex');
    await this.save();
    return grant;
  }

  async activate(id: string): Promise<Grant | undefined> {
    await this.load();
    const grant = this.grants.get(id);
    if (!grant || (grant.status !== 'approved' && grant.status !== 'pending')) return undefined;
    grant.status = 'active';
    if (!grant.resolved_at) grant.resolved_at = new Date().toISOString();
    await this.save();
    return grant;
  }

  async deny(id: string, reason?: string, resolvedBy?: string): Promise<Grant | undefined> {
    await this.load();
    const grant = this.grants.get(id);
    if (!grant || grant.status !== 'pending') return undefined;
    grant.status = 'denied';
    grant.resolved_at = new Date().toISOString();
    grant.resolved_by = resolvedBy;
    grant.deny_reason = reason;
    await this.save();
    return grant;
  }

  async revoke(service: string): Promise<Grant | undefined> {
    await this.load();
    const grant = [...this.grants.values()]
      .find(g => g.service === service && g.status === 'active');
    if (!grant) return undefined;
    grant.status = 'revoked';
    grant.resolved_at = new Date().toISOString();
    await this.save();
    return grant;
  }

  async findByOAuthState(state: string): Promise<Grant | undefined> {
    await this.load();
    return [...this.grants.values()].find(g => g.oauth_state === state);
  }

  async all(): Promise<Grant[]> {
    await this.load();
    return [...this.grants.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
