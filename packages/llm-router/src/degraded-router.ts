/**
 * @fileoverview Degraded mode routing for budget-constrained users
 * @description Routes users in degraded status to cheaper models while maintaining quality
 */

import { RequestType, ModelRouting, LLMProvider, LLMModel } from './types';

/**
 * Model choices for degraded mode - optimized for cost while maintaining quality
 */
export interface DegradedModelChoice {
  provider: LLMProvider;
  model: LLMModel;
  maxTokens: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Degraded routing table - all routes use cheaper models
 * Philosophy: 
 * - No input token limits (users can write as much as they want)
 * - Output tokens capped lower for cost control
 * - Still provide good responses, just shorter and cheaper
 * - Route complex tasks to Haiku (fast + competent)
 * - Route vision tasks to GPT-4o-mini (cheapest vision model)
 */
const DEGRADED_ROUTING: Record<RequestType, DegradedModelChoice> = {
  // FITNESS ROUTES - All go to Haiku for consistency and speed
  'fitness:coach-chat': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 800, // Reduced from 1500 premium
    temperature: 0.4,
    systemPrompt: 'You are Claw, a fitness coach. Provide concise, actionable fitness advice.',
  },
  
  'fitness:workout-analysis': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 800, // Reduced from 1200 premium
    temperature: 0.3,
    systemPrompt: 'Analyze workout data and provide key insights on form and progression.',
  },
  
  'fitness:exercise-recommend': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 600, // Reduced from 1000 premium
    temperature: 0.3,
    systemPrompt: 'Recommend exercises based on goals and equipment.',
  },
  
  'fitness:form-check': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 500, // Reduced from 800 premium
    temperature: 0.2,
    systemPrompt: 'Analyze exercise form and provide key corrections.',
  },
  
  'fitness:quick-lookup': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 300, // Reduced from 400 premium
    temperature: 0.1,
    systemPrompt: 'Provide quick exercise information.',
  },

  // NUTRITION ROUTES
  'nutrition:meal-scan': {
    provider: 'openai',
    model: 'gpt-4o-mini', // Cheapest vision model
    maxTokens: 600, // Reduced from 1000 premium
    temperature: 0.2,
    systemPrompt: 'Identify food and estimate nutrition from image.',
  },
  
  'nutrition:meal-text': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 500, // Reduced from 800 premium
    temperature: 0.2,
    systemPrompt: 'Analyze meal description and provide nutrition estimates.',
  },
  
  'nutrition:barcode-enrich': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 300, // Reduced from 400 premium
    temperature: 0.1,
    systemPrompt: 'Enrich barcode nutrition data.',
  },
  
  'nutrition:coach-chat': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 800, // Reduced from 1200 premium
    temperature: 0.4,
    systemPrompt: 'You are Claw, a nutrition coach. Provide concise nutrition advice.',
  },
  
  'nutrition:weekly-insights': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 1000, // Reduced from 1500 premium
    temperature: 0.3,
    systemPrompt: 'Analyze nutrition patterns and provide key weekly insights.',
  },
  
  'nutrition:quick-log': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 200, // Reduced from 300 premium
    temperature: 0.1,
    systemPrompt: 'Quick food logging assistance.',
  },

  // MEETINGS ROUTES
  'meetings:transcribe': {
    provider: 'openai',
    model: 'gpt-4o-mini', // Cheapest transcription option
    maxTokens: 1500, // Reduced from 2000 premium
    temperature: 0.1,
    systemPrompt: 'Transcribe audio to text.',
  },
  
  'meetings:analyze': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5', // Much cheaper than Opus
    maxTokens: 1200, // Reduced from 2000 premium
    temperature: 0.3,
    systemPrompt: 'Analyze meeting and provide key insights and recommendations.',
  },
  
  'meetings:extract-actions': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 500, // Reduced from 800 premium
    temperature: 0.2,
    systemPrompt: 'Extract key action items from meeting.',
  },
  
  'meetings:leadership-score': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5', // Much cheaper than Opus, still capable
    maxTokens: 800, // Reduced from 1200 premium
    temperature: 0.2,
    systemPrompt: 'Score leadership competencies with key rationale.',
  },
  
  'meetings:leadership-coach': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5', // Much cheaper than Opus
    maxTokens: 1000, // Reduced from 1500 premium
    temperature: 0.4,
    systemPrompt: 'Provide focused leadership coaching advice.',
  },
  
  'meetings:meeting-prep': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 600, // Reduced from 1000 premium
    temperature: 0.3,
    systemPrompt: 'Prepare concise meeting briefs.',
  },
  
  'meetings:search': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 300, // Reduced from 400 premium
    temperature: 0.1,
    systemPrompt: 'Search meeting transcripts.',
  },
  
  'meetings:summarize': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 500, // Reduced from 800 premium
    temperature: 0.2,
    systemPrompt: 'Create concise meeting summaries.',
  },

  // BUDGET ROUTES
  'budget:categorize': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5', // Already cheap, keep same
    maxTokens: 150, // Reduced from 200 premium
    temperature: 0.1,
    systemPrompt: 'Categorize transactions.',
  },
  
  'budget:coach-chat': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5', // Much cheaper than Sonnet
    maxTokens: 800, // Reduced from 1200 premium
    temperature: 0.4,
    systemPrompt: 'You are Claw, a financial coach. Provide concise budgeting advice.',
  },
  
  'budget:receipt-scan': {
    provider: 'openai',
    model: 'gpt-4o-mini', // Cheapest vision model
    maxTokens: 400, // Reduced from 600 premium
    temperature: 0.1,
    systemPrompt: 'Extract key data from receipt images.',
  },
  
  'budget:spending-analysis': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 800, // Reduced from 1200 premium
    temperature: 0.3,
    systemPrompt: 'Analyze spending patterns and provide key insights.',
  },
  
  'budget:proactive-alert': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 200, // Reduced from 300 premium
    temperature: 0.2,
    systemPrompt: 'Generate budget alerts.',
  },
  
  'budget:ynab-import-map': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 500, // Reduced from 800 premium
    temperature: 0.2,
    systemPrompt: 'Map YNAB categories efficiently.',
  },
  
  'budget:weekly-digest': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 600, // Reduced from 1000 premium
    temperature: 0.3,
    systemPrompt: 'Create weekly budget summary.',
  },

  // CROSS-APP ROUTES
  'cross:memory-refresh': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 1200, // Reduced from 2000 premium
    temperature: 0.2,
    systemPrompt: 'Create memory updates with key cross-domain insights.',
  },
  
  'cross:daily-overview': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 1000, // Reduced from 1500 premium
    temperature: 0.3,
    systemPrompt: 'Create daily overview summary.',
  },
  
  'cross:security-review': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 800, // Reduced from 1200 premium
    temperature: 0.2,
    systemPrompt: 'Perform security code review.',
  },
  
  'cross:performance-analysis': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 800, // Reduced from 1200 premium
    temperature: 0.2,
    systemPrompt: 'Analyze performance issues.',
  },

  // LEGACY ROUTES (for backward compatibility)
  'meal-scan': {
    provider: 'openai',
    model: 'gpt-4o-mini',
    maxTokens: 600,
    temperature: 0.3,
    systemPrompt: 'Identify food and estimate basic nutrition from image.',
  },
  
  'meal-text': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 500,
    temperature: 0.2,
    systemPrompt: 'Analyze meal and provide nutrition estimates.',
  },
  
  'coach-chat': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 800,
    temperature: 0.4,
    systemPrompt: 'You are Claw, a coach. Provide concise, helpful advice.',
  },
  
  'workout-analysis': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 800,
    temperature: 0.3,
    systemPrompt: 'Analyze workout data and provide key insights.',
  },
  
  'memory-refresh': {
    provider: 'anthropic',
    model: 'claude-haiku-3-5',
    maxTokens: 1200,
    temperature: 0.2,
    systemPrompt: 'Create memory summaries with insights.',
  },
};

/**
 * Get degraded routing configuration for a request type
 */
export function getDegradedRouting(requestType: RequestType): DegradedModelChoice | null {
  return DEGRADED_ROUTING[requestType] || null;
}

/**
 * Convert degraded model choice to standard routing format
 */
export function createDegradedModelRouting(requestType: RequestType): ModelRouting | null {
  const degradedChoice = getDegradedRouting(requestType);
  
  if (!degradedChoice) {
    return null;
  }
  
  return {
    primary: {
      provider: degradedChoice.provider,
      model: degradedChoice.model,
    },
    fallbacks: [], // No fallbacks in degraded mode to avoid cost escalation
    defaultOptions: {
      maxTokens: degradedChoice.maxTokens,
      temperature: degradedChoice.temperature,
      systemPrompt: degradedChoice.systemPrompt,
    },
  };
}

/**
 * Check if a request type has degraded routing available
 */
export function hasDegradedRouting(requestType: RequestType): boolean {
  return requestType in DEGRADED_ROUTING;
}

/**
 * Get all supported request types for degraded mode
 */
export function getSupportedDegradedRequestTypes(): RequestType[] {
  return Object.keys(DEGRADED_ROUTING) as RequestType[];
}

/**
 * Calculate cost savings from using degraded routing vs premium
 * This helps quantify the budget enforcement benefits
 */
export function calculateDegradedSavings(requestType: RequestType): {
  degradedCostEstimate: number;
  premiumCostEstimate: number;
  savings: number;
  savingsPercentage: number;
} {
  const degradedChoice = getDegradedRouting(requestType);
  
  if (!degradedChoice) {
    return {
      degradedCostEstimate: 0,
      premiumCostEstimate: 0,
      savings: 0,
      savingsPercentage: 0,
    };
  }
  
  // Estimate costs based on typical token usage
  const estimatedInputTokens = 1000; // Average input size
  const degradedOutputTokens = degradedChoice.maxTokens;
  const premiumOutputTokens = degradedOutputTokens * 1.5; // Premium typically allows 50% more tokens
  
  // Cost estimates using model pricing
  let degradedInputCost = 0, degradedOutputCost = 0;
  let premiumInputCost = 0, premiumOutputCost = 0;
  
  // Degraded cost (using the degraded model)
  if (degradedChoice.provider === 'anthropic' && degradedChoice.model === 'claude-haiku-3-5') {
    degradedInputCost = (estimatedInputTokens / 1000) * 0.00025;
    degradedOutputCost = (degradedOutputTokens / 1000) * 0.00125;
  } else if (degradedChoice.provider === 'openai' && degradedChoice.model === 'gpt-4o-mini') {
    degradedInputCost = (estimatedInputTokens / 1000) * 0.00015;
    degradedOutputCost = (degradedOutputTokens / 1000) * 0.0006;
  }
  
  // Premium cost (estimate using typical premium models)
  // Most premium routes use Sonnet or GPT-4o
  const premiumInputCostRate = 0.003; // Sonnet rate
  const premiumOutputCostRate = 0.015; // Sonnet rate
  
  premiumInputCost = (estimatedInputTokens / 1000) * premiumInputCostRate;
  premiumOutputCost = (premiumOutputTokens / 1000) * premiumOutputCostRate;
  
  const degradedCostEstimate = degradedInputCost + degradedOutputCost;
  const premiumCostEstimate = premiumInputCost + premiumOutputCost;
  
  const savings = Math.max(0, premiumCostEstimate - degradedCostEstimate);
  const savingsPercentage = premiumCostEstimate > 0 ? (savings / premiumCostEstimate) * 100 : 0;
  
  return {
    degradedCostEstimate,
    premiumCostEstimate,
    savings,
    savingsPercentage,
  };
}

/**
 * Get degraded mode explanation for users
 */
export function getDegradedModeMessage(requestType: RequestType): string {
  const degradedChoice = getDegradedRouting(requestType);
  
  if (!degradedChoice) {
    return 'This feature is not available in degraded mode.';
  }
  
  const { savings, savingsPercentage } = calculateDegradedSavings(requestType);
  
  const baseMessage = "You're now using our efficient AI engine to help you stay within budget.";
  
  if (savingsPercentage > 50) {
    return `${baseMessage} We're saving you about ${Math.round(savingsPercentage)}% on costs while still providing quality responses.`;
  }
  
  return `${baseMessage} You'll still get helpful responses, just more concise to keep costs down.`;
}

/**
 * Validate degraded routing configuration
 */
export function validateDegradedRouting(): Array<{ requestType: RequestType; issue: string }> {
  const issues: Array<{ requestType: RequestType; issue: string }> = [];
  
  for (const [requestType, choice] of Object.entries(DEGRADED_ROUTING)) {
    // Check for reasonable token limits
    if (choice.maxTokens > 2000) {
      issues.push({
        requestType: requestType as RequestType,
        issue: `maxTokens ${choice.maxTokens} is high for degraded mode`,
      });
    }
    
    // Check for appropriate model selection
    if (choice.provider === 'anthropic' && choice.model === 'claude-opus-4-6') {
      issues.push({
        requestType: requestType as RequestType,
        issue: 'Using expensive Opus model in degraded mode',
      });
    }
    
    if (choice.provider === 'openai' && choice.model === 'gpt-4o' && !requestType.includes('vision') && !requestType.includes('scan')) {
      issues.push({
        requestType: requestType as RequestType,
        issue: 'Using expensive GPT-4o for non-vision task',
      });
    }
  }
  
  return issues;
}