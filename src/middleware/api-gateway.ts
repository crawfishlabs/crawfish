/**
 * API Gateway Middleware for Claw Platform
 * Routes requests to appropriate Cloud Functions with validation and observability
 */

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, requireAuth, configureCORS, OAuthScope } from './oauth';
import OpenAPIValidator from 'express-openapi-validator';
import { v4 as uuidv4 } from 'uuid';

// Service endpoints mapping
const SERVICE_ENDPOINTS = {
  fitness: {
    region: process.env.FIREBASE_REGION || 'us-central1',
    project: process.env.FIREBASE_PROJECT || 'claw-fitness-prod'
  },
  nutrition: {
    region: process.env.FIREBASE_REGION || 'us-central1', 
    project: process.env.FIREBASE_PROJECT || 'claw-nutrition-prod'
  },
  meetings: {
    region: process.env.FIREBASE_REGION || 'us-central1',
    project: process.env.FIREBASE_PROJECT || 'claw-meetings-prod'
  },
  budget: {
    region: process.env.FIREBASE_REGION || 'us-central1',
    project: process.env.FIREBASE_PROJECT || 'claw-budget-prod'
  }
};

// Request logging interface
interface RequestLog {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  service?: string;
  userId?: string;
  userTier?: string;
  responseStatus?: number;
  responseTime?: number;
  error?: string;
}

/**
 * Generate request ID and attach to request
 */
export function requestId() {
  return (req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    req.requestId = uuidv4();
    res.set('X-Request-ID', req.requestId);
    next();
  };
}

/**
 * Request logging middleware
 */
export function requestLogger() {
  return (req: AuthenticatedRequest & { requestId?: string }, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    const log: RequestLog = {
      requestId: req.requestId || uuidv4(),
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      userId: req.user?.uid,
      userTier: req.user?.tier
    };

    // Override res.end to capture response details
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      log.responseStatus = res.statusCode;
      log.responseTime = Date.now() - startTime;
      
      // Log request (in production, send to logging service)
      console.log('API Gateway Request:', JSON.stringify(log));
      
      originalEnd.call(this, chunk, encoding);
    };

    next();
  };
}

/**
 * API versioning middleware
 */
export function apiVersioning() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract version from path (/v1/endpoint) or header
    const pathVersion = req.path.match(/^\/v(\d+)\//);
    const headerVersion = req.headers['api-version'];
    
    const version = pathVersion ? pathVersion[1] : headerVersion || '1';
    
    // Validate version
    if (!['1'].includes(version)) {
      return res.status(400).json({
        error: 'unsupported_version',
        message: `API version ${version} is not supported`,
        supported_versions: ['v1']
      });
    }

    // Remove version prefix from path for downstream routing
    if (pathVersion) {
      req.url = req.url.replace(`/v${version}`, '');
    }

    // Set version in response headers
    res.set('API-Version', `v${version}`);
    
    next();
  };
}

/**
 * Service router - routes requests to appropriate microservice
 */
export function routeToService() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Extract service from path
    const pathParts = req.path.split('/').filter(Boolean);
    const service = pathParts[0];

    if (!SERVICE_ENDPOINTS[service]) {
      return next(); // Let the main app handle it
    }

    // Get service configuration
    const serviceConfig = SERVICE_ENDPOINTS[service];
    const targetUrl = `https://${serviceConfig.region}-${serviceConfig.project}.cloudfunctions.net/api${req.path}`;

    try {
      // Forward request to microservice
      const fetch = (await import('node-fetch')).default;
      
      const headers: any = {
        'Content-Type': req.headers['content-type'],
        'Authorization': req.headers.authorization,
        'X-API-Key': req.headers['x-api-key'],
        'X-Request-ID': req.headers['x-request-id'],
        'User-Agent': 'Claw-Platform-Gateway/1.0'
      };

      // Remove undefined headers
      Object.keys(headers).forEach(key => {
        if (headers[key] === undefined) {
          delete headers[key];
        }
      });

      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
        timeout: 30000
      });

      const data = await response.text();
      
      // Forward response headers
      response.headers.forEach((value, key) => {
        if (!key.startsWith(':')) {
          res.set(key, value);
        }
      });

      res.status(response.status);
      
      // Try to parse as JSON, fall back to text
      try {
        const jsonData = JSON.parse(data);
        res.json(jsonData);
      } catch {
        res.send(data);
      }

    } catch (error) {
      console.error(`Service routing error for ${service}:`, error);
      
      res.status(502).json({
        error: 'service_unavailable',
        message: `${service} service is temporarily unavailable`,
        service,
        requestId: req.headers['x-request-id']
      });
    }
  };
}

/**
 * OpenAPI validation middleware factory
 */
export function createOpenAPIValidator(specPath: string) {
  return OpenAPIValidator.middleware({
    apiSpec: specPath,
    validateRequests: true,
    validateResponses: process.env.NODE_ENV !== 'production',
    unknownFormats: ['int64'], // Allow int64 format
    formats: {
      // Custom format validators
      'uuid': /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'date-time': true // Use default
    }
  });
}

/**
 * Error handling middleware for validation errors
 */
export function validationErrorHandler() {
  return (error: any, req: Request, res: Response, next: NextFunction) => {
    if (error.status === 400 && error.errors) {
      return res.status(400).json({
        error: 'validation_error', 
        message: 'Request validation failed',
        details: error.errors,
        path: req.path
      });
    }
    
    if (error.status === 404 && error.message.includes('not found in API spec')) {
      return res.status(404).json({
        error: 'endpoint_not_found',
        message: 'Endpoint not found in API specification',
        path: req.path
      });
    }

    next(error);
  };
}

/**
 * Health check middleware
 */
export function healthCheck() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.path === '/ping') {
      return res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: Object.keys(SERVICE_ENDPOINTS)
      });
    }
    next();
  };
}

/**
 * Create complete API Gateway middleware stack
 */
export function createAPIGateway(options: {
  enableCORS?: boolean;
  enableAuth?: boolean;
  enableValidation?: boolean;
  openAPISpec?: string;
  requiredScopes?: OAuthScope[];
} = {}) {
  const middlewares = [];

  // Request ID and logging
  middlewares.push(requestId());
  middlewares.push(requestLogger());

  // CORS configuration
  if (options.enableCORS !== false) {
    middlewares.push(configureCORS());
  }

  // Health check
  middlewares.push(healthCheck());

  // API versioning
  middlewares.push(apiVersioning());

  // Authentication
  if (options.enableAuth !== false) {
    middlewares.push(requireAuth(options.requiredScopes));
  }

  // OpenAPI validation
  if (options.enableValidation && options.openAPISpec) {
    middlewares.push(...createOpenAPIValidator(options.openAPISpec));
    middlewares.push(validationErrorHandler());
  }

  // Service routing (should be last)
  middlewares.push(routeToService());

  return middlewares;
}

/**
 * Global error handler
 */
export function globalErrorHandler() {
  return (error: any, req: Request, res: Response, next: NextFunction) => {
    console.error('API Gateway Error:', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      requestId: req.headers['x-request-id']
    });

    const status = error.status || error.statusCode || 500;
    const message = status === 500 ? 'Internal server error' : error.message;

    res.status(status).json({
      error: 'server_error',
      message,
      requestId: req.headers['x-request-id'],
      timestamp: new Date().toISOString()
    });
  };
}