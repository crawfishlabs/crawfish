/**
 * @fileoverview Claw Platform LLM Router Module
 * @description Model routing, provider management, cost tracking, and fallback handling with budget enforcement
 */

export * from './types';
export { routeLLMCall, getModelForRequestType } from './router';
export { AnthropicProvider } from './providers/anthropic';
export { OpenAIProvider } from './providers/openai';
export { GoogleProvider } from './providers/google';
export { FallbackChain, createFallbackChain } from './fallback';
export { trackLLMCall, getCostEstimate } from './cost-tracker';
export { PromptStore, PromptConfig, PromptVersion } from './prompt-store';
export { DEFAULT_PROMPTS } from './default-prompts';
export { 
  createPromptAPIRoutes, 
  PromptAPIResponse, 
  PromptsListResponse, 
  VersionHistoryResponse, 
  PromptTestResponse 
} from './prompt-api';

// Budget enforcement system
export { 
  getUserBudget, 
  checkBudget, 
  deductBudget, 
  resetMonthlyBudgets, 
  upgradeTier,
  getUserBudgetBreakdown,
  UserAIBudget, 
  BudgetCheckResult, 
  BudgetUsageBreakdown 
} from './user-budget';

export { 
  requireAIBudget, 
  requireAdminBudgetOverride, 
  RequestWithBudget,
  getRateLimitStatus 
} from './budget-middleware';

export { 
  sendBudgetAlert, 
  generateUsageBreakdown, 
  checkApproachingLimits, 
  identifyHighUsageUsers,
  BudgetAlert, 
  UsageBreakdown 
} from './budget-alerts';

export { 
  getDegradedRouting, 
  createDegradedModelRouting, 
  hasDegradedRouting, 
  getSupportedDegradedRequestTypes,
  calculateDegradedSavings,
  getDegradedModeMessage,
  validateDegradedRouting 
} from './degraded-router';

export { 
  resetMonthlyBudgetsJob, 
  dailyBudgetReportJob, 
  weeklyPowerUserReportJob, 
  hourlyAlertCheckJob,
  DailyBudgetReport, 
  PowerUserReport 
} from './budget-jobs';

export { default as budgetApiRoutes, AIBudgetStatus } from './budget-api';