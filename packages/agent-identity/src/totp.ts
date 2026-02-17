// ============================================================================
// TOTP Authenticator — RFC 6238 implementation using node:crypto
// ============================================================================

import { createHmac, randomBytes } from 'node:crypto';
import type { TOTPSeed, ServiceCredential } from './types.js';
import type { Vault } from './vault.js';

// Base32 encoding/decoding (RFC 4648)
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/[=\s]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generate a TOTP code per RFC 6238
 * @param secret - raw secret bytes
 * @param time - Unix timestamp in seconds (defaults to now)
 * @param opts - algorithm, digits, period
 */
export function generateTOTP(
  secret: Buffer,
  time?: number,
  opts?: { algorithm?: string; digits?: number; period?: number }
): string {
  const period = opts?.period || 30;
  const digits = opts?.digits || 6;
  const algorithm = opts?.algorithm || 'sha1';

  const counter = Math.floor((time ?? Math.floor(Date.now() / 1000)) / period);

  // Counter as 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  // HMAC
  const hmac = createHmac(algorithm, secret);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

export class TOTPManager {
  private vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /** Generate a new TOTP seed for a service */
  async generateSeed(
    service: string,
    opts?: { issuer?: string; account?: string }
  ): Promise<{ seed: TOTPSeed; uri: string }> {
    const secretBytes = randomBytes(20);
    const secret = base32Encode(secretBytes);

    const seed: TOTPSeed = {
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      issuer: opts?.issuer || service,
      account: opts?.account,
    };

    // Store in vault
    const credential: ServiceCredential = {
      service: `totp:${service}`,
      type: 'totp-seed',
      created_at: new Date().toISOString(),
      expires_at: null,
      data: seed,
    };
    await this.vault.set(`totp:${service}`, credential);

    // Generate otpauth URI (for QR codes)
    const issuer = encodeURIComponent(seed.issuer || service);
    const account = encodeURIComponent(seed.account || service);
    const uri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=${seed.algorithm}&digits=${seed.digits}&period=${seed.period}`;

    return { seed, uri };
  }

  /** Store an existing TOTP seed (e.g., from a service's 2FA setup) */
  async storeSeed(service: string, secret: string, opts?: Partial<TOTPSeed>): Promise<void> {
    const seed: TOTPSeed = {
      secret: secret.replace(/\s/g, '').toUpperCase(),
      algorithm: opts?.algorithm || 'SHA1',
      digits: opts?.digits || 6,
      period: opts?.period || 30,
      issuer: opts?.issuer || service,
      account: opts?.account,
    };
    const credential: ServiceCredential = {
      service: `totp:${service}`,
      type: 'totp-seed',
      created_at: new Date().toISOString(),
      expires_at: null,
      data: seed,
    };
    await this.vault.set(`totp:${service}`, credential);
  }

  /** Get the current TOTP code for a service */
  async getCode(service: string): Promise<string> {
    const cred = await this.vault.get(`totp:${service}`);
    if (!cred) throw new Error(`No TOTP seed found for service: ${service}`);
    const seed = cred.data as TOTPSeed;
    const secretBytes = base32Decode(seed.secret);
    return generateTOTP(secretBytes, undefined, {
      algorithm: seed.algorithm.toLowerCase(),
      digits: seed.digits,
      period: seed.period,
    });
  }
}
