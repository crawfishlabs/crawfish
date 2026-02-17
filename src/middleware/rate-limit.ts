/**
 * @fileoverview Express middleware for rate limiting using @claw/guardrails
 * @description Drop-in rate limiting middleware for any Claw app's Express router
 *
 * @example
 * ```ts
 * import { aiCoachLimiter, queryLimiter, standardLimiter } from '../middleware/rate-limit';
 *
 * router.use('/api/coach', aiCoachLimiter);
 * router.use('/api/search', queryLimiter);
 * router.use('/api', standardLimiter);
 * ```
 */

import { createRateLimiter, RATE_LIMIT_PRESETS } from '@claw/guardrails';

/** AI coach endpoints: 10 req/min per user */
export const aiCoachLimiter = createRateLimiter({
  ...RATE_LIMIT_PRESETS.AI_COACH,
  perEndpoint: true,
});

/** Query/search endpoints: 30 req/min per user */
export const queryLimiter = createRateLimiter({
  ...RATE_LIMIT_PRESETS.QUERY,
  perEndpoint: false,
});

/** Standard API endpoints: 60 req/min per user */
export const standardLimiter = createRateLimiter({
  ...RATE_LIMIT_PRESETS.STANDARD,
  perEndpoint: false,
});

/** Create a custom rate limiter for specific needs */
export { createRateLimiter, RATE_LIMIT_PRESETS } from '@claw/guardrails';
