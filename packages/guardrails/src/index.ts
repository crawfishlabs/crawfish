/**
 * @fileoverview @claw/guardrails — Core guardrails for all Claw apps
 *
 * TODO(@claw/core migration): Replace direct firebase-admin imports with @claw/core adapters:
 *   - rate-limiter.ts: firestore for rate limit state → CrawfishStore adapter
 *   - llm-guard.ts: firestore for rule storage → CrawfishStore adapter
 *   - output-guard.ts: event logging → CrawfishEventBus adapter
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
