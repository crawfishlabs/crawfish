/**
 * @fileoverview Metric Collector Job
 * @description Aggregates raw performance data into summaries every 6 hours
 */

import * as admin from 'firebase-admin';
import { PerformanceSummary } from '../../packages/observability/src/performance-types';

/**
 * Metric Collector - runs every 6 hours
 */
export class MetricCollector {
  private static instance: MetricCollector;
  private db: admin.firestore.Firestore;

  private constructor() {
    this.db = admin.firestore();
  }

  public static getInstance(): MetricCollector {
    if (!MetricCollector.instance) {
      MetricCollector.instance = new MetricCollector();
    }
    return MetricCollector.instance;
  }

  /**
   * Main collection process
   */
  public async collectMetrics(): Promise<void> {
    console.log('[METRIC-COLLECTOR] Starting metric collection...');
    
    try {
      const apps = ['claw-fitness', 'claw-nutrition', 'claw-meetings', 'claw-budget', 'claw-web'];
      const now = new Date();
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      
      for (const app of apps) {
        await this.collectAppMetrics(app, sixHoursAgo, now);
      }

      console.log('[METRIC-COLLECTOR] Metric collection completed');
    } catch (error) {
      console.error('[METRIC-COLLECTOR] Error during collection:', error);
    }
  }

  /**
   * Collect metrics for a specific app
   */
  private async collectAppMetrics(app: string, startTime: Date, endTime: Date): Promise<void> {
    console.log(`[METRIC-COLLECTOR] Collecting metrics for ${app}...`);
    
    const metrics = await this.getUniqueMetrics(app, startTime, endTime);
    
    for (const metricName of metrics) {
      await this.aggregateMetric(app, metricName, startTime, endTime);
    }
  }

  /**
   * Get unique metric names for an app in the time window
   */
  private async getUniqueMetrics(app: string, startTime: Date, endTime: Date): Promise<string[]> {
    const snapshot = await this.db
      .collection('_performance_metrics')
      .where('app', '==', app)
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startTime))
      .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(endTime))
      .select('name')
      .get();

    const uniqueMetrics = new Set<string>();
    snapshot.docs.forEach(doc => {
      uniqueMetrics.add(doc.data().name);
    });

    return Array.from(uniqueMetrics);
  }

  /**
   * Aggregate a specific metric
   */
  private async aggregateMetric(app: string, metricName: string, startTime: Date, endTime: Date): Promise<void> {
    try {
      const snapshot = await this.db
        .collection('_performance_metrics')
        .where('app', '==', app)
        .where('name', '==', metricName)
        .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startTime))
        .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(endTime))
        .get();

      if (snapshot.empty) {
        return;
      }

      const values = snapshot.docs.map(doc => doc.data().value as number);
      const successes = snapshot.docs.filter(doc => doc.data().metadata?.success !== 'false');
      
      values.sort((a, b) => a - b);

      const summary: PerformanceSummary = {
        metric: metricName,
        app,
        timeRange: '6h',
        count: values.length,
        p50: this.percentile(values, 0.5),
        p95: this.percentile(values, 0.95),
        p99: this.percentile(values, 0.99),
        avg: values.reduce((sum, val) => sum + val, 0) / values.length,
        min: values[0],
        max: values[values.length - 1],
        successRate: successes.length / snapshot.size,
        errorCount: snapshot.size - successes.length
      };

      // Store aggregated summary
      const periodId = this.getPeriodId(startTime, endTime);
      const summaryRef = this.db
        .collection('_performance_summaries')
        .doc(`${app}:${metricName}:${periodId}`);

      await summaryRef.set({
        ...summary,
        startTime: admin.firestore.Timestamp.fromDate(startTime),
        endTime: admin.firestore.Timestamp.fromDate(endTime),
        collectedAt: admin.firestore.Timestamp.now()
      });

      // Update daily and hourly aggregates
      await this.updateDailyAggregate(app, metricName, summary, startTime);
      await this.updateHourlyAggregate(app, metricName, summary, startTime);

      console.log(`[METRIC-COLLECTOR] Aggregated ${metricName} for ${app}: ${values.length} data points`);
      
    } catch (error) {
      console.error(`[METRIC-COLLECTOR] Error aggregating ${metricName} for ${app}:`, error);
    }
  }

  /**
   * Update daily aggregate
   */
  private async updateDailyAggregate(app: string, metricName: string, summary: PerformanceSummary, timestamp: Date): Promise<void> {
    const dateStr = timestamp.toISOString().split('T')[0];
    const dailyRef = this.db.collection('_daily_aggregates').doc(`${app}:${metricName}:${dateStr}`);

    await this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(dailyRef);
      const existing = doc.exists ? doc.data() : null;

      const updatedData = {
        app,
        metric: metricName,
        date: dateStr,
        count: (existing?.count || 0) + summary.count,
        totalSum: (existing?.totalSum || 0) + (summary.avg * summary.count),
        p50Values: [...(existing?.p50Values || []), summary.p50],
        p95Values: [...(existing?.p95Values || []), summary.p95],
        p99Values: [...(existing?.p99Values || []), summary.p99],
        minValue: existing?.minValue ? Math.min(existing.minValue, summary.min) : summary.min,
        maxValue: existing?.maxValue ? Math.max(existing.maxValue, summary.max) : summary.max,
        errorCount: (existing?.errorCount || 0) + (summary.errorCount || 0),
        lastUpdated: admin.firestore.Timestamp.now()
      };

      transaction.set(dailyRef, updatedData);
    });
  }

  /**
   * Update hourly aggregate
   */
  private async updateHourlyAggregate(app: string, metricName: string, summary: PerformanceSummary, timestamp: Date): Promise<void> {
    const hourStr = `${timestamp.toISOString().split('T')[0]}:${timestamp.getHours().toString().padStart(2, '0')}`;
    const hourlyRef = this.db.collection('_hourly_aggregates').doc(`${app}:${metricName}:${hourStr}`);

    await hourlyRef.set({
      app,
      metric: metricName,
      hour: hourStr,
      ...summary,
      aggregatedAt: admin.firestore.Timestamp.now()
    });
  }

  /**
   * Generate insights from aggregated data
   */
  public async generateInsights(): Promise<void> {
    console.log('[METRIC-COLLECTOR] Generating performance insights...');
    
    try {
      const apps = ['claw-fitness', 'claw-nutrition', 'claw-meetings', 'claw-budget', 'claw-web'];
      
      for (const app of apps) {
        await this.generateAppInsights(app);
      }
    } catch (error) {
      console.error('[METRIC-COLLECTOR] Error generating insights:', error);
    }
  }

  /**
   * Generate insights for a specific app
   */
  private async generateAppInsights(app: string): Promise<void> {
    const insights = [];
    
    // Get daily aggregates for the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dateStr = sevenDaysAgo.toISOString().split('T')[0];
    
    const snapshot = await this.db
      .collection('_daily_aggregates')
      .where('app', '==', app)
      .where('date', '>=', dateStr)
      .get();

    const metricTrends: Record<string, { current: number; previous: number }> = {};
    
    // Analyze trends
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const metric = data.metric;
      const avgValue = data.totalSum / data.count;
      
      if (!metricTrends[metric]) {
        metricTrends[metric] = { current: avgValue, previous: avgValue };
      } else {
        metricTrends[metric].previous = metricTrends[metric].current;
        metricTrends[metric].current = avgValue;
      }
    });

    // Generate insights based on trends
    for (const [metric, trend] of Object.entries(metricTrends)) {
      const changePercent = ((trend.current - trend.previous) / trend.previous) * 100;
      
      if (Math.abs(changePercent) > 10) {
        const direction = changePercent > 0 ? 'increased' : 'decreased';
        insights.push({
          app,
          metric,
          type: 'trend',
          message: `${metric} has ${direction} by ${Math.abs(changePercent).toFixed(1)}% over the last week`,
          changePercent,
          impact: this.categorizeImpact(Math.abs(changePercent)),
          timestamp: admin.firestore.Timestamp.now()
        });
      }
    }

    // Save insights
    if (insights.length > 0) {
      const batch = this.db.batch();
      insights.forEach(insight => {
        const docRef = this.db.collection('_performance_insights').doc();
        batch.set(docRef, insight);
      });
      await batch.commit();
      
      console.log(`[METRIC-COLLECTOR] Generated ${insights.length} insights for ${app}`);
    }
  }

  /**
   * Clean up old data
   */
  public async cleanupOldData(): Promise<void> {
    console.log('[METRIC-COLLECTOR] Cleaning up old data...');
    
    try {
      // Delete raw metrics older than 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const oldMetrics = await this.db
        .collection('_performance_metrics')
        .where('timestamp', '<', admin.firestore.Timestamp.fromDate(sevenDaysAgo))
        .limit(500)
        .get();

      if (!oldMetrics.empty) {
        const batch = this.db.batch();
        oldMetrics.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        
        console.log(`[METRIC-COLLECTOR] Deleted ${oldMetrics.size} old metric records`);
      }

      // Delete old alerts older than 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const oldAlerts = await this.db
        .collection('_performance_alerts')
        .where('timestamp', '<', admin.firestore.Timestamp.fromDate(thirtyDaysAgo))
        .limit(200)
        .get();

      if (!oldAlerts.empty) {
        const batch = this.db.batch();
        oldAlerts.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        
        console.log(`[METRIC-COLLECTOR] Deleted ${oldAlerts.size} old alert records`);
      }

    } catch (error) {
      console.error('[METRIC-COLLECTOR] Error cleaning up old data:', error);
    }
  }

  /**
   * Helper methods
   */
  private percentile(values: number[], percentile: number): number {
    const index = Math.ceil(values.length * percentile) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))];
  }

  private getPeriodId(startTime: Date, endTime: Date): string {
    return `${startTime.toISOString().split('T')[0]}-${startTime.getHours().toString().padStart(2, '0')}`;
  }

  private categorizeImpact(changePercent: number): 'low' | 'medium' | 'high' {
    if (changePercent < 20) return 'low';
    if (changePercent < 50) return 'medium';
    return 'high';
  }
}

/**
 * Main job entry point
 */
export async function runMetricCollection(): Promise<void> {
  const collector = MetricCollector.getInstance();
  
  // Collect and aggregate metrics
  await collector.collectMetrics();
  
  // Generate insights
  await collector.generateInsights();
  
  // Clean up old data
  await collector.cleanupOldData();
}

// CLI entry point
if (require.main === module) {
  runMetricCollection().catch(error => {
    console.error('[METRIC-COLLECTOR] Job failed:', error);
    process.exit(1);
  });
}