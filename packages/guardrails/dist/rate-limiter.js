"use strict";
/**
 * @fileoverview Rate limiting middleware for Claw apps
 * @description Per-user, per-endpoint sliding window rate limiter with Redis-compatible backing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryRateLimitStore = exports.RATE_LIMIT_PRESETS = void 0;
exports.createRateLimiter = createRateLimiter;
// ── Presets ─────────────────────────────────────────────────────────────
exports.RATE_LIMIT_PRESETS = {
    /** AI coach endpoints: 10 req/min */
    AI_COACH: { maxRequests: 10, windowMs: 60000 },
    /** Query/search endpoints: 30 req/min */
    QUERY: { maxRequests: 30, windowMs: 60000 },
    /** Standard API endpoints: 60 req/min */
    STANDARD: { maxRequests: 60, windowMs: 60000 },
};
class InMemoryRateLimitStore {
    constructor() {
        this.entries = new Map();
        // Clean up expired entries every 60s
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
        // Prevent keeping the process alive
        if (this.cleanupInterval.unref)
            this.cleanupInterval.unref();
    }
    async hit(key, windowMs) {
        const now = Date.now();
        const windowStart = now - windowMs;
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { timestamps: [] };
            this.entries.set(key, entry);
        }
        // Remove timestamps outside the window (sliding window)
        entry.timestamps = entry.timestamps.filter(t => t > windowStart);
        // Add current request
        entry.timestamps.push(now);
        const oldestInWindow = entry.timestamps[0] || now;
        const resetMs = oldestInWindow + windowMs - now;
        return { count: entry.timestamps.length, resetMs: Math.max(resetMs, 0) };
    }
    async reset(key) {
        this.entries.delete(key);
    }
    destroy() {
        clearInterval(this.cleanupInterval);
        this.entries.clear();
    }
    cleanup() {
        const now = Date.now();
        // Remove entries with no recent activity (5 min stale)
        for (const [key, entry] of this.entries) {
            const latest = entry.timestamps[entry.timestamps.length - 1] || 0;
            if (now - latest > 300000) {
                this.entries.delete(key);
            }
        }
    }
}
exports.InMemoryRateLimitStore = InMemoryRateLimitStore;
// ── Default key extractor ──────────────────────────────────────────────
function defaultKeyExtractor(req) {
    // Try common auth patterns
    const user = req.user;
    if (user?.uid)
        return user.uid;
    if (user?.id)
        return user.id;
    // Fall back to IP
    return req.ip || req.socket.remoteAddress || 'unknown';
}
// ── Middleware Factory ──────────────────────────────────────────────────
/**
 * Create an Express rate limiting middleware
 *
 * @example
 * ```ts
 * import { createRateLimiter, RATE_LIMIT_PRESETS } from '@claw/guardrails';
 * router.use('/api/coach', createRateLimiter(RATE_LIMIT_PRESETS.AI_COACH));
 * ```
 */
function createRateLimiter(config) {
    const store = config.store || new InMemoryRateLimitStore();
    const keyExtractor = config.keyExtractor || defaultKeyExtractor;
    const effectiveMax = config.maxRequests + (config.burstAllowance || 0);
    return async (req, res, next) => {
        try {
            let key = keyExtractor(req);
            if (config.perEndpoint) {
                key = `${key}:${req.method}:${req.baseUrl}${req.path}`;
            }
            const { count, resetMs } = await store.hit(key, config.windowMs);
            const remaining = Math.max(effectiveMax - count, 0);
            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', String(effectiveMax));
            res.setHeader('X-RateLimit-Remaining', String(remaining));
            res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + resetMs) / 1000)));
            if (count > effectiveMax) {
                const retryAfterSec = Math.ceil(resetMs / 1000);
                res.setHeader('Retry-After', String(retryAfterSec));
                res.status(429).json({
                    error: 'Too Many Requests',
                    message: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`,
                    retryAfter: retryAfterSec,
                });
                return;
            }
            next();
        }
        catch (err) {
            // On store failure, allow the request through (fail-open)
            console.error('[rate-limiter] Store error, failing open:', err);
            next();
        }
    };
}
