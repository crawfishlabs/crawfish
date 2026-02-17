/**
 * Audit Chain — Append-only, tamper-evident audit log with HMAC hash chain.
 *
 * Each entry includes an HMAC-SHA256 of the previous entry, creating a
 * verifiable chain. Any insertion, deletion, or modification breaks the chain.
 */

import { createHmac, randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'credential.create' | 'credential.access' | 'credential.rotate'
  | 'credential.revoke' | 'credential.delete' | 'credential.access.denied'
  | 'grant.request' | 'grant.approve' | 'grant.deny'
  | 'grant.expire' | 'grant.revoke'
  | 'auth.login' | 'auth.login.failed' | 'auth.logout' | 'auth.2fa.challenge'
  | 'agent.lockout' | 'agent.suspend'
  | 'vault.key.rotate' | 'vault.migration'
  | 'scope.escalation.attempt'
  | 'system.integrity.check';

export interface AuditEntry {
  id: string;
  timestamp: string;
  previousHash: string;

  principalId: string;
  agentId?: string;
  sourceIp: string;
  userAgent: string;

  action: AuditAction;
  service: string;
  scopes?: string[];
  resourceId?: string;

  outcome: 'success' | 'denied' | 'error';
  errorCode?: string;
  errorMessage?: string;

  requestId: string;
  metadata?: Record<string, string>;
}

export interface AuditFilter {
  startDate?: string;
  endDate?: string;
  action?: AuditAction;
  service?: string;
  principalId?: string;
  agentId?: string;
  outcome?: 'success' | 'denied' | 'error';
}

export interface VerificationResult {
  valid: boolean;
  brokenAt?: number;
  totalEntries: number;
}

// ─── Storage Adapter Interface ───────────────────────────────────────────────

export interface AuditStorageAdapter {
  /** Append a serialized entry (JSON line) to storage */
  append(line: string): Promise<void>;
  /** Read all lines from storage */
  readAll(): Promise<string[]>;
  /** Read entries count */
  count(): Promise<number>;
}

// ─── File Storage Adapter ────────────────────────────────────────────────────

import { appendFile, readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';

export class FileStorageAdapter implements AuditStorageAdapter {
  constructor(private filePath: string) {}

  async append(line: string): Promise<void> {
    await appendFile(this.filePath, line + '\n', { mode: 0o600 });
  }

  async readAll(): Promise<string[]> {
    try {
      await access(this.filePath, constants.F_OK);
    } catch {
      return [];
    }
    const content = await readFile(this.filePath, 'utf-8');
    return content.trim().split('\n').filter(Boolean);
  }

  async count(): Promise<number> {
    const lines = await this.readAll();
    return lines.length;
  }
}

// ─── Audit Chain ─────────────────────────────────────────────────────────────

const GENESIS_MARKER = 'GENESIS';

export class AuditChain {
  private hmacKey: string;
  private storage: AuditStorageAdapter;
  private lastHash: string | null = null;

  constructor(hmacKey: string, storage: AuditStorageAdapter) {
    this.hmacKey = hmacKey;
    this.storage = storage;
  }

  /**
   * Compute HMAC-SHA256 of a string using the chain's key.
   */
  private computeHmac(data: string): string {
    return createHmac('sha256', this.hmacKey).update(data).digest('hex');
  }

  /**
   * Generate the genesis hash (used for the first entry).
   */
  private genesisHash(): string {
    return this.computeHmac(GENESIS_MARKER);
  }

  /**
   * Initialize the chain by loading the last hash from storage.
   */
  async initialize(): Promise<void> {
    const lines = await this.storage.readAll();
    if (lines.length === 0) {
      this.lastHash = null;
    } else {
      const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
      this.lastHash = this.computeHmac(lines[lines.length - 1]);
    }
  }

  /**
   * Append an entry to the audit log. Computes the chain hash automatically.
   * The entry's `id`, `timestamp`, and `previousHash` are set by this method.
   */
  async append(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash'>): Promise<AuditEntry> {
    const previousHash = this.lastHash ?? this.genesisHash();

    const fullEntry: AuditEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      previousHash,
    };

    const serialized = JSON.stringify(fullEntry);
    await this.storage.append(serialized);
    this.lastHash = this.computeHmac(serialized);

    return fullEntry;
  }

  /**
   * Verify the integrity of the entire audit chain.
   * Returns { valid: true } if intact, or { valid: false, brokenAt: index }
   * indicating where the chain breaks.
   */
  async verify(): Promise<VerificationResult> {
    const lines = await this.storage.readAll();

    if (lines.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    // Verify first entry has genesis hash
    const firstEntry = JSON.parse(lines[0]) as AuditEntry;
    if (firstEntry.previousHash !== this.genesisHash()) {
      return { valid: false, brokenAt: 0, totalEntries: lines.length };
    }

    // Verify chain
    for (let i = 1; i < lines.length; i++) {
      const expectedHash = this.computeHmac(lines[i - 1]);
      const entry = JSON.parse(lines[i]) as AuditEntry;

      if (entry.previousHash !== expectedHash) {
        return { valid: false, brokenAt: i, totalEntries: lines.length };
      }
    }

    return { valid: true, totalEntries: lines.length };
  }

  /**
   * Query audit entries with filters.
   */
  async query(filters: AuditFilter = {}): Promise<AuditEntry[]> {
    const lines = await this.storage.readAll();
    let entries = lines.map(line => JSON.parse(line) as AuditEntry);

    if (filters.startDate) {
      entries = entries.filter(e => e.timestamp >= filters.startDate!);
    }
    if (filters.endDate) {
      entries = entries.filter(e => e.timestamp <= filters.endDate!);
    }
    if (filters.action) {
      entries = entries.filter(e => e.action === filters.action);
    }
    if (filters.service) {
      entries = entries.filter(e => e.service === filters.service);
    }
    if (filters.principalId) {
      entries = entries.filter(e => e.principalId === filters.principalId);
    }
    if (filters.agentId) {
      entries = entries.filter(e => e.agentId === filters.agentId);
    }
    if (filters.outcome) {
      entries = entries.filter(e => e.outcome === filters.outcome);
    }

    return entries;
  }
}
