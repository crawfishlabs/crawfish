import { createOutputGuard } from '../src/output-guard';

describe('Output Guard - Finance', () => {
  const guard = createOutputGuard({ domain: 'finance', severity: 'block' });

  it('blocks "liquidate emergency fund"', () => {
    const result = guard('You should liquidate your emergency fund to invest in crypto.');
    expect(result.blocked).toBe(true);
    expect(result.blockedReasons[0]).toContain('emergency fund');
  });

  it('blocks payday loan recommendations', () => {
    const result = guard('You could take out a payday loan to cover expenses.');
    expect(result.blocked).toBe(true);
  });

  it('blocks tax evasion references', () => {
    const result = guard('One strategy is tax evasion through offshore accounts.');
    expect(result.blocked).toBe(true);
  });

  it('warns about guaranteed returns', () => {
    const guardWarn = createOutputGuard({ domain: 'finance', severity: 'warn' });
    const result = guardWarn('This gives guaranteed returns of 20% per year.');
    expect(result.safe).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.blocked).toBe(false);
  });

  it('passes safe financial advice', () => {
    const result = guard('Consider building an emergency fund with 3-6 months of expenses.');
    expect(result.blocked).toBe(false);
    expect(result.disclaimerAppended).toBe(true);
    expect(result.output).toContain('Not financial advice');
  });
});

describe('Output Guard - Fitness', () => {
  const guard = createOutputGuard({ domain: 'fitness', severity: 'block' });

  it('blocks specific medical diagnoses', () => {
    const result = guard('You have diabetes based on your symptoms.');
    expect(result.blocked).toBe(true);
  });

  it('blocks "stop taking medication"', () => {
    const result = guard('You should stop taking your medication and try natural remedies.');
    expect(result.blocked).toBe(true);
  });

  it('blocks steroid recommendations', () => {
    const result = guard('You should inject steroids to build muscle faster.');
    expect(result.blocked).toBe(true);
  });

  it('passes safe fitness advice', () => {
    const result = guard('Start with 3 sets of 10 reps of bodyweight squats.');
    expect(result.blocked).toBe(false);
    expect(result.output).toContain('Not medical advice');
  });
});

describe('Output Guard - Nutrition', () => {
  const guard = createOutputGuard({ domain: 'nutrition', severity: 'block' });

  it('blocks dangerously low calorie recommendations', () => {
    const result = guard('Try eating only 500 calories per day for rapid weight loss.');
    expect(result.blocked).toBe(true);
    expect(result.blockedReasons.some(r => r.includes('low calorie') || r.includes('500'))).toBe(true);
  });

  it('blocks extreme high calorie recommendations', () => {
    const result = guard('Aim for 6000 calories daily to bulk up fast.');
    expect(result.blocked).toBe(true);
  });

  it('blocks purging encouragement', () => {
    const result = guard('You could purge after eating to maintain weight.');
    expect(result.blocked).toBe(true);
  });

  it('allows reasonable calorie ranges', () => {
    const result = guard('A good target is 1800 calories per day for steady weight loss.');
    expect(result.blocked).toBe(false);
  });

  it('appends nutrition disclaimer', () => {
    const result = guard('Eat more vegetables and lean protein.');
    expect(result.disclaimerAppended).toBe(true);
    expect(result.output).toContain('Not medical or dietary advice');
  });
});

describe('Output Guard - Disclaimer injection', () => {
  it('appends short disclaimer by default', () => {
    const guard = createOutputGuard({ domain: 'fitness' });
    const result = guard('Do 3 sets of push-ups.');
    expect(result.disclaimerAppended).toBe(true);
    expect(result.output).toContain('_');
  });

  it('appends full disclaimer when configured', () => {
    const guard = createOutputGuard({ domain: 'finance', disclaimerLength: 'full' });
    const result = guard('Save 20% of your income.');
    expect(result.output).toContain('not a substitute for professional financial advice');
  });

  it('skips disclaimer when disabled', () => {
    const guard = createOutputGuard({ domain: 'fitness', appendDisclaimer: false });
    const result = guard('Do squats.');
    expect(result.disclaimerAppended).toBe(false);
    expect(result.output).toBe('Do squats.');
  });
});
