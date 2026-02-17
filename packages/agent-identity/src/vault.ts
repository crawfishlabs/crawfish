// ============================================================================
// Encrypted Credential Vault
// AES-256-GCM with per-entry IV, stored as encrypted JSON
// ============================================================================

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IVault, ServiceCredential } from './types.js';
import { AuditLog } from './audit.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT = 'crawfish-agent-identity-v1';

interface VaultData {
  version: 1;
  credentials: Record<string, string>; // service -> encrypted base64
}

export class Vault implements IVault {
  private key: Buffer;
  private path: string;
  private data: VaultData | null = null;
  private audit: AuditLog;

  constructor(opts: { vaultPath: string; audit: AuditLog; key?: Buffer }) {
    this.path = opts.vaultPath.replace('~', process.env.HOME || '');
    this.audit = opts.audit;
    this.key = opts.key || Vault.keyFromEnv();
  }

  /** Derive a 32-byte key from the CRAWFISH_VAULT_KEY env var */
  static keyFromEnv(): Buffer {
    const envKey = process.env.CRAWFISH_VAULT_KEY;
    if (!envKey) {
      throw new Error(
        'CRAWFISH_VAULT_KEY environment variable not set. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    // If it's a 64-char hex string, use directly; otherwise derive via SHA-256
    if (/^[0-9a-f]{64}$/i.test(envKey)) {
      return Buffer.from(envKey, 'hex');
    }
    return createHash('sha256').update(SALT).update(envKey).digest();
  }

  /** Generate a new random vault key (hex string) */
  static generateKey(): string {
    return randomBytes(32).toString('hex');
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: iv (12) + authTag (16) + ciphertext
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  private decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  }

  private async load(): Promise<VaultData> {
    if (this.data) return this.data;
    try {
      const raw = await readFile(this.path, 'utf8');
      this.data = JSON.parse(raw) as VaultData;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.data = { version: 1, credentials: {} };
      } else {
        throw err;
      }
    }
    return this.data!;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  async get(service: string): Promise<ServiceCredential | null> {
    const data = await this.load();
    const encrypted = data.credentials[service];
    if (!encrypted) return null;
    try {
      const cred = JSON.parse(this.decrypt(encrypted)) as ServiceCredential;
      await this.audit.log({
        action: 'credential.access',
        service,
        outcome: 'success',
      });
      return cred;
    } catch {
      await this.audit.log({
        action: 'credential.access',
        service,
        outcome: 'failure',
        metadata: { error: 'decryption failed' },
      });
      return null;
    }
  }

  async set(service: string, credential: ServiceCredential): Promise<void> {
    const data = await this.load();
    data.credentials[service] = this.encrypt(JSON.stringify(credential));
    await this.save();
    await this.audit.log({
      action: 'credential.create',
      service,
      outcome: 'success',
      metadata: { type: credential.type },
    });
  }

  async delete(service: string): Promise<boolean> {
    const data = await this.load();
    if (!(service in data.credentials)) return false;
    delete data.credentials[service];
    await this.save();
    await this.audit.log({
      action: 'credential.revoke',
      service,
      outcome: 'success',
    });
    return true;
  }

  async list(): Promise<Array<{ service: string; type: string; expires_at: string | null }>> {
    const data = await this.load();
    const results: Array<{ service: string; type: string; expires_at: string | null }> = [];
    for (const [service, encrypted] of Object.entries(data.credentials)) {
      try {
        const cred = JSON.parse(this.decrypt(encrypted)) as ServiceCredential;
        results.push({ service, type: cred.type, expires_at: cred.expires_at });
      } catch {
        results.push({ service, type: 'unknown', expires_at: null });
      }
    }
    return results;
  }

  async rotateKey(newKey: Buffer): Promise<void> {
    const data = await this.load();
    // Decrypt all with old key, re-encrypt with new key
    const decrypted: Record<string, string> = {};
    for (const [service, encrypted] of Object.entries(data.credentials)) {
      decrypted[service] = this.decrypt(encrypted);
    }
    this.key = newKey;
    for (const [service, plain] of Object.entries(decrypted)) {
      data.credentials[service] = this.encrypt(plain);
    }
    await this.save();
    await this.audit.log({
      action: 'credential.rotate',
      service: '*',
      outcome: 'success',
      metadata: { reason: 'key rotation' },
    });
  }

  /** Expose encrypt/decrypt for testing */
  _encrypt(plaintext: string): string { return this.encrypt(plaintext); }
  _decrypt(encoded: string): string { return this.decrypt(encoded); }
}
