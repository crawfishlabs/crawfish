/**
 * @claw/core — Feature Flag Adapter
 *
 * Abstracts feature flag evaluation.
 * Implementations: CrawfishFlagProvider, LaunchDarklyAdapter, StatsigAdapter, etc.
 */

export interface FlagContext {
  userId?: string;
  accountId?: string;
  email?: string;
  country?: string;
  platform?: string;
  appVersion?: string;
  custom?: Record<string, unknown>;
}

export interface FlagEvaluation<T = unknown> {
  key: string;
  value: T;
  reason?: 'default' | 'rule' | 'override' | 'experiment' | 'error';
  experimentId?: string;
}

export interface CrawfishFlags {
  /** Evaluate a single flag. */
  getFlag<T = unknown>(key: string, context?: FlagContext): Promise<FlagEvaluation<T>>;

  /** Evaluate all flags for a given context (for client-side bootstrapping). */
  getAllFlags(context?: FlagContext): Promise<Record<string, FlagEvaluation>>;

  /** Set a flag value (optional — only supported by writable providers). */
  setFlag?(key: string, value: unknown, rules?: FlagRule[]): Promise<void>;
}

export interface FlagRule {
  attribute: string;
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt' | 'contains';
  value: unknown;
  rolloutPercentage?: number;
}
