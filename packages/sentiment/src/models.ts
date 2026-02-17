// ─── Sentiment & NPS Models ─────────────────────────────────────────────────

export type PromptType = 'micro_reaction' | 'contextual_rating' | 'nps' | 'feature_reaction';
export type Reaction = '😍' | '🙂' | '😐' | '😕' | '😤';
export type NPSCategory = 'promoter' | 'passive' | 'detractor';
export type TriggerKind = 'after_action' | 'after_experiment_exposure' | 'session_milestone' | 'scheduled';

export const REACTION_SCORES: Record<Reaction, number> = {
  '😍': 5,
  '🙂': 4,
  '😐': 3,
  '😕': 2,
  '😤': 1,
};

export function npsCategory(score: number): NPSCategory {
  if (score >= 9) return 'promoter';
  if (score >= 7) return 'passive';
  return 'detractor';
}

// ─── Prompt Config ──────────────────────────────────────────────────────────

export interface SentimentPrompt {
  id: string;
  type: PromptType;
  trigger: SentimentTrigger;
  cooldown: CooldownConfig;
}

export interface SentimentTrigger {
  kind: TriggerKind;
  action?: string;
  experimentId?: string;
  minSessionCount?: number;
  minDaysSinceInstall?: number;
}

export interface CooldownConfig {
  minHoursBetweenPrompts: number;  // default 168 (1 week)
  maxPromptsPerMonth: number;      // default 3
  npsIntervalDays: number;         // default 90
  respectDoNotDisturb: boolean;    // true
}

export const DEFAULT_COOLDOWN: CooldownConfig = {
  minHoursBetweenPrompts: 168,
  maxPromptsPerMonth: 3,
  npsIntervalDays: 90,
  respectDoNotDisturb: true,
};

// ─── Response ───────────────────────────────────────────────────────────────

export interface SentimentResponse {
  id: string;
  userId: string;
  appId: string;
  promptType: PromptType;

  // Micro reaction
  reaction?: Reaction;
  reactionScore?: number;

  // Contextual rating: 1-5 stars
  rating?: number;

  // NPS: 0-10
  npsScore?: number;
  npsCategory?: NPSCategory;

  // Optional follow-up
  comment?: string;

  // Context
  featureId?: string;
  experimentId?: string;
  variant?: string;
  screenContext?: string;
  actionContext?: string;

  // Metadata
  timestamp: Date;
  responseTimeMs?: number;
  dismissed?: boolean;
}

// ─── User Sentiment Metadata (stored per-user) ─────────────────────────────

export interface SentimentMeta {
  userId: string;
  lastPromptAt?: Date;
  lastNPSAt?: Date;
  promptsThisMonth: number;
  monthKey: string; // 'YYYY-MM'
  totalResponses: number;
  totalDismissals: number;
  consecutiveDismissals: number;
  consecutiveNegative: number;     // 😤 or 1-star streaks
  backoffUntil?: Date;
  firstActiveAt?: Date;
}

// ─── NPS ────────────────────────────────────────────────────────────────────

export interface NPSPromptConfig {
  promptId: string;
  appName: string;
  followUpPrompts: {
    promoter: string;   // "What do you love most?"
    passive: string;    // "What would make it a 10?"
    detractor: string;  // "What can we do better?"
  };
}

export interface NPSResult {
  appId: string;
  score: number;           // -100 to 100
  promoters: number;
  passives: number;
  detractors: number;
  totalResponses: number;
  segments?: Record<string, { score: number; count: number }>;
  trend?: { date: string; score: number }[];
  dateRange?: { start: Date; end: Date };
}

export interface ExperimentNPS {
  experimentId: string;
  variants: { variantId: string; nps: number; count: number }[];
  delta: number;
  isSignificant: boolean;
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface AppSentiment {
  appId: string;
  avgReactionScore: number;
  reactionDistribution: Record<Reaction, number>;
  nps: number;
  npsTrend: { date: string; score: number }[];
  responseRate: number;
  dismissRate: number;
  topPositiveThemes: string[];
  topNegativeThemes: string[];
  dateRange: { start: Date; end: Date };
}

export interface FeatureSentiment {
  featureId: string;
  appId: string;
  avgScore: number;
  responseCount: number;
  beforeAfter?: { before: number; after: number; changeDate: Date };
}

export interface ExperimentSentimentReport {
  experimentId: string;
  variants: {
    variantId: string;
    avgReaction: number;
    avgRating: number;
    nps: number;
    responseCount: number;
  }[];
  sentimentDelta: number;
  isSignificant: boolean;
  combinedScore: number;
}

export interface GuardrailResult {
  status: 'green' | 'warning' | 'breach';
  details: string;
  metricId: string;
  value: number;
  threshold: number;
}

// ─── Date Range Helper ──────────────────────────────────────────────────────

export interface DateRange {
  start: Date;
  end: Date;
}
