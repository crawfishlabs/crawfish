import { scrub, scrubObject } from '../../src/security/pii-scrubber';

describe('PII Scrubber', () => {
  describe('scrub()', () => {
    it('redacts AWS access keys', () => {
      expect(scrub('key is AKIAIOSFODNN7EXAMPLE')).toBe('key is [REDACTED]');
    });

    it('redacts GitHub PATs', () => {
      expect(scrub('token: ghp_ABCDEFghijklmnopqrstuvwxyz1234567890')).toBe('token: [REDACTED]');
      expect(scrub('token: gho_ABCDEFghijklmnopqrstuvwxyz1234567890')).toBe('token: [REDACTED]');
      expect(scrub('token: ghs_ABCDEFghijklmnopqrstuvwxyz1234567890')).toBe('token: [REDACTED]');
    });

    it('redacts Plaid access tokens', () => {
      expect(scrub('access-sandbox-de3ce8ef-33f8-452c-a685-8671031fc0f6')).toBe('[REDACTED]');
      expect(scrub('access-production-de3ce8ef-33f8-452c-a685-8671031fc0f6')).toBe('[REDACTED]');
    });

    it('redacts Bearer tokens', () => {
      expect(scrub('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig')).toContain('[REDACTED]');
    });

    it('redacts SSNs', () => {
      expect(scrub('SSN: 123-45-6789')).toBe('SSN: [REDACTED]');
    });

    it('redacts email addresses', () => {
      expect(scrub('contact sam@example.com now')).toBe('contact [REDACTED] now');
    });

    it('redacts phone numbers', () => {
      expect(scrub('call 555-123-4567')).toBe('call [REDACTED]');
      expect(scrub('call (555) 123-4567')).toBe('call [REDACTED]');
      expect(scrub('call +1-555-123-4567')).toBe('call [REDACTED]');
    });

    it('redacts api_key= patterns', () => {
      expect(scrub('api_key=sk_live_abc123def456')).toBe('[REDACTED]');
    });

    it('does not redact safe strings', () => {
      expect(scrub('hello world')).toBe('hello world');
      expect(scrub('credential.access')).toBe('credential.access');
    });

    it('handles non-string input gracefully', () => {
      expect(scrub(null as any)).toBe(null);
      expect(scrub(undefined as any)).toBe(undefined);
      expect(scrub(42 as any)).toBe(42);
    });
  });

  describe('scrubObject()', () => {
    it('redacts sensitive key values entirely', () => {
      const obj = { user: 'sam', password: 'super-secret', token: 'abc123' };
      const result = scrubObject(obj);
      expect(result.user).toBe('sam');
      expect(result.password).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
    });

    it('scrubs PII patterns in non-sensitive keys', () => {
      const obj = { message: 'User email is sam@example.com' };
      const result = scrubObject(obj);
      expect(result.message).toBe('User email is [REDACTED]');
    });

    it('deep-scrubs nested objects', () => {
      const obj = {
        data: {
          credentials: {
            apiKey: 'secret-key-123',
          },
          info: 'SSN: 123-45-6789',
        },
      };
      const result = scrubObject(obj);
      expect(result.data.credentials.apiKey).toBe('[REDACTED]');
      expect(result.data.info).toBe('SSN: [REDACTED]');
    });

    it('scrubs arrays', () => {
      const arr = ['safe', 'email: sam@test.com', { token: 'abc' }];
      const result = scrubObject(arr);
      expect(result[0]).toBe('safe');
      expect(result[1]).toContain('[REDACTED]');
      expect(result[2].token).toBe('[REDACTED]');
    });

    it('does not mutate original object', () => {
      const obj = { password: 'secret' };
      scrubObject(obj);
      expect(obj.password).toBe('secret');
    });

    it('handles null and undefined', () => {
      expect(scrubObject(null)).toBe(null);
      expect(scrubObject(undefined)).toBe(undefined);
    });
  });
});
