import {
  chiSquaredTest,
  tTest,
  calculateLift,
  calculateConfidence,
  isSignificant,
  calculateSampleSize,
} from '../src/statistics';

describe('chiSquaredTest', () => {
  it('detects significant difference in conversion rates', () => {
    // Control: 100/1000 = 10%, Treatment: 150/1000 = 15%
    const result = chiSquaredTest(100, 1000, 150, 1000);
    expect(result.isSignificant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.confidence).toBeGreaterThan(0.95);
  });

  it('returns not significant for similar rates', () => {
    const result = chiSquaredTest(100, 1000, 102, 1000);
    expect(result.isSignificant).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it('handles zero totals gracefully', () => {
    const result = chiSquaredTest(0, 0, 0, 0);
    expect(result.pValue).toBe(1);
    expect(result.isSignificant).toBe(false);
  });

  it('handles identical rates', () => {
    const result = chiSquaredTest(50, 500, 50, 500);
    expect(result.statistic).toBeCloseTo(0, 5);
    expect(result.isSignificant).toBe(false);
  });
});

describe('tTest', () => {
  it('detects significant difference in means', () => {
    const control = Array.from({ length: 100 }, () => 10 + Math.random() * 2);
    const treatment = Array.from({ length: 100 }, () => 12 + Math.random() * 2);
    const result = tTest(control, treatment);
    expect(result.isSignificant).toBe(true);
  });

  it('returns not significant for similar distributions', () => {
    const control = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11];
    const treatment = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11];
    const result = tTest(control, treatment);
    expect(result.isSignificant).toBe(false);
  });

  it('handles small samples', () => {
    const result = tTest([1], [2]);
    expect(result.pValue).toBe(1);
  });
});

describe('calculateLift', () => {
  it('calculates positive lift', () => {
    expect(calculateLift(100, 110)).toBeCloseTo(0.1);
  });

  it('calculates negative lift', () => {
    expect(calculateLift(100, 90)).toBeCloseTo(-0.1);
  });

  it('handles zero control', () => {
    expect(calculateLift(0, 10)).toBe(Infinity);
    expect(calculateLift(0, 0)).toBe(0);
  });
});

describe('calculateConfidence', () => {
  it('converts p-value to confidence', () => {
    expect(calculateConfidence(0.05)).toBe(0.95);
    expect(calculateConfidence(0.01)).toBe(0.99);
  });
});

describe('isSignificant', () => {
  it('uses default threshold of 0.05', () => {
    expect(isSignificant(0.04)).toBe(true);
    expect(isSignificant(0.06)).toBe(false);
  });

  it('accepts custom threshold', () => {
    expect(isSignificant(0.04, 0.01)).toBe(false);
    expect(isSignificant(0.009, 0.01)).toBe(true);
  });
});

describe('calculateSampleSize', () => {
  it('returns reasonable sample size for typical A/B test', () => {
    // 10% base rate, 10% MDE, 80% power
    const n = calculateSampleSize(0.1, 0.1, 0.8);
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(100000);
  });

  it('requires more samples for smaller effects', () => {
    const n1 = calculateSampleSize(0.1, 0.2, 0.8);
    const n2 = calculateSampleSize(0.1, 0.05, 0.8);
    expect(n2).toBeGreaterThan(n1);
  });

  it('handles zero MDE', () => {
    expect(calculateSampleSize(0.1, 0, 0.8)).toBe(Infinity);
  });
});
