/**
 * @fileoverview Domain-specific output validation and disclaimer injection
 * @description Validates AI coach responses, blocks dangerous content, appends disclaimers
 */

import { Domain, getDisclaimer, DisclaimerLength } from './disclaimers';

// ── Types ──────────────────────────────────────────────────────────────

export type Severity = 'warn' | 'block' | 'disclaim';

export interface OutputGuardConfig {
  domain: Domain;
  severity?: Severity;
  /** Disclaimer length to auto-append (default: 'short') */
  disclaimerLength?: DisclaimerLength;
  /** Whether to auto-append disclaimers (default: true) */
  appendDisclaimer?: boolean;
  /** Custom blocked patterns in addition to domain defaults */
  extraBlockedPatterns?: { pattern: RegExp; reason: string }[];
}

export interface OutputGuardResult {
  safe: boolean;
  output: string;
  warnings: string[];
  blocked: boolean;
  blockedReasons: string[];
  disclaimerAppended: boolean;
}

// ── Domain-Specific Blocked Patterns ────────────────────────────────────

interface BlockedPattern {
  pattern: RegExp;
  reason: string;
  severity: 'warn' | 'block';
}

const FINANCE_BLOCKED: BlockedPattern[] = [
  { pattern: /liquidate\s+(?:your\s+)?emergency\s+fund/i, reason: 'Suggests liquidating emergency fund', severity: 'block' },
  { pattern: /(?:get|take\s+out|apply\s+for)\s+(?:a\s+)?payday\s+loan/i, reason: 'Recommends payday loan', severity: 'block' },
  { pattern: /tax\s+evasion/i, reason: 'References tax evasion', severity: 'block' },
  { pattern: /(?:hide|conceal)\s+(?:income|money|assets)\s+(?:from|to\s+avoid)\s+(?:the\s+)?(?:IRS|tax|government)/i, reason: 'Suggests hiding income from taxes', severity: 'block' },
  { pattern: /(?:guaranteed|risk[- ]free)\s+(?:returns?|profit|income)/i, reason: 'Promises guaranteed returns', severity: 'warn' },
  { pattern: /(?:put|invest)\s+(?:all|everything|your\s+entire)\s+(?:savings?|money|portfolio)\s+(?:in|into)\s+(?:one|a\s+single)/i, reason: 'Suggests concentrating all assets', severity: 'warn' },
];

const FITNESS_BLOCKED: BlockedPattern[] = [
  { pattern: /(?:you\s+(?:have|are\s+(?:suffering|diagnosed)))\s+(?:with\s+)?(?:diabetes|cancer|heart\s+disease|arthritis|fibromyalgia|lupus)/i, reason: 'Makes specific medical diagnosis', severity: 'block' },
  { pattern: /stop\s+taking\s+(?:your\s+)?medication/i, reason: 'Advises stopping medication', severity: 'block' },
  { pattern: /(?:you\s+don'?t\s+need|stop\s+seeing)\s+(?:your\s+)?(?:doctor|physician|therapist)/i, reason: 'Advises against medical care', severity: 'block' },
  { pattern: /(?:push|train|work)\s+through\s+(?:the\s+)?(?:sharp\s+)?pain/i, reason: 'Encourages training through pain', severity: 'warn' },
  { pattern: /(?:inject|take|use)\s+(?:steroids|HGH|testosterone|anabolic)/i, reason: 'Recommends performance-enhancing drugs', severity: 'block' },
];

const NUTRITION_BLOCKED: BlockedPattern[] = [
  { pattern: /(?:eat|consume|limit\s+(?:yourself\s+)?to)\s+(?:only\s+)?(?:less\s+than\s+)?[1-7]\d{2}\s*(?:cal|kcal|calories)/i, reason: 'Recommends dangerously low calories (<800)', severity: 'block' },
  { pattern: /(?:eat|consume|aim\s+for)\s+(?:over|more\s+than|at\s+least)\s+5\d{3}\s*(?:cal|kcal|calories)/i, reason: 'Recommends extreme calorie intake (>5000)', severity: 'block' },
  { pattern: /(?:fast|don'?t\s+eat)\s+for\s+(?:more\s+than\s+)?(?:[3-9]\d?|\d{2,})\s+days/i, reason: 'Recommends extended fasting', severity: 'block' },
  { pattern: /(?:purge|purging|laxative|vomit|throw\s+up)\s+(?:after|to\s+(?:lose|remove|get\s+rid))/i, reason: 'Encourages eating disorder behavior', severity: 'block' },
  { pattern: /(?:the\s+)?(?:thinner|skinnier)\s+(?:the\s+)?better/i, reason: 'Promotes harmful body image', severity: 'warn' },
  { pattern: /stop\s+taking\s+(?:your\s+)?medication/i, reason: 'Advises stopping medication', severity: 'block' },
];

const DOMAIN_PATTERNS: Record<Domain, BlockedPattern[]> = {
  fitness: FITNESS_BLOCKED,
  nutrition: NUTRITION_BLOCKED,
  finance: FINANCE_BLOCKED,
  meetings: [], // Meetings has minimal content restrictions
};

// ── Calorie extraction helper ───────────────────────────────────────────

function checkCalorieRecommendations(output: string): { issue: string; severity: 'warn' | 'block' } | null {
  // Match patterns like "eat 600 calories" or "1200 cal/day" etc
  const calorieMatches = output.matchAll(/(\d{3,5})\s*(?:cal(?:ories?)?|kcal)\s*(?:per\s+day|\/\s*day|daily)?/gi);
  for (const match of calorieMatches) {
    const calories = parseInt(match[1], 10);
    if (calories < 800) {
      return { issue: `Dangerously low calorie recommendation: ${calories}`, severity: 'block' };
    }
    if (calories > 5000) {
      return { issue: `Extremely high calorie recommendation: ${calories}`, severity: 'block' };
    }
  }
  return null;
}

// ── Output Guard Factory ────────────────────────────────────────────────

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
export function createOutputGuard(config: OutputGuardConfig): (output: string) => OutputGuardResult {
  const {
    domain,
    severity = 'disclaim',
    disclaimerLength = 'short',
    appendDisclaimer = true,
    extraBlockedPatterns = [],
  } = config;

  const domainPatterns = DOMAIN_PATTERNS[domain] || [];
  const allPatterns = [
    ...domainPatterns,
    ...extraBlockedPatterns.map(p => ({ ...p, severity: 'block' as const })),
  ];

  return (output: string): OutputGuardResult => {
    const warnings: string[] = [];
    const blockedReasons: string[] = [];
    let blocked = false;

    // Check domain-specific blocked patterns
    for (const { pattern, reason, severity: patternSeverity } of allPatterns) {
      if (pattern.test(output)) {
        if (patternSeverity === 'block' || severity === 'block') {
          blockedReasons.push(reason);
          blocked = true;
        } else {
          warnings.push(reason);
        }
      }
    }

    // Domain-specific calorie check for nutrition
    if (domain === 'nutrition') {
      const calorieIssue = checkCalorieRecommendations(output);
      if (calorieIssue) {
        if (calorieIssue.severity === 'block') {
          blockedReasons.push(calorieIssue.issue);
          blocked = true;
        } else {
          warnings.push(calorieIssue.issue);
        }
      }
    }

    // Build final output
    let finalOutput = output;
    let disclaimerAppended = false;

    if (blocked && severity === 'block') {
      finalOutput = "I'm sorry, but I can't provide that specific advice. Please consult a qualified professional for personalized guidance.";
      disclaimerAppended = false;
    } else if (appendDisclaimer) {
      const disclaimer = getDisclaimer(domain, disclaimerLength);
      finalOutput = `${output}\n\n_${disclaimer}_`;
      disclaimerAppended = true;
    }

    return {
      safe: !blocked && warnings.length === 0,
      output: finalOutput,
      warnings,
      blocked,
      blockedReasons,
      disclaimerAppended,
    };
  };
}
