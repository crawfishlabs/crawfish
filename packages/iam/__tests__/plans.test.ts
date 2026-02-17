import { PLANS, deriveEntitlements, getPlan, getAllPlans } from '../src/plans';

describe('Plans', () => {
  it('has all expected plans', () => {
    const ids = Object.keys(PLANS);
    expect(ids).toContain('free');
    expect(ids).toContain('fitness_pro');
    expect(ids).toContain('nutrition_pro');
    expect(ids).toContain('budget_pro');
    expect(ids).toContain('meetings_pro');
    expect(ids).toContain('health_bundle');
    expect(ids).toContain('all_access');
  });

  it('free plan has all apps but limited features', () => {
    const free = PLANS.free;
    expect(free.apps).toEqual(['fitness', 'nutrition', 'budget', 'meetings']);
    expect(free.features.ai_queries_per_day).toBe(3);
    expect(free.features.export_data).toBe(false);
    expect(free.priceMonthly).toBe(0);
  });

  it('individual plans include only their app', () => {
    expect(PLANS.fitness_pro.apps).toEqual(['fitness']);
    expect(PLANS.nutrition_pro.apps).toEqual(['nutrition']);
    expect(PLANS.budget_pro.apps).toEqual(['budget']);
    expect(PLANS.meetings_pro.apps).toEqual(['meetings']);
  });

  it('bundles include multiple apps', () => {
    expect(PLANS.health_bundle.apps).toEqual(['fitness', 'nutrition']);
    expect(PLANS.all_access.apps).toEqual(['fitness', 'nutrition', 'budget', 'meetings']);
  });

  it('bundle pricing is cheaper than individual', () => {
    const fitnessPro = PLANS.fitness_pro.priceMonthly;
    const nutritionPro = PLANS.nutrition_pro.priceMonthly;
    expect(PLANS.health_bundle.priceMonthly).toBeLessThan(fitnessPro + nutritionPro);
  });

  it('yearly is cheaper than 12x monthly', () => {
    for (const plan of Object.values(PLANS)) {
      if (plan.priceMonthly > 0) {
        expect(plan.priceYearly).toBeLessThan(plan.priceMonthly * 12);
      }
    }
  });
});

describe('deriveEntitlements', () => {
  it('free plan gives free tier to all apps', () => {
    const ent = deriveEntitlements(PLANS.free);
    expect(ent.apps.fitness.tier).toBe('free');
    expect(ent.apps.nutrition.tier).toBe('free');
    expect(ent.apps.fitness.aiQueriesPerDay).toBe(3);
    expect(ent.apps.fitness.hasAccess).toBe(true);
  });

  it('individual plan gives pro to included app, free to others', () => {
    const ent = deriveEntitlements(PLANS.fitness_pro);
    expect(ent.apps.fitness.tier).toBe('pro');
    expect(ent.apps.fitness.aiQueriesPerDay).toBe(-1);
    expect(ent.apps.nutrition.tier).toBe('free');
    expect(ent.apps.nutrition.aiQueriesPerDay).toBe(3);
  });

  it('all_access gives pro to all apps', () => {
    const ent = deriveEntitlements(PLANS.all_access);
    expect(ent.apps.fitness.tier).toBe('pro');
    expect(ent.apps.nutrition.tier).toBe('pro');
    expect(ent.apps.budget.tier).toBe('pro');
    expect(ent.apps.meetings.tier).toBe('pro');
    expect(ent.globalFeatures.partner_sharing).toBe(true);
  });

  it('budget_pro enables partner_sharing', () => {
    const ent = deriveEntitlements(PLANS.budget_pro);
    expect(ent.apps.budget.features.partner_sharing).toBe(true);
  });
});

describe('getPlan / getAllPlans', () => {
  it('returns plan by id', () => {
    expect(getPlan('free')?.id).toBe('free');
    expect(getPlan('nonexistent')).toBeUndefined();
  });

  it('returns all plans', () => {
    expect(getAllPlans().length).toBe(7);
  });
});
