// ============================================================================
// Append-only Audit Log — JSON Lines format
// ============================================================================

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEntry, AuditAction } from './types.js';

export class AuditLog {
  private path: string;
  private principal: string;
  private agent: string;

  constructor(opts: { path: string; principal?: string; agent?: string }) {
    this.path = opts.path.replace('~', process.env.HOME || '');
    this.principal = opts.principal || 'unknown';
    this.agent = opts.agent || 'unknown';
  }

  async log(entry: {
    action: AuditAction;
    service: string;
    outcome: 'success' | 'failure' | 'pending';
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const full: AuditEntry = {
      ts: new Date().toISOString(),
      action: entry.action,
      service: entry.service,
      principal: this.principal,
      agent: this.agent,
      outcome: entry.outcome,
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    };
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(full) + '\n', { mode: 0o600 });
  }

  async query(opts?: {
    service?: string;
    action?: AuditAction;
    since?: string; // ISO date or relative like "7d"
    limit?: number;
  }): Promise<AuditEntry[]> {
    let lines: string[];
    try {
      const raw = await readFile(this.path, 'utf8');
      lines = raw.trim().split('\n').filter(Boolean);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    let entries = lines.map(l => JSON.parse(l) as AuditEntry);

    if (opts?.service) {
      entries = entries.filter(e => e.service === opts.service);
    }
    if (opts?.action) {
      entries = entries.filter(e => e.action === opts.action);
    }
    if (opts?.since) {
      const since = this.parseSince(opts.since);
      entries = entries.filter(e => new Date(e.ts) >= since);
    }
    if (opts?.limit) {
      entries = entries.slice(-opts.limit);
    }
    return entries;
  }

  private parseSince(since: string): Date {
    const match = since.match(/^(\d+)([dhm])$/);
    if (match) {
      const n = parseInt(match[1]);
      const unit = match[2];
      const ms = unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 60000;
      return new Date(Date.now() - ms);
    }
    return new Date(since);
  }
}
