/**
 * PII Scrubber — Detects and redacts personally identifiable information
 * and credentials from strings and objects.
 *
 * Used as:
 * 1. Direct utility: scrub(text), scrubObject(obj)
 * 2. Express middleware: piiScrubberMiddleware()
 */

import type { Request, Response, NextFunction } from 'express';

const REDACTED = '[REDACTED]';

/**
 * Ordered list of PII patterns. More specific patterns first to avoid
 * partial matches by broader patterns.
 */
const PII_PATTERNS: { name: string; pattern: RegExp }[] = [
  // AWS Access Keys (AKIA...)
  { name: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },

  // GitHub tokens (ghp_, gho_, ghs_, ghr_, github_pat_)
  { name: 'github-token', pattern: /\b(ghp_|gho_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{16,255}\b/g },

  // Plaid access tokens
  { name: 'plaid-token', pattern: /\baccess-(sandbox|development|production)-[a-f0-9-]{36}\b/g },

  // Generic Bearer tokens in header format
  { name: 'bearer-token', pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g },

  // JWTs (three base64url segments separated by dots)
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },

  // Generic API key patterns (key=..., api_key=..., apikey=...)
  { name: 'api-key-param', pattern: /(?:api[_-]?key|secret|token|password|passwd|authorization)\s*[=:]\s*['"]?[A-Za-z0-9\-._~+/]{8,}['"]?/gi },

  // SSNs (XXX-XX-XXXX)
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },

  // Credit card numbers (13-19 digits, with optional separators)
  { name: 'credit-card', pattern: /\b(?:\d[ -]*?){13,19}\b/g },

  // Phone numbers (various formats, including (555) 123-4567)
  { name: 'phone', pattern: /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },

  // Email addresses
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
];

// Sensitive object keys — values of these keys are always redacted
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token', 'apiKey', 'api_key', 'apikey',
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
  'private_key', 'privateKey', 'totpSeed', 'totp_seed',
  'client_secret', 'clientSecret',
]);

/**
 * Scrub PII from a string. Returns the string with all detected PII
 * replaced with [REDACTED].
 */
export function scrub(text: string): string {
  if (typeof text !== 'string') return text;

  let result = text;
  for (const { pattern } of PII_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/**
 * Deep-scrub an object. Recursively traverses and:
 * 1. Redacts values of sensitive keys entirely
 * 2. Scrubs string values for PII patterns
 * 3. Returns a new object (does not mutate input)
 */
export function scrubObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return scrub(obj);
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => scrubObject(item));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = REDACTED;
    } else if (typeof value === 'string') {
      result[key] = scrub(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = scrubObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Express middleware that scrubs PII from response bodies.
 * Wraps res.json() and res.send() to scrub output before sending.
 */
export function piiScrubberMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = function (body: any) {
      return originalJson(scrubObject(body));
    };

    res.send = function (body: any) {
      if (typeof body === 'string') {
        return originalSend(scrub(body));
      }
      if (typeof body === 'object') {
        return originalSend(scrubObject(body));
      }
      return originalSend(body);
    };

    next();
  };
}
