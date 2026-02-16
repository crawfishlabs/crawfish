/**
 * @fileoverview Performance Benchmarking System
 * @description Benchmark critical paths per app and compare against baselines
 */

import * as admin from 'firebase-admin';
import { performance } from 'perf_hooks';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PerformanceBaseline } from '../packages/observability/src/performance-types';

interface BenchmarkResult {
  name: string;
  duration: number;
  success: boolean;
  iterations: number;
  avg: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  metadata?: Record<string, any>;
}

interface BenchmarkSuite {
  app: string;
  version?: string;
  timestamp: Date;
  results: BenchmarkResult[];
  environment: 'local' | 'ci' | 'production';
  baseline?: Record<string, number>;
  regressions?: string[];
}

/**
 * Performance Benchmark Runner
 */
export class PerformanceBenchmarker {
  private static instance: PerformanceBenchmarker;
  private db: admin.firestore.Firestore;
  private baselines: Record<string, number> = {};
  
  private constructor() {
    this.db = admin.firestore();
  }

  public static getInstance(): PerformanceBenchmarker {
    if (!PerformanceBenchmarker.instance) {
      PerformanceBenchmarker.instance = new PerformanceBenchmarker();
    }
    return PerformanceBenchmarker.instance;
  }

  /**
   * Run benchmarks for an app
   */
  public async runBenchmarks(appName: string): Promise<BenchmarkSuite> {
    console.log(`[BENCHMARK] Starting benchmarks for ${appName}...`);
    
    const suite: BenchmarkSuite = {
      app: appName,
      timestamp: new Date(),
      results: [],
      environment: this.detectEnvironment(),
    };

    // Load baselines
    await this.loadBaselines(appName);
    suite.baseline = this.baselines;

    // Get benchmarks for this app
    const benchmarks = this.getBenchmarksForApp(appName);
    
    // Run each benchmark
    for (const benchmark of benchmarks) {
      console.log(`[BENCHMARK] Running ${benchmark.name}...`);
      const result = await this.runBenchmark(benchmark);
      suite.results.push(result);
    }

    // Check for regressions
    suite.regressions = this.checkForRegressions(suite.results, this.baselines);

    // Save results
    await this.saveBenchmarkResults(suite);

    console.log(`[BENCHMARK] Completed ${appName} benchmarks. Found ${suite.regressions.length} regressions.`);
    
    return suite;
  }

  /**
   * Run a single benchmark
   */
  private async runBenchmark(benchmark: BenchmarkFunction): Promise<BenchmarkResult> {
    const iterations = benchmark.iterations || 10;
    const durations: number[] = [];
    let successCount = 0;

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      let success = false;
      
      try {
        await benchmark.fn();
        success = true;
        successCount++;
      } catch (error) {
        console.error(`Benchmark ${benchmark.name} iteration ${i + 1} failed:`, error);
      }
      
      const endTime = performance.now();
      durations.push(endTime - startTime);
    }

    durations.sort((a, b) => a - b);

    return {
      name: benchmark.name,
      duration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      success: successCount === iterations,
      iterations,
      avg: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      p95: this.percentile(durations, 0.95),
      p99: this.percentile(durations, 0.99),
      min: durations[0],
      max: durations[durations.length - 1],
      metadata: {
        successRate: successCount / iterations,
        failureCount: iterations - successCount,
      }
    };
  }

  /**
   * Get benchmark functions for an app
   */
  private getBenchmarksForApp(appName: string): BenchmarkFunction[] {
    const universalBenchmarks: BenchmarkFunction[] = [
      {
        name: 'api_latency',
        iterations: 20,
        fn: this.benchmarkAPILatency
      },
      {
        name: 'cold_start',
        iterations: 5,
        fn: this.benchmarkColdStart
      }
    ];

    const appSpecificBenchmarks: Record<string, BenchmarkFunction[]> = {
      'claw-fitness': [
        {
          name: 'workout_log_save',
          iterations: 10,
          fn: this.benchmarkWorkoutLogSave
        },
        {
          name: 'exercise_search',
          iterations: 15,
          fn: this.benchmarkExerciseSearch
        },
        {
          name: 'rest_timer_accuracy',
          iterations: 5,
          fn: this.benchmarkRestTimerAccuracy
        }
      ],
      'claw-nutrition': [
        {
          name: 'photo_scan_result',
          iterations: 5,
          fn: this.benchmarkPhotoScanResult
        },
        {
          name: 'barcode_lookup',
          iterations: 20,
          fn: this.benchmarkBarcodeLookup
        },
        {
          name: 'food_search',
          iterations: 15,
          fn: this.benchmarkFoodSearch
        }
      ],
      'claw-meetings': [
        {
          name: 'recording_start',
          iterations: 10,
          fn: this.benchmarkRecordingStart
        },
        {
          name: 'meeting_search',
          iterations: 10,
          fn: this.benchmarkMeetingSearch
        }
      ],
      'claw-budget': [
        {
          name: 'budget_view_load',
          iterations: 15,
          fn: this.benchmarkBudgetViewLoad
        },
        {
          name: 'transaction_save',
          iterations: 20,
          fn: this.benchmarkTransactionSave
        },
        {
          name: 'category_assignment',
          iterations: 25,
          fn: this.benchmarkCategoryAssignment
        }
      ]
    };

    return [...universalBenchmarks, ...(appSpecificBenchmarks[appName] || [])];
  }

  /**
   * Universal benchmark functions
   */
  private async benchmarkAPILatency(): Promise<void> {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
  }

  private async benchmarkColdStart(): Promise<void> {
    // Simulate cold start delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
  }

  /**
   * ClawFitness benchmark functions
   */
  private async benchmarkWorkoutLogSave(): Promise<void> {
    // Simulate saving workout data to Firestore
    const mockWorkout = {
      userId: 'test-user',
      exercises: Array.from({ length: 5 }, (_, i) => ({
        name: `Exercise ${i + 1}`,
        sets: Array.from({ length: 3 }, (_, j) => ({
          reps: 10,
          weight: 135,
          restTime: 60
        }))
      })),
      duration: 3600,
      date: new Date()
    };
    
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
  }

  private async benchmarkExerciseSearch(): Promise<void> {
    // Simulate exercise search
    const searchTerm = 'bench press';
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 25));
  }

  private async benchmarkRestTimerAccuracy(): Promise<void> {
    // Simulate rest timer precision test
    const expectedDuration = 1000; // 1 second
    const start = performance.now();
    
    await new Promise(resolve => setTimeout(resolve, expectedDuration));
    
    const end = performance.now();
    const actualDuration = end - start;
    const drift = Math.abs(actualDuration - expectedDuration);
    
    if (drift > 100) {
      throw new Error(`Rest timer drift too high: ${drift}ms`);
    }
  }

  /**
   * Claw Nutrition benchmark functions
   */
  private async benchmarkPhotoScanResult(): Promise<void> {
    // Simulate photo processing and ML analysis
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
  }

  private async benchmarkBarcodeLookup(): Promise<void> {
    // Simulate barcode database lookup
    const barcode = '012345678901';
    await new Promise(resolve => setTimeout(resolve, Math.random() * 300 + 100));
  }

  private async benchmarkFoodSearch(): Promise<void> {
    // Simulate food database search
    const query = 'apple';
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
  }

  /**
   * Claw Meetings benchmark functions
   */
  private async benchmarkRecordingStart(): Promise<void> {
    // Simulate recording initialization
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
  }

  private async benchmarkMeetingSearch(): Promise<void> {
    // Simulate meeting search across transcripts
    const query = 'action items from yesterday';
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
  }

  /**
   * Claw Budget benchmark functions
   */
  private async benchmarkBudgetViewLoad(): Promise<void> {
    // Simulate loading budget categories and transactions
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 150));
  }

  private async benchmarkTransactionSave(): Promise<void> {
    // Simulate saving transaction
    const mockTransaction = {
      amount: 15.99,
      description: 'Coffee shop',
      category: 'Food',
      date: new Date()
    };
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
  }

  private async benchmarkCategoryAssignment(): Promise<void> {
    // Simulate instant category assignment
    await new Promise(resolve => setTimeout(resolve, Math.random() * 20 + 10));
  }

  /**
   * Load baselines for comparison
   */
  private async loadBaselines(appName: string): Promise<void> {
    try {
      const baselineFile = join(process.cwd(), 'performance', 'baselines', `${appName}.json`);
      const baselines = JSON.parse(readFileSync(baselineFile, 'utf8'));
      this.baselines = baselines;
    } catch (error) {
      console.warn(`No baseline file found for ${appName}, using defaults`);
      this.baselines = this.getDefaultBaselines(appName);
    }
  }

  /**
   * Get default baselines if no file exists
   */
  private getDefaultBaselines(appName: string): Record<string, number> {
    const universal = {
      api_latency: 200,
      cold_start: 2000
    };

    const appDefaults: Record<string, Record<string, number>> = {
      'claw-fitness': {
        workout_log_save: 400,
        exercise_search: 150,
        rest_timer_accuracy: 50
      },
      'claw-nutrition': {
        photo_scan_result: 3000,
        barcode_lookup: 500,
        food_search: 200
      },
      'claw-meetings': {
        recording_start: 300,
        meeting_search: 1500
      },
      'claw-budget': {
        budget_view_load: 350,
        transaction_save: 200,
        category_assignment: 50
      }
    };

    return { ...universal, ...(appDefaults[appName] || {}) };
  }

  /**
   * Check for performance regressions
   */
  private checkForRegressions(results: BenchmarkResult[], baselines: Record<string, number>): string[] {
    const regressions: string[] = [];
    const regressionThreshold = 0.1; // 10% regression threshold

    for (const result of results) {
      const baseline = baselines[result.name];
      if (!baseline) continue;

      const regression = (result.p95 - baseline) / baseline;
      if (regression > regressionThreshold) {
        regressions.push(
          `${result.name}: ${result.p95.toFixed(2)}ms vs baseline ${baseline}ms (${(regression * 100).toFixed(1)}% slower)`
        );
      }
    }

    return regressions;
  }

  /**
   * Save benchmark results
   */
  private async saveBenchmarkResults(suite: BenchmarkSuite): Promise<void> {
    try {
      // Save to Firestore
      await this.db.collection('_benchmark_results').doc(`${suite.app}-${Date.now()}`).set(suite);

      // Save results to file for CI artifacts
      const resultsFile = join(process.cwd(), 'perf-results.json');
      writeFileSync(resultsFile, JSON.stringify(suite, null, 2));

      console.log(`[BENCHMARK] Results saved for ${suite.app}`);
    } catch (error) {
      console.error('Error saving benchmark results:', error);
    }
  }

  /**
   * Detect environment
   */
  private detectEnvironment(): 'local' | 'ci' | 'production' {
    if (process.env.CI) return 'ci';
    if (process.env.NODE_ENV === 'production') return 'production';
    return 'local';
  }

  /**
   * Calculate percentile
   */
  private percentile(values: number[], percentile: number): number {
    const index = Math.ceil(values.length * percentile) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))];
  }

  /**
   * Fail CI if regressions exceed threshold
   */
  public failIfRegressions(results: BenchmarkSuite, failThreshold: number = 0.1): void {
    if (results.regressions && results.regressions.length > 0) {
      const maxRegression = results.results
        .map(r => {
          const baseline = results.baseline?.[r.name];
          return baseline ? (r.p95 - baseline) / baseline : 0;
        })
        .reduce((max, current) => Math.max(max, current), 0);

      if (maxRegression > failThreshold) {
        console.error(`[BENCHMARK] FAIL: Performance regression exceeds threshold (${(maxRegression * 100).toFixed(1)}% > ${(failThreshold * 100)}%)`);
        console.error('Regressions found:');
        results.regressions.forEach(r => console.error(`  - ${r}`));
        process.exit(1);
      }
    }

    console.log(`[BENCHMARK] PASS: All benchmarks within acceptable thresholds`);
  }
}

interface BenchmarkFunction {
  name: string;
  iterations?: number;
  fn: () => Promise<void>;
}

/**
 * CLI interface for running benchmarks
 */
export async function runBenchmarks(appName: string): Promise<void> {
  const benchmarker = PerformanceBenchmarker.getInstance();
  const results = await benchmarker.runBenchmarks(appName);
  
  // Check for regressions and fail if needed (for CI)
  if (process.env.CI) {
    benchmarker.failIfRegressions(results);
  }
}

// CLI entry point
if (require.main === module) {
  const appName = process.argv[2];
  if (!appName) {
    console.error('Usage: node benchmark.js <app-name>');
    process.exit(1);
  }
  
  runBenchmarks(appName).catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
  });
}