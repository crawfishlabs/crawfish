// ─── Sentiment Metrics for Experiment Engine ────────────────────────────────
//
// These metric definitions and guardrails integrate with @claw/experiments
// to make user sentiment a first-class signal in experiment evaluation.

export const SENTIMENT_METRICS = {
  micro_reaction_avg: {
    id: 'micro_reaction_avg',
    type: 'satisfaction' as const,
    aggregation: 'avg' as const,
    direction: 'increase' as const,
    description: 'Average micro-reaction score (1-5 emoji scale)',
  },
  contextual_rating_avg: {
    id: 'contextual_rating_avg',
    type: 'satisfaction' as const,
    aggregation: 'avg' as const,
    direction: 'increase' as const,
    description: 'Average contextual star rating (1-5)',
  },
  nps_score: {
    id: 'nps_score',
    type: 'satisfaction' as const,
    aggregation: 'avg' as const,
    direction: 'increase' as const,
    description: 'Net Promoter Score (-100 to 100)',
  },
  sentiment_response_rate: {
    id: 'sentiment_response_rate',
    type: 'conversion' as const,
    aggregation: 'rate' as const,
    direction: 'increase' as const,
    description: 'Rate of users who respond to sentiment prompts',
  },
  negative_reaction_rate: {
    id: 'negative_reaction_rate',
    type: 'conversion' as const,
    aggregation: 'rate' as const,
    direction: 'decrease' as const,
    description: 'Rate of negative reactions (😕😤 or 1-2 stars)',
  },
};

// Default guardrails that every experiment should include
export const SENTIMENT_GUARDRAILS = [
  {
    metricId: 'negative_reaction_rate',
    threshold: 0.25,
    comparison: 'lt' as const,
    action: 'alert' as const,
    description: 'Alert if >25% of reactions are negative',
  },
  {
    metricId: 'nps_score',
    threshold: -20,
    comparison: 'gt' as const,
    action: 'rollback' as const,
    description: 'Rollback if NPS delta drops below -20 points vs control',
  },
];

// Convenience: merge sentiment guardrails into experiment config
export function withSentimentGuardrails<T extends { guardrails?: any[] }>(config: T): T {
  return {
    ...config,
    guardrails: [
      ...(config.guardrails || []),
      ...SENTIMENT_GUARDRAILS.map(g => ({
        metricId: g.metricId,
        threshold: g.threshold,
        comparison: g.comparison,
        action: g.action,
      })),
    ],
  };
}
