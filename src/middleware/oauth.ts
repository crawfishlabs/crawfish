/**
 * OAuth 2.0 Middleware for Claw Platform
 * Validates Firebase Auth JWT tokens and enforces OAuth 2.0 scopes
 */

import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken, getAuth } from 'firebase-admin/auth';
import { RateLimiterMemory } from 'rate-limiter-flexible';

// Define OAuth 2.0 scopes
export enum OAuthScope {
  READ = 'read',
  WRITE = 'write', 
  ADMIN = 'admin'
}

// Subscription tiers
export enum SubscriptionTier {
  FREE = 'free',
  PRO = 'pro',
  ENTERPRISE = 'enterprise'
}

// Extended request interface
export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email: string;
    tier: SubscriptionTier;
    scopes: OAuthScope[];
    clientId?: string;
  };
}

// Rate limiter configurations per tier
const rateLimiters = {
  [SubscriptionTier.FREE]: new RateLimiterMemory({
    keyPrefix: 'oauth_free',
    points: 100, // requests
    duration: 60, // per 60 seconds
  }),
  [SubscriptionTier.PRO]: new RateLimiterMemory({
    keyPrefix: 'oauth_pro', 
    points: 1000, // requests
    duration: 60, // per 60 seconds
  }),
  [SubscriptionTier.ENTERPRISE]: new RateLimiterMemory({
    keyPrefix: 'oauth_enterprise',
    points: 10000, // requests
    duration: 60, // per 60 seconds
  }),
};

// API key rate limiter (for server-to-server)
const apiKeyLimiter = new RateLimiterMemory({
  keyPrefix: 'api_key',
  points: 5000,
  duration: 60,
});

/**
 * Extract and validate Firebase Auth JWT token
 */
export async function validateToken(authHeader?: string): Promise<DecodedIdToken> {
  if (!authHeader) {
    throw new Error('Authorization header is required');
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new Error('Bearer token is required');
  }

  try {
    return await getAuth().verifyIdToken(token);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Extract user details and subscription tier from token claims
 */
export function extractUserContext(decodedToken: DecodedIdToken): AuthenticatedRequest['user'] {
  const { uid, email } = decodedToken;
  
  // Extract custom claims
  const customClaims = decodedToken as any;
  const tier = customClaims.tier || SubscriptionTier.FREE;
  const scopes = customClaims.scopes || [OAuthScope.READ];
  const clientId = customClaims.clientId;

  return {
    uid,
    email: email!,
    tier,
    scopes,
    clientId
  };
}

/**
 * OAuth 2.0 middleware factory
 */
export function requireAuth(requiredScopes: OAuthScope[] = [OAuthScope.READ]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const apiKey = req.headers['x-api-key'] as string;

      // Handle API key authentication (server-to-server)
      if (apiKey) {
        await handleApiKey(req, res, apiKey);
        return next();
      }

      // Handle OAuth token authentication
      const decodedToken = await validateToken(authHeader);
      const userContext = extractUserContext(decodedToken);

      // Check required scopes
      const hasRequiredScope = requiredScopes.some(scope => 
        userContext.scopes.includes(scope) || userContext.scopes.includes(OAuthScope.ADMIN)
      );

      if (!hasRequiredScope) {
        return res.status(403).json({
          error: 'insufficient_scope',
          message: `Required scopes: ${requiredScopes.join(', ')}`,
          required_scopes: requiredScopes
        });
      }

      // Apply rate limiting
      const rateLimiter = rateLimiters[userContext.tier];
      const key = userContext.clientId || userContext.uid;

      try {
        await rateLimiter.consume(key);
      } catch (rateLimitError) {
        const remainingPoints = rateLimitError.remainingPoints || 0;
        const msBeforeNext = rateLimitError.msBeforeNext || 60000;

        res.set({
          'Retry-After': Math.round(msBeforeNext / 1000) || 1,
          'X-RateLimit-Limit': rateLimiter.points,
          'X-RateLimit-Remaining': remainingPoints,
          'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext)
        });

        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: 'Rate limit exceeded',
          retry_after: Math.round(msBeforeNext / 1000)
        });
      }

      // Set rate limit headers
      const remainingPoints = await rateLimiter.get(key);
      res.set({
        'X-RateLimit-Limit': rateLimiter.points,
        'X-RateLimit-Remaining': remainingPoints?.remainingPoints || rateLimiter.points,
      });

      // Attach user context to request
      req.user = userContext;

      // Log request with user context
      console.log(`OAuth Request: ${req.method} ${req.path} - User: ${userContext.uid} (${userContext.tier}) - Scopes: ${userContext.scopes.join(', ')}`);

      next();
    } catch (error) {
      console.error('OAuth authentication failed:', error);
      
      return res.status(401).json({
        error: 'authentication_failed',
        message: error.message || 'Invalid authentication credentials'
      });
    }
  };
}

/**
 * Handle API key authentication for server-to-server calls
 */
async function handleApiKey(req: AuthenticatedRequest, res: Response, apiKey: string) {
  // Validate API key format and check against database/cache
  if (!apiKey.startsWith('sk_')) {
    throw new Error('Invalid API key format');
  }

  // Apply API key rate limiting
  try {
    await apiKeyLimiter.consume(apiKey);
  } catch (rateLimitError) {
    const remainingPoints = rateLimitError.remainingPoints || 0;
    const msBeforeNext = rateLimitError.msBeforeNext || 60000;

    res.set({
      'Retry-After': Math.round(msBeforeNext / 1000) || 1,
      'X-RateLimit-Limit': apiKeyLimiter.points,
      'X-RateLimit-Remaining': remainingPoints,
      'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext)
    });

    throw new Error('API key rate limit exceeded');
  }

  // Mock API key validation (replace with actual validation logic)
  req.user = {
    uid: 'api_key_' + apiKey.slice(-8),
    email: 'api@example.com',
    tier: SubscriptionTier.ENTERPRISE,
    scopes: [OAuthScope.READ, OAuthScope.WRITE, OAuthScope.ADMIN],
    clientId: apiKey
  };

  console.log(`API Key Request: ${req.method} ${req.path} - Key: ${apiKey.slice(-8)}`);
}

/**
 * CORS configuration for OAuth endpoints
 */
export function configureCORS() {
  return (req: Request, res: Response, next: NextFunction) => {
    const allowedOrigins = [
      'http://localhost:3000',
      'https://claw-fitness.web.app',
      'https://claw-nutrition.web.app', 
      'https://claw-meetings.web.app',
      'https://claw-budget.web.app',
      'https://claw-web.web.app'
    ];

    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    next();
  };
}

/**
 * Token refresh middleware - handles expired tokens
 */
export function handleTokenRefresh() {
  return (error: any, req: Request, res: Response, next: NextFunction) => {
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        error: 'token_expired',
        message: 'Authentication token has expired',
        refresh_required: true
      });
    }
    next(error);
  };
}