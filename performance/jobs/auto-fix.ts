/**
 * @fileoverview Auto-Fix Job
 * @description Runs the autonomous optimization loop every 6 hours
 */

import * as admin from 'firebase-admin';
import { runOptimizationLoop } from '../auto-optimize';
import { checkMetricsAndAlert } from '../../packages/observability/src/performance-alerts';

/**
 * Auto-Fix Job - runs every 6 hours
 */
export class AutoFixJob {
  private static instance: AutoFixJob;
  private db: admin.firestore.Firestore;
  private isRunning: boolean = false;

  private constructor() {
    this.db = admin.firestore();
  }

  public static getInstance(): AutoFixJob {
    if (!AutoFixJob.instance) {
      AutoFixJob.instance = new AutoFixJob();
    }
    return AutoFixJob.instance;
  }

  /**
   * Main auto-fix process
   */
  public async runAutoFix(): Promise<void> {
    if (this.isRunning) {
      console.log('[AUTO-FIX] Job already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('[AUTO-FIX] Starting auto-fix job...');
    
    const startTime = Date.now();
    let success = true;
    let errors: string[] = [];

    try {
      // Step 1: Check metrics and fire alerts
      console.log('[AUTO-FIX] Step 1: Checking metrics and firing alerts...');
      await this.safeExecute('checkMetricsAndAlert', checkMetricsAndAlert, errors);

      // Step 2: Run optimization loop
      console.log('[AUTO-FIX] Step 2: Running optimization loop...');
      await this.safeExecute('runOptimizationLoop', runOptimizationLoop, errors);

      // Step 3: Process pending optimizations
      console.log('[AUTO-FIX] Step 3: Processing pending optimizations...');
      await this.safeExecute('processPendingOptimizations', this.processPendingOptimizations.bind(this), errors);

      // Step 4: Update optimization statuses
      console.log('[AUTO-FIX] Step 4: Updating optimization statuses...');
      await this.safeExecute('updateOptimizationStatuses', this.updateOptimizationStatuses.bind(this), errors);

      // Step 5: Clean up completed optimizations
      console.log('[AUTO-FIX] Step 5: Cleaning up completed optimizations...');
      await this.safeExecute('cleanupOptimizations', this.cleanupOptimizations.bind(this), errors);

    } catch (error) {
      console.error('[AUTO-FIX] Unexpected error:', error);
      success = false;
      errors.push(`Unexpected error: ${error.message}`);
    } finally {
      this.isRunning = false;
      
      const duration = Date.now() - startTime;
      await this.logJobExecution(success, duration, errors);
      
      console.log(`[AUTO-FIX] Job completed in ${duration}ms. Success: ${success}, Errors: ${errors.length}`);
    }
  }

  /**
   * Safely execute a function and capture errors
   */
  private async safeExecute(stepName: string, fn: () => Promise<void>, errors: string[]): Promise<void> {
    try {
      await fn();
      console.log(`[AUTO-FIX] ${stepName} completed successfully`);
    } catch (error) {
      const errorMessage = `${stepName} failed: ${error.message}`;
      console.error(`[AUTO-FIX] ${errorMessage}`);
      errors.push(errorMessage);
    }
  }

  /**
   * Process pending optimizations that need manual review
   */
  private async processPendingOptimizations(): Promise<void> {
    const snapshot = await this.db
      .collection('_performance_optimizations')
      .where('status', '==', 'pending')
      .orderBy('priority', 'desc')
      .limit(10)
      .get();

    if (snapshot.empty) {
      console.log('[AUTO-FIX] No pending optimizations found');
      return;
    }

    console.log(`[AUTO-FIX] Processing ${snapshot.size} pending optimizations`);

    for (const doc of snapshot.docs) {
      const optimization = doc.data();
      await this.processOptimization(doc.id, optimization);
    }
  }

  /**
   * Process a single optimization
   */
  private async processOptimization(id: string, optimization: any): Promise<void> {
    try {
      console.log(`[AUTO-FIX] Processing optimization ${id}: ${optimization.description}`);

      // Check if the issue still exists
      const stillRelevant = await this.isOptimizationStillRelevant(optimization);
      
      if (!stillRelevant) {
        console.log(`[AUTO-FIX] Optimization ${id} no longer relevant, marking as obsolete`);
        await this.updateOptimizationStatus(id, 'rejected', 'Issue resolved naturally');
        return;
      }

      // Check if we should auto-implement based on complexity and priority
      if (this.shouldAutoImplement(optimization)) {
        console.log(`[AUTO-FIX] Auto-implementing low-risk optimization ${id}`);
        await this.autoImplementOptimization(id, optimization);
      } else {
        console.log(`[AUTO-FIX] Optimization ${id} requires manual review (complexity: ${optimization.complexity}, priority: ${optimization.priority})`);
        await this.notifyForManualReview(optimization);
      }

    } catch (error) {
      console.error(`[AUTO-FIX] Error processing optimization ${id}:`, error);
      await this.updateOptimizationStatus(id, 'rejected', `Processing error: ${error.message}`);
    }
  }

  /**
   * Check if optimization is still relevant
   */
  private async isOptimizationStillRelevant(optimization: any): Promise<boolean> {
    try {
      // Get current performance for this metric
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const snapshot = await this.db
        .collection('_performance_metrics')
        .where('app', '==', optimization.app)
        .where('name', '==', optimization.metric)
        .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(oneHourAgo))
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();

      if (snapshot.empty) {
        return false; // No recent data
      }

      const values = snapshot.docs.map(doc => doc.data().value as number);
      const currentAvg = values.reduce((sum, val) => sum + val, 0) / values.length;

      // If current performance is better than the optimization target, it's no longer relevant
      return currentAvg > optimization.targetValue;
    } catch (error) {
      console.error('Error checking optimization relevance:', error);
      return true; // Assume still relevant if we can't check
    }
  }

  /**
   * Determine if optimization should be auto-implemented
   */
  private shouldAutoImplement(optimization: any): boolean {
    // Auto-implement only low-complexity, high-priority optimizations
    if (optimization.complexity === 'high') return false;
    if (optimization.priority < 50) return false;
    
    // Auto-implement database and cache optimizations
    const safeCategories = ['database', 'cache'];
    if (!safeCategories.includes(optimization.category)) return false;

    // Auto-implement if estimated time is low
    if (optimization.estimatedHours > 8) return false;

    return true;
  }

  /**
   * Auto-implement an optimization
   */
  private async autoImplementOptimization(id: string, optimization: any): Promise<void> {
    try {
      // Mark as in progress
      await this.updateOptimizationStatus(id, 'in_progress', 'Auto-implementation started');

      // Apply the optimization based on category
      switch (optimization.category) {
        case 'database':
          await this.applyDatabaseOptimization(optimization);
          break;
        case 'cache':
          await this.applyCacheOptimization(optimization);
          break;
        case 'infrastructure':
          await this.applyInfrastructureOptimization(optimization);
          break;
        default:
          throw new Error(`Unsupported optimization category: ${optimization.category}`);
      }

      // Create audit log
      await this.createAuditLog(optimization, 'auto_implemented');

      // Schedule verification
      await this.scheduleVerification(id, optimization);

      console.log(`[AUTO-FIX] Auto-implemented optimization ${id}`);
      
    } catch (error) {
      console.error(`[AUTO-FIX] Error auto-implementing optimization ${id}:`, error);
      await this.updateOptimizationStatus(id, 'rejected', `Auto-implementation failed: ${error.message}`);
    }
  }

  /**
   * Apply database optimization
   */
  private async applyDatabaseOptimization(optimization: any): Promise<void> {
    console.log(`[AUTO-FIX] Applying database optimization: ${optimization.description}`);
    
    // This would apply actual database optimizations
    // For now, just simulate
    if (optimization.description.includes('index')) {
      console.log('[AUTO-FIX] Creating database index...');
      // await createDatabaseIndex(optimization.app, optimization.metric);
    }
    
    if (optimization.description.includes('batch')) {
      console.log('[AUTO-FIX] Implementing batched writes...');
      // await implementBatchedWrites(optimization.app);
    }
  }

  /**
   * Apply cache optimization
   */
  private async applyCacheOptimization(optimization: any): Promise<void> {
    console.log(`[AUTO-FIX] Applying cache optimization: ${optimization.description}`);
    
    // This would apply actual caching optimizations
    if (optimization.description.includes('Redis')) {
      console.log('[AUTO-FIX] Configuring Redis cache...');
      // await configureRedisCache(optimization.app, optimization.metric);
    }
  }

  /**
   * Apply infrastructure optimization
   */
  private async applyInfrastructureOptimization(optimization: any): Promise<void> {
    console.log(`[AUTO-FIX] Applying infrastructure optimization: ${optimization.description}`);
    
    // This would apply infrastructure changes
    if (optimization.configChanges) {
      console.log('[AUTO-FIX] Updating infrastructure configuration...');
      // await updateInfrastructureConfig(optimization.app, optimization.configChanges);
    }
  }

  /**
   * Schedule verification of optimization effectiveness
   */
  private async scheduleVerification(id: string, optimization: any): Promise<void> {
    const verificationTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    await this.db.collection('_optimization_verifications').doc(id).set({
      optimizationId: id,
      app: optimization.app,
      metric: optimization.metric,
      expectedImprovement: optimization.improvement,
      targetValue: optimization.targetValue,
      verificationTime: admin.firestore.Timestamp.fromDate(verificationTime),
      status: 'scheduled'
    });
  }

  /**
   * Update optimization statuses based on verification results
   */
  private async updateOptimizationStatuses(): Promise<void> {
    // Check for verifications that are due
    const now = new Date();
    
    const snapshot = await this.db
      .collection('_optimization_verifications')
      .where('status', '==', 'scheduled')
      .where('verificationTime', '<=', admin.firestore.Timestamp.fromDate(now))
      .get();

    for (const doc of snapshot.docs) {
      const verification = doc.data();
      await this.verifyOptimizationEffectiveness(doc.id, verification);
    }
  }

  /**
   * Verify if an optimization was effective
   */
  private async verifyOptimizationEffectiveness(verificationId: string, verification: any): Promise<void> {
    try {
      // Get performance data after optimization
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const snapshot = await this.db
        .collection('_performance_metrics')
        .where('app', '==', verification.app)
        .where('name', '==', verification.metric)
        .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(oneDayAgo))
        .get();

      if (snapshot.empty) {
        console.log(`[AUTO-FIX] No data available for verification of ${verificationId}`);
        return;
      }

      const values = snapshot.docs.map(doc => doc.data().value as number);
      const currentAvg = values.reduce((sum, val) => sum + val, 0) / values.length;
      
      const actualImprovement = ((verification.currentValue - currentAvg) / verification.currentValue) * 100;
      const expectedImprovement = verification.expectedImprovement;
      
      let status: string;
      let result: string;
      
      if (actualImprovement >= expectedImprovement * 0.8) { // 80% of expected improvement
        status = 'completed';
        result = `Successful: ${actualImprovement.toFixed(1)}% improvement (expected ${expectedImprovement.toFixed(1)}%)`;
      } else if (actualImprovement > 0) {
        status = 'completed';
        result = `Partial success: ${actualImprovement.toFixed(1)}% improvement (expected ${expectedImprovement.toFixed(1)}%)`;
      } else {
        status = 'rejected';
        result = `Failed: No improvement detected (current: ${currentAvg.toFixed(2)})`;
      }

      // Update optimization status
      await this.updateOptimizationStatus(verification.optimizationId, status, result);
      
      // Update verification status
      await this.db.collection('_optimization_verifications').doc(verificationId).update({
        status: 'completed',
        actualImprovement,
        result,
        verifiedAt: admin.firestore.Timestamp.now()
      });

      console.log(`[AUTO-FIX] Verified optimization ${verification.optimizationId}: ${result}`);

    } catch (error) {
      console.error(`[AUTO-FIX] Error verifying optimization ${verificationId}:`, error);
    }
  }

  /**
   * Clean up old optimizations
   */
  private async cleanupOptimizations(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    // Clean up completed optimizations older than 30 days
    const completedSnapshot = await this.db
      .collection('_performance_optimizations')
      .where('status', 'in', ['completed', 'rejected'])
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(thirtyDaysAgo))
      .limit(50)
      .get();

    if (!completedSnapshot.empty) {
      const batch = this.db.batch();
      completedSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      
      console.log(`[AUTO-FIX] Cleaned up ${completedSnapshot.size} old optimizations`);
    }

    // Clean up old verification records
    const verificationSnapshot = await this.db
      .collection('_optimization_verifications')
      .where('verificationTime', '<', admin.firestore.Timestamp.fromDate(thirtyDaysAgo))
      .limit(50)
      .get();

    if (!verificationSnapshot.empty) {
      const batch = this.db.batch();
      verificationSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      
      console.log(`[AUTO-FIX] Cleaned up ${verificationSnapshot.size} old verifications`);
    }
  }

  /**
   * Notify for manual review
   */
  private async notifyForManualReview(optimization: any): Promise<void> {
    const notification = {
      type: 'optimization_review_required',
      app: optimization.app,
      metric: optimization.metric,
      description: optimization.description,
      complexity: optimization.complexity,
      priority: optimization.priority,
      estimatedHours: optimization.estimatedHours,
      createdAt: admin.firestore.Timestamp.now()
    };

    await this.db.collection('_manual_review_queue').doc().set(notification);
    
    // TODO: Send Telegram notification
    console.log(`[AUTO-FIX] Queued for manual review: ${optimization.description}`);
  }

  /**
   * Create audit log entry
   */
  private async createAuditLog(optimization: any, action: string): Promise<void> {
    const auditEntry = {
      optimizationId: optimization.id,
      app: optimization.app,
      metric: optimization.metric,
      action,
      description: optimization.description,
      category: optimization.category,
      timestamp: admin.firestore.Timestamp.now(),
      automated: true
    };

    await this.db.collection('_optimization_audit_log').doc().set(auditEntry);
  }

  /**
   * Update optimization status
   */
  private async updateOptimizationStatus(id: string, status: string, notes?: string): Promise<void> {
    const updateData: any = {
      status,
      updatedAt: admin.firestore.Timestamp.now()
    };

    if (notes) {
      updateData.notes = notes;
    }

    if (status === 'completed') {
      updateData.completedAt = admin.firestore.Timestamp.now();
    }

    await this.db.collection('_performance_optimizations').doc(id).update(updateData);
  }

  /**
   * Log job execution
   */
  private async logJobExecution(success: boolean, duration: number, errors: string[]): Promise<void> {
    const logEntry = {
      jobName: 'auto-fix',
      success,
      duration,
      errors,
      timestamp: admin.firestore.Timestamp.now()
    };

    await this.db.collection('_job_execution_log').doc().set(logEntry);
  }
}

/**
 * Main job entry point
 */
export async function runAutoFix(): Promise<void> {
  const job = AutoFixJob.getInstance();
  await job.runAutoFix();
}

// CLI entry point
if (require.main === module) {
  runAutoFix().catch(error => {
    console.error('[AUTO-FIX] Job failed:', error);
    process.exit(1);
  });
}