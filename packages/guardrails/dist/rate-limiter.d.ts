/**
 * @fileoverview Rate limiting middleware for Claw apps
 * @description Per-user, per-endpoint sliding window rate limiter with Redis-compatible backing
 */
import { Request, RequestHandler } from 'express';
export interface RateLimitConfig {
    /** Max requests per window */
    maxRequests: number;
    /** Window size in milliseconds */
    windowMs: number;
    /** Allow burst above maxRequests (extra requests allowed in burst) */
    burstAllowance?: number;
    /** Key extractor — defaults to user ID from req */
    keyExtractor?: (req: Request) => string;
    /** Optional store (defaults to in-memory) */
    store?: RateLimitStore;
    /** Whether to include endpoint in the key */
    perEndpoint?: boolean;
}
export interface RateLimitStore {
    /** Record a hit and return { count, resetMs } */
    hit(key: string, windowMs: number): Promise<{
        count: number;
        resetMs: number;
    }>;
    /** Reset a key */
    reset(key: string): Promise<void>;
}
export interface RateLimitInfo {
    limit: number;
    remaining: number;
    resetMs: number;
}
export declare const RATE_LIMIT_PRESETS: {
    /** AI coach endpoints: 10 req/min */
    readonly AI_COACH: RateLimitConfig;
    /** Query/search endpoints: 30 req/min */
    readonly QUERY: RateLimitConfig;
    /** Standard API endpoints: 60 req/min */
    readonly STANDARD: RateLimitConfig;
};
export declare class InMemoryRateLimitStore implements RateLimitStore {
    private entries;
    private cleanupInterval;
    constructor();
    hit(key: string, windowMs: number): Promise<{
        count: number;
        resetMs: number;
    }>;
    reset(key: string): Promise<void>;
    destroy(): void;
    private cleanup;
}
/**
 * Create an Express rate limiting middleware
 *
 * @example
 * ```ts
 * import { createRateLimiter, RATE_LIMIT_PRESETS } from '@claw/guardrails';
 * router.use('/api/coach', createRateLimiter(RATE_LIMIT_PRESETS.AI_COACH));
 * ```
 */
export declare function createRateLimiter(config: RateLimitConfig): RequestHandler;
