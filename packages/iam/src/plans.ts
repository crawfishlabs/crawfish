import { Plan } from './models';

export const PLANS: Record<string, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tier: 'free',
    priceMonthly: 0,
    priceYearly: 0,
    apps: ['fitness', 'nutrition', 'budget', 'meetings'],
    features: {
      ai_queries_per_day: 3,
      storage_gb: 0.5,
      export_data: false,
      partner_sharing: false,
    },
  },

  fitness_pro: {
    id: 'fitness_pro',
    name: 'Crawfish Fitness Pro',
    tier: 'individual',
    priceMonthly: 6.99,
    priceYearly: 49.99,
    apps: ['fitness'],
    features: {
      ai_queries_per_day: -1, // unlimited
      storage_gb: 5,
      export_data: true,
      partner_sharing: false,
    },
  },

  nutrition_pro: {
    id: 'nutrition_pro',
    name: 'Crawfish Nutrition Pro',
    tier: 'individual',
    priceMonthly: 6.99,
    priceYearly: 49.99,
    apps: ['nutrition'],
    features: {
      ai_queries_per_day: -1,
      storage_gb: 5,
      export_data: true,
      partner_sharing: false,
    },
  },

  budget_pro: {
    id: 'budget_pro',
    name: 'Crawfish Budget Pro',
    tier: 'individual',
    priceMonthly: 6.99,
    priceYearly: 49.99,
    apps: ['budget'],
    features: {
      ai_queries_per_day: -1,
      storage_gb: 5,
      export_data: true,
      partner_sharing: true,
    },
  },

  meetings_pro: {
    id: 'meetings_pro',
    name: 'Crawfish Meetings Pro',
    tier: 'individual',
    priceMonthly: 9.99,
    priceYearly: 79.99,
    apps: ['meetings'],
    features: {
      ai_queries_per_day: -1,
      storage_gb: 10,
      export_data: true,
      partner_sharing: false,
    },
  },

  health_bundle: {
    id: 'health_bundle',
    name: 'Crawfish Health Bundle',
    tier: 'bundle',
    priceMonthly: 9.99,
    priceYearly: 79.99,
    apps: ['fitness', 'nutrition'],
    features: {
      ai_queries_per_day: -1,
      storage_gb: 10,
      export_data: true,
      partner_sharing: false,
    },
  },

  all_access: {
    id: 'all_access',
    name: 'Crawfish All Access',
    tier: 'all_access',
    priceMonthly: 19.99,
    priceYearly: 149.99,
    apps: ['fitness', 'nutrition', 'budget', 'meetings'],
    features: {
      ai_queries_per_day: -1,
      storage_gb: 50,
      export_data: true,
      partner_sharing: true,
    },
  },
};

/**
 * Derive default entitlements for a given plan.
 * Apps included in the plan get "pro" tier; others get "free" tier.
 */
export function deriveEntitlements(plan: Plan): import('./models').Entitlements {
  const FREE_DEFAULTS = PLANS.free.features;
  const apps: Record<string, import('./models').AppEntitlement> = {};

  for (const appId of ['fitness', 'nutrition', 'budget', 'meetings'] as import('./models').AppId[]) {
    const included = plan.apps.includes(appId);
    apps[appId] = {
      hasAccess: true, // free tier still has limited access
      tier: included && plan.tier !== 'free' ? 'pro' : 'free',
      aiQueriesPerDay: included ? (plan.features.ai_queries_per_day as number) : (FREE_DEFAULTS.ai_queries_per_day as number),
      storageGb: included ? (plan.features.storage_gb as number) : (FREE_DEFAULTS.storage_gb as number),
      features: included ? { ...plan.features } : { ...FREE_DEFAULTS },
    };
  }

  return {
    apps: apps as import('./models').Entitlements['apps'],
    globalFeatures: { ...plan.features },
  };
}

export function getPlan(planId: string): Plan | undefined {
  return PLANS[planId];
}

export function getAllPlans(): Plan[] {
  return Object.values(PLANS);
}
