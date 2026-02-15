/**
 * @fileoverview OpenAI API client and provider implementation
 * @description Handles GPT model API calls with proper error handling and cost tracking
 */

import OpenAI from 'openai';
import * as admin from 'firebase-admin';
import { 
  LLMModel, 
  LLMCallOptions, 
  LLMResponse, 
  LLMError, 
  LLMErrorType, 
  OpenAIModel 
} from '../types';

/**
 * OpenAI pricing per 1K tokens (as of 2024)
 * Update these when pricing changes
 */
const OPENAI_PRICING = {
  'gpt-4o-mini': {
    inputTokenCost: 0.00015,  // $0.15 per 1M input tokens
    outputTokenCost: 0.0006,  // $0.60 per 1M output tokens
  },
  'gpt-4o': {
    inputTokenCost: 0.005,    // $5 per 1M input tokens
    outputTokenCost: 0.015,   // $15 per 1M output tokens
  },
  'gpt-4-turbo': {
    inputTokenCost: 0.01,     // $10 per 1M input tokens
    outputTokenCost: 0.03,    // $30 per 1M output tokens
  },
  'gpt-3.5-turbo': {
    inputTokenCost: 0.0005,   // $0.50 per 1M input tokens
    outputTokenCost: 0.0015,  // $1.50 per 1M output tokens
  },
};

/**
 * OpenAI provider implementation
 * 
 * Handles GPT model API calls with proper error handling,
 * rate limiting, and cost calculation.
 */
export class OpenAIProvider {
  private client: OpenAI;
  
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    
    this.client = new OpenAI({
      apiKey,
    });
  }
  
  /**
   * Make an API call to OpenAI's GPT models
   * 
   * @param model - GPT model to use
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
      if (!this.isOpenAIModel(model)) {
        throw new Error(`Invalid OpenAI model: ${model}`);
      }
      
      // Construct messages
      const messages = this.buildMessages(prompt, context, options);
      
      // Make API call
      const response = await this.client.chat.completions.create({
        model: model as OpenAIModel,
        messages,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.3,
        ...(options.isVision && { 
          // Vision models support different parameters
        }),
      });
      
      const endTime = Date.now();
      const latencyMs = endTime - startTime;
      
      // Extract usage information
      const usage = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      };
      
      // Calculate cost
      const estimatedCost = this.calculateCost(model as OpenAIModel, usage);
      
      // Extract content
      const content = response.choices[0]?.message?.content || '';
      
      return {
        content,
        provider: 'openai',
        model: model as OpenAIModel,
        usage,
        latencyMs,
        estimatedCost,
        timestamp: admin.firestore.Timestamp.now(),
        requestId: '', // Will be set by router
      };
      
    } catch (error) {
      const endTime = Date.now();
      const latencyMs = endTime - startTime;
      
      console.error(`OpenAI API call failed (${latencyMs}ms):`, error);
      
      // Convert to LLMError
      throw this.handleError(error, model as OpenAIModel);
    }
  }
  
  /**
   * Build messages array for OpenAI API
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
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: any }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }> = [];
    
    // Add system prompt if provided
    if (options.systemPrompt) {
      messages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }
    
    // Add context if provided
    if (context) {
      messages.push({
        role: 'system',
        content: `Context: ${JSON.stringify(context, null, 2)}`,
      });
    }
    
    // Handle vision requests
    if (options.isVision && options.imageData) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${options.imageData.mimeType};base64,${options.imageData.base64}`,
              detail: 'auto', // Can be 'low', 'high', or 'auto'
            },
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
   * @param model - OpenAI model used
   * @param usage - Token usage statistics
   * @returns Estimated cost in USD
   */
  private calculateCost(
    model: OpenAIModel,
    usage: { inputTokens: number; outputTokens: number }
  ): number {
    const pricing = OPENAI_PRICING[model];
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
  private handleError(error: any, model: OpenAIModel): LLMError {
    let errorType = LLMErrorType.API_ERROR;
    let retryable = false;
    
    // Parse OpenAI API errors
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
    
    // Check for specific error codes
    if (error.code) {
      switch (error.code) {
        case 'insufficient_quota':
          errorType = LLMErrorType.INSUFFICIENT_QUOTA;
          break;
        case 'model_not_found':
          errorType = LLMErrorType.MODEL_UNAVAILABLE;
          break;
        case 'rate_limit_exceeded':
          errorType = LLMErrorType.RATE_LIMIT;
          retryable = true;
          break;
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
    
    const llmError = new Error(error.message || 'OpenAI API error') as LLMError;
    llmError.provider = 'openai';
    llmError.model = model;
    llmError.errorType = errorType;
    llmError.retryable = retryable;
    llmError.originalError = error;
    
    return llmError;
  }
  
  /**
   * Check if model is valid OpenAI model
   * 
   * @param model - Model to validate
   * @returns True if valid OpenAI model
   */
  private isOpenAIModel(model: LLMModel): model is OpenAIModel {
    return Object.keys(OPENAI_PRICING).includes(model);
  }
  
  /**
   * Get available models for this provider
   * 
   * @returns Array of available model names
   */
  static getAvailableModels(): OpenAIModel[] {
    return Object.keys(OPENAI_PRICING) as OpenAIModel[];
  }
  
  /**
   * Get pricing information for a model
   * 
   * @param model - Model to get pricing for
   * @returns Pricing information or null if not found
   */
  static getPricing(model: OpenAIModel) {
    return OPENAI_PRICING[model] || null;
  }
}