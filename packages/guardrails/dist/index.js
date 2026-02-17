"use strict";
/**
 * @fileoverview @claw/guardrails — Core guardrails for all Claw apps
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDisclaimer = exports.DISCLAIMERS = exports.createOutputGuard = exports.validateLLMOutput = exports.createSafeSystemPrompt = exports.sanitizeUserInput = exports.InMemoryRateLimitStore = exports.RATE_LIMIT_PRESETS = exports.createRateLimiter = void 0;
// Rate limiting
var rate_limiter_1 = require("./rate-limiter");
Object.defineProperty(exports, "createRateLimiter", { enumerable: true, get: function () { return rate_limiter_1.createRateLimiter; } });
Object.defineProperty(exports, "RATE_LIMIT_PRESETS", { enumerable: true, get: function () { return rate_limiter_1.RATE_LIMIT_PRESETS; } });
Object.defineProperty(exports, "InMemoryRateLimitStore", { enumerable: true, get: function () { return rate_limiter_1.InMemoryRateLimitStore; } });
// LLM prompt injection protection
var llm_guard_1 = require("./llm-guard");
Object.defineProperty(exports, "sanitizeUserInput", { enumerable: true, get: function () { return llm_guard_1.sanitizeUserInput; } });
Object.defineProperty(exports, "createSafeSystemPrompt", { enumerable: true, get: function () { return llm_guard_1.createSafeSystemPrompt; } });
Object.defineProperty(exports, "validateLLMOutput", { enumerable: true, get: function () { return llm_guard_1.validateLLMOutput; } });
// Domain-specific output validation
var output_guard_1 = require("./output-guard");
Object.defineProperty(exports, "createOutputGuard", { enumerable: true, get: function () { return output_guard_1.createOutputGuard; } });
// Disclaimers
var disclaimers_1 = require("./disclaimers");
Object.defineProperty(exports, "DISCLAIMERS", { enumerable: true, get: function () { return disclaimers_1.DISCLAIMERS; } });
Object.defineProperty(exports, "getDisclaimer", { enumerable: true, get: function () { return disclaimers_1.getDisclaimer; } });
