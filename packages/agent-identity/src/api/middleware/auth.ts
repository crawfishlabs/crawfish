// ============================================================================
// Authentication Middleware
// ============================================================================

import type { Context, Next } from 'hono';

/**
 * Agent auth: Bearer token in Authorization header.
 * Token is set during init and stored in agent config.
 */
export function agentAuth(expectedToken: string) {
  return async (c: Context, next: Next) => {
    const auth = c.req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing Authorization: Bearer <token>' }, 401);
    }
    const token = auth.slice(7);
    if (token !== expectedToken) {
      return c.json({ error: 'Invalid agent token' }, 403);
    }
    c.set('actor', 'agent');
    await next();
  };
}

/**
 * Human auth: simple token-based for MVP.
 * Production: session cookies, magic links, or OAuth.
 */
export function humanAuth(expectedToken: string) {
  return async (c: Context, next: Next) => {
    // Check cookie first
    const cookie = c.req.header('Cookie');
    const sessionToken = cookie?.match(/session=([^;]+)/)?.[1];

    // Then check Authorization header
    const auth = c.req.header('Authorization');
    const bearerToken = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;

    const token = sessionToken || bearerToken;
    if (!token || token !== expectedToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('actor', 'human');
    await next();
  };
}

/**
 * Combined auth: accepts either agent or human token.
 * Sets c.get('actor') to 'agent' or 'human'.
 */
export function combinedAuth(agentToken: string, humanToken: string) {
  return async (c: Context, next: Next) => {
    const auth = c.req.header('Authorization');
    const bearerToken = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const cookie = c.req.header('Cookie');
    const sessionToken = cookie?.match(/session=([^;]+)/)?.[1];

    const token = bearerToken || sessionToken;

    if (token === agentToken) {
      c.set('actor', 'agent');
    } else if (token === humanToken) {
      c.set('actor', 'human');
    } else {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
