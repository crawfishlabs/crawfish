/**
 * @fileoverview Performance monitoring and metrics collection
 * @description Comprehensive performance tracking across all Claw apps
 */

import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { 
  PerformanceTrace, 
  PerformanceMetric, 
  PerformanceAlert,
  PerformanceSummary,
  MetricThresholds,
  AlertLevel
} from './performance-types';

/**
 * Performance monitoring class
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private db: admin.firestore.Firestore;
  private thresholds: Map<string, MetricThresholds> = new Map();

  private constructor() {
    this.db = admin.firestore();
    this.loadThresholds();
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Start a performance trace
   */
  public startTrace(name: string, metadata?: Record<string, string>): PerformanceTrace {
    const trace: PerformanceTrace = {
      id: uuidv4(),
      name,
      startTime: Date.now(),
      metadata: metadata || {},
      app: this.extractAppFromMetadata(metadata),
    };

    return trace;
  }

  /**
   * End a performance trace and record the metric
   */
  public async endTrace(trace: PerformanceTrace, success: boolean = true, error?: string): Promise<void> {
    const endTime = Date.now();
    const duration = endTime - trace.startTime;

    const metric: PerformanceMetric = {
      id: uuidv4(),
      name: trace.name,
      value: duration,
      unit: 'ms',
      timestamp: admin.firestore.Timestamp.now(),
      app: trace.app || 'unknown',
      metadata: {
        ...trace.metadata,
        success,
        error,
        traceId: trace.id,
      },
    };

    await this.recordMetric(metric);
    await this.checkThresholds(metric);
  }

  /**
   * Record a custom metric
   */
  public async recordMetric(metric: PerformanceMetric): Promise<void> {
    try {
      await this.db.collection('_performance_metrics').doc(metric.id).set(metric);
      await this.updateSummaries(metric);
    } catch (error) {
      console.error('Error recording performance metric:', error);
    }
  }

  /**
   * Record LLM call performance
   */
  public async recordLLMCall(
    model: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    app: string,
    success: boolean = true,
    error?: string
  ): Promise<void> {
    const metric: PerformanceMetric = {
      id: uuidv4(),
      name: 'llm_response_time',
      value: latencyMs,
      unit: 'ms',
      timestamp: admin.firestore.Timestamp.now(),
      app,
      metadata: {
        model,
        inputTokens: inputTokens.toString(),
        outputTokens: outputTokens.toString(),
        totalTokens: (inputTokens + outputTokens).toString(),
        success: success.toString(),
        error,
      },
    };

    await this.recordMetric(metric);
  }

  /**
   * Get performance metrics for analysis
   */
  public async getMetrics(
    app: string,
    metric: string,
    timeRange: string
  ): Promise<PerformanceSummary> {
    try {
      const startTime = this.getTimeRangeStart(timeRange);
      
      const snapshot = await this.db
        .collection('_performance_metrics')
        .where('app', '==', app)
        .where('name', '==', metric)
        .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startTime))
        .orderBy('timestamp', 'desc')
        .get();

      const values = snapshot.docs.map(doc => doc.data().value as number);
      
      if (values.length === 0) {
        return {
          metric,
          app,
          timeRange,
          count: 0,
          p50: 0,
          p95: 0,
          p99: 0,
          avg: 0,
          min: 0,
          max: 0,
        };
      }

      values.sort((a, b) => a - b);
      
      return {
        metric,
        app,
        timeRange,
        count: values.length,
        p50: this.percentile(values, 0.5),
        p95: this.percentile(values, 0.95),
        p99: this.percentile(values, 0.99),
        avg: values.reduce((sum, val) => sum + val, 0) / values.length,
        min: values[0],
        max: values[values.length - 1],
      };
    } catch (error) {
      console.error('Error getting metrics:', error);
      throw error;
    }
  }

  /**
   * Check metric against thresholds and trigger alerts
   */
  private async checkThresholds(metric: PerformanceMetric): Promise<void> {
    const thresholdKey = `${metric.app}:${metric.name}`;
    const thresholds = this.thresholds.get(thresholdKey);
    
    if (!thresholds) {
      return;
    }

    let alertLevel: AlertLevel | null = null;
    let message = '';

    if (metric.value > thresholds.critical) {
      alertLevel = 'critical';
      message = `CRITICAL: ${metric.name} exceeded ${thresholds.critical}${metric.unit} (actual: ${metric.value}${metric.unit})`;
    } else if (metric.value > thresholds.warning) {
      alertLevel = 'warning';
      message = `WARNING: ${metric.name} exceeded ${thresholds.warning}${metric.unit} (actual: ${metric.value}${metric.unit})`;
    }

    if (alertLevel) {
      await this.fireAlert({
        id: uuidv4(),
        level: alertLevel,
        metric: metric.name,
        app: metric.app,
        value: metric.value,
        threshold: alertLevel === 'critical' ? thresholds.critical : thresholds.warning,
        message,
        timestamp: admin.firestore.Timestamp.now(),
        metadata: metric.metadata,
      });
    }
  }

  /**
   * Fire a performance alert
   */
  private async fireAlert(alert: PerformanceAlert): Promise<void> {
    try {
      await this.db.collection('_performance_alerts').doc(alert.id).set(alert);
      
      // Log to console for immediate visibility
      console.log(`[PERFORMANCE ALERT] ${alert.level.toUpperCase()}: ${alert.message}`);
      
      // TODO: Send to Telegram, email, etc.
    } catch (error) {
      console.error('Error firing alert:', error);
    }
  }

  /**
   * Update performance summaries
   */
  private async updateSummaries(metric: PerformanceMetric): Promise<void> {
    try {
      const date = new Date().toISOString().split('T')[0];
      const summaryRef = this.db.collection('_performance_summaries').doc(`${date}:${metric.app}:${metric.name}`);

      await this.db.runTransaction(async (transaction) => {
        const doc = await transaction.get(summaryRef);
        const data = doc.exists ? doc.data() : null;

        const updateData = {
          date,
          app: metric.app,
          metric: metric.name,
          count: (data?.count || 0) + 1,
          sum: (data?.sum || 0) + metric.value,
          sumSquares: (data?.sumSquares || 0) + (metric.value * metric.value),
          min: data?.min ? Math.min(data.min, metric.value) : metric.value,
          max: data?.max ? Math.max(data.max, metric.value) : metric.value,
          lastUpdated: admin.firestore.Timestamp.now(),
        };

        transaction.set(summaryRef, updateData, { merge: true });
      });
    } catch (error) {
      console.error('Error updating summaries:', error);
    }
  }

  /**
   * Load performance thresholds from configuration
   */
  private loadThresholds(): void {
    // Define thresholds based on PERFORMANCE-METRICS.md
    const universalThresholds = {
      'api_latency': { warning: 400, critical: 500 },
      'llm_response_time': { warning: 4000, critical: 5000 },
      'cold_start': { warning: 2500, critical: 3000 },
      'error_rate': { warning: 0.003, critical: 0.005 },
    };

    const appSpecificThresholds = {
      'claw-fitness': {
        'rest_timer_accuracy': { warning: 80, critical: 100 },
        'workout_log_save': { warning: 400, critical: 500 },
        'exercise_search': { warning: 150, critical: 200 },
        'coach_response_start': { warning: 1200, critical: 1500 },
      },
      'claw-nutrition': {
        'photo_scan_result': { warning: 3500, critical: 4000 },
        'barcode_lookup': { warning: 800, critical: 1000 },
        'food_search': { warning: 250, critical: 300 },
        'daily_dashboard_load': { warning: 800, critical: 1000 },
      },
      'claw-meetings': {
        'recording_start': { warning: 400, critical: 500 },
        'transcription_latency_per_minute': { warning: 25000, critical: 30000 },
        'meeting_analysis': { warning: 45000, critical: 60000 },
        'meeting_search': { warning: 1500, critical: 2000 },
      },
      'claw-budget': {
        'budget_view_load': { warning: 400, critical: 500 },
        'transaction_save': { warning: 250, critical: 300 },
        'category_assignment': { warning: 80, critical: 100 },
        'receipt_scan_parse': { warning: 4000, critical: 5000 },
        'bank_sync': { warning: 8000, critical: 10000 },
        'report_generation': { warning: 1500, critical: 2000 },
      },
    };

    // Load universal thresholds
    for (const [metric, thresholds] of Object.entries(universalThresholds)) {
      this.thresholds.set(`*:${metric}`, thresholds);
    }

    // Load app-specific thresholds
    for (const [app, metrics] of Object.entries(appSpecificThresholds)) {
      for (const [metric, thresholds] of Object.entries(metrics)) {
        this.thresholds.set(`${app}:${metric}`, thresholds);
      }
    }
  }

  /**
   * Helper methods
   */
  private extractAppFromMetadata(metadata?: Record<string, string>): string {
    return metadata?.app || metadata?.service || 'unknown';
  }

  private getTimeRangeStart(timeRange: string): Date {
    const now = new Date();
    switch (timeRange) {
      case '1h': return new Date(now.getTime() - 60 * 60 * 1000);
      case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default: return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  private percentile(values: number[], percentile: number): number {
    const index = Math.ceil(values.length * percentile) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))];
  }
}

/**
 * Convenience functions for common use cases
 */

/**
 * Start a named trace
 */
export function startTrace(name: string, metadata?: Record<string, string>): PerformanceTrace {
  return PerformanceMonitor.getInstance().startTrace(name, metadata);
}

/**
 * End a trace
 */
export async function endTrace(trace: PerformanceTrace, success: boolean = true, error?: string): Promise<void> {
  await PerformanceMonitor.getInstance().endTrace(trace, success, error);
}

/**
 * Record a metric
 */
export async function recordMetric(name: string, value: number, unit: 'ms' | 'bytes' | 'count', app: string, metadata?: Record<string, string>): Promise<void> {
  const metric: PerformanceMetric = {
    id: uuidv4(),
    name,
    value,
    unit,
    timestamp: admin.firestore.Timestamp.now(),
    app,
    metadata: metadata || {},
  };

  await PerformanceMonitor.getInstance().recordMetric(metric);
}

/**
 * Record LLM call performance
 */
export async function recordLLMCall(
  model: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  app: string,
  success: boolean = true,
  error?: string
): Promise<void> {
  await PerformanceMonitor.getInstance().recordLLMCall(model, inputTokens, outputTokens, latencyMs, app, success, error);
}

/**
 * Get performance metrics
 */
export async function getMetrics(app: string, metric: string, timeRange: string): Promise<PerformanceSummary> {
  return PerformanceMonitor.getInstance().getMetrics(app, metric, timeRange);
}