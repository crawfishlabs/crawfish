import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  Experiment,
  Variant,
  ExperimentEvent,
  FeedbackSignal,
  UserAssignment,
  ExperimentEvaluation,
  VariantMetricResult,
  MetricComparison,
  Recommendation,
  DecisionLog,
} from './models';
import { chiSquaredTest, tTest, calculateLift, calculateConfidence, isSignificant } from './statistics';

// ─── Firestore Abstraction ──────────────────────────────────────────────────

export interface ExperimentStore {
  getExperiment(id: string): Promise<Experiment | null>;
  updateExperiment(id: string, data: Partial<Experiment>): Promise<void>;
  getAssignment(experimentId: string, userId: string): Promise<UserAssignment | null>;
  setAssignment(assignment: UserAssignment): Promise<void>;
  addEvent(event: ExperimentEvent): Promise<void>;
  addEvents(events: ExperimentEvent[]): Promise<void>;
  getEvents(experimentId: string, metricId?: string): Promise<ExperimentEvent[]>;
  getEventsByVariant(experimentId: string, variantId: string, metricId?: string): Promise<ExperimentEvent[]>;
  addFeedback(signal: FeedbackSignal): Promise<void>;
  getFeedback(experimentId: string): Promise<FeedbackSignal[]>;
  addDecisionLog(log: DecisionLog): Promise<void>;
  getUserSegments(userId: string): Promise<string[]>;
  getActiveExperimentsForUser(userId: string, appId?: string): Promise<UserAssignment[]>;
  setFeatureFlags(flags: Record<string, any>): Promise<void>;
  getFeatureFlags(): Promise<Record<string, any>>;
}

// ─── Feature Flag Integration ───────────────────────────────────────────────

export interface FeatureFlagService {
  setFlags(flags: Record<string, any>): Promise<void>;
  revertFlags(flags: Record<string, any>): Promise<void>;
}

// ─── Alerting ───────────────────────────────────────────────────────────────

export interface AlertService {
  sendAlert(title: string, message: string, severity: 'info' | 'warning' | 'critical'): Promise<void>;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class ExperimentEngine {
  constructor(
    private store: ExperimentStore,
    private flagService?: FeatureFlagService,
    private alertService?: AlertService
  ) {}

  // ── Assignment ──────────────────────────────────────────────────────────

  async assignUser(experimentId: string, userId: string): Promise<Variant> {
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    // Check for existing sticky assignment
    const existing = await this.store.getAssignment(experimentId, userId);
    if (existing) {
      const variant = experiment.variants.find(v => v.id === existing.variantId);
      if (variant) return variant;
    }

    // Check if user is excluded
    if (experiment.cohort.excludeList?.includes(userId)) {
      return this.getControlVariant(experiment);
    }

    // Check cohort eligibility
    const eligible = await this.isUserEligible(experiment, userId);
    if (!eligible) {
      return this.getControlVariant(experiment);
    }

    // Deterministic hash-based assignment
    const variant = this.hashAssign(experiment, userId);

    // Persist sticky assignment
    await this.store.setAssignment({
      experimentId,
      userId,
      variantId: variant.id,
      assignedAt: new Date(),
    });

    return variant;
  }

  private async isUserEligible(experiment: Experiment, userId: string): Promise<boolean> {
    const { cohort } = experiment;

    switch (cohort.type) {
      case 'allowlist':
        return cohort.allowlist?.includes(userId) ?? false;

      case 'segment': {
        const segments = await this.store.getUserSegments(userId);
        return cohort.segments?.some(s => segments.includes(s)) ?? false;
      }

      case 'percentage': {
        const pct = cohort.percentage ?? 100;
        const hash = this.hashValue(`${experiment.id}:eligibility:${userId}`);
        return (hash % 10000) < (pct * 100);
      }

      default:
        return true;
    }
  }

  private hashAssign(experiment: Experiment, userId: string): Variant {
    const hash = this.hashValue(`${experiment.id}:variant:${userId}`);
    const bucket = hash % 10000; // 0-9999

    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += variant.weight * 100; // weight is percentage, scale to 10000
      if (bucket < cumulative) return variant;
    }

    // Fallback to last variant
    return experiment.variants[experiment.variants.length - 1];
  }

  private hashValue(input: string): number {
    const hash = crypto.createHash('md5').update(input).digest();
    return hash.readUInt32BE(0);
  }

  private getControlVariant(experiment: Experiment): Variant {
    return experiment.variants.find(v => v.name === 'control') ?? experiment.variants[0];
  }

  // ── Event Tracking ────────────────────────────────────────────────────

  async trackEvent(
    experimentId: string,
    userId: string,
    metricId: string,
    value: number
  ): Promise<void> {
    const assignment = await this.store.getAssignment(experimentId, userId);
    if (!assignment) return; // User not in experiment

    const event: ExperimentEvent = {
      id: uuidv4(),
      experimentId,
      userId,
      variantId: assignment.variantId,
      metricId,
      value,
      timestamp: new Date(),
    };

    await this.store.addEvent(event);
  }

  async trackEventsBatch(
    events: { experimentId: string; userId: string; metricId: string; value: number }[]
  ): Promise<void> {
    const resolvedEvents: ExperimentEvent[] = [];

    for (const e of events) {
      const assignment = await this.store.getAssignment(e.experimentId, e.userId);
      if (!assignment) continue;

      resolvedEvents.push({
        id: uuidv4(),
        experimentId: e.experimentId,
        userId: e.userId,
        variantId: assignment.variantId,
        metricId: e.metricId,
        value: e.value,
        timestamp: new Date(),
      });
    }

    if (resolvedEvents.length > 0) {
      await this.store.addEvents(resolvedEvents);
    }
  }

  // ── Feedback Integration ──────────────────────────────────────────────

  async ingestFeedback(signal: FeedbackSignal): Promise<void> {
    await this.store.addFeedback(signal);
  }

  // ── Evaluation ────────────────────────────────────────────────────────

  async evaluateExperiment(experimentId: string): Promise<ExperimentEvaluation> {
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const events = await this.store.getEvents(experimentId);

    // Calculate per-variant metrics
    const variantResults: VariantMetricResult[] = [];
    const comparisons: MetricComparison[] = [];

    const controlVariant = this.getControlVariant(experiment);

    for (const metric of experiment.metrics) {
      const controlEvents = events.filter(
        e => e.variantId === controlVariant.id && e.metricId === metric.id
      );

      for (const variant of experiment.variants) {
        const variantEvents = events.filter(
          e => e.variantId === variant.id && e.metricId === metric.id
        );

        const value = this.aggregateMetric(variantEvents, metric.aggregation);
        variantResults.push({
          variantId: variant.id,
          metricId: metric.id,
          value,
          sampleSize: new Set(variantEvents.map(e => e.userId)).size,
        });

        // Compare treatment to control
        if (variant.id !== controlVariant.id) {
          const controlValue = this.aggregateMetric(controlEvents, metric.aggregation);
          const comparison = this.compareVariants(
            controlEvents,
            variantEvents,
            controlValue,
            value,
            metric
          );
          comparisons.push(comparison);
        }
      }
    }

    // Check guardrails
    const breachedGuardrails: string[] = [];
    for (const guard of experiment.guardrails) {
      for (const variant of experiment.variants) {
        if (variant.id === controlVariant.id) continue;
        const result = variantResults.find(
          r => r.variantId === variant.id && r.metricId === guard.metricId
        );
        if (result && this.isGuardrailBreached(result.value, guard.threshold, guard.comparison)) {
          breachedGuardrails.push(`${guard.description} (variant: ${variant.name}, value: ${result.value})`);
        }
      }
    }

    const guardrailStatus = breachedGuardrails.length > 0 ? 'breached' as const : 'all_green' as const;

    // Total sample
    const totalSampleSize = new Set(events.map(e => e.userId)).size;
    const durationHours = (Date.now() - experiment.startDate.getTime()) / (1000 * 60 * 60);

    // Determine recommendation
    const recommendation = this.determineRecommendation(
      experiment,
      comparisons,
      guardrailStatus,
      totalSampleSize,
      durationHours
    );

    return {
      experimentId,
      timestamp: new Date(),
      variantResults,
      comparisons,
      guardrailStatus,
      breachedGuardrails,
      recommendation: recommendation.rec,
      reason: recommendation.reason,
      totalSampleSize,
      durationHours,
    };
  }

  private aggregateMetric(events: ExperimentEvent[], aggregation: string): number {
    if (events.length === 0) return 0;
    const values = events.map(e => e.value);
    const uniqueUsers = new Set(events.map(e => e.userId)).size;

    switch (aggregation) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'count':
        return values.length;
      case 'rate':
        return uniqueUsers > 0 ? values.filter(v => v > 0).length / uniqueUsers : 0;
      case 'p50':
        return this.percentile(values, 0.5);
      case 'p95':
        return this.percentile(values, 0.95);
      default:
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
  }

  private percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, idx)];
  }

  private compareVariants(
    controlEvents: ExperimentEvent[],
    treatmentEvents: ExperimentEvent[],
    controlValue: number,
    treatmentValue: number,
    metric: { id: string; type: string; aggregation: string }
  ): MetricComparison {
    let pValue = 1;

    if (metric.type === 'conversion' || metric.aggregation === 'rate') {
      const controlUsers = new Set(controlEvents.map(e => e.userId)).size;
      const treatmentUsers = new Set(treatmentEvents.map(e => e.userId)).size;
      const controlConversions = controlEvents.filter(e => e.value > 0).length;
      const treatmentConversions = treatmentEvents.filter(e => e.value > 0).length;

      const result = chiSquaredTest(controlConversions, controlUsers, treatmentConversions, treatmentUsers);
      pValue = result.pValue;
    } else {
      const controlValues = controlEvents.map(e => e.value);
      const treatmentValues = treatmentEvents.map(e => e.value);
      const result = tTest(controlValues, treatmentValues);
      pValue = result.pValue;
    }

    const lift = calculateLift(controlValue, treatmentValue);

    return {
      metricId: metric.id,
      controlValue,
      treatmentValue,
      lift,
      pValue,
      confidence: calculateConfidence(pValue),
      isSignificant: isSignificant(pValue),
    };
  }

  private isGuardrailBreached(value: number, threshold: number, comparison: string): boolean {
    switch (comparison) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      default: return false;
    }
  }

  private determineRecommendation(
    experiment: Experiment,
    comparisons: MetricComparison[],
    guardrailStatus: string,
    sampleSize: number,
    durationHours: number
  ): { rec: Recommendation; reason: string } {
    // Guardrails breached → roll back
    if (guardrailStatus === 'breached') {
      return { rec: 'roll_back', reason: 'Guardrail metric breached' };
    }

    // Insufficient data
    if (sampleSize < experiment.minSampleSize) {
      return { rec: 'insufficient_data', reason: `Sample size ${sampleSize} below minimum ${experiment.minSampleSize}` };
    }
    if (durationHours < experiment.minDuration) {
      return { rec: 'insufficient_data', reason: `Duration ${durationHours.toFixed(1)}h below minimum ${experiment.minDuration}h` };
    }

    // Check success criteria
    const allCriteriaMet = experiment.successCriteria.every(criterion => {
      const comparison = comparisons.find(c => c.metricId === criterion.metricId);
      if (!comparison) return false;
      return comparison.lift >= criterion.minLift && comparison.confidence >= criterion.confidence;
    });

    if (allCriteriaMet && experiment.successCriteria.length > 0) {
      return { rec: 'roll_forward', reason: 'All success criteria met' };
    }

    // Check if any metric is significantly negative
    const hasSignificantRegression = comparisons.some(c => {
      const metric = experiment.metrics.find(m => m.id === c.metricId);
      if (!metric) return false;
      const isWrongDirection = (metric.direction === 'increase' && c.lift < 0) ||
                                (metric.direction === 'decrease' && c.lift > 0);
      return isWrongDirection && c.isSignificant;
    });

    if (hasSignificantRegression) {
      return { rec: 'roll_back', reason: 'Significant regression detected in key metrics' };
    }

    // End date reached
    if (experiment.endDate && new Date() >= experiment.endDate) {
      return { rec: 'extend', reason: 'End date reached without clear signal — manual review needed' };
    }

    return { rec: 'extend', reason: 'Not enough statistical power yet' };
  }

  // ── Auto-Pilot ────────────────────────────────────────────────────────

  async runAutoPilot(experimentId: string): Promise<ExperimentEvaluation> {
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment || experiment.status !== 'running') {
      throw new Error(`Experiment ${experimentId} is not running`);
    }

    const evaluation = await this.evaluateExperiment(experimentId);

    switch (evaluation.recommendation) {
      case 'roll_back': {
        await this.rollBack(experimentId, evaluation.reason);
        await this.alertService?.sendAlert(
          `Experiment ${experiment.name} auto-rolled back`,
          evaluation.reason,
          'critical'
        );
        break;
      }

      case 'roll_forward': {
        const winningVariant = this.findWinningVariant(experiment, evaluation);
        await this.rollForward(experimentId, winningVariant);
        await this.alertService?.sendAlert(
          `Experiment ${experiment.name} auto-rolled forward`,
          `Winning variant: ${winningVariant}. ${evaluation.reason}`,
          'info'
        );
        break;
      }

      case 'extend': {
        if (experiment.endDate && new Date() >= experiment.endDate) {
          await this.store.updateExperiment(experimentId, { status: 'paused' });
          await this.alertService?.sendAlert(
            `Experiment ${experiment.name} paused — manual review needed`,
            evaluation.reason,
            'warning'
          );
        }
        break;
      }
    }

    // Log decision
    await this.store.addDecisionLog({
      id: uuidv4(),
      experimentId,
      action: evaluation.recommendation === 'roll_forward' ? 'roll_forward' :
             evaluation.recommendation === 'roll_back' ? 'roll_back' : 'extend',
      reason: evaluation.reason,
      by: 'auto',
      evaluation,
      timestamp: new Date(),
    });

    return evaluation;
  }

  private findWinningVariant(experiment: Experiment, evaluation: ExperimentEvaluation): string {
    const controlVariant = this.getControlVariant(experiment);
    let bestVariant = controlVariant.id;
    let bestLift = 0;

    for (const comparison of evaluation.comparisons) {
      if (comparison.isSignificant && comparison.lift > bestLift) {
        // Find which variant this comparison belongs to
        const variantResult = evaluation.variantResults.find(
          vr => vr.metricId === comparison.metricId && vr.variantId !== controlVariant.id
        );
        if (variantResult) {
          bestVariant = variantResult.variantId;
          bestLift = comparison.lift;
        }
      }
    }

    return bestVariant;
  }

  // ── Rollout Controls ──────────────────────────────────────────────────

  async rollForward(experimentId: string, winningVariantId: string): Promise<void> {
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const winningVariant = experiment.variants.find(v => v.id === winningVariantId);
    if (!winningVariant) throw new Error(`Variant ${winningVariantId} not found`);

    // Set feature flags to winning variant's values for 100% of users
    if (this.flagService) {
      await this.flagService.setFlags(winningVariant.featureFlags);
    }

    await this.store.updateExperiment(experimentId, {
      status: 'completed',
      decision: 'roll_forward',
      decisionReason: `Rolled forward with variant: ${winningVariant.name}`,
      decisionAt: new Date(),
      decisionBy: 'auto',
    });
  }

  async rollBack(experimentId: string, reason: string): Promise<void> {
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const controlVariant = this.getControlVariant(experiment);

    // Revert to control flags
    if (this.flagService) {
      await this.flagService.revertFlags(controlVariant.featureFlags);
    }

    await this.store.updateExperiment(experimentId, {
      status: 'rolled_back',
      decision: 'roll_back',
      decisionReason: reason,
      decisionAt: new Date(),
      decisionBy: 'auto',
    });

    await this.store.addDecisionLog({
      id: uuidv4(),
      experimentId,
      action: 'roll_back',
      reason,
      by: 'auto',
      timestamp: new Date(),
    });
  }

  async graduateRollout(experimentId: string, newPercentage: number): Promise<void> {
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    if (newPercentage < 0 || newPercentage > 100) {
      throw new Error('Percentage must be between 0 and 100');
    }

    await this.store.updateExperiment(experimentId, {
      cohort: { ...experiment.cohort, percentage: newPercentage },
      updatedAt: new Date(),
    });

    await this.store.addDecisionLog({
      id: uuidv4(),
      experimentId,
      action: 'graduate',
      reason: `Graduated rollout to ${newPercentage}%`,
      by: 'manual',
      timestamp: new Date(),
    });
  }
}
