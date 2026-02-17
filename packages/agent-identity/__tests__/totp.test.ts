import { describe, it, expect } from 'vitest';
import { generateTOTP, base32Encode, base32Decode } from '../src/totp.js';

describe('Base32', () => {
  it('should encode and decode roundtrip', () => {
    const original = Buffer.from('Hello, World!');
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded.toString()).toBe('Hello, World!');
  });

  it('should encode known value', () => {
    // "12345678901234567890" is the RFC 6238 test secret
    const encoded = base32Encode(Buffer.from('12345678901234567890'));
    expect(encoded).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('should decode known value', () => {
    const decoded = base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(decoded.toString()).toBe('12345678901234567890');
  });
});

describe('TOTP - RFC 6238 Test Vectors', () => {
  // RFC 6238 Appendix B test vectors (SHA1)
  // Secret: "12345678901234567890" (ASCII) = 0x31323334...
  const secret = Buffer.from('12345678901234567890');

  // Test vectors from RFC 6238:
  // Time (sec)     | TOTP (SHA1)
  // 59             | 94287082
  // 1111111109     | 07081804
  // 1111111111     | 14050471
  // 1234567890     | 89005924
  // 2000000000     | 69279037
  // 20000000000    | 65353130

  // These use 8-digit codes and 30-second period
  const vectors = [
    { time: 59, expected: '94287082' },
    { time: 1111111109, expected: '07081804' },
    { time: 1111111111, expected: '14050471' },
    { time: 1234567890, expected: '89005924' },
    { time: 2000000000, expected: '69279037' },
    { time: 20000000000, expected: '65353130' },
  ];

  for (const { time, expected } of vectors) {
    it(`should generate correct 8-digit code at time=${time}`, () => {
      const code = generateTOTP(secret, time, { digits: 8, period: 30, algorithm: 'sha1' });
      expect(code).toBe(expected);
    });
  }

  it('should generate 6-digit codes by default', () => {
    const code = generateTOTP(secret, 59, { digits: 6, period: 30 });
    expect(code).toHaveLength(6);
    // Last 6 digits of 94287082 = 287082
    expect(code).toBe('287082');
  });

  it('should pad short codes with leading zeros', () => {
    // At time 1111111109, 8-digit code is 07081804
    // 6-digit should be 081804
    const code = generateTOTP(secret, 1111111109, { digits: 6, period: 30 });
    expect(code).toBe('081804');
    expect(code).toHaveLength(6);
  });
});

describe('TOTP - SHA256 and SHA512', () => {
  // RFC 6238 also defines test vectors for SHA256 and SHA512
  // SHA256 secret: "12345678901234567890123456789012" (32 bytes)
  // SHA512 secret: "1234567890123456789012345678901234567890123456789012345678901234" (64 bytes)

  it('should generate SHA256 TOTP', () => {
    const secret256 = Buffer.from('12345678901234567890123456789012');
    const code = generateTOTP(secret256, 59, { digits: 8, period: 30, algorithm: 'sha256' });
    expect(code).toBe('46119246');
  });

  it('should generate SHA512 TOTP', () => {
    const secret512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');
    const code = generateTOTP(secret512, 59, { digits: 8, period: 30, algorithm: 'sha512' });
    expect(code).toBe('90693936');
  });
});
