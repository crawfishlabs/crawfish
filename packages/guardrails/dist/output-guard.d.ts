/**
 * @fileoverview Domain-specific output validation and disclaimer injection
 * @description Validates AI coach responses, blocks dangerous content, appends disclaimers
 */
import { Domain, DisclaimerLength } from './disclaimers';
export type Severity = 'warn' | 'block' | 'disclaim';
export interface OutputGuardConfig {
    domain: Domain;
    severity?: Severity;
    /** Disclaimer length to auto-append (default: 'short') */
    disclaimerLength?: DisclaimerLength;
    /** Whether to auto-append disclaimers (default: true) */
    appendDisclaimer?: boolean;
    /** Custom blocked patterns in addition to domain defaults */
    extraBlockedPatterns?: {
        pattern: RegExp;
        reason: string;
    }[];
}
export interface OutputGuardResult {
    safe: boolean;
    output: string;
    warnings: string[];
    blocked: boolean;
    blockedReasons: string[];
    disclaimerAppended: boolean;
}
/**
 * Create a domain-specific output guard
 *
 * @example
 * ```ts
 * const guard = createOutputGuard({ domain: 'fitness' });
 * const result = guard(aiResponse);
 * if (!result.safe) console.warn(result.warnings);
 * // Use result.output (may have disclaimer appended)
 * ```
 */
export declare function createOutputGuard(config: OutputGuardConfig): (output: string) => OutputGuardResult;
