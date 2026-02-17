import { AuditChain, FileStorageAdapter, AuditStorageAdapter, AuditEntry } from '../../src/security/audit-chain';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_HMAC_KEY = 'test-hmac-key-for-audit-chain';

function makeEntry(overrides: Partial<AuditEntry> = {}) {
  return {
    principalId: 'principal-1',
    agentId: 'agent-1',
    sourceIp: '127.0.0.1',
    userAgent: 'test-agent/1.0',
    action: 'credential.access' as const,
    service: 'github',
    outcome: 'success' as const,
    requestId: 'req-001',
    ...overrides,
  };
}

describe('AuditChain', () => {
  let tmpDir: string;
  let filePath: string;
  let storage: FileStorageAdapter;
  let chain: AuditChain;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'audit-test-'));
    filePath = join(tmpDir, 'audit.jsonl');
    storage = new FileStorageAdapter(filePath);
    chain = new AuditChain(TEST_HMAC_KEY, storage);
    await chain.initialize();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('appends entries with chain hashes', async () => {
    const entry1 = await chain.append(makeEntry());
    const entry2 = await chain.append(makeEntry({ service: 'plaid' }));

    expect(entry1.id).toBeDefined();
    expect(entry1.timestamp).toBeDefined();
    expect(entry1.previousHash).toBeDefined();
    expect(entry2.previousHash).not.toBe(entry1.previousHash);
  });

  it('verifies an intact chain', async () => {
    await chain.append(makeEntry());
    await chain.append(makeEntry({ action: 'grant.approve' }));
    await chain.append(makeEntry({ action: 'credential.rotate' }));

    const result = await chain.verify();
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(3);
  });

  it('detects tampered entries', async () => {
    await chain.append(makeEntry());
    await chain.append(makeEntry({ action: 'grant.approve' }));
    await chain.append(makeEntry({ action: 'credential.rotate' }));

    // Tamper with the second entry
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const entry = JSON.parse(lines[1]);
    entry.action = 'credential.delete'; // tamper
    lines[1] = JSON.stringify(entry);
    const { writeFile: wf } = await import('fs/promises');
    await wf(filePath, lines.join('\n') + '\n');

    // Create fresh chain to verify (re-reads from storage)
    const verifyChain = new AuditChain(TEST_HMAC_KEY, storage);
    await verifyChain.initialize();
    const result = await verifyChain.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2); // entry after tampered one detects mismatch
  });

  it('detects deleted entries', async () => {
    await chain.append(makeEntry());
    await chain.append(makeEntry({ action: 'grant.approve' }));
    await chain.append(makeEntry({ action: 'credential.rotate' }));

    // Delete the second entry
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    lines.splice(1, 1); // remove second entry
    const { writeFile: wf } = await import('fs/promises');
    await wf(filePath, lines.join('\n') + '\n');

    const verifyChain = new AuditChain(TEST_HMAC_KEY, storage);
    await verifyChain.initialize();
    const result = await verifyChain.verify();
    expect(result.valid).toBe(false);
  });

  it('verifies empty chain as valid', async () => {
    const result = await chain.verify();
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(0);
  });

  describe('query()', () => {
    beforeEach(async () => {
      await chain.append(makeEntry({ service: 'github', action: 'credential.access', outcome: 'success' }));
      await chain.append(makeEntry({ service: 'plaid', action: 'grant.request', outcome: 'denied' }));
      await chain.append(makeEntry({ service: 'github', action: 'credential.rotate', outcome: 'success', agentId: 'agent-2' }));
    });

    it('queries all entries', async () => {
      const results = await chain.query();
      expect(results).toHaveLength(3);
    });

    it('filters by service', async () => {
      const results = await chain.query({ service: 'github' });
      expect(results).toHaveLength(2);
    });

    it('filters by action', async () => {
      const results = await chain.query({ action: 'grant.request' });
      expect(results).toHaveLength(1);
      expect(results[0].service).toBe('plaid');
    });

    it('filters by outcome', async () => {
      const results = await chain.query({ outcome: 'denied' });
      expect(results).toHaveLength(1);
    });

    it('filters by agentId', async () => {
      const results = await chain.query({ agentId: 'agent-2' });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('credential.rotate');
    });
  });
});
