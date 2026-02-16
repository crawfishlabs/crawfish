/**
 * @fileoverview TypeScript types for LLM routing and provider management
 * @description Defines interfaces for model selection, API calls, and cost tracking
 */

import * as admin from 'firebase-admin';

/**
 * Available LLM providers
 */
export type LLMProvider = 'anthropic' | 'openai' | 'google';

/**
 * Available models by provider (current versions)
 */
export type AnthropicModel = 
  | 'claude-opus-4-6'        // Best reasoning, $15/$75 per 1M tokens
  | 'claude-sonnet-4-20250514' // Great balance, $3/$15
  | 'claude-haiku-3-5'       // Fast + cheap, $0.25/$1.25
  ;

export type OpenAIModel = 
  | 'gpt-4o'               // Strong general, $2.50/$10
  | 'gpt-4o-mini'          // Cheap + fast, $0.15/$0.60
  | 'gpt-4.1'              // Latest, coding focus
  | 'gpt-4.1-mini'         // Latest mini
  | 'o3'                   // Reasoning
  | 'o4-mini'              // Cheap reasoning
  ;

export type GoogleModel = 
  | 'gemini-2.5-pro'       // Best Google, long context
  | 'gemini-2.5-flash'     // Fast + cheap
  | 'gemini-2.0-flash'     // Very cheap
  ;

export type LLMModel = AnthropicModel | OpenAIModel | GoogleModel;

/**
 * Routing preferences for model selection
 */
export type RoutingPreference = 'quality' | 'balanced' | 'cost';

/**
 * Router configuration
 */
export interface RouterConfig {
  preference: RoutingPreference;  // default: 'quality'
  maxCostPerCall?: number;        // budget cap per call
  maxCostPerUserPerDay?: number;  // budget cap per user per day
  enableFallback: boolean;
  logAllCalls: boolean;
}

/**
 * Request types for model routing - full coverage across all 4 Claw apps
 */
export type RequestType =
  // Fitness
  | 'fitness:coach-chat'           // Complex coaching → Opus/Sonnet
  | 'fitness:workout-analysis'     // Analyze workout data → Sonnet
  | 'fitness:exercise-recommend'   // Recommend exercises → Sonnet
  | 'fitness:form-check'           // Check form from description → Sonnet
  | 'fitness:quick-lookup'         // Exercise info, plate math → Haiku
  // Nutrition  
  | 'nutrition:meal-scan'          // Photo → food recognition → GPT-4o (vision)
  | 'nutrition:meal-text'          // Text description → calories → Haiku
  | 'nutrition:barcode-enrich'     // Enrich barcode data → Haiku
  | 'nutrition:coach-chat'         // Nutrition coaching → Sonnet
  | 'nutrition:weekly-insights'    // Pattern analysis → Sonnet
  | 'nutrition:quick-log'          // Simple food logging → Haiku
  // Meetings
  | 'meetings:transcribe'          // Audio → text → Whisper (OpenAI)
  | 'meetings:analyze'             // Full meeting analysis → Sonnet/Opus
  | 'meetings:extract-actions'     // Pull action items → Sonnet
  | 'meetings:leadership-score'    // Score competencies → Opus (needs nuance)
  | 'meetings:leadership-coach'    // Coaching chat → Opus
  | 'meetings:meeting-prep'        // Prep brief → Sonnet
  | 'meetings:search'              // NL search → Haiku
  | 'meetings:summarize'           // Quick summary → Sonnet
  // Budget
  | 'budget:categorize'            // Auto-categorize transaction → Haiku
  | 'budget:coach-chat'            // Financial coaching → Sonnet
  | 'budget:receipt-scan'          // Receipt photo → structured → GPT-4o mini
  | 'budget:spending-analysis'     // Spending patterns → Sonnet
  | 'budget:proactive-alert'       // Generate alerts → Haiku
  | 'budget:ynab-import-map'       // Map YNAB categories → Sonnet
  | 'budget:weekly-digest'         // Weekly summary → Sonnet
  // Cross-app
  | 'cross:memory-refresh'         // Weekly memory update → Sonnet
  | 'cross:daily-overview'         // Cross-domain summary → Sonnet
  | 'cross:security-review'        // Code security scan → Sonnet
  | 'cross:performance-analysis'   // Perf root cause → Sonnet
  // Legacy (for backward compatibility)
  | 'meal-scan' 
  | 'meal-text' 
  | 'coach-chat' 
  | 'workout-analysis' 
  | 'memory-refresh'
  ;

/**
 * LLM call options and configuration
 */
export interface LLMCallOptions {
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature for randomness (0-1) */
  temperature?: number;
  /** System prompt to use */
  systemPrompt?: string;
  /** Whether this is a vision request (for image analysis) */
  isVision?: boolean;
  /** Image data for vision requests */
  imageData?: {
    base64: string;
    mimeType: string;
  };
  /** Override routing preference for this call */
  preferenceOverride?: RoutingPreference;
  /** Force a specific model for this call */
  modelOverride?: LLMModel;
  /** Additional metadata for cost tracking */
  metadata?: {
    userId: string;
    requestType: RequestType;
    feature?: string;
  };
  /** Fallback configuration */
  fallback?: {
    enabled: boolean;
    maxRetries: number;
    providers?: LLMProvider[];
  };
}

/**
 * LLM response from any provider
 */
export interface LLMResponse {
  /** Generated text content */
  content: string;
  /** Provider that handled the request */
  provider: LLMProvider;
  /** Model that generated the response */
  model: LLMModel;
  /** Token usage statistics */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Response latency in milliseconds */
  latencyMs: number;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Request timestamp */
  timestamp: admin.firestore.Timestamp;
  /** Unique request ID for tracking */
  requestId: string;
  /** Whether routing preference was downgraded due to budget */
  preferenceDowngraded?: boolean;
  /** Original preference before downgrade */
  originalPreference?: RoutingPreference;
}

/**
 * Cost tracking data for Firestore
 */
export interface LLMCallRecord {
  /** Request ID for deduplication */
  requestId: string;
  /** User who made the request */
  userId: string;
  /** Request type for categorization */
  requestType: RequestType;
  /** Provider used */
  provider: LLMProvider;
  /** Model used */
  model: LLMModel;
  /** Token usage */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Cost in USD */
  cost: number;
  /** Response latency */
  latencyMs: number;
  /** Whether request succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Routing preference used */
  routingPreference?: RoutingPreference;
  /** Whether preference was downgraded */
  preferenceDowngraded?: boolean;
  /** Additional metadata */
  metadata?: any;
  /** Call timestamp */
  timestamp: admin.firestore.Timestamp;
}

/**
 * Model routing configuration
 */
export interface ModelRouting {
  /** Primary model for this request type */
  primary: {
    provider: LLMProvider;
    model: LLMModel;
  };
  /** Fallback models in order of preference */
  fallbacks: Array<{
    provider: LLMProvider;
    model: LLMModel;
  }>;
  /** Default options for this request type */
  defaultOptions: Partial<LLMCallOptions>;
}

/**
 * Routing table for different preferences
 */
export interface PreferenceRouting {
  quality: ModelRouting;
  balanced: ModelRouting;
  cost: ModelRouting;
}

/**
 * Provider API configuration
 */
export interface ProviderConfig {
  /** Provider name */
  provider: LLMProvider;
  /** API key (from environment or Firebase config) */
  apiKey: string;
  /** Base URL for API requests (optional) */
  baseUrl?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Rate limiting configuration */
  rateLimit?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  /** Cost per token (input/output) */
  pricing: {
    [model: string]: {
      inputTokenCost: number; // Cost per 1K input tokens
      outputTokenCost: number; // Cost per 1K output tokens
    };
  };
}

/**
 * Fallback chain configuration
 */
export interface FallbackConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelay: number;
  /** Error types that should trigger fallback */
  fallbackTriggers: string[];
  /** Providers to try in order */
  providerChain: LLMProvider[];
}

/**
 * Daily cost aggregation for finops
 */
export interface DailyCostSummary {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Total cost across all users */
  totalCost: number;
  /** Total tokens used */
  totalTokens: number;
  /** Number of API calls */
  totalCalls: number;
  /** Cost breakdown by provider */
  byProvider: {
    [provider: string]: {
      cost: number;
      tokens: number;
      calls: number;
    };
  };
  /** Cost breakdown by request type */
  byRequestType: {
    [requestType: string]: {
      cost: number;
      tokens: number;
      calls: number;
    };
  };
  /** Cost breakdown by routing preference */
  byPreference: {
    [preference: string]: {
      cost: number;
      tokens: number;
      calls: number;
    };
  };
  /** Top users by spend */
  topUsers: Array<{
    userId: string;
    cost: number;
    calls: number;
  }>;
  /** Generated timestamp */
  generatedAt: admin.firestore.Timestamp;
}

/**
 * Budget enforcement configuration
 */
export interface BudgetConfig {
  /** Maximum cost per call in USD */
  maxCostPerCall: number;
  /** Maximum cost per user per day in USD */
  maxCostPerUserPerDay: number;
  /** Maximum cost per app per day in USD */
  maxCostPerAppPerDay: number;
  /** Auto-downgrade preference when over budget */
  autoDowngrade: boolean;
  /** Alert thresholds (percentage of limit) */
  alertThresholds: number[];
}

/**
 * Error types for provider fallback
 */
export enum LLMErrorType {
  RATE_LIMIT = 'rate_limit',
  API_ERROR = 'api_error',
  TIMEOUT = 'timeout',
  INVALID_REQUEST = 'invalid_request',
  INSUFFICIENT_QUOTA = 'insufficient_quota',
  MODEL_UNAVAILABLE = 'model_unavailable',
  NETWORK_ERROR = 'network_error',
  BUDGET_EXCEEDED = 'budget_exceeded',
}

/**
 * LLM error with provider context
 */
export interface LLMError extends Error {
  provider: LLMProvider;
  model: LLMModel;
  errorType: LLMErrorType;
  retryable: boolean;
  originalError?: any;
}