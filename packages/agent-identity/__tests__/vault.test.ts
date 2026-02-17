import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Vault } from '../src/vault.js';
import { AuditLog } from '../src/audit.js';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ServiceCredential } from '../src/types.js';

describe('Vault', () => {
  let tempDir: string;
  let vault: Vault;
  let audit: AuditLog;
  const testKey = randomBytes(32);

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vault-test-'));
    audit = new AuditLog({
      path: join(tempDir, 'audit.jsonl'),
      principal: 'test-user',
      agent: 'test-agent',
    });
    vault = new Vault({
      vaultPath: join(tempDir, 'vault.enc'),
      audit,
      key: testKey,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const makeCred = (service: string): ServiceCredential => ({
    service,
    type: 'oauth',
    created_at: new Date().toISOString(),
    expires_at: null,
    data: { access_token: `token-${service}`, token_type: 'bearer', scope: 'repo' },
  });

  it('should encrypt and decrypt a credential roundtrip', async () => {
    const cred = makeCred('github');
    await vault.set('github', cred);
    const retrieved = await vault.get('github');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.service).toBe('github');
    expect((retrieved!.data as any).access_token).toBe('token-github');
  });

  it('should return null for missing credential', async () => {
    const result = await vault.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should list all stored credentials', async () => {
    await vault.set('github', makeCred('github'));
    await vault.set('vercel', makeCred('vercel'));
    const list = await vault.list();
    expect(list).toHaveLength(2);
    expect(list.map(l => l.service).sort()).toEqual(['github', 'vercel']);
  });

  it('should delete a credential', async () => {
    await vault.set('github', makeCred('github'));
    const deleted = await vault.delete('github');
    expect(deleted).toBe(true);
    const result = await vault.get('github');
    expect(result).toBeNull();
  });

  it('should return false when deleting nonexistent credential', async () => {
    const deleted = await vault.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('should fail to decrypt with wrong key', async () => {
    await vault.set('github', makeCred('github'));

    const wrongVault = new Vault({
      vaultPath: join(tempDir, 'vault.enc'),
      audit,
      key: randomBytes(32),
    });
    const result = await wrongVault.get('github');
    expect(result).toBeNull(); // Decryption failure returns null
  });

  it('should rotate the encryption key', async () => {
    await vault.set('github', makeCred('github'));
    await vault.set('vercel', makeCred('vercel'));

    const newKey = randomBytes(32);
    await vault.rotateKey(newKey);

    // Old vault instance (with new key after rotation) should still work
    const github = await vault.get('github');
    expect(github).not.toBeNull();
    expect((github!.data as any).access_token).toBe('token-github');

    // New vault instance with new key should work
    const newVault = new Vault({
      vaultPath: join(tempDir, 'vault.enc'),
      audit,
      key: newKey,
    });
    const vercel = await newVault.get('vercel');
    expect(vercel).not.toBeNull();
    expect((vercel!.data as any).access_token).toBe('token-vercel');
  });

  it('should write audit entries on mutations', async () => {
    await vault.set('github', makeCred('github'));
    await vault.get('github');
    await vault.delete('github');

    const entries = await audit.query();
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const actions = entries.map(e => e.action);
    expect(actions).toContain('credential.create');
    expect(actions).toContain('credential.access');
    expect(actions).toContain('credential.revoke');
  });

  it('should encrypt/decrypt raw strings correctly', () => {
    const plaintext = 'hello world — this is a test with unicode: 🔐';
    const encrypted = vault._encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = vault._decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same input';
    const a = vault._encrypt(plaintext);
    const b = vault._encrypt(plaintext);
    expect(a).not.toBe(b); // Different IVs → different output
    expect(vault._decrypt(a)).toBe(plaintext);
    expect(vault._decrypt(b)).toBe(plaintext);
  });
});
