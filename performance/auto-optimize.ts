/**
 * @fileoverview Autonomous Performance Optimization System
 * @description Detects performance issues, analyzes root causes, and generates fixes
 */

import * as admin from 'firebase-admin';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PerformanceSummary, PerformanceRegression, PerformanceOptimization } from '../packages/observability/src/performance-types';
import { getMetrics } from '../packages/observability/src/performance';

const execAsync = promisify(exec);

interface AnalysisResult {
  cause: string;
  confidence: number;
  affectedCode: string[];
  suggestedFix: string;
  category: 'database' | 'cache' | 'algorithm' | 'infrastructure' | 'bundle';
  complexity: 'low' | 'medium' | 'high';
  estimatedHours: number;
}

interface GitCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: Date;
  files: string[];
}

/**
 * Autonomous Performance Optimizer
 */
export class AutoOptimizer {
  private static instance: AutoOptimizer;
  private db: admin.firestore.Firestore;
  
  private constructor() {
    this.db = admin.firestore();
  }

  public static getInstance(): AutoOptimizer {
    if (!AutoOptimizer.instance) {
      AutoOptimizer.instance = new AutoOptimizer();
    }
    return AutoOptimizer.instance;
  }

  /**
   * Main optimization loop - detects and fixes performance issues
   */
  public async runOptimizationLoop(): Promise<void> {
    console.log('[AUTO-OPTIMIZER] Starting performance optimization loop...');
    
    try {
      const apps = ['claw-fitness', 'claw-nutrition', 'claw-meetings', 'claw-budget', 'claw-web'];
      
      for (const app of apps) {
        await this.optimizeApp(app);
      }
      
      console.log('[AUTO-OPTIMIZER] Optimization loop completed');
    } catch (error) {
      console.error('[AUTO-OPTIMIZER] Error in optimization loop:', error);
    }
  }

  /**
   * Optimize a specific app
   */
  private async optimizeApp(app: string): Promise<void> {
    console.log(`[AUTO-OPTIMIZER] Analyzing ${app}...`);
    
    // Step 1: Detect performance issues
    const issues = await this.detectPerformanceIssues(app);
    
    if (issues.length === 0) {
      console.log(`[AUTO-OPTIMIZER] No performance issues detected for ${app}`);
      return;
    }

    console.log(`[AUTO-OPTIMIZER] Found ${issues.length} performance issues for ${app}`);

    // Step 2: Analyze each issue and generate fixes
    for (const issue of issues) {
      await this.analyzeAndFix(app, issue);
    }
  }

  /**
   * Step 1: Detect performance issues
   */
  private async detectPerformanceIssues(app: string): Promise<PerformanceRegression[]> {
    const issues: PerformanceRegression[] = [];
    const metricsToCheck = this.getMetricsToCheck(app);
    
    for (const metric of metricsToCheck) {
      // Compare current performance to baseline
      const currentPerf = await getMetrics(app, metric, '24h');
      const baselinePerf = await this.getBaseline(app, metric);
      
      if (!baselinePerf || currentPerf.count === 0) {
        continue;
      }

      // Check for significant regression (>20% degradation)
      const degradation = ((currentPerf.p95 - baselinePerf) / baselinePerf) * 100;
      
      if (degradation > 20) {
        const severity = this.determineSeverity(degradation, metric);
        
        issues.push({
          id: `${app}-${metric}-${Date.now()}`,
          app,
          metric,
          baselineValue: baselinePerf,
          currentValue: currentPerf.p95,
          changePercent: degradation,
          detectedAt: admin.firestore.Timestamp.now(),
          possibleCauses: [],
          severity,
          status: 'investigating'
        });
      }
    }
    
    return issues;
  }

  /**
   * Step 2: Analyze root cause and generate fix
   */
  private async analyzeAndFix(app: string, issue: PerformanceRegression): Promise<void> {
    console.log(`[AUTO-OPTIMIZER] Analyzing issue: ${issue.metric} degraded by ${issue.changePercent.toFixed(1)}%`);
    
    try {
      // Get recent code changes
      const recentCommits = await this.getRecentCommits(app);
      
      // Analyze with LLM
      const analysis = await this.analyzeWithLLM(issue, recentCommits);
      
      if (analysis.confidence < 0.7) {
        console.log(`[AUTO-OPTIMIZER] Low confidence analysis (${analysis.confidence}), skipping auto-fix`);
        await this.createManualInvestigation(issue, analysis);
        return;
      }

      // Generate optimization suggestion
      const optimization = await this.generateOptimization(issue, analysis);
      
      // Decide on action based on impact and complexity
      await this.decideAndAct(issue, optimization);
      
    } catch (error) {
      console.error(`[AUTO-OPTIMIZER] Error analyzing issue ${issue.id}:`, error);
    }
  }

  /**
   * Analyze performance issue with LLM
   */
  private async analyzeWithLLM(issue: PerformanceRegression, commits: GitCommit[]): Promise<AnalysisResult> {
    const prompt = this.buildAnalysisPrompt(issue, commits);
    
    // This would call your LLM API (OpenAI, Claude, etc.)
    // For now, returning mock analysis
    const mockAnalysis: AnalysisResult = {
      cause: this.inferCause(issue, commits),
      confidence: 0.8,
      affectedCode: this.identifyAffectedCode(commits),
      suggestedFix: this.generateSuggestedFix(issue),
      category: this.categorizeIssue(issue.metric),
      complexity: 'medium',
      estimatedHours: 4
    };
    
    return mockAnalysis;
  }

  /**
   * Generate performance optimization
   */
  private async generateOptimization(issue: PerformanceRegression, analysis: AnalysisResult): Promise<PerformanceOptimization> {
    const targetImprovement = Math.min(issue.changePercent * 0.8, 50); // Aim to recover 80% of degradation
    const targetValue = issue.baselineValue * (1 + (issue.changePercent - targetImprovement) / 100);
    
    return {
      id: `opt-${issue.id}`,
      app: issue.app,
      metric: issue.metric,
      currentValue: issue.currentValue,
      targetValue,
      improvement: targetImprovement,
      category: analysis.category,
      description: analysis.suggestedFix,
      complexity: analysis.complexity,
      estimatedHours: analysis.estimatedHours,
      priority: this.calculatePriority(issue, analysis),
      codeChanges: this.generateCodeChanges(analysis),
      configChanges: this.generateConfigChanges(analysis),
      createdAt: admin.firestore.Timestamp.now(),
      status: 'pending'
    };
  }

  /**
   * Decide on action and execute
   */
  private async decideAndAct(issue: PerformanceRegression, optimization: PerformanceOptimization): Promise<void> {
    const impact = this.categorizeImpact(issue.changePercent);
    
    switch (impact) {
      case 'low':
        // Auto-create MR, auto-merge if tests pass
        await this.autoImplementAndMerge(optimization);
        break;
        
      case 'medium':
        // Create MR, notify Sam, wait for approval
        await this.createMRAndNotify(optimization);
        break;
        
      case 'high':
        // Create MR, block deployments, alert immediately
        await this.createMRAndBlock(optimization);
        break;
    }
  }

  /**
   * Auto-implement low-impact fixes
   */
  private async autoImplementAndMerge(optimization: PerformanceOptimization): Promise<void> {
    try {
      console.log(`[AUTO-OPTIMIZER] Auto-implementing low-impact fix: ${optimization.description}`);
      
      // Generate the fix code/config
      if (optimization.codeChanges && optimization.codeChanges.length > 0) {
        await this.applyCodeChanges(optimization);
      }
      
      if (optimization.configChanges) {
        await this.applyConfigChanges(optimization);
      }
      
      // Create and merge MR
      await this.createGitMR(optimization, true);
      
      // Update status
      await this.updateOptimizationStatus(optimization.id, 'in_progress');
      
    } catch (error) {
      console.error(`[AUTO-OPTIMIZER] Error auto-implementing fix:`, error);
    }
  }

  /**
   * Create MR and notify for medium-impact issues
   */
  private async createMRAndNotify(optimization: PerformanceOptimization): Promise<void> {
    try {
      console.log(`[AUTO-OPTIMIZER] Creating MR for medium-impact fix: ${optimization.description}`);
      
      // Generate the fix code/config
      if (optimization.codeChanges && optimization.codeChanges.length > 0) {
        await this.applyCodeChanges(optimization);
      }
      
      // Create MR (don't auto-merge)
      const mrUrl = await this.createGitMR(optimization, false);
      
      // Notify Sam via Telegram
      await this.notifyTelegram(
        `🔧 Performance Fix Ready for Review\n\n` +
        `**App:** ${optimization.app}\n` +
        `**Issue:** ${optimization.metric} degraded by ${optimization.improvement.toFixed(1)}%\n` +
        `**Fix:** ${optimization.description}\n` +
        `**Complexity:** ${optimization.complexity}\n\n` +
        `[Review MR](${mrUrl})`
      );
      
    } catch (error) {
      console.error(`[AUTO-OPTIMIZER] Error creating MR:`, error);
    }
  }

  /**
   * Create MR and block deployments for high-impact issues
   */
  private async createMRAndBlock(optimization: PerformanceOptimization): Promise<void> {
    try {
      console.log(`[AUTO-OPTIMIZER] CRITICAL: Creating blocking MR for high-impact fix: ${optimization.description}`);
      
      // Block all deployments
      await this.blockDeployments(optimization.app);
      
      // Generate the fix
      if (optimization.codeChanges && optimization.codeChanges.length > 0) {
        await this.applyCodeChanges(optimization);
      }
      
      // Create urgent MR
      const mrUrl = await this.createGitMR(optimization, false, true);
      
      // Alert immediately via Telegram
      await this.notifyTelegram(
        `🚨 CRITICAL Performance Issue - Deployments Blocked\n\n` +
        `**App:** ${optimization.app}\n` +
        `**Issue:** ${optimization.metric} degraded by ${optimization.improvement.toFixed(1)}%\n` +
        `**Impact:** ${this.categorizeImpact(optimization.improvement)} impact\n` +
        `**Fix:** ${optimization.description}\n\n` +
        `⚠️ All deployments blocked until this is resolved.\n\n` +
        `[Review Urgent MR](${mrUrl})`
      );
      
    } catch (error) {
      console.error(`[AUTO-OPTIMIZER] Error creating blocking MR:`, error);
    }
  }

  /**
   * Helper methods
   */
  
  private getMetricsToCheck(app: string): string[] {
    const universal = ['api_latency', 'llm_response_time', 'cold_start'];
    const appSpecific: Record<string, string[]> = {
      'claw-fitness': ['rest_timer_accuracy', 'workout_log_save', 'exercise_search'],
      'claw-nutrition': ['photo_scan_result', 'barcode_lookup', 'food_search'],
      'claw-meetings': ['recording_start', 'transcription_latency_per_minute', 'meeting_analysis'],
      'claw-budget': ['budget_view_load', 'transaction_save', 'category_assignment']
    };
    return [...universal, ...(appSpecific[app] || [])];
  }

  private async getBaseline(app: string, metric: string): Promise<number | null> {
    try {
      const doc = await this.db
        .collection('_performance_baselines')
        .doc(`${app}:${metric}`)
        .get();
      
      return doc.exists ? doc.data()?.value || null : null;
    } catch (error) {
      console.error('Error getting baseline:', error);
      return null;
    }
  }

  private determineSeverity(degradation: number, metric: string): 'minor' | 'major' | 'critical' {
    const criticalMetrics = ['api_latency', 'photo_scan_result', 'recording_start', 'transaction_save'];
    
    if (criticalMetrics.includes(metric) && degradation > 50) return 'critical';
    if (degradation > 100) return 'critical';
    if (degradation > 50) return 'major';
    return 'minor';
  }

  private categorizeImpact(changePercent: number): 'low' | 'medium' | 'high' {
    if (changePercent < 30) return 'low';
    if (changePercent < 75) return 'medium';
    return 'high';
  }

  private async getRecentCommits(app: string): Promise<GitCommit[]> {
    try {
      const { stdout } = await execAsync(
        `cd /home/sam/.openclaw/workspace/projects/${app} && git log --since="24 hours ago" --pretty=format:"%H|%s|%an|%ad" --date=iso --name-only`
      );
      
      // Parse git log output
      const commits: GitCommit[] = [];
      const lines = stdout.split('\n');
      let currentCommit: Partial<GitCommit> | null = null;
      
      for (const line of lines) {
        if (line.includes('|')) {
          if (currentCommit) {
            commits.push(currentCommit as GitCommit);
          }
          const [hash, message, author, timestamp] = line.split('|');
          currentCommit = {
            hash,
            message,
            author,
            timestamp: new Date(timestamp),
            files: []
          };
        } else if (line.trim() && currentCommit) {
          currentCommit.files = currentCommit.files || [];
          currentCommit.files.push(line.trim());
        }
      }
      
      if (currentCommit) {
        commits.push(currentCommit as GitCommit);
      }
      
      return commits;
    } catch (error) {
      console.error('Error getting recent commits:', error);
      return [];
    }
  }

  private buildAnalysisPrompt(issue: PerformanceRegression, commits: GitCommit[]): string {
    return `Performance degradation detected:

App: ${issue.app}
Metric: ${issue.metric}
Baseline: ${issue.baselineValue}ms
Current: ${issue.currentValue}ms
Degradation: ${issue.changePercent.toFixed(1)}%

Recent commits (last 24h):
${commits.map(c => `- ${c.hash.slice(0, 8)}: ${c.message} (${c.author})`).join('\n')}

Files changed:
${commits.flatMap(c => c.files).join(', ')}

Analyze the likely cause of this performance degradation and suggest a fix.
Return confidence level (0-1) and categorize the fix type.`;
  }

  private inferCause(issue: PerformanceRegression, commits: GitCommit[]): string {
    // Simple heuristic-based cause inference
    if (issue.metric.includes('database') || issue.metric.includes('load')) {
      return 'Database query performance degradation';
    }
    if (issue.metric.includes('scan') || issue.metric.includes('process')) {
      return 'Processing algorithm inefficiency';
    }
    return 'General performance regression';
  }

  private identifyAffectedCode(commits: GitCommit[]): string[] {
    return commits.flatMap(c => c.files).slice(0, 5);
  }

  private generateSuggestedFix(issue: PerformanceRegression): string {
    if (issue.metric.includes('database') || issue.metric.includes('load')) {
      return 'Add database index or optimize query';
    }
    if (issue.metric.includes('scan') || issue.metric.includes('process')) {
      return 'Optimize processing algorithm or add caching';
    }
    return 'General performance optimization needed';
  }

  private categorizeIssue(metric: string): 'database' | 'cache' | 'algorithm' | 'infrastructure' | 'bundle' {
    if (metric.includes('database') || metric.includes('load')) return 'database';
    if (metric.includes('scan') || metric.includes('process')) return 'algorithm';
    if (metric.includes('cold_start')) return 'infrastructure';
    return 'cache';
  }

  private calculatePriority(issue: PerformanceRegression, analysis: AnalysisResult): number {
    let priority = 0;
    priority += issue.changePercent / 10; // More degradation = higher priority
    priority += analysis.confidence * 50; // Higher confidence = higher priority
    if (issue.severity === 'critical') priority += 100;
    if (issue.severity === 'major') priority += 50;
    return Math.round(priority);
  }

  private generateCodeChanges(analysis: AnalysisResult): string[] {
    // This would generate actual code changes based on the analysis
    return [`// TODO: ${analysis.suggestedFix}`];
  }

  private generateConfigChanges(analysis: AnalysisResult): Record<string, any> {
    if (analysis.category === 'infrastructure') {
      return { memory: '512MB', timeout: '30s' };
    }
    return {};
  }

  private async applyCodeChanges(optimization: PerformanceOptimization): Promise<void> {
    // Implementation would apply the actual code changes
    console.log(`Applying code changes for ${optimization.id}`);
  }

  private async applyConfigChanges(optimization: PerformanceOptimization): Promise<void> {
    // Implementation would apply configuration changes
    console.log(`Applying config changes for ${optimization.id}`);
  }

  private async createGitMR(optimization: PerformanceOptimization, autoMerge: boolean = false, urgent: boolean = false): Promise<string> {
    // Implementation would create actual Git MR/PR
    const branchName = `auto-perf-${optimization.id}`;
    console.log(`Creating Git MR on branch ${branchName}, auto-merge: ${autoMerge}`);
    return `https://gitlab.com/claw/${optimization.app}/-/merge_requests/123`;
  }

  private async blockDeployments(app: string): Promise<void> {
    // Implementation would block deployments in CI/CD pipeline
    console.log(`Blocking deployments for ${app}`);
  }

  private async notifyTelegram(message: string): Promise<void> {
    // Implementation would send to Telegram
    console.log(`[TELEGRAM] ${message}`);
  }

  private async createManualInvestigation(issue: PerformanceRegression, analysis: AnalysisResult): Promise<void> {
    const investigation = {
      ...issue,
      analysis,
      requiresManualReview: true,
      createdAt: admin.firestore.Timestamp.now()
    };
    
    await this.db.collection('_performance_investigations').doc(issue.id).set(investigation);
    console.log(`Created manual investigation for ${issue.id}`);
  }

  private async updateOptimizationStatus(id: string, status: string): Promise<void> {
    await this.db.collection('_performance_optimizations').doc(id).update({
      status,
      updatedAt: admin.firestore.Timestamp.now()
    });
  }
}

/**
 * Main entry point for the optimization loop
 */
export async function runOptimizationLoop(): Promise<void> {
  await AutoOptimizer.getInstance().runOptimizationLoop();
}

/**
 * Check-only mode for CI/CD
 */
export async function checkOnly(): Promise<void> {
  console.log('[AUTO-OPTIMIZER] Running in check-only mode...');
  // Implementation would only detect issues, not fix them
}