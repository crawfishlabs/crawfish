/**
 * @fileoverview Express middleware for AI budget enforcement
 * @description Middleware that enforces per-user AI budget limits before processing requests
 */

import { Request, Response, NextFunction } from 'express';
import { checkBudget, BudgetCheckResult } from './user-budget';

/**
 * Extended Express Request with budget information
 */
export interface RequestWithBudget extends Request {
  aiBudget?: BudgetCheckResult;
  user?: {
    uid: string;
    email?: string;
    [key: string]: any;
  };
}

/**
 * Rate limiting configuration
 */
interface RateLimitConfig {
  maxCallsPerDay: number;
  maxCallsPerHour: number;
  maxCallsPerEndpointPerHour: number;
  maxCostPerCall: number;
}

/**
 * Default rate limits (can be overridden per tier)
 */
const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  maxCallsPerDay: 50,
  maxCallsPerHour: 10,
  maxCallsPerEndpointPerHour: 10,
  maxCostPerCall: 0.50,
};

/**
 * Rate limits by tier
 */
const TIER_RATE_LIMITS: Record<string, RateLimitConfig> = {
  free: {
    maxCallsPerDay: 0, // No AI calls allowed
    maxCallsPerHour: 0,
    maxCallsPerEndpointPerHour: 0,
    maxCostPerCall: 0,
  },
  pro: {
    maxCallsPerDay: 100,
    maxCallsPerHour: 20,
    maxCallsPerEndpointPerHour: 15,
    maxCostPerCall: 0.50,
  },
  pro_plus: {
    maxCallsPerDay: 300,
    maxCallsPerHour: 50,
    maxCallsPerEndpointPerHour: 30,
    maxCostPerCall: 0.50,
  },
  enterprise: {
    maxCallsPerDay: 1000,
    maxCallsPerHour: 200,
    maxCallsPerEndpointPerHour: 100,
    maxCostPerCall: 2.00,
  },
};

/**
 * In-memory cache for rate limiting (in production, use Redis)
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitCache = new Map<string, RateLimitEntry>();

/**
 * Get rate limit key for a user/endpoint/timeframe
 */
function getRateLimitKey(userId: string, endpoint: string, timeframe: 'hour' | 'day'): string {
  const now = new Date();
  let windowStart: number;
  
  if (timeframe === 'hour') {
    windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
  } else {
    windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  
  return `${userId}:${endpoint}:${timeframe}:${windowStart}`;
}

/**
 * Check and increment rate limit
 */
function checkRateLimit(userId: string, endpoint: string, timeframe: 'hour' | 'day', limit: number): boolean {
  const key = getRateLimitKey(userId, endpoint, timeframe);
  const now = Date.now();
  
  const entry = rateLimitCache.get(key);
  
  if (!entry) {
    // First request in this window
    const resetTime = timeframe === 'hour' ? now + 60 * 60 * 1000 : now + 24 * 60 * 60 * 1000;
    rateLimitCache.set(key, { count: 1, resetTime });
    return true;
  }
  
  if (now > entry.resetTime) {
    // Window expired, reset
    const resetTime = timeframe === 'hour' ? now + 60 * 60 * 1000 : now + 24 * 60 * 60 * 1000;
    rateLimitCache.set(key, { count: 1, resetTime });
    return true;
  }
  
  if (entry.count >= limit) {
    return false; // Rate limit exceeded
  }
  
  // Increment counter
  entry.count++;
  return true;
}

/**
 * Clean up expired rate limit entries (called periodically)
 */
function cleanupRateLimitCache(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitCache.entries()) {
    if (now > entry.resetTime) {
      rateLimitCache.delete(key);
    }
  }
}

// Clean up cache every 10 minutes
setInterval(cleanupRateLimitCache, 10 * 60 * 1000);

/**
 * Middleware to enforce AI budget limits
 */
export function requireAIBudget() {
  return async (req: RequestWithBudget, res: Response, next: NextFunction) => {
    try {
      // Extract user ID from request
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'User authentication required for AI features.',
        });
      }

      // Check budget status
      const budgetCheck = await checkBudget(userId);
      
      // Handle blocked users
      if (!budgetCheck.allowed) {
        const errorResponse: any = {
          error: 'ai_budget_exhausted',
          status: budgetCheck.status,
          resetAt: budgetCheck.resetAt,
          upgradeUrl: '/settings/subscription',
        };

        if (budgetCheck.status === 'blocked') {
          errorResponse.message = budgetCheck.budgetUsd === 0 
            ? 'AI features are not available on the free tier. Upgrade to Pro to start using AI coaching.'
            : "You've hit your AI limit for this month. Upgrade to Pro+ for more AI coaching.";
        } else {
          errorResponse.message = 'AI budget exhausted. Please upgrade your plan.';
        }

        return res.status(429).json(errorResponse);
      }

      // Get endpoint for rate limiting
      const endpoint = req.route?.path || req.path || 'unknown';
      
      // Determine tier for rate limits (fallback to budget tier)
      const userTier = budgetCheck.status === 'premium' || budgetCheck.status === 'degraded' 
        ? (budgetCheck.budgetUsd >= 10 ? 'pro_plus' : 'pro')
        : 'free';
      
      const rateLimits = TIER_RATE_LIMITS[userTier] || DEFAULT_RATE_LIMITS;

      // Check rate limits
      
      // 1. Daily call limit
      if (rateLimits.maxCallsPerDay > 0) {
        if (!checkRateLimit(userId, 'global', 'day', rateLimits.maxCallsPerDay)) {
          return res.status(429).json({
            error: 'rate_limit_exceeded',
            type: 'daily_calls',
            message: `Daily AI call limit of ${rateLimits.maxCallsPerDay} exceeded. Limit resets at midnight UTC.`,
            resetAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
        }
      }

      // 2. Hourly call limit
      if (rateLimits.maxCallsPerHour > 0) {
        if (!checkRateLimit(userId, 'global', 'hour', rateLimits.maxCallsPerHour)) {
          return res.status(429).json({
            error: 'rate_limit_exceeded',
            type: 'hourly_calls',
            message: `Hourly AI call limit of ${rateLimits.maxCallsPerHour} exceeded. Limit resets at the top of each hour.`,
            resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          });
        }
      }

      // 3. Per-endpoint hourly limit
      if (rateLimits.maxCallsPerEndpointPerHour > 0) {
        if (!checkRateLimit(userId, endpoint, 'hour', rateLimits.maxCallsPerEndpointPerHour)) {
          return res.status(429).json({
            error: 'rate_limit_exceeded',
            type: 'endpoint_calls',
            message: `Hourly limit for this AI feature (${rateLimits.maxCallsPerEndpointPerHour} calls) exceeded. Try a different feature or wait for the limit to reset.`,
            resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          });
        }
      }

      // 4. Estimated cost per call limit (rough estimation based on request size)
      const estimatedCost = estimateRequestCost(req);
      if (estimatedCost > rateLimits.maxCostPerCall) {
        return res.status(413).json({
          error: 'request_too_expensive',
          message: `This request is estimated to cost $${estimatedCost.toFixed(4)}, which exceeds the per-call limit of $${rateLimits.maxCostPerCall.toFixed(4)}. Please reduce the size of your request.`,
          estimatedCost,
          maxCostPerCall: rateLimits.maxCostPerCall,
        });
      }

      // Attach budget info to request for downstream routing decisions
      req.aiBudget = budgetCheck;

      next();

    } catch (error) {
      console.error('Budget middleware error:', error);
      
      // Fail-safe: allow request but log error
      res.status(500).json({
        error: 'budget_check_failed',
        message: 'Unable to verify AI budget. Please try again.',
      });
    }
  };
}

/**
 * Estimate request cost based on content size
 * This is a rough estimation for pre-flight validation
 */
function estimateRequestCost(req: Request): number {
  try {
    // Get request body size
    const bodyStr = JSON.stringify(req.body || {});
    const bodyLength = bodyStr.length;
    
    // Get query params size
    const queryStr = JSON.stringify(req.query || {});
    const queryLength = queryStr.length;
    
    // Rough token estimation (4 characters per token)
    const estimatedInputTokens = Math.ceil((bodyLength + queryLength) / 4);
    
    // Estimate output tokens (assume 500 for most requests, more for complex tasks)
    let estimatedOutputTokens = 500;
    
    // Adjust based on request type
    const path = req.path.toLowerCase();
    if (path.includes('analyze') || path.includes('coach') || path.includes('insight')) {
      estimatedOutputTokens = 1000;
    } else if (path.includes('categorize') || path.includes('quick')) {
      estimatedOutputTokens = 200;
    }
    
    // Use conservative pricing (assume medium-cost model like Sonnet)
    const inputCostPer1k = 0.003; // $3 per 1M tokens
    const outputCostPer1k = 0.015; // $15 per 1M tokens
    
    const inputCost = (estimatedInputTokens / 1000) * inputCostPer1k;
    const outputCost = (estimatedOutputTokens / 1000) * outputCostPer1k;
    
    return inputCost + outputCost;
    
  } catch (error) {
    console.warn('Error estimating request cost:', error);
    return 0.01; // Conservative fallback
  }
}

/**
 * Middleware for admin endpoints that need budget override
 */
export function requireAdminBudgetOverride() {
  return (req: RequestWithBudget, res: Response, next: NextFunction) => {
    // Check if user has admin privileges
    const userRole = req.user?.role || 'user';
    if (userRole !== 'admin' && userRole !== 'enterprise') {
      return res.status(403).json({
        error: 'insufficient_privileges',
        message: 'Admin privileges required to override budget limits.',
      });
    }

    // Skip normal budget checks for admins
    req.aiBudget = {
      allowed: true,
      status: 'premium',
      remaining: 999999,
      routingPreference: 'quality',
      resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      budgetUsd: 999999,
      spentUsd: 0,
      degradedSpendUsd: 0,
    };

    next();
  };
}

/**
 * Get current rate limit status for a user
 */
export async function getRateLimitStatus(userId: string): Promise<{
  dailyCallsUsed: number;
  dailyCallsLimit: number;
  hourlyCallsUsed: number;
  hourlyCallsLimit: number;
  resetTimes: {
    daily: string;
    hourly: string;
  };
}> {
  // Get user tier (this is simplified - in practice you'd get from the budget)
  const userTier = 'pro'; // This should come from user's actual tier
  const rateLimits = TIER_RATE_LIMITS[userTier] || DEFAULT_RATE_LIMITS;
  
  // Get current usage from cache
  const dailyKey = getRateLimitKey(userId, 'global', 'day');
  const hourlyKey = getRateLimitKey(userId, 'global', 'hour');
  
  const dailyEntry = rateLimitCache.get(dailyKey);
  const hourlyEntry = rateLimitCache.get(hourlyKey);
  
  const now = Date.now();
  const dailyCallsUsed = dailyEntry && now <= dailyEntry.resetTime ? dailyEntry.count : 0;
  const hourlyCallsUsed = hourlyEntry && now <= hourlyEntry.resetTime ? hourlyEntry.count : 0;
  
  // Calculate reset times
  const nextHour = new Date();
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  
  const nextDay = new Date();
  nextDay.setDate(nextDay.getDate() + 1);
  nextDay.setHours(0, 0, 0, 0);
  
  return {
    dailyCallsUsed,
    dailyCallsLimit: rateLimits.maxCallsPerDay,
    hourlyCallsUsed,
    hourlyCallsLimit: rateLimits.maxCallsPerHour,
    resetTimes: {
      daily: nextDay.toISOString(),
      hourly: nextHour.toISOString(),
    },
  };
}