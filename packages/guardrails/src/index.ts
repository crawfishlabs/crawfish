/**
 * @fileoverview @claw/guardrails — Core guardrails for all Claw apps
 */

// Rate limiting
export {
  createRateLimiter,
  RATE_LIMIT_PRESETS,
  InMemoryRateLimitStore,
  RateLimitConfig,
  RateLimitStore,
  RateLimitInfo,
} from './rate-limiter';

// LLM prompt injection protection
export {
  sanitizeUserInput,
  createSafeSystemPrompt,
  validateLLMOutput,
  GuardAction,
  LLMGuardConfig,
  GuardEvent,
  SanitizeResult,
  OutputValidationRule,
  OutputValidationResult,
  SafePromptOptions,
} from './llm-guard';

// Domain-specific output validation
export {
  createOutputGuard,
  OutputGuardConfig,
  OutputGuardResult,
  Severity,
} from './output-guard';

// Disclaimers
export {
  DISCLAIMERS,
  getDisclaimer,
  Domain,
  DisclaimerLength,
  DisclaimerSet,
  Locale,
} from './disclaimers';
