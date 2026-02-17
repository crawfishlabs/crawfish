// ─── Core Types ─────────────────────────────────────────────────────────────

export type AppId = 'fitness' | 'nutrition' | 'budget' | 'meetings';
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'rolled_back';
export type DecisionType = 'roll_forward' | 'roll_back' | 'extend' | 'iterate';
export type MetricType = 'conversion' | 'count' | 'duration' | 'revenue' | 'satisfaction';
export type Aggregation = 'sum' | 'avg' | 'p50' | 'p95' | 'count' | 'rate';
export type Direction = 'increase' | 'decrease';
export type Comparison = 'gt' | 'lt' | 'gte' | 'lte';
export type GuardrailAction = 'pause' | 'rollback' | 'alert';
export type FeedbackType = 'ticket' | 'rating' | 'review' | 'nps' | 'churn' | 'in_app_feedback';
export type Sentiment = 'positive' | 'neutral' | 'negative';

// ─── Experiment ─────────────────────────────────────────────────────────────

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  appId: AppId;
  status: ExperimentStatus;

  cohort: CohortConfig;
  variants: Variant[];
  metrics: ExperimentMetric[];
  guardrails: GuardrailMetric[];
  successCriteria: SuccessCriterion[];

  // Lifecycle
  startDate: Date;
  endDate?: Date;
  minSampleSize: number;
  minDuration: number; // hours

  // Results
  decision?: DecisionType;
  decisionReason?: string;
  decisionAt?: Date;
  decisionBy?: 'auto' | 'manual';

  createdAt: Date;
  updatedAt: Date;
}

export interface CohortConfig {
  type: 'percentage' | 'segment' | 'allowlist';
  percentage?: number;
  segments?: string[];
  allowlist?: string[];
  excludeList?: string[];
}

export interface Variant {
  id: string;
  name: string; // 'control' | 'treatment_a' | 'treatment_b' etc.
  weight: number; // percentage, all must sum to 100
  featureFlags: Record<string, any>;
}

export interface ExperimentMetric {
  id: string;
  name: string;
  type: MetricType;
  aggregation: Aggregation;
  direction: Direction;
}

export interface GuardrailMetric {
  metricId: string;
  threshold: number;
  comparison: Comparison;
  description: string;
  action: GuardrailAction;
}

export interface SuccessCriterion {
  metricId: string;
  minLift: number; // minimum % improvement over control
  confidence: number; // e.g. 0.95
}

// ─── Events & Signals ───────────────────────────────────────────────────────

export interface ExperimentEvent {
  id: string;
  experimentId: string;
  userId: string;
  variantId: string;
  metricId: string;
  value: number;
  timestamp: Date;
}

export interface FeedbackSignal {
  experimentId: string;
  variant: string;
  userId: string;
  type: FeedbackType;
  sentiment: Sentiment;
  score?: number;
  message?: string;
  timestamp: Date;
}

// ─── Assignment ─────────────────────────────────────────────────────────────

export interface UserAssignment {
  experimentId: string;
  userId: string;
  variantId: string;
  assignedAt: Date;
}

// ─── Evaluation ─────────────────────────────────────────────────────────────

export type Recommendation = 'roll_forward' | 'roll_back' | 'extend' | 'insufficient_data';

export interface VariantMetricResult {
  variantId: string;
  metricId: string;
  value: number;
  sampleSize: number;
}

export interface MetricComparison {
  metricId: string;
  controlValue: number;
  treatmentValue: number;
  lift: number;
  pValue: number;
  confidence: number;
  isSignificant: boolean;
}

export interface ExperimentEvaluation {
  experimentId: string;
  timestamp: Date;
  variantResults: VariantMetricResult[];
  comparisons: MetricComparison[];
  guardrailStatus: 'all_green' | 'warning' | 'breached';
  breachedGuardrails: string[];
  recommendation: Recommendation;
  reason: string;
  totalSampleSize: number;
  durationHours: number;
}

// ─── Reports ────────────────────────────────────────────────────────────────

export interface FeedbackSummary {
  variant: string;
  totalFeedback: number;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topThemes: string[];
  averageRating: number;
}

export interface TimelinePoint {
  timestamp: Date;
  metricId: string;
  variantId: string;
  value: number;
}

export interface ExperimentReport {
  experiment: Experiment;
  variants: VariantMetricResult[];
  comparisons: MetricComparison[];
  guardrailStatus: 'all_green' | 'warning' | 'breached';
  recommendation: Recommendation;
  confidence: number;
  feedbackSummary: FeedbackSummary[];
  timeline: TimelinePoint[];
  generatedAt: Date;
}

export interface PortfolioReport {
  experiments: Experiment[];
  totalExperiments: number;
  winRate: number;
  averageLift: number;
  averageTimeToDecisionHours: number;
  cumulativeImpact: Record<string, number>;
  feedbackCorrelation: number;
  dateRange: { start: Date; end: Date };
  generatedAt: Date;
}

export interface ImpactDataPoint {
  date: Date;
  metricId: string;
  value: number;
  experimentId?: string;
}

export interface ImpactReport {
  appId: AppId;
  months: number;
  trajectories: ImpactDataPoint[];
  experimentImpacts: { experimentId: string; metricId: string; before: number; after: number; delta: number }[];
  netImpactScore: number;
  generatedAt: Date;
}

// ─── Support Integration ────────────────────────────────────────────────────

export interface SupportTicket {
  id: string;
  userId: string;
  appId: AppId;
  subject: string;
  body: string;
  createdAt: Date;
}

// ─── Decision Log ───────────────────────────────────────────────────────────

export interface DecisionLog {
  id: string;
  experimentId: string;
  action: DecisionType | 'pause' | 'graduate';
  reason: string;
  by: 'auto' | 'manual';
  evaluation?: ExperimentEvaluation;
  timestamp: Date;
}
