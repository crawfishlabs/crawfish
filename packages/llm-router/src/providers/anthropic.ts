/**
 * @fileoverview Anthropic API client and provider implementation
 * @description Handles Claude model API calls with proper error handling and cost tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import * as admin from 'firebase-admin';
import { 
  LLMModel, 
  LLMCallOptions, 
  LLMResponse, 
  LLMError, 
  LLMErrorType, 
  AnthropicModel 
} from '../types';

/**
 * Anthropic pricing per 1K tokens (as of 2024)
 * Update these when pricing changes
 */
const ANTHROPIC_PRICING = {
  'claude-3-haiku-20240307': {
    inputTokenCost: 0.00025,  // $0.25 per 1M input tokens
    outputTokenCost: 0.00125, // $1.25 per 1M output tokens
  },
  'claude-3-sonnet-20240229': {
    inputTokenCost: 0.003,    // $3 per 1M input tokens
    outputTokenCost: 0.015,   // $15 per 1M output tokens
  },
  'claude-3-opus-20240229': {
    inputTokenCost: 0.015,    // $15 per 1M input tokens
    outputTokenCost: 0.075,   // $75 per 1M output tokens
  },
  'claude-3.5-sonnet-20241022': {
    inputTokenCost: 0.003,    // $3 per 1M input tokens
    outputTokenCost: 0.015,   // $15 per 1M output tokens
  },
};

/**
 * Anthropic provider implementation
 * 
 * Handles Claude model API calls with proper error handling,
 * rate limiting, and cost calculation.
 */
export class AnthropicProvider {
  private client: Anthropic;
  
  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    
    this.client = new Anthropic({
      apiKey,
    });
  }
  
  /**
   * Make an API call to Anthropic's Claude models
   * 
   * @param model - Claude model to use
   * @param prompt - User prompt/message
   * @param context - Additional context data (optional)
   * @param options - Call options
   * @returns Promise resolving to LLM response
   */
  async call(
    model: LLMModel,
    prompt: string,
    context?: any,
    options: LLMCallOptions = {}
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    
    try {
      // Validate model
      if (!this.isAnthropicModel(model)) {
        throw new Error(`Invalid Anthropic model: ${model}`);
      }
      
      // Construct messages
      const messages = this.buildMessages(prompt, context, options);
      
      // Make API call
      const response = await this.client.messages.create({
        model: model as AnthropicModel,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.3,
        system: options.systemPrompt,
        messages,
      });
      
      const endTime = Date.now();
      const latencyMs = endTime - startTime;
      
      // Extract usage information
      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };
      
      // Calculate cost
      const estimatedCost = this.calculateCost(model as AnthropicModel, usage);
      
      // Extract text content
      const content = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('\n');
      
      return {
        content,
        provider: 'anthropic',
        model: model as AnthropicModel,
        usage,
        latencyMs,
        estimatedCost,
        timestamp: admin.firestore.Timestamp.now(),
        requestId: '', // Will be set by router
      };
      
    } catch (error) {
      const endTime = Date.now();
      const latencyMs = endTime - startTime;
      
      console.error(`Anthropic API call failed (${latencyMs}ms):`, error);
      
      // Convert to LLMError
      throw this.handleError(error, model as AnthropicModel);
    }
  }
  
  /**
   * Build messages array for Anthropic API
   * 
   * @param prompt - User prompt
   * @param context - Additional context
   * @param options - Call options
   * @returns Messages array
   */
  private buildMessages(
    prompt: string,
    context?: any,
    options: LLMCallOptions = {}
  ): Array<{ role: 'user' | 'assistant'; content: any }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [];
    
    // Add context if provided
    if (context) {
      messages.push({
        role: 'user',
        content: `Context: ${JSON.stringify(context, null, 2)}\n\n`,
      });
    }
    
    // Handle vision requests
    if (options.isVision && options.imageData) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: options.imageData.mimeType,
              data: options.imageData.base64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      });
    } else {
      // Text-only request
      messages.push({
        role: 'user',
        content: prompt,
      });
    }
    
    return messages;
  }
  
  /**
   * Calculate estimated cost for the API call
   * 
   * @param model - Anthropic model used
   * @param usage - Token usage statistics
   * @returns Estimated cost in USD
   */
  private calculateCost(
    model: AnthropicModel,
    usage: { inputTokens: number; outputTokens: number }
  ): number {
    const pricing = ANTHROPIC_PRICING[model];
    if (!pricing) {
      console.warn(`No pricing data for model: ${model}`);
      return 0;
    }
    
    const inputCost = (usage.inputTokens / 1000) * pricing.inputTokenCost;
    const outputCost = (usage.outputTokens / 1000) * pricing.outputTokenCost;
    
    return inputCost + outputCost;
  }
  
  /**
   * Handle API errors and convert to LLMError
   * 
   * @param error - Original error
   * @param model - Model that was called
   * @returns LLMError with context
   */
  private handleError(error: any, model: AnthropicModel): LLMError {
    let errorType = LLMErrorType.API_ERROR;
    let retryable = false;
    
    // Parse Anthropic API errors
    if (error.status) {
      switch (error.status) {
        case 400:
          errorType = LLMErrorType.INVALID_REQUEST;
          break;
        case 401:
          errorType = LLMErrorType.API_ERROR;
          break;
        case 429:
          errorType = LLMErrorType.RATE_LIMIT;
          retryable = true;
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          errorType = LLMErrorType.API_ERROR;
          retryable = true;
          break;
        default:
          errorType = LLMErrorType.API_ERROR;
      }
    }
    
    // Check for timeout
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      errorType = LLMErrorType.TIMEOUT;
      retryable = true;
    }
    
    // Check for network errors
    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      errorType = LLMErrorType.NETWORK_ERROR;
      retryable = true;
    }
    
    const llmError = new Error(error.message || 'Anthropic API error') as LLMError;
    llmError.provider = 'anthropic';
    llmError.model = model;
    llmError.errorType = errorType;
    llmError.retryable = retryable;
    llmError.originalError = error;
    
    return llmError;
  }
  
  /**
   * Check if model is valid Anthropic model
   * 
   * @param model - Model to validate
   * @returns True if valid Anthropic model
   */
  private isAnthropicModel(model: LLMModel): model is AnthropicModel {
    return Object.keys(ANTHROPIC_PRICING).includes(model);
  }
  
  /**
   * Get available models for this provider
   * 
   * @returns Array of available model names
   */
  static getAvailableModels(): AnthropicModel[] {
    return Object.keys(ANTHROPIC_PRICING) as AnthropicModel[];
  }
  
  /**
   * Get pricing information for a model
   * 
   * @param model - Model to get pricing for
   * @returns Pricing information or null if not found
   */
  static getPricing(model: AnthropicModel) {
    return ANTHROPIC_PRICING[model] || null;
  }
}