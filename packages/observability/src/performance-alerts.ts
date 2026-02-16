/**
 * @fileoverview Performance alerting system
 * @description Checks metrics against thresholds and fires alerts
 */

import * as admin from 'firebase-admin';
import { PerformanceAlert, AlertLevel, PerformanceMetric, PerformanceSummary } from './performance-types';

/**
 * Performance alerting class
 */
export class PerformanceAlerter {
  private static instance: PerformanceAlerter;
  private db: admin.firestore.Firestore;

  private constructor() {
    this.db = admin.firestore();
  }

  public static getInstance(): PerformanceAlerter {
    if (!PerformanceAlerter.instance) {
      PerformanceAlerter.instance = new PerformanceAlerter();
    }
    return PerformanceAlerter.instance;
  }

  /**
   * Check metrics against thresholds and fire alerts
   */
  public async checkMetricsAndAlert(): Promise<void> {
    try {
      const apps = ['claw-fitness', 'claw-nutrition', 'claw-meetings', 'claw-budget', 'claw-web'];
      
      for (const app of apps) {
        await this.checkAppMetrics(app);
      }
    } catch (error) {
      console.error('Error checking metrics for alerts:', error);
    }
  }

  /**
   * Check metrics for a specific app
   */
  private async checkAppMetrics(app: string): Promise<void> {
    const metricsToCheck = this.getMetricsToCheck(app);
    
    for (const metric of metricsToCheck) {
      await this.checkMetric(app, metric);
    }
  }

  /**
   * Check a specific metric
   */
  private async checkMetric(app: string, metricName: string): Promise<void> {
    try {
      // Get recent metrics (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const snapshot = await this.db
        .collection('_performance_metrics')
        .where('app', '==', app)
        .where('name', '==', metricName)
        .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(fiveMinutesAgo))
        .get();

      if (snapshot.empty) {
        return;
      }

      const values = snapshot.docs.map(doc => doc.data().value as number);
      const successCount = snapshot.docs.filter(doc => doc.data().metadata?.success !== 'false').length;
      const errorCount = snapshot.size - successCount;
      
      // Calculate statistics
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
      const p95 = this.calculatePercentile(values, 0.95);
      const errorRate = errorCount / snapshot.size;

      // Get thresholds
      const thresholds = this.getThresholds(app, metricName);
      if (!thresholds) {
        return;
      }

      // Check for alerts
      await this.evaluateThresholds(app, metricName, avg, p95, errorRate, thresholds);
      
    } catch (error) {
      console.error(`Error checking metric ${app}:${metricName}:`, error);
    }
  }

  /**
   * Evaluate metrics against thresholds
   */
  private async evaluateThresholds(
    app: string,
    metric: string,
    avg: number,
    p95: number,
    errorRate: number,
    thresholds: any
  ): Promise<void> {
    // Check different alert conditions
    const alerts: Array<{ level: AlertLevel, message: string, value: number, threshold: number }> = [];

    // Latency alerts (use p95 for latency metrics)
    if (metric.includes('latency') || metric.includes('time') || metric.includes('load')) {
      if (p95 > thresholds.critical) {
        alerts.push({
          level: 'critical',
          message: `${metric} p95 exceeded critical threshold`,
          value: p95,
          threshold: thresholds.critical
        });
      } else if (p95 > thresholds.warning) {
        alerts.push({
          level: 'warning',
          message: `${metric} p95 exceeded warning threshold`,
          value: p95,
          threshold: thresholds.warning
        });
      }
    }

    // Error rate alerts
    if (errorRate > 0.01) { // 1% error rate
      alerts.push({
        level: 'critical',
        message: `High error rate detected for ${metric}`,
        value: errorRate * 100,
        threshold: 1
      });
    } else if (errorRate > 0.005) { // 0.5% error rate
      alerts.push({
        level: 'warning',
        message: `Elevated error rate for ${metric}`,
        value: errorRate * 100,
        threshold: 0.5
      });
    }

    // Fire alerts
    for (const alert of alerts) {
      await this.fireAlert({
        id: `${app}-${metric}-${alert.level}-${Date.now()}`,
        level: alert.level,
        metric,
        app,
        value: alert.value,
        threshold: alert.threshold,
        message: `[${app.toUpperCase()}] ${alert.message}: ${alert.value.toFixed(2)} > ${alert.threshold}`,
        timestamp: admin.firestore.Timestamp.now(),
        metadata: {
          avg: avg.toString(),
          p95: p95.toString(),
          errorRate: (errorRate * 100).toFixed(2) + '%',
        }
      });
    }
  }

  /**
   * Fire an alert
   */
  private async fireAlert(alert: PerformanceAlert): Promise<void> {
    try {
      // Check if we've already fired this alert recently (prevent spam)
      const recentAlerts = await this.db
        .collection('_performance_alerts')
        .where('app', '==', alert.app)
        .where('metric', '==', alert.metric)
        .where('level', '==', alert.level)
        .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(new Date(Date.now() - 30 * 60 * 1000))) // Last 30 minutes
        .get();

      if (!recentAlerts.empty) {
        console.log(`Suppressing duplicate alert: ${alert.message}`);
        return;
      }

      // Store alert
      await this.db.collection('_performance_alerts').doc(alert.id).set(alert);

      // Log to console
      console.log(`[PERFORMANCE ALERT] ${alert.level.toUpperCase()}: ${alert.message}`);

      // Send to external channels
      await this.sendToTelegram(alert);
      await this.sendToDashboard(alert);

    } catch (error) {
      console.error('Error firing alert:', error);
    }
  }

  /**
   * Send alert to Telegram (placeholder for now)
   */
  private async sendToTelegram(alert: PerformanceAlert): Promise<void> {
    // TODO: Integrate with Telegram API
    console.log(`[TELEGRAM] ${alert.message}`);
  }

  /**
   * Send alert to dashboard
   */
  private async sendToDashboard(alert: PerformanceAlert): Promise<void> {
    try {
      await this.db.collection('dashboard_alerts').doc(alert.id).set({
        ...alert,
        displayed: false,
        createdAt: admin.firestore.Timestamp.now(),
      });
    } catch (error) {
      console.error('Error sending alert to dashboard:', error);
    }
  }

  /**
   * Get metrics to check for an app
   */
  private getMetricsToCheck(app: string): string[] {
    const universalMetrics = [
      'api_latency',
      'llm_response_time',
      'cold_start',
    ];

    const appSpecificMetrics: Record<string, string[]> = {
      'claw-fitness': [
        'rest_timer_accuracy',
        'workout_log_save',
        'exercise_search',
        'coach_response_start',
      ],
      'claw-nutrition': [
        'photo_scan_result',
        'barcode_lookup',
        'food_search',
        'daily_dashboard_load',
      ],
      'claw-meetings': [
        'recording_start',
        'transcription_latency_per_minute',
        'meeting_analysis',
        'meeting_search',
      ],
      'claw-budget': [
        'budget_view_load',
        'transaction_save',
        'category_assignment',
        'receipt_scan_parse',
        'bank_sync',
        'report_generation',
      ],
    };

    return [...universalMetrics, ...(appSpecificMetrics[app] || [])];
  }

  /**
   * Get thresholds for a metric
   */
  private getThresholds(app: string, metric: string): { warning: number, critical: number } | null {
    const thresholds: Record<string, { warning: number, critical: number }> = {
      // Universal metrics
      'api_latency': { warning: 400, critical: 500 },
      'llm_response_time': { warning: 4000, critical: 5000 },
      'cold_start': { warning: 2500, critical: 3000 },
      
      // ClawFitness
      'rest_timer_accuracy': { warning: 80, critical: 100 },
      'workout_log_save': { warning: 400, critical: 500 },
      'exercise_search': { warning: 150, critical: 200 },
      'coach_response_start': { warning: 1200, critical: 1500 },
      
      // Claw Nutrition
      'photo_scan_result': { warning: 3500, critical: 4000 },
      'barcode_lookup': { warning: 800, critical: 1000 },
      'food_search': { warning: 250, critical: 300 },
      'daily_dashboard_load': { warning: 800, critical: 1000 },
      
      // Claw Meetings
      'recording_start': { warning: 400, critical: 500 },
      'transcription_latency_per_minute': { warning: 25000, critical: 30000 },
      'meeting_analysis': { warning: 45000, critical: 60000 },
      'meeting_search': { warning: 1500, critical: 2000 },
      
      // Claw Budget
      'budget_view_load': { warning: 400, critical: 500 },
      'transaction_save': { warning: 250, critical: 300 },
      'category_assignment': { warning: 80, critical: 100 },
      'receipt_scan_parse': { warning: 4000, critical: 5000 },
      'bank_sync': { warning: 8000, critical: 10000 },
      'report_generation': { warning: 1500, critical: 2000 },
    };

    return thresholds[metric] || null;
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }
}

/**
 * Convenience function to check metrics and fire alerts
 */
export async function checkMetricsAndAlert(): Promise<void> {
  await PerformanceAlerter.getInstance().checkMetricsAndAlert();
}