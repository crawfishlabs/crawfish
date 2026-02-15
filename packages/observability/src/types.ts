/**
 * @fileoverview Types for observability, cost tracking, and monitoring
 */

import * as admin from 'firebase-admin';

/**
 * LLM provider names
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google';

/**
 * Model names by provider
 */
export type ModelName = 
  | 'gpt-4' | 'gpt-4-turbo' | 'gpt-3.5-turbo'
  | 'claude-3-opus' | 'claude-3-sonnet' | 'claude-3-haiku'
  | 'gemini-pro' | 'gemini-pro-vision';

/**
 * Cost tracking entry
 */
export interface CostEntry {
  /** Unique entry ID */
  id: string;
  /** User ID */
  userId: string;
  /** LLM provider */
  provider: LLMProvider;
  /** Model used */
  model: ModelName;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Cost in USD */
  cost: number;
  /** Feature that triggered the call */
  feature: string;
  /** Session identifier */
  sessionId?: string;
  /** Request timestamp */
  timestamp: admin.firestore.Timestamp;
  /** Additional metadata */
  metadata?: {
    requestId?: string;
    responseTime?: number;
    success?: boolean;
    errorMessage?: string;
  };
}

/**
 * Daily cost summary
 */
export interface DailyCostSummary {
  /** Date (YYYY-MM-DD) */
  date: string;
  /** Total cost in USD */
  totalCost: number;
  /** Total tokens used */
  totalTokens: number;
  /** Breakdown by provider */
  byProvider: Record<LLMProvider, {
    cost: number;
    tokens: number;
    calls: number;
  }>;
  /** Breakdown by feature */
  byFeature: Record<string, {
    cost: number;
    tokens: number;
    calls: number;
  }>;
  /** Number of unique users */
  uniqueUsers: number;
  /** Last updated */
  updatedAt: admin.firestore.Timestamp;
}

/**
 * User cost tracking
 */
export interface UserCostData {
  /** User ID */
  userId: string;
  /** Current month cost */
  monthlyTotal: number;
  /** Current day cost */
  dailyTotal: number;
  /** Last reset date */
  lastReset: admin.firestore.Timestamp;
  /** Usage breakdown */
  usage: {
    mealScan: number;
    coachChat: number;
    workoutAnalysis: number;
  };
  /** Cost limits */
  limits?: {
    daily?: number;
    monthly?: number;
  };
  /** Last updated */
  updatedAt: admin.firestore.Timestamp;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  /** Average response time in ms */
  avgResponseTime: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Error count */
  errorCount: number;
  /** Total requests */
  totalRequests: number;
  /** Time period for metrics */
  period: '1h' | '24h' | '7d' | '30d';
  /** Timestamp */
  timestamp: admin.firestore.Timestamp;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  /** Alert ID */
  id: string;
  /** Alert type */
  type: 'cost_threshold' | 'error_rate' | 'response_time' | 'usage_spike';
  /** Threshold value */
  threshold: number;
  /** Time window for evaluation */
  windowMinutes: number;
  /** Whether alert is enabled */
  enabled: boolean;
  /** Recipients for alert */
  recipients: string[];
  /** Last triggered */
  lastTriggered?: admin.firestore.Timestamp;
}