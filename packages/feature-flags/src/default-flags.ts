import { FeatureFlag } from './models';

export const DEFAULT_FLAGS: FeatureFlag[] = [
  // Fitness
  { key: 'fitness_ai_coach_enabled', value: true, type: 'boolean', description: 'AI coaching feature' },
  { key: 'fitness_social_features', value: false, type: 'boolean', description: 'Social features (not ready)' },

  // Nutrition
  { key: 'nutrition_barcode_scan', value: true, type: 'boolean', description: 'Barcode scanning' },
  { key: 'nutrition_ai_estimation', value: true, type: 'boolean', description: 'AI calorie estimation' },
  { key: 'nutrition_meal_photos', value: true, type: 'boolean', description: 'Meal photo logging' },

  // Budget
  { key: 'budget_partner_sharing', value: true, type: 'boolean', description: 'Partner budget sharing' },
  { key: 'budget_plaid_sync', value: false, type: 'boolean', description: 'Plaid bank sync (not ready)' },

  // Meetings
  { key: 'meetings_real_time_transcription', value: false, type: 'boolean', description: 'Real-time transcription (not ready)' },
  { key: 'meetings_ai_coaching', value: true, type: 'boolean', description: 'AI meeting coaching' },

  // Global
  { key: 'global_dark_mode', value: true, type: 'boolean', description: 'Dark mode support' },
  { key: 'global_pro_features', value: true, type: 'boolean', description: 'Pro tier features' },
  { key: 'global_onboarding_v2', value: false, type: 'boolean', description: 'New onboarding flow' },
];

/** Map of flag key to default value for quick lookup */
export const DEFAULT_FLAG_MAP: Record<string, any> = Object.fromEntries(
  DEFAULT_FLAGS.map(f => [f.key, f.value])
);
