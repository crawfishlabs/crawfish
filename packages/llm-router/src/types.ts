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
 * Available models by provider
 */
export type AnthropicModel = 
  | 'claude-3-haiku-20240307'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-opus-20240229'
  | 'claude-3.5-sonnet-20241022';

export type OpenAIModel = 
  | 'gpt-4o-mini'
  | 'gpt-4o'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo';

export type GoogleModel = 
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro'
  | 'gemini-1.0-pro';

export type LLMModel = AnthropicModel | OpenAIModel | GoogleModel;

/**
 * Request types for model routing
 */
export type RequestType = 
  | 'meal-scan' 
  | 'meal-text' 
  | 'coach-chat' 
  | 'workout-analysis' 
  | 'memory-refresh';

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