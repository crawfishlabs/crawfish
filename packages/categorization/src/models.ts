// ─── Core Types ──────────────────────────────────────────────────────────────

export interface MerchantInfo {
  id: string;
  rawDescriptor: string;
  cleanName: string;
  mccCode: string;
  mccCategory: string;
  suggestedCategory?: string;
  confidence: number;
  source: 'mcc' | 'pattern' | 'community' | 'ai' | 'user_rule';
  logoUrl?: string;
}

export interface CategorizationResult {
  merchantInfo: MerchantInfo;
  suggestedCategory: string;
  confidence: number;
  alternativeCategories: { category: string; confidence: number }[];
  source: string;
  needsUserConfirmation: boolean;
}

export interface UserRule {
  id?: string;
  userId: string;
  pattern: string;
  merchantName?: string;
  category: string;
  createdAt: Date;
  matchCount: number;
}

export interface CommunityMapping {
  descriptor: string;
  categoryVotes: Record<string, number>;
  topCategory: string;
  confidence: number;
  totalVotes: number;
  lastUpdated: Date;
}

// ─── Transaction Input ───────────────────────────────────────────────────────

export interface TransactionInput {
  descriptor: string;
  amount: number;
  mccCode?: string;
  date: Date;
}

// ─── Descriptor Cleaner Types ────────────────────────────────────────────────

export interface CleanedDescriptor {
  cleanName: string;
  originalDescriptor: string;
  paymentProcessor?: string;
  location?: string;
}

export interface KnownMerchant {
  name: string;
  patterns: string[];
  defaultCategory: string;
  logoUrl?: string;
}

// ─── Smart Suggestion Types ──────────────────────────────────────────────────

export interface DetectedSubscription {
  merchantName: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  nextExpectedDate: Date;
  dayOfMonth?: number;
  confidence: number;
  transactionCount: number;
}

export interface Anomaly {
  type: 'unusually_large' | 'duplicate' | 'new_merchant_overspent' | 'unusual_time';
  description: string;
  severity: 'low' | 'medium' | 'high';
  transaction: TransactionInput;
  referenceAmount?: number;
}

export interface SplitSuggestion {
  merchantName: string;
  suggestedCategories: string[];
  reason: string;
}

export interface DetectedIncome {
  merchantName: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  nextExpectedDate: Date;
  confidence: number;
}

// ─── Continuous Improvement Types ────────────────────────────────────────────

export interface CategorizationDecision {
  id?: string;
  descriptor: string;
  cleanedDescriptor: string;
  suggestedCategory: string;
  finalCategory: string;
  accepted: boolean;
  source: string;
  confidence: number;
  userId: string;
  timestamp: Date;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface LayerAccuracy {
  layer: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface MisCategorizedDescriptor {
  descriptor: string;
  suggestedCategory: string;
  correctedCategory: string;
  occurrences: number;
  userIds: number; // distinct user count
}

export interface AccuracyReport {
  dateRange: DateRange;
  overallAccuracy: number;
  totalDecisions: number;
  perLayerAccuracy: LayerAccuracy[];
  perCategoryAccuracy: Record<string, { total: number; correct: number; accuracy: number }>;
  aiFallbackRate: number;
  correctionRate: number;
  topCorrectedDescriptors: MisCategorizedDescriptor[];
  improvementTrend: { date: string; accuracy: number }[];
}

export interface ImprovementAction {
  type: 'promote_to_known' | 'update_community' | 'flag_for_review' | 'adjust_confidence' | 'prune_stale';
  descriptor: string;
  details: string;
  timestamp: Date;
}

export interface MerchantCandidate {
  descriptor: string;
  cleanName: string;
  category: string;
  totalCategorizations: number;
  agreement: number; // 0-1
  distinctUsers: number;
}

// ─── Storage Interface (injectable) ──────────────────────────────────────────

export interface CategorizationStore {
  getUserRules(userId: string): Promise<UserRule[]>;
  saveUserRule(rule: UserRule): Promise<void>;
  deleteUserRule(userId: string, ruleId: string): Promise<void>;
  getCommunityMapping(descriptorHash: string): Promise<CommunityMapping | null>;
  saveCommunityMapping(descriptorHash: string, mapping: CommunityMapping): Promise<void>;
  recordAccuracy(userId: string, descriptor: string, suggested: string, actual: string): Promise<void>;

  // Continuous improvement store methods
  recordDecision(decision: CategorizationDecision): Promise<void>;
  getDecisions(dateRange: DateRange): Promise<CategorizationDecision[]>;
  getDecisionsByDescriptor(descriptor: string, limit?: number): Promise<CategorizationDecision[]>;
  getDecisionStats(dateRange: DateRange): Promise<{
    total: number;
    accepted: number;
    bySource: Record<string, { total: number; correct: number }>;
    byCategory: Record<string, { total: number; correct: number }>;
  }>;
  getDailyAccuracy(days: number): Promise<{ date: string; accuracy: number; total: number }[]>;
  getTopMisCategorized(dateRange: DateRange, minOccurrences: number): Promise<MisCategorizedDescriptor[]>;
  recordImprovementAction(action: ImprovementAction): Promise<void>;
  getFrequentDescriptors(minCount: number, minAgreement: number): Promise<MerchantCandidate[]>;
  pruneStaleMapping(descriptorHash: string): Promise<void>;
}

// ─── AI Provider Interface ───────────────────────────────────────────────────

export interface AICategorizationProvider {
  categorize(
    merchantName: string,
    mccCode: string | undefined,
    mccDescription: string | undefined,
    amount: number,
    userCategories: string[]
  ): Promise<{ category: string; confidence: number }>;
}
