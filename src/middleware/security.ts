/**
 * Comprehensive Security Middleware for Claw Applications
 * 
 * Provides:
 * - Rate limiting per user and endpoint
 * - Input sanitization and validation
 * - Request size limits
 * - CORS configuration
 * - Authentication verification
 * - Prompt injection detection for LLM endpoints
 * - Audit logging
 * - Security headers
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import helmet from 'helmet';
import cors from 'cors';
import { body, param, query, validationResult } from 'express-validator';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

// Initialize DOMPurify for server-side use
const window = new JSDOM('').window;
const purify = DOMPurify(window);

interface SecurityConfig {
  rateLimit: {
    windowMs: number;
    max: number;
    skipSuccessfulRequests?: boolean;
    keyGenerator?: (req: Request) => string;
  };
  cors: {
    origins: string[];
    credentials: boolean;
  };
  auth: {
    required: boolean;
    skipPaths?: string[];
    adminPaths?: string[];
  };
  validation: {
    maxRequestSize: string;
    sanitizeHtml: boolean;
    allowedTags?: string[];
  };
  audit: {
    enabled: boolean;
    sensitiveFields: string[];
    retention: number; // days
  };
  prompts: {
    enabled: boolean;
    maxLength: number;
    suspiciousPatterns: RegExp[];
  };
}

interface AuditLog {
  id: string;
  timestamp: string;
  userId?: string;
  ip: string;
  method: string;
  path: string;
  userAgent?: string;
  statusCode?: number;
  duration?: number;
  blocked?: boolean;
  reason?: string;
  metadata?: Record<string, any>;
}

interface SecurityContext {
  userId?: string;
  userRole?: string;
  isAuthenticated: boolean;
  isAdmin: boolean;
  requestId: string;
  startTime: number;
}

class SecurityMiddleware {
  private config: SecurityConfig;
  private auditLogs: AuditLog[] = [];
  private rateLimitStore = new Map<string, { count: number; resetTime: number }>();

  constructor(config: SecurityConfig) {
    this.config = config;
  }

  // Main security middleware factory
  public createSecurityMiddleware() {
    const middlewares = [
      this.addSecurityHeaders(),
      this.setupCors(),
      this.createRateLimiter(),
      this.createSlowDown(),
      this.parseRequestId(),
      this.validateRequestSize(),
      this.sanitizeInput(),
      this.verifyAuthentication(),
      this.auditLogger()
    ];

    return middlewares;
  }

  // Security headers middleware
  private addSecurityHeaders() {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      },
      noSniff: true,
      frameguard: { action: 'deny' },
      xssFilter: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    });
  }

  // CORS configuration
  private setupCors() {
    return cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        if (this.config.cors.origins.includes(origin) || 
            this.config.cors.origins.includes('*')) {
          return callback(null, true);
        }
        
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: this.config.cors.credentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 86400 // 24 hours
    });
  }

  // Dynamic rate limiter based on user and endpoint
  private createRateLimiter() {
    return (req: Request, res: Response, next: NextFunction) => {
      const key = this.generateRateLimitKey(req);
      const limits = this.getRateLimitsForEndpoint(req.path);
      
      const now = Date.now();
      const windowMs = limits.windowMs || this.config.rateLimit.windowMs;
      const maxRequests = limits.max || this.config.rateLimit.max;
      
      let store = this.rateLimitStore.get(key);
      
      if (!store || now > store.resetTime) {
        store = { count: 0, resetTime: now + windowMs };
        this.rateLimitStore.set(key, store);
      }
      
      store.count++;
      
      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, maxRequests - store.count).toString(),
        'X-RateLimit-Reset': store.resetTime.toString()
      });
      
      if (store.count > maxRequests) {
        this.logSecurityEvent(req, 'rate_limit_exceeded', {
          limit: maxRequests,
          current: store.count,
          window: windowMs
        });
        
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil((store.resetTime - now) / 1000)
        });
      }
      
      next();
    };
  }

  // Progressive delay for repeated requests
  private createSlowDown() {
    return slowDown({
      windowMs: this.config.rateLimit.windowMs,
      delayAfter: Math.floor(this.config.rateLimit.max * 0.7), // Start slowing down at 70% of limit
      delayMs: 500, // 500ms delay per request after delayAfter
      maxDelayMs: 20000, // Max 20 second delay
      keyGenerator: (req: Request) => this.generateRateLimitKey(req)
    });
  }

  // Generate rate limit key based on user or IP
  private generateRateLimitKey(req: Request): string {
    const securityContext = req.securityContext as SecurityContext;
    
    if (securityContext?.userId) {
      return `user:${securityContext.userId}:${req.path}`;
    }
    
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `ip:${ip}:${req.path}`;
  }

  // Get rate limits specific to endpoint type
  private getRateLimitsForEndpoint(path: string): { windowMs: number; max: number } {
    const endpointLimits: Record<string, { windowMs: number; max: number }> = {
      // Authentication endpoints - very strict
      '/auth/': { windowMs: 15 * 60 * 1000, max: 5 }, // 5 attempts per 15 minutes
      '/login': { windowMs: 15 * 60 * 1000, max: 5 },
      '/register': { windowMs: 60 * 60 * 1000, max: 3 }, // 3 registrations per hour
      
      // LLM endpoints - moderate limits
      '/ai/': { windowMs: 60 * 1000, max: 20 }, // 20 requests per minute
      '/llm/': { windowMs: 60 * 1000, max: 20 },
      
      // File upload - strict
      '/upload': { windowMs: 60 * 1000, max: 10 }, // 10 uploads per minute
      
      // API endpoints - standard
      '/api/': { windowMs: 60 * 1000, max: 100 }, // 100 requests per minute
      
      // Public endpoints - lenient
      '/public/': { windowMs: 60 * 1000, max: 200 }
    };

    for (const [pattern, limits] of Object.entries(endpointLimits)) {
      if (path.includes(pattern)) {
        return limits;
      }
    }

    return { windowMs: this.config.rateLimit.windowMs, max: this.config.rateLimit.max };
  }

  // Request ID generation for tracing
  private parseRequestId() {
    return (req: Request, res: Response, next: NextFunction) => {
      const requestId = req.headers['x-request-id'] as string || 
                       crypto.randomUUID();
      
      req.requestId = requestId;
      req.securityContext = {
        requestId,
        startTime: Date.now(),
        isAuthenticated: false,
        isAdmin: false
      };
      
      res.set('X-Request-ID', requestId);
      next();
    };
  }

  // Request size validation
  private validateRequestSize() {
    return (req: Request, res: Response, next: NextFunction) => {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      const maxSize = this.parseSize(this.config.validation.maxRequestSize);
      
      if (contentLength > maxSize) {
        this.logSecurityEvent(req, 'request_too_large', {
          size: contentLength,
          limit: maxSize
        });
        
        return res.status(413).json({
          error: 'Request Entity Too Large',
          message: `Request size ${this.formatSize(contentLength)} exceeds limit of ${this.config.validation.maxRequestSize}`
        });
      }
      
      next();
    };
  }

  // Input sanitization and validation
  private sanitizeInput() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (this.config.validation.sanitizeHtml) {
        this.sanitizeObject(req.body);
        this.sanitizeObject(req.query);
        this.sanitizeObject(req.params);
      }

      // Check for potential prompt injection in LLM endpoints
      if (this.config.prompts.enabled && this.isLLMEndpoint(req.path)) {
        const injectionDetected = this.detectPromptInjection(req.body);
        if (injectionDetected) {
          this.logSecurityEvent(req, 'prompt_injection_attempt', {
            path: req.path,
            suspiciousContent: injectionDetected
          });
          
          return res.status(400).json({
            error: 'Invalid Input',
            message: 'Request contains potentially harmful content'
          });
        }
      }

      next();
    };
  }

  // Recursively sanitize object properties
  private sanitizeObject(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        // Sanitize HTML
        obj[key] = purify.sanitize(obj[key], {
          ALLOWED_TAGS: this.config.validation.allowedTags || ['b', 'i', 'em', 'strong'],
          ALLOWED_ATTR: []
        });

        // Remove potentially dangerous characters
        obj[key] = obj[key].replace(/[<>'";&()]/g, '');
        
        // Limit length
        if (obj[key].length > 10000) {
          obj[key] = obj[key].substring(0, 10000) + '...';
        }
      } else if (typeof obj[key] === 'object') {
        this.sanitizeObject(obj[key]);
      }
    }
  }

  // Authentication verification
  private verifyAuthentication() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const securityContext = req.securityContext as SecurityContext;
      
      // Skip authentication for certain paths
      if (this.shouldSkipAuth(req.path)) {
        return next();
      }

      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          throw new Error('No valid authorization header');
        }

        const token = authHeader.split(' ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        // Set security context
        securityContext.userId = decodedToken.uid;
        securityContext.userRole = decodedToken.role || 'user';
        securityContext.isAuthenticated = true;
        securityContext.isAdmin = decodedToken.role === 'admin';

        // Check admin-only paths
        if (this.isAdminPath(req.path) && !securityContext.isAdmin) {
          this.logSecurityEvent(req, 'unauthorized_admin_access', {
            userId: securityContext.userId,
            path: req.path
          });
          
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Admin access required'
          });
        }

        // Add user context to request
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          role: decodedToken.role || 'user'
        };

        next();
      } catch (error) {
        this.logSecurityEvent(req, 'authentication_failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }
    };
  }

  // Audit logging middleware
  private auditLogger() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!this.config.audit.enabled) {
        return next();
      }

      const securityContext = req.securityContext as SecurityContext;
      
      // Log request
      const auditLog: AuditLog = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: securityContext.userId,
        ip: req.ip || req.connection.remoteAddress || 'unknown',
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent']
      };

      // Capture response details
      const originalSend = res.send;
      const originalJson = res.json;
      
      res.send = function(body: any) {
        auditLog.statusCode = res.statusCode;
        auditLog.duration = Date.now() - securityContext.startTime;
        return originalSend.call(this, body);
      };

      res.json = function(body: any) {
        auditLog.statusCode = res.statusCode;
        auditLog.duration = Date.now() - securityContext.startTime;
        return originalJson.call(this, body);
      };

      // Log after response
      res.on('finish', () => {
        this.saveAuditLog(auditLog);
      });

      next();
    };
  }

  // Helper methods
  private shouldSkipAuth(path: string): boolean {
    const skipPaths = [
      '/health',
      '/status',
      '/public',
      '/auth/login',
      '/auth/register',
      '/auth/forgot-password',
      ...(this.config.auth.skipPaths || [])
    ];

    return skipPaths.some(skipPath => path.startsWith(skipPath));
  }

  private isAdminPath(path: string): boolean {
    const adminPaths = [
      '/admin',
      '/api/admin',
      '/audit',
      '/security',
      ...(this.config.auth.adminPaths || [])
    ];

    return adminPaths.some(adminPath => path.startsWith(adminPath));
  }

  private isLLMEndpoint(path: string): boolean {
    const llmPaths = ['/ai/', '/llm/', '/chat/', '/generate/'];
    return llmPaths.some(llmPath => path.includes(llmPath));
  }

  private detectPromptInjection(body: any): string | null {
    if (!body) return null;

    const suspiciousPatterns = [
      // Direct injection attempts
      /ignore\s+previous\s+instructions/i,
      /forget\s+everything\s+above/i,
      /you\s+are\s+now\s+a\s+different\s+assistant/i,
      /system[:\s]+role/i,
      
      // Jailbreak attempts
      /developer\s+mode/i,
      /jailbreak/i,
      /override\s+safety/i,
      /ignore\s+safety/i,
      
      // Extraction attempts
      /what\s+are\s+your\s+instructions/i,
      /reveal\s+your\s+prompt/i,
      /show\s+me\s+the\s+system\s+message/i,
      
      // Roleplay attacks
      /pretend\s+you\s+are/i,
      /act\s+as\s+a/i,
      /simulate\s+a/i,
      
      // Code execution
      /```[\s\S]*exec/i,
      /subprocess|os\.system|eval\(/i,
      
      ...this.config.prompts.suspiciousPatterns
    ];

    const textToCheck = JSON.stringify(body).toLowerCase();
    
    if (textToCheck.length > this.config.prompts.maxLength) {
      return 'Text too long';
    }

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(textToCheck)) {
        const match = textToCheck.match(pattern);
        return match ? match[0] : 'Suspicious pattern detected';
      }
    }

    return null;
  }

  private parseSize(sizeString: string): number {
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };

    const match = sizeString.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B)$/i);
    if (!match) return 1024 * 1024; // Default 1MB

    const [, size, unit] = match;
    return parseFloat(size) * (units[unit.toUpperCase()] || 1);
  }

  private formatSize(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0B';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + sizes[i];
  }

  private logSecurityEvent(
    req: Request, 
    event: string, 
    metadata?: Record<string, any>
  ) {
    const securityContext = req.securityContext as SecurityContext;
    
    console.warn(`[SECURITY EVENT] ${event}`, {
      requestId: securityContext.requestId,
      userId: securityContext.userId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
      ...metadata
    });

    // In production, would send to security monitoring system
    this.saveAuditLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: securityContext.userId,
      ip: req.ip || 'unknown',
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'],
      blocked: true,
      reason: event,
      metadata
    });
  }

  private saveAuditLog(log: AuditLog) {
    this.auditLogs.push(log);

    // Keep only recent logs in memory (for performance)
    if (this.auditLogs.length > 10000) {
      this.auditLogs = this.auditLogs.slice(-5000);
    }

    // In production, would save to database or external logging service
    if (log.blocked || log.statusCode && log.statusCode >= 400) {
      console.log(`[AUDIT] ${log.method} ${log.path} - ${log.statusCode || 'N/A'}`, {
        userId: log.userId,
        ip: log.ip,
        duration: log.duration,
        blocked: log.blocked,
        reason: log.reason
      });
    }
  }

  // Public methods for getting audit data
  public getAuditLogs(limit: number = 100): AuditLog[] {
    return this.auditLogs.slice(-limit);
  }

  public getSecurityMetrics(): {
    totalRequests: number;
    blockedRequests: number;
    averageResponseTime: number;
    topBlockedIPs: Array<{ ip: string; count: number }>;
  } {
    const totalRequests = this.auditLogs.length;
    const blockedRequests = this.auditLogs.filter(log => log.blocked).length;
    
    const responseTimes = this.auditLogs
      .filter(log => log.duration)
      .map(log => log.duration!);
    
    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
      : 0;

    // Count blocked requests by IP
    const ipCounts = new Map<string, number>();
    this.auditLogs
      .filter(log => log.blocked)
      .forEach(log => {
        ipCounts.set(log.ip, (ipCounts.get(log.ip) || 0) + 1);
      });

    const topBlockedIPs = Array.from(ipCounts.entries())
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalRequests,
      blockedRequests,
      averageResponseTime,
      topBlockedIPs
    };
  }
}

// Input validation helpers
export const validateInput = {
  email: () => body('email').isEmail().normalizeEmail(),
  password: () => body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  uuid: (field: string) => body(field).isUUID(4),
  sanitizedString: (field: string, maxLength: number = 1000) => 
    body(field).trim().escape().isLength({ max: maxLength }),
  positiveInteger: (field: string) => body(field).isInt({ min: 1 }),
  url: (field: string) => body(field).isURL(),
  date: (field: string) => body(field).isISO8601().toDate()
};

// Security configuration presets
export const securityConfigs = {
  // High security for production
  production: {
    rateLimit: { windowMs: 15 * 60 * 1000, max: 100 },
    cors: { origins: ['https://clawapp.com', 'https://api.clawapp.com'], credentials: true },
    auth: { required: true, skipPaths: ['/health'], adminPaths: ['/admin'] },
    validation: { maxRequestSize: '10MB', sanitizeHtml: true },
    audit: { enabled: true, sensitiveFields: ['password', 'token'], retention: 90 },
    prompts: { enabled: true, maxLength: 5000, suspiciousPatterns: [] }
  },

  // Moderate security for staging
  staging: {
    rateLimit: { windowMs: 15 * 60 * 1000, max: 200 },
    cors: { origins: ['https://staging.clawapp.com'], credentials: true },
    auth: { required: true, skipPaths: ['/health', '/test'] },
    validation: { maxRequestSize: '20MB', sanitizeHtml: true },
    audit: { enabled: true, sensitiveFields: ['password'], retention: 30 },
    prompts: { enabled: true, maxLength: 10000, suspiciousPatterns: [] }
  },

  // Lenient security for development
  development: {
    rateLimit: { windowMs: 15 * 60 * 1000, max: 1000 },
    cors: { origins: ['http://localhost:3000', 'http://localhost:8080'], credentials: true },
    auth: { required: false, skipPaths: ['*'] },
    validation: { maxRequestSize: '50MB', sanitizeHtml: false },
    audit: { enabled: false, sensitiveFields: [], retention: 7 },
    prompts: { enabled: false, maxLength: 50000, suspiciousPatterns: [] }
  }
};

export { SecurityMiddleware, SecurityConfig, SecurityContext, AuditLog };