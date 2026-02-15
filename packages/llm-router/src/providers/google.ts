/**
 * @fileoverview Google AI API client and provider implementation
 * @description Handles Gemini model API calls with proper error handling and cost tracking
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as admin from 'firebase-admin';
import { 
  LLMModel, 
  LLMCallOptions, 
  LLMResponse, 
  LLMError, 
  LLMErrorType, 
  GoogleModel 
} from '../types';

/**
 * Google AI pricing per 1K tokens (as of 2024)
 * Update these when pricing changes
 */
const GOOGLE_PRICING = {
  'gemini-1.5-flash': {
    inputTokenCost: 0.000075,  // $0.075 per 1M input tokens
    outputTokenCost: 0.0003,   // $0.30 per 1M output tokens
  },
  'gemini-1.5-pro': {
    inputTokenCost: 0.00125,   // $1.25 per 1M input tokens
    outputTokenCost: 0.005,    // $5 per 1M output tokens
  },
  'gemini-1.0-pro': {
    inputTokenCost: 0.0005,    // $0.50 per 1M input tokens
    outputTokenCost: 0.0015,   // $1.50 per 1M output tokens
  },
};

/**
 * Google AI provider implementation
 * 
 * Handles Gemini model API calls with proper error handling,
 * rate limiting, and cost calculation.
 */
export class GoogleProvider {
  private client: GoogleGenerativeAI;
  
  constructor() {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_AI_API_KEY environment variable is required');
    }
    
    this.client = new GoogleGenerativeAI(apiKey);
  }
  
  /**
   * Make an API call to Google's Gemini models
   * 
   * @param model - Gemini model to use
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
      if (!this.isGoogleModel(model)) {
        throw new Error(`Invalid Google model: ${model}`);
      }
      
      // Get model instance
      const geminiModel = this.client.getGenerativeModel({ 
        model: model as GoogleModel,
        generationConfig: {
          maxOutputTokens: options.maxTokens || 1000,
          temperature: options.temperature || 0.3,
        },
        systemInstruction: options.systemPrompt,
      });
      
      // Build content for the request
      const content = this.buildContent(prompt, context, options);
      
      // Make API call
      const result = await geminiModel.generateContent(content);
      const response = await result.response;
      
      const endTime = Date.now();
      const latencyMs = endTime - startTime;
      
      // Extract usage information (if available)
      const usage = {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      };
      
      // If usage is not available, estimate from content
      if (usage.totalTokens === 0) {
        usage.inputTokens = this.estimateTokens(prompt + (context ? JSON.stringify(context) : ''));
        usage.outputTokens = this.estimateTokens(response.text());
        usage.totalTokens = usage.inputTokens + usage.outputTokens;
      }
      
      // Calculate cost
      const estimatedCost = this.calculateCost(model as GoogleModel, usage);
      
      // Extract content
      const content_text = response.text();
      
      return {
        content: content_text,
        provider: 'google',
        model: model as GoogleModel,
        usage,
        latencyMs,
        estimatedCost,
        timestamp: admin.firestore.Timestamp.now(),
        requestId: '', // Will be set by router
      };
      
    } catch (error) {
      const endTime = Date.now();
      const latencyMs = endTime - startTime;
      
      console.error(`Google AI API call failed (${latencyMs}ms):`, error);
      
      // Convert to LLMError
      throw this.handleError(error, model as GoogleModel);
    }
  }
  
  /**
   * Build content for Google AI API request
   * 
   * @param prompt - User prompt
   * @param context - Additional context
   * @param options - Call options
   * @returns Content for API request
   */
  private buildContent(
    prompt: string,
    context?: any,
    options: LLMCallOptions = {}
  ): any {
    let fullPrompt = prompt;
    
    // Add context if provided
    if (context) {
      fullPrompt = `Context: ${JSON.stringify(context, null, 2)}\n\n${prompt}`;
    }
    
    // Handle vision requests
    if (options.isVision && options.imageData) {
      return [
        fullPrompt,
        {
          inlineData: {
            data: options.imageData.base64,
            mimeType: options.imageData.mimeType,
          },
        },
      ];
    } else {
      // Text-only request
      return fullPrompt;
    }
  }
  
  /**
   * Calculate estimated cost for the API call
   * 
   * @param model - Google model used
   * @param usage - Token usage statistics
   * @returns Estimated cost in USD
   */
  private calculateCost(
    model: GoogleModel,
    usage: { inputTokens: number; outputTokens: number }
  ): number {
    const pricing = GOOGLE_PRICING[model];
    if (!pricing) {
      console.warn(`No pricing data for model: ${model}`);
      return 0;
    }
    
    const inputCost = (usage.inputTokens / 1000) * pricing.inputTokenCost;
    const outputCost = (usage.outputTokens / 1000) * pricing.outputTokenCost;
    
    return inputCost + outputCost;
  }
  
  /**
   * Estimate token count from text (rough approximation)
   * Google's tokenization may differ, but this gives a reasonable estimate
   * 
   * @param text - Text to estimate tokens for
   * @returns Estimated token count
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Handle API errors and convert to LLMError
   * 
   * @param error - Original error
   * @param model - Model that was called
   * @returns LLMError with context
   */
  private handleError(error: any, model: GoogleModel): LLMError {
    let errorType = LLMErrorType.API_ERROR;
    let retryable = false;
    
    // Parse Google AI API errors
    if (error.status) {
      switch (error.status) {
        case 400:
          errorType = LLMErrorType.INVALID_REQUEST;
          break;
        case 401:
        case 403:
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
    
    // Check for specific error messages
    if (error.message) {
      if (error.message.includes('quota') || error.message.includes('limit')) {
        errorType = LLMErrorType.RATE_LIMIT;
        retryable = true;
      } else if (error.message.includes('model not found')) {
        errorType = LLMErrorType.MODEL_UNAVAILABLE;
      } else if (error.message.includes('safety') || error.message.includes('blocked')) {
        errorType = LLMErrorType.INVALID_REQUEST;
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
    
    const llmError = new Error(error.message || 'Google AI API error') as LLMError;
    llmError.provider = 'google';
    llmError.model = model;
    llmError.errorType = errorType;
    llmError.retryable = retryable;
    llmError.originalError = error;
    
    return llmError;
  }
  
  /**
   * Check if model is valid Google model
   * 
   * @param model - Model to validate
   * @returns True if valid Google model
   */
  private isGoogleModel(model: LLMModel): model is GoogleModel {
    return Object.keys(GOOGLE_PRICING).includes(model);
  }
  
  /**
   * Get available models for this provider
   * 
   * @returns Array of available model names
   */
  static getAvailableModels(): GoogleModel[] {
    return Object.keys(GOOGLE_PRICING) as GoogleModel[];
  }
  
  /**
   * Get pricing information for a model
   * 
   * @param model - Model to get pricing for
   * @returns Pricing information or null if not found
   */
  static getPricing(model: GoogleModel) {
    return GOOGLE_PRICING[model] || null;
  }
}