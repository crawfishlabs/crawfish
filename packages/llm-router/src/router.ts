/**
 * @fileoverview LLM model routing and selection logic
 * @description Routes requests to appropriate models based on request type and requirements
 */

import { 
  RequestType, 
  LLMProvider, 
  LLMModel, 
  LLMCallOptions, 
  LLMResponse, 
  ModelRouting, 
  LLMError, 
  LLMErrorType 
} from './types';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { GoogleProvider } from './providers/google';
import { createFallbackChain } from './fallback';
import { trackLLMCall } from './cost-tracker';
import { v4 as uuidv4 } from 'uuid';

/**
 * Model routing table - defines which models to use for each request type
 */
const MODEL_ROUTING: Record<RequestType, ModelRouting> = {
  'meal-scan': {
    primary: {
      provider: 'openai',
      model: 'gpt-4o-mini', // Good vision capabilities
    },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
      { provider: 'google', model: 'gemini-1.5-flash' },
    ],
    defaultOptions: {
      maxTokens: 1000,
      temperature: 0.3,
      isVision: true,
      systemPrompt: `You are a nutrition analysis AI. Analyze the food in the image and provide:
1. Detailed list of food items and portions
2. Estimated calories and macronutrients
3. Nutritional assessment and suggestions
Be accurate and detailed in your analysis.`,
    },
  },
  'meal-text': {
    primary: {
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307', // Fast and accurate for text
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-1.5-flash' },
      { provider: 'openai', model: 'gpt-4o-mini' },
    ],
    defaultOptions: {
      maxTokens: 800,
      temperature: 0.2,
      systemPrompt: `You are a nutrition assistant. Help users log their meals accurately.
Provide nutritional estimates and healthy suggestions based on the meal description.`,
    },
  },
  'coach-chat': {
    primary: {
      provider: 'anthropic',
      model: 'claude-3.5-sonnet-20241022', // Best reasoning for coaching
    },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-sonnet-20240229' },
      { provider: 'openai', model: 'gpt-4o' },
    ],
    defaultOptions: {
      maxTokens: 1500,
      temperature: 0.4,
      systemPrompt: `You are Claw, an expert fitness and nutrition coach. Provide personalized,
evidence-based advice. Be supportive, motivational, and practical. Always consider the user's
context, goals, and preferences when making recommendations.`,
    },
  },
  'workout-analysis': {
    primary: {
      provider: 'anthropic',
      model: 'claude-3.5-sonnet-20241022', // Good for detailed analysis
    },
    fallbacks: [
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'anthropic', model: 'claude-3-sonnet-20240229' },
    ],
    defaultOptions: {
      maxTokens: 1200,
      temperature: 0.3,
      systemPrompt: `You are a fitness expert analyzing workout data. Provide insights on:
1. Exercise form and technique suggestions
2. Progressive overload recommendations
3. Recovery and injury prevention advice
4. Workout plan optimization`,
    },
  },
  'memory-refresh': {
    primary: {
      provider: 'anthropic',
      model: 'claude-3.5-sonnet-20241022', // Best for summarization
    },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-sonnet-20240229' },
      { provider: 'openai', model: 'gpt-4o' },
    ],
    defaultOptions: {
      maxTokens: 2000,
      temperature: 0.2,
      systemPrompt: `You are creating memory summaries for fitness coaching. Analyze the user's
data and create concise, actionable insights. Focus on patterns, progress, and recommendations
for the upcoming period.`,
    },
  },
};

/**
 * Provider instances (initialized lazily)
 */
let providerInstances: {
  anthropic?: AnthropicProvider;
  openai?: OpenAIProvider;
  google?: GoogleProvider;
} = {};

/**
 * Route an LLM call to the appropriate model and provider
 * 
 * @param requestType - Type of request determining model selection
 * @param prompt - User prompt/message
 * @param context - Additional context data (optional)
 * @param options - Call options (optional, will be merged with defaults)
 * @returns Promise resolving to LLM response
 * 
 * @example
 * ```typescript
 * const response = await routeLLMCall(
 *   'meal-scan',
 *   'What food is in this image?',
 *   userContext,
 *   { 
 *     imageData: { base64: '...', mimeType: 'image/jpeg' },
 *     metadata: { userId: 'user123', requestType: 'meal-scan' }
 *   }
 * );
 * console.log(response.content);
 * ```
 */
export async function routeLLMCall(
  requestType: RequestType,
  prompt: string,
  context?: any,
  options: LLMCallOptions = {}
): Promise<LLMResponse> {
  const requestId = uuidv4();
  const startTime = Date.now();
  
  try {
    // Get routing configuration for request type
    const routing = MODEL_ROUTING[requestType];
    if (!routing) {
      throw new Error(`Unknown request type: ${requestType}`);
    }
    
    // Merge default options with provided options
    const finalOptions: LLMCallOptions = {
      ...routing.defaultOptions,
      ...options,
      metadata: options.metadata ? {
        requestType,
        ...options.metadata,
      } : undefined,
    };
    
    // Create fallback chain if enabled
    const fallbackChain = createFallbackChain(routing, finalOptions.fallback);
    
    // Try primary model first
    let lastError: LLMError | null = null;
    
    for (const { provider, model } of [routing.primary, ...routing.fallbacks]) {
      try {
        console.log(`Trying ${provider}/${model} for ${requestType} request`);
        
        const providerInstance = await getProviderInstance(provider);
        const response = await providerInstance.call(model, prompt, context, finalOptions);
        
        // Track successful call
        const userId = finalOptions.metadata?.userId;
        if (userId) {
          await trackLLMCall({
            requestId,
            userId,
            requestType,
            provider,
            model,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            totalTokens: response.usage.totalTokens,
            cost: response.estimatedCost,
            latencyMs: Date.now() - startTime,
            success: true,
            timestamp: response.timestamp,
          });
        }
        
        return {
          ...response,
          requestId,
        };
        
      } catch (error) {
        console.warn(`${provider}/${model} failed for ${requestType}:`, error);
        lastError = error as LLMError;
        
        // Track failed call
        const userId = finalOptions.metadata?.userId;
        if (userId) {
          await trackLLMCall({
            requestId,
            userId,
            requestType,
            provider,
            model,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cost: 0,
            latencyMs: Date.now() - startTime,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date(),
          });
        }
        
        // If not retryable, break the fallback chain
        if (!lastError.retryable) {
          break;
        }
      }
    }
    
    // All providers failed
    throw lastError || new Error(`All providers failed for ${requestType} request`);
    
  } catch (error) {
    console.error(`LLM routing failed for ${requestType}:`, error);
    throw error;
  }
}

/**
 * Get the configured model for a request type (for informational purposes)
 * 
 * @param requestType - Request type to check
 * @returns Primary model configuration
 */
export function getModelForRequestType(requestType: RequestType): { provider: LLMProvider; model: LLMModel } {
  const routing = MODEL_ROUTING[requestType];
  if (!routing) {
    throw new Error(`Unknown request type: ${requestType}`);
  }
  
  return routing.primary;
}

/**
 * Get or create provider instance
 * 
 * @param provider - Provider name
 * @returns Provider instance
 */
async function getProviderInstance(provider: LLMProvider): Promise<AnthropicProvider | OpenAIProvider | GoogleProvider> {
  if (!providerInstances[provider]) {
    switch (provider) {
      case 'anthropic':
        providerInstances.anthropic = new AnthropicProvider();
        break;
      case 'openai':
        providerInstances.openai = new OpenAIProvider();
        break;
      case 'google':
        providerInstances.google = new GoogleProvider();
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
  
  return providerInstances[provider]!;
}

/**
 * Update model routing configuration (for dynamic routing changes)
 * 
 * @param requestType - Request type to update
 * @param routing - New routing configuration
 */
export function updateModelRouting(requestType: RequestType, routing: ModelRouting): void {
  MODEL_ROUTING[requestType] = routing;
  console.log(`Updated routing for ${requestType}:`, routing);
}

/**
 * Get current routing configuration for a request type
 * 
 * @param requestType - Request type
 * @returns Current routing configuration
 */
export function getRoutingConfig(requestType: RequestType): ModelRouting {
  return MODEL_ROUTING[requestType];
}

/**
 * Health check for all providers
 * 
 * @returns Promise resolving to provider health status
 */
export async function healthCheckProviders(): Promise<{ [provider: string]: boolean }> {
  const results: { [provider: string]: boolean } = {};
  
  for (const provider of ['anthropic', 'openai', 'google'] as LLMProvider[]) {
    try {
      const instance = await getProviderInstance(provider);
      // Try a simple health check call
      await instance.call(
        'claude-3-haiku-20240307' as any, // Use cheapest model
        'Say "OK"',
        null,
        { maxTokens: 10, temperature: 0 }
      );
      results[provider] = true;
    } catch (error) {
      console.warn(`Health check failed for ${provider}:`, error);
      results[provider] = false;
    }
  }
  
  return results;
}