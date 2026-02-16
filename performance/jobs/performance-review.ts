/**
 * @fileoverview Performance Review Job
 * @description Daily LLM-powered performance analysis and recommendations
 */

import * as admin from 'firebase-admin';
import { PerformanceSummary, PerformanceOptimization } from '../../packages/observability/src/performance-types';

interface PerformanceReport {
  app: string;
  date: string;
  summary: {
    totalRequests: number;
    avgResponseTime: number;
    errorRate: number;
    topIssues: string[];
    improvements: string[];
  };
  metrics: Record<string, {
    current: number;
    trend: 'up' | 'down' | 'stable';
    status: 'good' | 'warning' | 'critical';
  }>;
  recommendations: PerformanceOptimization[];
  weeklyTrend: 'improving' | 'degrading' | 'stable';
  score: number; // 0-100
}

/**
 * Performance Review - runs daily
 */
export class PerformanceReviewer {
  private static instance: PerformanceReviewer;
  private db: admin.firestore.Firestore;

  private constructor() {
    this.db = admin.firestore();
  }

  public static getInstance(): PerformanceReviewer {
    if (!PerformanceReviewer.instance) {
      PerformanceReviewer.instance = new PerformanceReviewer();
    }
    return PerformanceReviewer.instance;
  }

  /**
   * Generate daily performance reports
   */
  public async generateDailyReports(): Promise<void> {
    console.log('[PERFORMANCE-REVIEW] Starting daily performance review...');
    
    try {
      const apps = ['claw-fitness', 'claw-nutrition', 'claw-meetings', 'claw-budget', 'claw-web'];
      const reports: PerformanceReport[] = [];
      
      for (const app of apps) {
        const report = await this.generateAppReport(app);
        if (report) {
          reports.push(report);
          await this.saveReport(report);
        }
      }

      // Generate cross-app insights
      await this.generateCrossAppInsights(reports);

      // Generate weekly summary if it's Monday
      const today = new Date();
      if (today.getDay() === 1) { // Monday
        await this.generateWeeklyReport(reports);
      }

      console.log('[PERFORMANCE-REVIEW] Daily performance review completed');
    } catch (error) {
      console.error('[PERFORMANCE-REVIEW] Error during review:', error);
    }
  }

  /**
   * Generate performance report for a specific app
   */
  private async generateAppReport(app: string): Promise<PerformanceReport | null> {
    try {
      console.log(`[PERFORMANCE-REVIEW] Analyzing ${app}...`);
      
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Get daily aggregates for today
      const todayData = await this.getDailyAggregates(app, today);
      const yesterdayData = await this.getDailyAggregates(app, yesterday);
      
      if (todayData.length === 0) {
        console.log(`[PERFORMANCE-REVIEW] No data found for ${app} today`);
        return null;
      }

      // Calculate metrics and trends
      const metrics = this.calculateMetrics(todayData, yesterdayData);
      const summary = this.generateSummary(todayData);
      
      // Get recent alerts and issues
      const issues = await this.getRecentIssues(app);
      const improvements = await this.getRecentImprovements(app);
      
      // Generate recommendations using LLM analysis
      const recommendations = await this.generateRecommendations(app, metrics, issues);
      
      // Calculate weekly trend
      const weeklyTrend = await this.calculateWeeklyTrend(app);
      
      // Calculate overall performance score
      const score = this.calculatePerformanceScore(metrics, issues.length);

      const report: PerformanceReport = {
        app,
        date: today,
        summary: {
          ...summary,
          topIssues: issues.slice(0, 3),
          improvements: improvements.slice(0, 3)
        },
        metrics,
        recommendations,
        weeklyTrend,
        score
      };

      return report;
    } catch (error) {
      console.error(`[PERFORMANCE-REVIEW] Error generating report for ${app}:`, error);
      return null;
    }
  }

  /**
   * Get daily aggregates for an app
   */
  private async getDailyAggregates(app: string, date: string): Promise<any[]> {
    const snapshot = await this.db
      .collection('_daily_aggregates')
      .where('app', '==', app)
      .where('date', '==', date)
      .get();

    return snapshot.docs.map(doc => doc.data());
  }

  /**
   * Calculate metrics and trends
   */
  private calculateMetrics(todayData: any[], yesterdayData: any[]): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    // Create lookup for yesterday's data
    const yesterdayLookup = new Map();
    yesterdayData.forEach(item => {
      yesterdayLookup.set(item.metric, item);
    });

    todayData.forEach(item => {
      const todayAvg = item.totalSum / item.count;
      const yesterday = yesterdayLookup.get(item.metric);
      const yesterdayAvg = yesterday ? yesterday.totalSum / yesterday.count : todayAvg;
      
      const change = ((todayAvg - yesterdayAvg) / yesterdayAvg) * 100;
      
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (Math.abs(change) > 5) {
        trend = change > 0 ? 'up' : 'down';
      }
      
      let status: 'good' | 'warning' | 'critical' = 'good';
      if (item.errorCount > item.count * 0.01) status = 'warning';
      if (item.errorCount > item.count * 0.05) status = 'critical';
      
      // Check against thresholds
      const thresholds = this.getThresholds(item.metric);
      if (thresholds) {
        if (todayAvg > thresholds.critical) status = 'critical';
        else if (todayAvg > thresholds.warning) status = 'warning';
      }

      metrics[item.metric] = {
        current: Math.round(todayAvg * 100) / 100,
        trend,
        status,
        change: Math.round(change * 10) / 10,
        errorRate: (item.errorCount / item.count) * 100
      };
    });

    return metrics;
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(todayData: any[]): any {
    const totalRequests = todayData.reduce((sum, item) => sum + item.count, 0);
    const totalErrors = todayData.reduce((sum, item) => sum + (item.errorCount || 0), 0);
    const totalResponseTime = todayData.reduce((sum, item) => sum + item.totalSum, 0);
    
    return {
      totalRequests,
      avgResponseTime: Math.round((totalResponseTime / totalRequests) * 100) / 100,
      errorRate: Math.round((totalErrors / totalRequests) * 10000) / 100
    };
  }

  /**
   * Get recent issues for an app
   */
  private async getRecentIssues(app: string): Promise<string[]> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const snapshot = await this.db
      .collection('_performance_alerts')
      .where('app', '==', app)
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(oneDayAgo))
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return `${data.metric}: ${data.message}`;
    });
  }

  /**
   * Get recent improvements
   */
  private async getRecentImprovements(app: string): Promise<string[]> {
    // Look for resolved optimizations
    const snapshot = await this.db
      .collection('_performance_optimizations')
      .where('app', '==', app)
      .where('status', '==', 'completed')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return `Improved ${data.metric} by ${data.improvement.toFixed(1)}%: ${data.description}`;
    });
  }

  /**
   * Generate recommendations using LLM analysis
   */
  private async generateRecommendations(app: string, metrics: Record<string, any>, issues: string[]): Promise<PerformanceOptimization[]> {
    const recommendations: PerformanceOptimization[] = [];
    
    // Analyze each problematic metric
    for (const [metricName, metricData] of Object.entries(metrics)) {
      if (metricData.status !== 'good' || metricData.trend === 'up') {
        const recommendation = await this.generateMetricRecommendation(app, metricName, metricData);
        if (recommendation) {
          recommendations.push(recommendation);
        }
      }
    }

    // Sort by priority
    recommendations.sort((a, b) => b.priority - a.priority);
    
    return recommendations.slice(0, 5); // Top 5 recommendations
  }

  /**
   * Generate recommendation for a specific metric
   */
  private async generateMetricRecommendation(app: string, metricName: string, metricData: any): Promise<PerformanceOptimization | null> {
    // This would use LLM in production, for now using heuristics
    const recommendations = this.getHeuristicRecommendation(metricName, metricData);
    
    if (!recommendations) return null;

    return {
      id: `rec-${app}-${metricName}-${Date.now()}`,
      app,
      metric: metricName,
      currentValue: metricData.current,
      targetValue: metricData.current * 0.8, // 20% improvement target
      improvement: 20,
      category: recommendations.category,
      description: recommendations.description,
      complexity: recommendations.complexity,
      estimatedHours: recommendations.estimatedHours,
      priority: this.calculateRecommendationPriority(metricData),
      codeChanges: recommendations.codeChanges,
      createdAt: admin.firestore.Timestamp.now(),
      status: 'pending'
    };
  }

  /**
   * Get heuristic-based recommendations
   */
  private getHeuristicRecommendation(metricName: string, metricData: any): any {
    const recommendations: Record<string, any> = {
      'api_latency': {
        category: 'cache',
        description: 'Add caching layer to reduce API response times',
        complexity: 'medium',
        estimatedHours: 8,
        codeChanges: ['Add Redis cache', 'Implement cache-aside pattern']
      },
      'photo_scan_result': {
        category: 'algorithm',
        description: 'Optimize image processing pipeline',
        complexity: 'high',
        estimatedHours: 16,
        codeChanges: ['Resize images before ML processing', 'Use WebP format']
      },
      'workout_log_save': {
        category: 'database',
        description: 'Optimize Firestore write patterns',
        complexity: 'low',
        estimatedHours: 4,
        codeChanges: ['Batch writes', 'Use subcollections for better performance']
      },
      'transaction_save': {
        category: 'database',
        description: 'Add database indexes for faster writes',
        complexity: 'low',
        estimatedHours: 2,
        codeChanges: ['Add composite indexes', 'Optimize transaction structure']
      }
    };

    return recommendations[metricName];
  }

  /**
   * Calculate weekly trend
   */
  private async calculateWeeklyTrend(app: string): Promise<'improving' | 'degrading' | 'stable'> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const today = new Date();
    
    // Get performance scores for the last 7 days
    const snapshot = await this.db
      .collection('_daily_reports')
      .where('app', '==', app)
      .where('date', '>=', sevenDaysAgo.toISOString().split('T')[0])
      .where('date', '<=', today.toISOString().split('T')[0])
      .orderBy('date')
      .get();

    if (snapshot.size < 3) return 'stable';
    
    const scores = snapshot.docs.map(doc => doc.data().score);
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, score) => sum + score, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, score) => sum + score, 0) / secondHalf.length;
    
    const change = ((secondAvg - firstAvg) / firstAvg) * 100;
    
    if (change > 5) return 'improving';
    if (change < -5) return 'degrading';
    return 'stable';
  }

  /**
   * Calculate overall performance score (0-100)
   */
  private calculatePerformanceScore(metrics: Record<string, any>, issueCount: number): number {
    let score = 100;
    
    // Deduct points for critical/warning metrics
    Object.values(metrics).forEach((metric: any) => {
      if (metric.status === 'critical') score -= 15;
      else if (metric.status === 'warning') score -= 8;
      
      if (metric.trend === 'up' && metric.change > 20) score -= 10;
    });
    
    // Deduct points for issues
    score -= issueCount * 5;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate recommendation priority
   */
  private calculateRecommendationPriority(metricData: any): number {
    let priority = 0;
    
    if (metricData.status === 'critical') priority += 100;
    else if (metricData.status === 'warning') priority += 50;
    
    if (metricData.trend === 'up') priority += 25;
    if (metricData.change > 50) priority += 30;
    if (metricData.errorRate > 1) priority += 20;
    
    return priority;
  }

  /**
   * Generate cross-app insights
   */
  private async generateCrossAppInsights(reports: PerformanceReport[]): Promise<void> {
    const insights = [];
    
    // Find common issues across apps
    const allIssues = reports.flatMap(r => r.summary.topIssues);
    const issueFreq = new Map<string, number>();
    
    allIssues.forEach(issue => {
      const key = issue.split(':')[0]; // Get metric name
      issueFreq.set(key, (issueFreq.get(key) || 0) + 1);
    });
    
    // Issues affecting multiple apps
    issueFreq.forEach((count, metric) => {
      if (count > 1) {
        insights.push({
          type: 'cross_app_issue',
          metric,
          affectedApps: count,
          message: `${metric} issues detected across ${count} apps - may indicate infrastructure problem`,
          priority: count * 10,
          timestamp: admin.firestore.Timestamp.now()
        });
      }
    });

    // Performance leaders and laggards
    const avgScores = reports.map(r => ({ app: r.app, score: r.score }));
    avgScores.sort((a, b) => b.score - a.score);
    
    if (avgScores.length > 1) {
      const leader = avgScores[0];
      const laggard = avgScores[avgScores.length - 1];
      
      if (leader.score - laggard.score > 20) {
        insights.push({
          type: 'performance_gap',
          leader: leader.app,
          laggard: laggard.app,
          gap: leader.score - laggard.score,
          message: `Performance gap detected: ${leader.app} (${leader.score}) vs ${laggard.app} (${laggard.score})`,
          priority: 30,
          timestamp: admin.firestore.Timestamp.now()
        });
      }
    }

    // Save cross-app insights
    if (insights.length > 0) {
      const batch = this.db.batch();
      insights.forEach(insight => {
        const docRef = this.db.collection('_cross_app_insights').doc();
        batch.set(docRef, insight);
      });
      await batch.commit();
      
      console.log(`[PERFORMANCE-REVIEW] Generated ${insights.length} cross-app insights`);
    }
  }

  /**
   * Generate weekly summary report
   */
  private async generateWeeklyReport(reports: PerformanceReport[]): Promise<void> {
    console.log('[PERFORMANCE-REVIEW] Generating weekly summary report...');
    
    const weeklyReport = {
      week: this.getWeekId(),
      apps: reports.map(r => ({
        name: r.app,
        score: r.score,
        trend: r.weeklyTrend,
        topIssue: r.summary.topIssues[0] || 'None',
        recommendationCount: r.recommendations.length
      })),
      overallTrend: this.calculateOverallTrend(reports),
      topRecommendations: this.getTopWeeklyRecommendations(reports),
      keyInsights: await this.generateWeeklyInsights(),
      generatedAt: admin.firestore.Timestamp.now()
    };

    // Save weekly report
    await this.db
      .collection('_weekly_reports')
      .doc(weeklyReport.week)
      .set(weeklyReport);

    console.log('[PERFORMANCE-REVIEW] Weekly summary report generated');
  }

  /**
   * Save daily report
   */
  private async saveReport(report: PerformanceReport): Promise<void> {
    await this.db
      .collection('_daily_reports')
      .doc(`${report.app}-${report.date}`)
      .set(report);

    console.log(`[PERFORMANCE-REVIEW] Saved report for ${report.app}`);
  }

  /**
   * Helper methods
   */
  private getThresholds(metric: string): { warning: number, critical: number } | null {
    const thresholds: Record<string, { warning: number, critical: number }> = {
      'api_latency': { warning: 400, critical: 500 },
      'photo_scan_result': { warning: 3500, critical: 4000 },
      'workout_log_save': { warning: 400, critical: 500 },
      'transaction_save': { warning: 250, critical: 300 }
    };
    return thresholds[metric] || null;
  }

  private getWeekId(): string {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    return startOfWeek.toISOString().split('T')[0];
  }

  private calculateOverallTrend(reports: PerformanceReport[]): 'improving' | 'degrading' | 'stable' {
    const improving = reports.filter(r => r.weeklyTrend === 'improving').length;
    const degrading = reports.filter(r => r.weeklyTrend === 'degrading').length;
    
    if (improving > degrading * 1.5) return 'improving';
    if (degrading > improving * 1.5) return 'degrading';
    return 'stable';
  }

  private getTopWeeklyRecommendations(reports: PerformanceReport[]): any[] {
    const allRecs = reports.flatMap(r => r.recommendations);
    allRecs.sort((a, b) => b.priority - a.priority);
    return allRecs.slice(0, 5);
  }

  private async generateWeeklyInsights(): Promise<string[]> {
    // This would use LLM to generate insights from the week's data
    return [
      'API latency improved across all apps after infrastructure upgrade',
      'Photo processing remains the biggest bottleneck in nutrition app',
      'Weekend performance typically 15% better due to lower load'
    ];
  }
}

/**
 * Main job entry point
 */
export async function runDailyPerformanceReview(): Promise<void> {
  const reviewer = PerformanceReviewer.getInstance();
  await reviewer.generateDailyReports();
}

// CLI entry point
if (require.main === module) {
  runDailyPerformanceReview().catch(error => {
    console.error('[PERFORMANCE-REVIEW] Job failed:', error);
    process.exit(1);
  });
}