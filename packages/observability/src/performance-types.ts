/**
 * @fileoverview Types for performance monitoring and metrics
 */

import * as admin from 'firebase-admin';

/**
 * Performance trace for timing operations
 */
export interface PerformanceTrace {
  /** Unique trace ID */
  id: string;
  /** Trace name/identifier */
  name: string;
  /** Start time in milliseconds */
  startTime: number;
  /** End time in milliseconds (set when trace completes) */
  endTime?: number;
  /** App or service name */
  app?: string;
  /** Additional metadata */
  metadata: Record<string, string>;
}

/**
 * Performance metric entry
 */
export interface PerformanceMetric {
  /** Unique metric ID */
  id: string;
  /** Metric name */
  name: string;
  /** Metric value */
  value: number;
  /** Unit of measurement */
  unit: 'ms' | 'bytes' | 'count' | 'percent';
  /** Timestamp when metric was recorded */
  timestamp: admin.firestore.Timestamp;
  /** App or service name */
  app: string;
  /** Additional metadata */
  metadata: Record<string, string>;
}

/**
 * Performance alert
 */
export interface PerformanceAlert {
  /** Alert ID */
  id: string;
  /** Alert severity level */
  level: AlertLevel;
  /** Metric that triggered the alert */
  metric: string;
  /** App name */
  app: string;
  /** Actual metric value */
  value: number;
  /** Threshold that was exceeded */
  threshold: number;
  /** Human-readable alert message */
  message: string;
  /** Alert timestamp */
  timestamp: admin.firestore.Timestamp;
  /** Additional context */
  metadata?: Record<string, string>;
  /** Whether alert has been acknowledged */
  acknowledged?: boolean;
  /** When alert was resolved (if applicable) */
  resolvedAt?: admin.firestore.Timestamp;
}

/**
 * Alert severity levels
 */
export type AlertLevel = 'info' | 'warning' | 'critical';

/**
 * Metric thresholds for alerting
 */
export interface MetricThresholds {
  /** Warning threshold */
  warning: number;
  /** Critical threshold */
  critical: number;
  /** Info threshold (optional) */
  info?: number;
}

/**
 * Performance summary/statistics
 */
export interface PerformanceSummary {
  /** Metric name */
  metric: string;
  /** App name */
  app: string;
  /** Time range for summary */
  timeRange: string;
  /** Number of data points */
  count: number;
  /** 50th percentile */
  p50: number;
  /** 95th percentile */
  p95: number;
  /** 99th percentile */
  p99: number;
  /** Average value */
  avg: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Error count (optional) */
  errorCount?: number;
  /** Success rate (optional) */
  successRate?: number;
}

/**
 * Performance dashboard data
 */
export interface PerformanceDashboard {
  /** App name */
  app: string;
  /** Time period */
  period: string;
  /** Key performance indicators */
  kpis: {
    /** API latency summary */
    apiLatency: PerformanceSummary;
    /** Error rate */
    errorRate: number;
    /** Success rate */
    successRate: number;
    /** Throughput (requests per minute) */
    throughput: number;
  };
  /** App-specific metrics */
  appMetrics: Record<string, PerformanceSummary>;
  /** Recent alerts */
  recentAlerts: PerformanceAlert[];
  /** Trends (compared to previous period) */
  trends: {
    apiLatency: 'up' | 'down' | 'stable';
    errorRate: 'up' | 'down' | 'stable';
    throughput: 'up' | 'down' | 'stable';
  };
}

/**
 * Performance optimization suggestion
 */
export interface PerformanceOptimization {
  /** Suggestion ID */
  id: string;
  /** App name */
  app: string;
  /** Metric being optimized */
  metric: string;
  /** Current performance */
  currentValue: number;
  /** Target performance */
  targetValue: number;
  /** Potential improvement percentage */
  improvement: number;
  /** Optimization category */
  category: 'database' | 'cache' | 'algorithm' | 'infrastructure' | 'bundle';
  /** Description of the optimization */
  description: string;
  /** Implementation complexity */
  complexity: 'low' | 'medium' | 'high';
  /** Estimated development hours */
  estimatedHours: number;
  /** Priority score */
  priority: number;
  /** Code changes suggested */
  codeChanges?: string[];
  /** Configuration changes suggested */
  configChanges?: Record<string, any>;
  /** Created timestamp */
  createdAt: admin.firestore.Timestamp;
  /** Status */
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
}

/**
 * Performance regression analysis
 */
export interface PerformanceRegression {
  /** Regression ID */
  id: string;
  /** App name */
  app: string;
  /** Metric that regressed */
  metric: string;
  /** Baseline value (before regression) */
  baselineValue: number;
  /** Current value (after regression) */
  currentValue: number;
  /** Percentage change */
  changePercent: number;
  /** When regression was detected */
  detectedAt: admin.firestore.Timestamp;
  /** Potential causes */
  possibleCauses: string[];
  /** Git commits in the suspected time range */
  suspectCommits?: {
    hash: string;
    message: string;
    author: string;
    timestamp: Date;
  }[];
  /** Severity assessment */
  severity: 'minor' | 'major' | 'critical';
  /** Status */
  status: 'investigating' | 'root_cause_found' | 'fixed' | 'false_positive';
}

/**
 * Performance baseline for comparison
 */
export interface PerformanceBaseline {
  /** App name */
  app: string;
  /** Metric name */
  metric: string;
  /** Baseline value */
  value: number;
  /** When baseline was established */
  establishedAt: admin.firestore.Timestamp;
  /** Version/release when baseline was set */
  version?: string;
  /** Git commit hash */
  commitHash?: string;
  /** Environment where baseline was measured */
  environment: 'production' | 'staging' | 'test';
  /** Additional context */
  metadata?: Record<string, string>;
}