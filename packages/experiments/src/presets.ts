import { GuardrailMetric, SuccessCriterion, Comparison } from './models';

export interface RolloutPreset {
  stages?: number[];
  cohortPercentage?: number;
  guardrails: { metric: string; threshold: number; comparison: Comparison }[];
  successCriteria?: { minLift: number; confidence: number }[];
  minDuration: number; // hours
  minDurationPerStage?: number; // hours
  minSample: number;
  minSamplePerStage?: number;
}

export const EXPERIMENT_PRESETS: Record<string, RolloutPreset> = {
  feature_rollout: {
    stages: [10, 25, 50, 100],
    guardrails: [
      { metric: 'error_rate', threshold: 0.02, comparison: 'lt' },
      { metric: 'negative_feedback_rate', threshold: 0.15, comparison: 'lt' },
      { metric: 'crash_rate', threshold: 0.01, comparison: 'lt' },
    ],
    minDurationPerStage: 48,
    minDuration: 192, // 48 * 4 stages
    minSamplePerStage: 100,
    minSample: 400,
  },

  ab_test: {
    guardrails: [
      { metric: 'error_rate', threshold: 0.02, comparison: 'lt' },
      { metric: 'negative_feedback_rate', threshold: 0.15, comparison: 'lt' },
    ],
    successCriteria: [
      { minLift: 0.05, confidence: 0.95 },
    ],
    minDuration: 168, // 1 week
    minSample: 500,
  },

  quick_validation: {
    cohortPercentage: 5,
    guardrails: [
      { metric: 'error_rate', threshold: 0.05, comparison: 'lt' },
    ],
    minDuration: 24,
    minSample: 50,
  },
};

/**
 * Apply a preset to generate guardrails and success criteria for an experiment.
 */
export function applyPreset(presetName: string): {
  guardrails: GuardrailMetric[];
  successCriteria: SuccessCriterion[];
  minDuration: number;
  minSampleSize: number;
} {
  const preset = EXPERIMENT_PRESETS[presetName];
  if (!preset) throw new Error(`Unknown preset: ${presetName}`);

  const guardrails: GuardrailMetric[] = preset.guardrails.map((g, i) => ({
    metricId: g.metric,
    threshold: g.threshold,
    comparison: g.comparison,
    description: `${g.metric} must be ${g.comparison} ${g.threshold}`,
    action: 'rollback' as const,
  }));

  const successCriteria: SuccessCriterion[] = (preset.successCriteria ?? []).map((sc, i) => ({
    metricId: `primary_metric_${i}`,
    minLift: sc.minLift,
    confidence: sc.confidence,
  }));

  return {
    guardrails,
    successCriteria,
    minDuration: preset.minDuration,
    minSampleSize: preset.minSample,
  };
}
