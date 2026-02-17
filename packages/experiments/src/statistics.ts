/**
 * Statistical functions for experiment evaluation.
 * Implements chi-squared test, t-test, lift calculation, and power analysis.
 */

export interface TestResult {
  statistic: number;
  pValue: number;
  confidence: number;
  isSignificant: boolean;
}

// ─── Chi-Squared Test (for conversion metrics) ─────────────────────────────

export function chiSquaredTest(
  controlConversions: number,
  controlTotal: number,
  treatmentConversions: number,
  treatmentTotal: number
): TestResult {
  const totalConversions = controlConversions + treatmentConversions;
  const totalNonConversions = (controlTotal - controlConversions) + (treatmentTotal - treatmentConversions);
  const grandTotal = controlTotal + treatmentTotal;

  if (grandTotal === 0 || totalConversions === 0 || totalNonConversions === 0) {
    return { statistic: 0, pValue: 1, confidence: 0, isSignificant: false };
  }

  // Expected values
  const eControlConv = (controlTotal * totalConversions) / grandTotal;
  const eControlNon = (controlTotal * totalNonConversions) / grandTotal;
  const eTreatConv = (treatmentTotal * totalConversions) / grandTotal;
  const eTreatNon = (treatmentTotal * totalNonConversions) / grandTotal;

  // Chi-squared statistic
  const chi2 =
    Math.pow(controlConversions - eControlConv, 2) / eControlConv +
    Math.pow((controlTotal - controlConversions) - eControlNon, 2) / eControlNon +
    Math.pow(treatmentConversions - eTreatConv, 2) / eTreatConv +
    Math.pow((treatmentTotal - treatmentConversions) - eTreatNon, 2) / eTreatNon;

  // Approximate p-value using chi-squared distribution with 1 df
  const pValue = chi2PValue(chi2, 1);

  return {
    statistic: chi2,
    pValue,
    confidence: 1 - pValue,
    isSignificant: pValue < 0.05,
  };
}

// ─── T-Test (for continuous metrics) ────────────────────────────────────────

export function tTest(controlValues: number[], treatmentValues: number[]): TestResult {
  const n1 = controlValues.length;
  const n2 = treatmentValues.length;

  if (n1 < 2 || n2 < 2) {
    return { statistic: 0, pValue: 1, confidence: 0, isSignificant: false };
  }

  const mean1 = mean(controlValues);
  const mean2 = mean(treatmentValues);
  const var1 = variance(controlValues, mean1);
  const var2 = variance(treatmentValues, mean2);

  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) {
    return { statistic: 0, pValue: 1, confidence: 0, isSignificant: false };
  }

  const t = (mean2 - mean1) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = Math.pow(var1 / n1 + var2 / n2, 2);
  const denom =
    Math.pow(var1 / n1, 2) / (n1 - 1) +
    Math.pow(var2 / n2, 2) / (n2 - 1);
  const df = denom === 0 ? n1 + n2 - 2 : num / denom;

  // Two-tailed p-value using t-distribution approximation
  const pValue = tPValue(Math.abs(t), df);

  return {
    statistic: t,
    pValue,
    confidence: 1 - pValue,
    isSignificant: pValue < 0.05,
  };
}

// ─── Utility Functions ──────────────────────────────────────────────────────

export function calculateLift(control: number, treatment: number): number {
  if (control === 0) return treatment === 0 ? 0 : Infinity;
  return (treatment - control) / control;
}

export function calculateConfidence(pValue: number): number {
  return 1 - pValue;
}

export function isSignificant(pValue: number, threshold: number = 0.05): boolean {
  return pValue < threshold;
}

/**
 * Calculate minimum sample size per group for a given base rate, MDE, and power.
 * Uses the normal approximation formula.
 */
export function calculateSampleSize(
  baseRate: number,
  minDetectableEffect: number,
  power: number = 0.8
): number {
  const alpha = 0.05;
  const zAlpha = zScore(1 - alpha / 2); // 1.96 for alpha=0.05
  const zBeta = zScore(power); // 0.84 for power=0.8

  const p1 = baseRate;
  const p2 = baseRate * (1 + minDetectableEffect);
  const pBar = (p1 + p2) / 2;

  const numerator = Math.pow(zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2);
  const denominator = Math.pow(p2 - p1, 2);

  if (denominator === 0) return Infinity;
  return Math.ceil(numerator / denominator);
}

// ─── Internal Math Helpers ──────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function variance(values: number[], avg: number): number {
  return values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (values.length - 1);
}

/**
 * Approximate z-score for a given cumulative probability using the rational approximation.
 */
function zScore(p: number): number {
  // Abramowitz and Stegun approximation 26.2.23
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < 0.5) return -zScore(1 - p);

  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

/**
 * Approximate p-value from chi-squared distribution (1 df).
 * Uses the Wilson-Hilferty approximation for the regularized incomplete gamma function.
 */
function chi2PValue(x: number, df: number): number {
  if (x <= 0) return 1;
  // For 1 df, P(X > x) = 2 * (1 - Phi(sqrt(x)))
  if (df === 1) {
    return 2 * (1 - normalCDF(Math.sqrt(x)));
  }
  // General approximation via Wilson-Hilferty
  const k = df;
  const z = Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k));
  const se = Math.sqrt(2 / (9 * k));
  return 1 - normalCDF(z / se);
}

/**
 * Approximate two-tailed p-value from t-distribution.
 * For large df, approximates as normal.
 */
function tPValue(t: number, df: number): number {
  if (df > 100) {
    return 2 * (1 - normalCDF(t));
  }
  // Approximation: transform t to z using the formula z ≈ t * (1 - 1/(4*df)) / sqrt(1 + t²/(2*df))
  const z = t * (1 - 1 / (4 * df)) / Math.sqrt(1 + (t * t) / (2 * df));
  return 2 * (1 - normalCDF(z));
}

/**
 * Standard normal CDF using Abramowitz and Stegun approximation.
 */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}
