/**
 * @fileoverview Claw Platform Observability Module
 * @description Cost tracking, monitoring, error reporting, health checks, and alerting
 */

export * from './types';
export * from './performance-types';

// Cost tracking exports
export { 
  trackLLMUsage, 
  calculateCost, 
  getUserCostData, 
  getDailySummary 
} from './tracker';

// Performance monitoring exports
export {
  PerformanceMonitor,
  startTrace,
  endTrace,
  recordMetric,
  recordLLMCall,
  getMetrics
} from './performance';

// Performance alerts exports
export {
  PerformanceAlerter,
  checkMetricsAndAlert
} from './performance-alerts';

// Error reporting
export {
  reportError,
  captureException,
  errorReportingMiddleware,
  ErrorReport,
} from './error-reporting';

// Health checks
export {
  healthCheck,
  deepHealthCheck,
  healthRouter,
  HealthStatus,
  DependencyStatus,
} from './health-check';

// Alerting
export {
  createAlert,
  evaluateAlerts,
  seedBuiltInRules,
  AlertRule,
  FiredAlert,
} from './alerts';

// Middleware
export {
  performanceMiddleware,
  trackLLMCall,
} from './middleware';
