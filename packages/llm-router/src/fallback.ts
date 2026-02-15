/**
 * @fileoverview Fallback chain implementation for LLM providers
 * @description Handles retry logic and provider fallbacks when primary providers fail
 */

import { 
  LLMProvider, 
  LLMModel, 
  ModelRouting, 
  FallbackConfig, 
  LLMError, 
  LLMErrorType,
  LLMCallOptions 
} from './types';

/**
 * Default fallback configuration
 */
const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  fallbackTriggers: [
    LLMErrorType.RATE_LIMIT,
    LLMErrorType.API_ERROR,
    LLMErrorType.TIMEOUT,
    LLMErrorType.NETWORK_ERROR,
    LLMErrorType.MODEL_UNAVAILABLE,
  ],
  providerChain: ['anthropic', 'openai', 'google'],
};

/**
 * Fallback chain manager for handling provider failures
 * 
 * Manages the retry logic and fallback sequence when LLM providers fail.
 * Includes exponential backoff, error classification, and provider switching.
 */
export class FallbackChain {
  private config: FallbackConfig;
  private currentAttempt: number = 0;
  private providerIndex: number = 0;
  
  constructor(config: Partial<FallbackConfig> = {}) {
    this.config = { ...DEFAULT_FALLBACK_CONFIG, ...config };
  }
  
  /**
   * Execute a function with fallback handling
   * 
   * @param fn - Function to execute with fallback
   * @param providers - Array of provider configurations to try
   * @returns Promise resolving to function result
   */
  async execute<T>(
    fn: (provider: LLMProvider, model: LLMModel) => Promise<T>,
    providers: Array<{ provider: LLMProvider; model: LLMModel }>
  ): Promise<T> {
    let lastError: LLMError | null = null;
    
    for (let providerIndex = 0; providerIndex < providers.length; providerIndex++) {
      const { provider, model } = providers[providerIndex];
      
      // Try with retries for the current provider
      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          console.log(`Attempting ${provider}/${model} (attempt ${attempt + 1}/${this.config.maxRetries})`);
          
          const result = await fn(provider, model);
          
          if (attempt > 0) {
            console.log(`${provider}/${model} succeeded on retry ${attempt + 1}`);
          }
          
          return result;
          
        } catch (error) {
          lastError = error as LLMError;
          
          console.warn(`${provider}/${model} failed (attempt ${attempt + 1}):`, 
            error instanceof Error ? error.message : String(error));
          
          // Check if error should trigger fallback
          if (!this.shouldRetry(lastError)) {
            console.log(`Non-retryable error for ${provider}/${model}, skipping to next provider`);
            break; // Skip to next provider
          }
          
          // If this is not the last attempt, wait before retrying
          if (attempt < this.config.maxRetries - 1) {
            const delay = this.calculateRetryDelay(attempt);
            console.log(`Waiting ${delay}ms before retry...`);
            await this.sleep(delay);
          }
        }
      }
      
      console.log(`All retries exhausted for ${provider}/${model}, trying next provider`);
    }
    
    // All providers and retries failed
    console.error('All providers in fallback chain failed');
    throw lastError || new Error('All fallback providers failed');
  }
  
  /**
   * Determine if an error should trigger a retry
   * 
   * @param error - LLM error to check
   * @returns True if should retry
   */
  private shouldRetry(error: LLMError): boolean {
    // Check if error type is in fallback triggers
    if (!this.config.fallbackTriggers.includes(error.errorType)) {
      return false;
    }
    
    // Check if error is marked as retryable
    return error.retryable;
  }
  
  /**
   * Calculate retry delay with exponential backoff
   * 
   * @param attempt - Current attempt number (0-based)
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number): number {
    // Exponential backoff: base_delay * (2^attempt) + jitter
    const exponentialDelay = this.config.retryDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }
  
  /**
   * Sleep for the specified number of milliseconds
   * 
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Reset the fallback chain state
   */
  reset(): void {
    this.currentAttempt = 0;
    this.providerIndex = 0;
  }
  
  /**
   * Get current fallback statistics
   * 
   * @returns Current state information
   */
  getStats(): {
    currentAttempt: number;
    providerIndex: number;
    maxRetries: number;
  } {
    return {
      currentAttempt: this.currentAttempt,
      providerIndex: this.providerIndex,
      maxRetries: this.config.maxRetries,
    };
  }
}

/**
 * Create a fallback chain from model routing configuration
 * 
 * @param routing - Model routing configuration
 * @param fallbackOptions - Optional fallback configuration overrides
 * @returns Configured FallbackChain instance
 */
export function createFallbackChain(
  routing: ModelRouting,
  fallbackOptions?: Partial<FallbackConfig>
): FallbackChain {
  // Build provider chain from routing configuration
  const providerChain = [routing.primary, ...routing.fallbacks]
    .map(config => config.provider)
    .filter((provider, index, arr) => arr.indexOf(provider) === index); // Remove duplicates
  
  const config: Partial<FallbackConfig> = {
    providerChain,
    ...fallbackOptions,
  };
  
  return new FallbackChain(config);
}

/**
 * Simple retry wrapper for individual function calls
 * 
 * @param fn - Function to retry
 * @param maxRetries - Maximum number of retries
 * @param retryDelay - Delay between retries in milliseconds
 * @returns Promise resolving to function result
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => provider.call(model, prompt),
 *   3,
 *   1000
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      console.warn(`Retry attempt ${attempt + 1}/${maxRetries} failed:`, 
        error instanceof Error ? error.message : String(error));
      
      if (attempt < maxRetries - 1) {
        const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error(`Function failed after ${maxRetries} retries`);
}

/**
 * Circuit breaker pattern for provider health management
 * 
 * Temporarily disables failing providers to prevent cascading failures
 */
export class CircuitBreaker {
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private failureThreshold: number = 5,
    private timeoutMs: number = 60000, // 1 minute
    private resetTimeoutMs: number = 300000 // 5 minutes
  ) {}
  
  /**
   * Execute a function with circuit breaker protection
   * 
   * @param fn - Function to execute
   * @returns Promise resolving to function result
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'half-open';
        console.log('Circuit breaker moving to half-open state');
      } else {
        throw new Error('Circuit breaker is open - provider temporarily disabled');
      }
    }
    
    try {
      const result = await fn();
      
      // Success - reset failure count and close circuit if needed
      this.failureCount = 0;
      if (this.state === 'half-open') {
        this.state = 'closed';
        console.log('Circuit breaker closed - provider recovered');
      }
      
      return result;
      
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      // Check if we should open the circuit
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
        console.warn(`Circuit breaker opened - provider disabled for ${this.resetTimeoutMs}ms`);
      }
      
      throw error;
    }
  }
  
  /**
   * Get current circuit breaker state
   * 
   * @returns Current state and statistics
   */
  getState(): {
    state: string;
    failureCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
  
  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
    console.log('Circuit breaker manually reset');
  }
}