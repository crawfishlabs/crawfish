/**
 * @fileoverview Prompt injection protection for LLM interactions
 * @description Sanitizes user input, wraps system prompts, validates LLM output
 */
export type GuardAction = 'warn' | 'block';
export interface LLMGuardConfig {
    /** What to do when injection is detected (default: 'warn') */
    action: GuardAction;
    /** Custom logger (defaults to console.warn) */
    logger?: (event: GuardEvent) => void;
}
export interface GuardEvent {
    type: 'injection_attempt' | 'output_leak' | 'pii_detected';
    input?: string;
    output?: string;
    patterns: string[];
    timestamp: Date;
    blocked: boolean;
}
export interface SanitizeResult {
    sanitized: string;
    flagged: boolean;
    patterns: string[];
}
export interface OutputValidationRule {
    /** Patterns that must NOT appear in output */
    blockedPatterns?: RegExp[];
    /** If true, check for PII patterns (emails, phones, SSNs) */
    checkPII?: boolean;
    /** If true, check for system prompt leakage */
    checkSystemPromptLeak?: boolean;
    /** Custom validator function */
    custom?: (output: string) => {
        valid: boolean;
        reason?: string;
    };
}
export interface OutputValidationResult {
    valid: boolean;
    issues: string[];
    sanitizedOutput?: string;
}
export interface SafePromptOptions {
    /** Additional framing instructions */
    additionalInstructions?: string[];
    /** Domain context for the prompt */
    domain?: string;
}
/**
 * Sanitize user input by detecting and optionally stripping injection patterns
 *
 * @returns SanitizeResult with sanitized text, whether it was flagged, and which patterns matched
 */
export declare function sanitizeUserInput(input: string, config?: LLMGuardConfig): SanitizeResult;
/**
 * Wrap a system prompt with injection-resistant framing
 */
export declare function createSafeSystemPrompt(basePrompt: string, options?: SafePromptOptions): string;
/**
 * Validate LLM output for safety issues
 */
export declare function validateLLMOutput(output: string, rules?: OutputValidationRule): OutputValidationResult;
