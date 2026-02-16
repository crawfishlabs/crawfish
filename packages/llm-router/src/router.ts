/**
 * @fileoverview LLM model routing and selection logic
 * @description Routes requests to appropriate models based on request type, preferences, and budget
 */

import { 
  RequestType, 
  LLMProvider, 
  LLMModel, 
  LLMCallOptions, 
  LLMResponse, 
  ModelRouting,
  PreferenceRouting, 
  RoutingPreference,
  RouterConfig,
  BudgetConfig,
  LLMError, 
  LLMErrorType 
} from './types';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { GoogleProvider } from './providers/google';
import { createFallbackChain } from './fallback';
import { trackLLMCall, checkUsageLimits, getCostEstimate } from './cost-tracker';
import { v4 as uuidv4 } from 'uuid';

/**
 * Global router configuration
 */
let routerConfig: RouterConfig = {
  preference: 'quality',
  enableFallback: true,
  logAllCalls: true,
};

/**
 * Global budget configuration
 */
let budgetConfig: BudgetConfig = {
  maxCostPerCall: 0.50, // $0.50 per call max
  maxCostPerUserPerDay: 10.00, // $10 per user per day
  maxCostPerAppPerDay: 100.00, // $100 per app per day
  autoDowngrade: true,
  alertThresholds: [0.5, 0.8, 0.95], // 50%, 80%, 95% alerts
};

/**
 * Full routing table with all 4 Claw apps and 3 preference levels
 */
const MODEL_ROUTING: Record<RequestType, PreferenceRouting> = {
  // FITNESS ROUTES
  'fitness:coach-chat': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-opus-4-6' }, // Needs deep reasoning
      fallbacks: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.4,
        systemPrompt: 'You are Claw, an expert fitness coach. Provide personalized, evidence-based training advice.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.4,
        systemPrompt: 'You are Claw, an expert fitness coach. Provide personalized, evidence-based training advice.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, // Still need quality for coaching
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'You are Claw, a fitness coach. Provide helpful training advice.',
      },
    },
  },

  'fitness:workout-analysis': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.3,
        systemPrompt: 'Analyze workout data and provide insights on form, progression, and optimization.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'Analyze workout data and provide insights on form, progression, and optimization.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Analyze workout data and provide basic insights.',
      },
    },
  },

  'fitness:exercise-recommend': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'Recommend exercises based on goals, equipment, and experience level.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.3,
        systemPrompt: 'Recommend exercises based on goals, equipment, and experience level.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Recommend exercises based on basic requirements.',
      },
    },
  },

  'fitness:form-check': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Analyze exercise form and provide detailed corrections and safety tips.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Analyze exercise form and provide corrections.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.2,
        systemPrompt: 'Provide basic form feedback.',
      },
    },
  },

  'fitness:quick-lookup': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, // Quality > speed
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        systemPrompt: 'Provide quick, accurate exercise information and calculations.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 300,
        temperature: 0.1,
        systemPrompt: 'Provide quick exercise information.',
      },
    },
    cost: {
      primary: { provider: 'google', model: 'gemini-2.0-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 200,
        temperature: 0.1,
        systemPrompt: 'Quick exercise lookup.',
      },
    },
  },

  // NUTRITION ROUTES
  'nutrition:meal-scan': {
    quality: {
      primary: { provider: 'openai', model: 'gpt-4o' }, // Best vision
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.2,
        isVision: true,
        systemPrompt: 'Analyze the food in this image. Provide detailed nutritional breakdown.',
      },
    },
    balanced: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        isVision: true,
        systemPrompt: 'Analyze the food in this image and estimate nutrition.',
      },
    },
    cost: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' }, // Still need vision
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        isVision: true,
        systemPrompt: 'Identify food and estimate basic nutrition.',
      },
    },
  },

  'nutrition:meal-text': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Analyze meal description and provide detailed nutritional information.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Analyze meal and provide nutrition info.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        systemPrompt: 'Basic nutrition estimation.',
      },
    },
  },

  'nutrition:barcode-enrich': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        systemPrompt: 'Enrich barcode nutrition data with additional context.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 300,
        temperature: 0.1,
        systemPrompt: 'Enrich barcode data.',
      },
    },
    cost: {
      primary: { provider: 'google', model: 'gemini-2.0-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 200,
        temperature: 0.1,
        systemPrompt: 'Basic barcode enrichment.',
      },
    },
  },

  'nutrition:coach-chat': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.4,
        systemPrompt: 'You are Claw, an expert nutrition coach. Provide personalized nutrition advice.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.4,
        systemPrompt: 'You are a nutrition coach. Provide helpful nutrition advice.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, // Keep quality for coaching
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.3,
        systemPrompt: 'Provide nutrition coaching advice.',
      },
    },
  },

  'nutrition:weekly-insights': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.3,
        systemPrompt: 'Analyze nutrition patterns and provide weekly insights.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.3,
        systemPrompt: 'Analyze nutrition patterns.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Basic nutrition analysis.',
      },
    },
  },

  'nutrition:quick-log': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 300,
        temperature: 0.1,
        systemPrompt: 'Quick food logging assistance.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 250,
        temperature: 0.1,
        systemPrompt: 'Quick food logging.',
      },
    },
    cost: {
      primary: { provider: 'google', model: 'gemini-2.0-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 200,
        temperature: 0.1,
        systemPrompt: 'Log food.',
      },
    },
  },

  // MEETINGS ROUTES
  'meetings:transcribe': {
    quality: {
      primary: { provider: 'openai', model: 'gpt-4o' }, // Whisper equivalent
      fallbacks: [],
      defaultOptions: {
        maxTokens: 2000,
        temperature: 0.1,
        systemPrompt: 'Transcribe audio to text accurately.',
      },
    },
    balanced: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [],
      defaultOptions: {
        maxTokens: 2000,
        temperature: 0.1,
        systemPrompt: 'Transcribe audio to text.',
      },
    },
    cost: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [],
      defaultOptions: {
        maxTokens: 2000,
        temperature: 0.1,
        systemPrompt: 'Transcribe audio.',
      },
    },
  },

  'meetings:analyze': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-opus-4-6' }, // Complex analysis
      fallbacks: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 2000,
        temperature: 0.3,
        systemPrompt: 'Provide comprehensive meeting analysis with insights and recommendations.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.3,
        systemPrompt: 'Analyze meeting and provide insights.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.2,
        systemPrompt: 'Basic meeting analysis.',
      },
    },
  },

  'meetings:extract-actions': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Extract clear, actionable items from meeting transcripts.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Extract action items.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        systemPrompt: 'List action items.',
      },
    },
  },

  'meetings:leadership-score': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-opus-4-6' }, // Nuanced evaluation
      fallbacks: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.2,
        systemPrompt: 'Score leadership competencies with detailed rationale.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-opus-4-6' }, // Keep quality
      fallbacks: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.2,
        systemPrompt: 'Score leadership competencies.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Basic leadership scoring.',
      },
    },
  },

  'meetings:leadership-coach': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-opus-4-6' }, // High-stakes coaching
      fallbacks: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.4,
        systemPrompt: 'Provide expert leadership coaching with nuanced insights.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-opus-4-6' }, // Keep quality for coaching
      fallbacks: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.4,
        systemPrompt: 'Provide leadership coaching.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, // Still need quality
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'Leadership coaching advice.',
      },
    },
  },

  'meetings:meeting-prep': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'Prepare comprehensive meeting briefs and agendas.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.3,
        systemPrompt: 'Prepare meeting briefs.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Basic meeting prep.',
      },
    },
  },

  'meetings:search': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        systemPrompt: 'Search meeting transcripts and notes.',
      },
    },
    balanced: {
      primary: { provider: 'google', model: 'gemini-2.5-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 300,
        temperature: 0.1,
        systemPrompt: 'Search meetings.',
      },
    },
    cost: {
      primary: { provider: 'google', model: 'gemini-2.0-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 200,
        temperature: 0.1,
        systemPrompt: 'Basic search.',
      },
    },
  },

  'meetings:summarize': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Create concise, actionable meeting summaries.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Summarize meeting.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        systemPrompt: 'Basic summary.',
      },
    },
  },

  // BUDGET ROUTES
  'budget:categorize': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' }, // High volume, pattern-based
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 200,
        temperature: 0.1,
        systemPrompt: 'Categorize transactions accurately based on description and patterns.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 150,
        temperature: 0.1,
        systemPrompt: 'Categorize transactions.',
      },
    },
    cost: {
      primary: { provider: 'google', model: 'gemini-2.0-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 100,
        temperature: 0.1,
        systemPrompt: 'Auto-categorize.',
      },
    },
  },

  'budget:coach-chat': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.4,
        systemPrompt: 'You are Claw, a financial coach. Provide personalized budgeting and financial advice.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.4,
        systemPrompt: 'Provide financial coaching advice.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, // Keep quality for coaching
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.3,
        systemPrompt: 'Financial advice.',
      },
    },
  },

  'budget:receipt-scan': {
    quality: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' }, // Vision, structured extraction
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.1,
        isVision: true,
        systemPrompt: 'Extract structured data from receipt images.',
      },
    },
    balanced: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 500,
        temperature: 0.1,
        isVision: true,
        systemPrompt: 'Extract receipt data.',
      },
    },
    cost: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' }, // Need vision
      fallbacks: [],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        isVision: true,
        systemPrompt: 'Basic receipt scan.',
      },
    },
  },

  'budget:spending-analysis': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.3,
        systemPrompt: 'Analyze spending patterns and provide insights and recommendations.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'Analyze spending patterns.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Basic spending analysis.',
      },
    },
  },

  'budget:proactive-alert': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 300,
        temperature: 0.2,
        systemPrompt: 'Generate helpful budget alerts and warnings.',
      },
    },
    balanced: {
      primary: { provider: 'google', model: 'gemini-2.5-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 250,
        temperature: 0.2,
        systemPrompt: 'Generate budget alerts.',
      },
    },
    cost: {
      primary: { provider: 'google', model: 'gemini-2.0-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 200,
        temperature: 0.1,
        systemPrompt: 'Budget alerts.',
      },
    },
  },

  'budget:ynab-import-map': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Map YNAB categories and handle import complexities.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Map YNAB categories.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        systemPrompt: 'Basic YNAB mapping.',
      },
    },
  },

  'budget:weekly-digest': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'Create comprehensive weekly budget summary and insights.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.3,
        systemPrompt: 'Weekly budget summary.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Basic weekly digest.',
      },
    },
  },

  // CROSS-APP ROUTES
  'cross:memory-refresh': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 2000,
        temperature: 0.2,
        systemPrompt: 'Create comprehensive cross-domain memory updates and insights.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.2,
        systemPrompt: 'Memory refresh update.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.2,
        systemPrompt: 'Basic memory update.',
      },
    },
  },

  'cross:daily-overview': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.3,
        systemPrompt: 'Create comprehensive daily overview across all domains.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.3,
        systemPrompt: 'Daily overview summary.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Basic daily overview.',
      },
    },
  },

  'cross:security-review': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.2,
        systemPrompt: 'Perform thorough security code review and vulnerability assessment.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.2,
        systemPrompt: 'Security code review.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.1,
        systemPrompt: 'Basic security scan.',
      },
    },
  },

  'cross:performance-analysis': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.2,
        systemPrompt: 'Analyze performance issues and provide root cause analysis.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.2,
        systemPrompt: 'Performance analysis.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Basic performance check.',
      },
    },
  },

  // LEGACY ROUTES (for backward compatibility)
  'meal-scan': {
    quality: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        isVision: true,
        systemPrompt: 'You are a nutrition analysis AI. Analyze the food in the image and provide detailed nutritional breakdown.',
      },
    },
    balanced: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.3,
        isVision: true,
        systemPrompt: 'Analyze the food in this image and estimate nutrition.',
      },
    },
    cost: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        isVision: true,
        systemPrompt: 'Identify food and estimate basic nutrition.',
      },
    },
  },

  'meal-text': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'You are a nutrition assistant. Help users log their meals accurately.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 600,
        temperature: 0.2,
        systemPrompt: 'Help log meals accurately.',
      },
    },
    cost: {
      primary: { provider: 'google', model: 'gemini-2.0-flash' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 400,
        temperature: 0.1,
        systemPrompt: 'Basic meal logging.',
      },
    },
  },

  'coach-chat': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.4,
        systemPrompt: 'You are Claw, an expert fitness and nutrition coach. Provide personalized, evidence-based advice.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.4,
        systemPrompt: 'You are Claw, a fitness and nutrition coach. Provide helpful advice.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'google', model: 'gemini-2.5-flash' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'Provide coaching advice.',
      },
    },
  },

  'workout-analysis': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
      ],
      defaultOptions: {
        maxTokens: 1200,
        temperature: 0.3,
        systemPrompt: 'You are a fitness expert analyzing workout data. Provide insights on form, progression, and optimization.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: 'Analyze workout data and provide insights.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 800,
        temperature: 0.2,
        systemPrompt: 'Basic workout analysis.',
      },
    },
  },

  'memory-refresh': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-haiku-3-5' },
        { provider: 'openai', model: 'gpt-4o' },
      ],
      defaultOptions: {
        maxTokens: 2000,
        temperature: 0.2,
        systemPrompt: 'You are creating memory summaries for fitness coaching. Analyze data and create actionable insights.',
      },
    },
    balanced: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.2,
        systemPrompt: 'Create memory summaries with insights.',
      },
    },
    cost: {
      primary: { provider: 'anthropic', model: 'claude-haiku-3-5' },
      fallbacks: [
        { provider: 'google', model: 'gemini-2.0-flash' },
        { provider: 'openai', model: 'gpt-4o-mini' },
      ],
      defaultOptions: {
        maxTokens: 1000,
        temperature: 0.2,
        systemPrompt: 'Basic memory refresh.',
      },
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
 * Route an LLM call to the appropriate model and provider with budget enforcement
 * 
 * @param requestType - Type of request determining model selection
 * @param prompt - User prompt/message
 * @param userId - User ID for budget enforcement (required)
 * @param context - Additional context data (optional)
 * @param options - Call options (optional, will be merged with defaults)
 * @returns Promise resolving to LLM response
 */
export async function routeLLMCall(
  requestType: RequestType,
  prompt: string,
  userId: string,
  context?: any,
  options: LLMCallOptions = {}
): Promise<LLMResponse> {
  const requestId = uuidv4();
  const startTime = Date.now();
  
  try {
    // Import budget functions (dynamic to avoid circular dependencies)
    const { checkBudget, deductBudget } = await import('./user-budget');
    const { createDegradedModelRouting, hasDegradedRouting } = await import('./degraded-router');
    
    // Check user budget status first
    const budgetStatus = await checkBudget(userId);
    
    // Block users who are not allowed to use AI
    if (!budgetStatus.allowed) {
      const error = new Error(`AI budget exhausted for user ${userId}: ${budgetStatus.status}`) as LLMError;
      error.provider = 'anthropic'; // Placeholder
      error.model = 'claude-haiku-3-5'; // Placeholder
      error.errorType = LLMErrorType.BUDGET_EXCEEDED;
      error.retryable = false;
      throw error;
    }
    
    // Determine routing preference based on budget status
    let activePreference = options.preferenceOverride || routerConfig.preference;
    let originalPreference = activePreference;
    let preferenceDowngraded = false;
    let useDegradedRouting = false;
    
    if (budgetStatus.status === 'degraded') {
      // Use degraded routing if available for this request type
      if (hasDegradedRouting(requestType)) {
        useDegradedRouting = true;
        preferenceDowngraded = true;
        console.log(`Budget degraded: using degraded routing for user ${userId}, requestType ${requestType}`);
      } else {
        // Fall back to cost preference
        activePreference = 'cost';
        preferenceDowngraded = true;
        console.log(`Budget degraded: downgraded to cost preference for user ${userId}, requestType ${requestType}`);
      }
    } else if (budgetStatus.routingPreference === 'cost' && activePreference !== 'cost') {
      // User is approaching budget limit, downgrade preference
      activePreference = 'cost';
      preferenceDowngraded = true;
      console.log(`Budget approaching: downgraded ${originalPreference} → ${activePreference} for user ${userId}`);
    }
    
    // Get routing configuration for request type and preference
    let routing: ModelRouting;
    
    if (useDegradedRouting) {
      // Use degraded routing table
      const degradedRouting = createDegradedModelRouting(requestType);
      if (!degradedRouting) {
        throw new Error(`No degraded routing available for ${requestType}`);
      }
      routing = degradedRouting;
    } else {
      // Use normal routing table
      const routingConfig = MODEL_ROUTING[requestType];
      if (!routingConfig) {
        throw new Error(`Unknown request type: ${requestType}`);
      }
      
      routing = routingConfig[activePreference];
      if (!routing) {
        throw new Error(`No routing config for ${requestType} with preference ${activePreference}`);
      }
    }
    
    // Handle model override
    let finalRouting = routing;
    if (options.modelOverride) {
      const provider = getProviderForModel(options.modelOverride);
      finalRouting = {
        ...routing,
        primary: { provider, model: options.modelOverride },
      };
    }
    
    // Merge default options with provided options
    const finalOptions: LLMCallOptions = {
      ...routing.defaultOptions,
      ...options,
      metadata: {
        requestType,
        userId,
        ...options.metadata,
      },
    };
    
    // Try primary model first, then fallbacks
    let lastError: LLMError | null = null;
    
    for (const { provider, model } of [finalRouting.primary, ...finalRouting.fallbacks]) {
      try {
        console.log(`Trying ${provider}/${model} for ${requestType} (${activePreference}) request`);
        
        // Estimate cost before making the call
        const estimatedCost = getCostEstimate(provider, model, 1000, 500); // Rough estimate
        if (budgetConfig.maxCostPerCall && estimatedCost > budgetConfig.maxCostPerCall) {
          console.warn(`Skipping ${provider}/${model} - estimated cost $${estimatedCost} exceeds per-call limit $${budgetConfig.maxCostPerCall}`);
          continue;
        }
        
        const providerInstance = await getProviderInstance(provider);
        const response = await providerInstance.call(model, prompt, context, finalOptions);
        
        // Deduct cost from user budget
        await deductBudget(userId, response.estimatedCost, requestType, model);
        
        // Track successful call
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
          routingPreference: useDegradedRouting ? 'degraded' : activePreference,
          preferenceDowngraded,
          timestamp: response.timestamp,
        });
        
        return {
          ...response,
          requestId,
          preferenceDowngraded,
          originalPreference: preferenceDowngraded ? originalPreference : undefined,
        };
        
      } catch (error) {
        console.warn(`${provider}/${model} failed for ${requestType}:`, error);
        lastError = error as LLMError;
        
        // Track failed call
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
          routingPreference: useDegradedRouting ? 'degraded' : activePreference,
          preferenceDowngraded,
          timestamp: new Date(),
        });
        
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
 * Check budget constraints for a user
 */
async function checkBudgetConstraints(userId: string, requestType: RequestType): Promise<{
  shouldDowngrade: boolean;
  reason?: string;
}> {
  try {
    const usage = await checkUsageLimits(userId, requestType);
    
    // Check daily cost limit
    if (budgetConfig.maxCostPerUserPerDay && usage.costToday >= budgetConfig.maxCostPerUserPerDay) {
      return { shouldDowngrade: true, reason: 'Daily cost limit exceeded' };
    }
    
    // Check if approaching limit (80% threshold)
    if (budgetConfig.maxCostPerUserPerDay && usage.costToday >= budgetConfig.maxCostPerUserPerDay * 0.8) {
      return { shouldDowngrade: true, reason: 'Approaching daily cost limit' };
    }
    
    return { shouldDowngrade: false };
  } catch (error) {
    console.warn('Error checking budget constraints:', error);
    return { shouldDowngrade: false };
  }
}

/**
 * Get provider name for a given model
 */
function getProviderForModel(model: LLMModel): LLMProvider {
  if (model.includes('claude')) return 'anthropic';
  if (model.includes('gpt') || model.includes('o3') || model.includes('o4')) return 'openai';
  if (model.includes('gemini')) return 'google';
  throw new Error(`Unknown provider for model: ${model}`);
}

/**
 * Set global routing preference
 */
export function setRoutingPreference(preference: RoutingPreference): void {
  routerConfig.preference = preference;
  console.log(`Global routing preference set to: ${preference}`);
}

/**
 * Get current routing preference
 */
export function getRoutingPreference(): RoutingPreference {
  return routerConfig.preference;
}

/**
 * Update router configuration
 */
export function updateRouterConfig(config: Partial<RouterConfig>): void {
  routerConfig = { ...routerConfig, ...config };
  console.log('Router configuration updated:', routerConfig);
}

/**
 * Update budget configuration
 */
export function updateBudgetConfig(config: Partial<BudgetConfig>): void {
  budgetConfig = { ...budgetConfig, ...config };
  console.log('Budget configuration updated:', budgetConfig);
}

/**
 * Get the configured model for a request type (for informational purposes)
 */
export function getModelForRequestType(requestType: RequestType, preference?: RoutingPreference): { provider: LLMProvider; model: LLMModel } {
  const routing = MODEL_ROUTING[requestType];
  if (!routing) {
    throw new Error(`Unknown request type: ${requestType}`);
  }
  
  const activePreference = preference || routerConfig.preference;
  return routing[activePreference].primary;
}

/**
 * Get or create provider instance
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
 * Update model routing configuration for a specific request type
 */
export function updateModelRouting(requestType: RequestType, routing: Partial<PreferenceRouting>): void {
  MODEL_ROUTING[requestType] = { ...MODEL_ROUTING[requestType], ...routing };
  console.log(`Updated routing for ${requestType}:`, routing);
}

/**
 * Get current routing configuration for a request type
 */
export function getRoutingConfig(requestType: RequestType): PreferenceRouting {
  return MODEL_ROUTING[requestType];
}

/**
 * Health check for all providers
 */
export async function healthCheckProviders(): Promise<{ [provider: string]: boolean }> {
  const results: { [provider: string]: boolean } = {};
  
  for (const provider of ['anthropic', 'openai', 'google'] as LLMProvider[]) {
    try {
      const instance = await getProviderInstance(provider);
      // Try a simple health check call with cheapest model
      const model = provider === 'anthropic' ? 'claude-haiku-3-5' : 
                    provider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.0-flash';
      await instance.call(
        model as any,
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

/**
 * Get routing statistics and insights
 */
export async function getRoutingStats(days: number = 7): Promise<{
  totalCalls: number;
  byPreference: { [preference: string]: number };
  byRequestType: { [requestType: string]: number };
  byProvider: { [provider: string]: number };
  averageCost: number;
  totalCost: number;
  downgrades: number;
}> {
  // This would typically query the database for statistics
  // For now, return a placeholder structure
  return {
    totalCalls: 0,
    byPreference: { quality: 0, balanced: 0, cost: 0 },
    byRequestType: {},
    byProvider: { anthropic: 0, openai: 0, google: 0 },
    averageCost: 0,
    totalCost: 0,
    downgrades: 0,
  };
}