import { CategorizationImprover } from '../src/continuous-improvement';
import {
  CategorizationStore,
  UserRule,
  CommunityMapping,
  CategorizationDecision,
  DateRange,
  MisCategorizedDescriptor,
  ImprovementAction,
  MerchantCandidate,
} from '../src/models';

// ─── Mock Store ──────────────────────────────────────────────────────────────

class MockImprovementStore implements CategorizationStore {
  decisions: CategorizationDecision[] = [];
  community = new Map<string, CommunityMapping>();
  actions: ImprovementAction[] = [];
  rules: UserRule[] = [];

  async getUserRules(userId: string): Promise<UserRule[]> {
    return this.rules.filter(r => r.userId === userId);
  }
  async saveUserRule(rule: UserRule): Promise<void> {
    this.rules.push(rule);
  }
  async deleteUserRule(): Promise<void> {}
  async getCommunityMapping(hash: string): Promise<CommunityMapping | null> {
    return this.community.get(hash) || null;
  }
  async saveCommunityMapping(hash: string, mapping: CommunityMapping): Promise<void> {
    this.community.set(hash, mapping);
  }
  async recordAccuracy(): Promise<void> {}

  async recordDecision(decision: CategorizationDecision): Promise<void> {
    this.decisions.push(decision);
  }

  async getDecisions(dateRange: DateRange): Promise<CategorizationDecision[]> {
    return this.decisions.filter(
      d => d.timestamp >= dateRange.start && d.timestamp <= dateRange.end
    );
  }

  async getDecisionsByDescriptor(descriptor: string, limit?: number): Promise<CategorizationDecision[]> {
    const results = this.decisions.filter(
      d => d.cleanedDescriptor.toLowerCase() === descriptor.toLowerCase()
    );
    return limit ? results.slice(0, limit) : results;
  }

  async getDecisionStats(dateRange: DateRange) {
    const filtered = this.decisions.filter(
      d => d.timestamp >= dateRange.start && d.timestamp <= dateRange.end
    );

    const bySource: Record<string, { total: number; correct: number }> = {};
    const byCategory: Record<string, { total: number; correct: number }> = {};
    let accepted = 0;

    for (const d of filtered) {
      if (!bySource[d.source]) bySource[d.source] = { total: 0, correct: 0 };
      bySource[d.source].total++;
      if (d.accepted) bySource[d.source].correct++;

      const cat = d.finalCategory;
      if (!byCategory[cat]) byCategory[cat] = { total: 0, correct: 0 };
      byCategory[cat].total++;
      if (d.accepted) byCategory[cat].correct++;

      if (d.accepted) accepted++;
    }

    return { total: filtered.length, accepted, bySource, byCategory };
  }

  async getDailyAccuracy(days: number) {
    const result: { date: string; accuracy: number; total: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayDecisions = this.decisions.filter(dec => {
        const decDate = dec.timestamp.toISOString().split('T')[0];
        return decDate === dateStr;
      });
      const total = dayDecisions.length;
      const correct = dayDecisions.filter(dec => dec.accepted).length;
      result.push({ date: dateStr, accuracy: total > 0 ? correct / total : 0, total });
    }
    return result;
  }

  async getTopMisCategorized(dateRange: DateRange, minOccurrences: number): Promise<MisCategorizedDescriptor[]> {
    const filtered = this.decisions.filter(
      d => d.timestamp >= dateRange.start && d.timestamp <= dateRange.end && !d.accepted
    );

    const groups = new Map<string, { suggested: string; corrected: string; count: number; users: Set<string> }>();
    for (const d of filtered) {
      const key = `${d.cleanedDescriptor}|${d.suggestedCategory}|${d.finalCategory}`;
      if (!groups.has(key)) {
        groups.set(key, { suggested: d.suggestedCategory, corrected: d.finalCategory, count: 0, users: new Set() });
      }
      const g = groups.get(key)!;
      g.count++;
      g.users.add(d.userId);
    }

    return Array.from(groups.entries())
      .filter(([, g]) => g.count >= minOccurrences)
      .map(([key, g]) => ({
        descriptor: key.split('|')[0],
        suggestedCategory: g.suggested,
        correctedCategory: g.corrected,
        occurrences: g.count,
        userIds: g.users.size,
      }))
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  async recordImprovementAction(action: ImprovementAction): Promise<void> {
    this.actions.push(action);
  }

  async getFrequentDescriptors(minCount: number, minAgreement: number): Promise<MerchantCandidate[]> {
    const groups = new Map<string, { categories: Map<string, number>; users: Set<string>; total: number }>();

    for (const d of this.decisions) {
      const key = d.cleanedDescriptor.toLowerCase();
      if (!groups.has(key)) groups.set(key, { categories: new Map(), users: new Set(), total: 0 });
      const g = groups.get(key)!;
      g.categories.set(d.finalCategory, (g.categories.get(d.finalCategory) || 0) + 1);
      g.users.add(d.userId);
      g.total++;
    }

    const results: MerchantCandidate[] = [];
    for (const [key, g] of groups) {
      if (g.total < minCount) continue;
      let maxVotes = 0;
      let topCat = '';
      for (const [cat, count] of g.categories) {
        if (count > maxVotes) { maxVotes = count; topCat = cat; }
      }
      const agreement = maxVotes / g.total;
      if (agreement < minAgreement) continue;

      results.push({
        descriptor: key,
        cleanName: key,
        category: topCat,
        totalCategorizations: g.total,
        agreement,
        distinctUsers: g.users.size,
      });
    }

    return results.sort((a, b) => b.totalCategorizations - a.totalCategorizations);
  }

  async pruneStaleMapping(descriptorHash: string): Promise<void> {
    this.community.delete(descriptorHash);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDecision(
  overrides: Partial<CategorizationDecision> = {}
): CategorizationDecision {
  return {
    descriptor: 'SOME MERCHANT',
    cleanedDescriptor: 'Some Merchant',
    suggestedCategory: 'Shopping',
    finalCategory: 'Shopping',
    accepted: true,
    source: 'pattern',
    confidence: 0.9,
    userId: 'user1',
    timestamp: new Date(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CategorizationImprover', () => {
  let store: MockImprovementStore;
  let improver: CategorizationImprover;

  beforeEach(() => {
    store = new MockImprovementStore();
    improver = new CategorizationImprover(store);
  });

  describe('recordDecision()', () => {
    test('records a categorization decision', async () => {
      await improver.recordDecision(
        'WHOLEFDS MKT 10847',
        'Groceries',
        'Groceries',
        'pattern',
        0.92,
        'user1'
      );

      expect(store.decisions).toHaveLength(1);
      expect(store.decisions[0].accepted).toBe(true);
      expect(store.decisions[0].cleanedDescriptor).toBeTruthy();
    });

    test('correctly marks corrections as not accepted', async () => {
      await improver.recordDecision(
        'COSTCO WHSE',
        'Groceries',
        'Shopping',
        'pattern',
        0.85,
        'user1'
      );

      expect(store.decisions[0].accepted).toBe(false);
    });
  });

  describe('getAccuracyMetrics()', () => {
    test('calculates overall accuracy', async () => {
      const now = new Date();
      for (let i = 0; i < 8; i++) {
        store.decisions.push(makeDecision({ timestamp: now }));
      }
      for (let i = 0; i < 2; i++) {
        store.decisions.push(makeDecision({
          accepted: false,
          suggestedCategory: 'Shopping',
          finalCategory: 'Groceries',
          timestamp: now,
        }));
      }

      const report = await improver.getAccuracyMetrics({
        start: new Date(now.getTime() - 60000),
        end: new Date(now.getTime() + 60000),
      });

      expect(report.overallAccuracy).toBe(0.8);
      expect(report.totalDecisions).toBe(10);
      expect(report.correctionRate).toBe(0.2);
    });

    test('calculates per-layer accuracy', async () => {
      const now = new Date();
      // Pattern: 5 correct, 1 wrong
      for (let i = 0; i < 5; i++) {
        store.decisions.push(makeDecision({ source: 'pattern', timestamp: now }));
      }
      store.decisions.push(makeDecision({ source: 'pattern', accepted: false, finalCategory: 'Other', timestamp: now }));

      // AI: 2 correct, 3 wrong
      for (let i = 0; i < 2; i++) {
        store.decisions.push(makeDecision({ source: 'ai', timestamp: now }));
      }
      for (let i = 0; i < 3; i++) {
        store.decisions.push(makeDecision({ source: 'ai', accepted: false, finalCategory: 'Other', timestamp: now }));
      }

      const report = await improver.getAccuracyMetrics({
        start: new Date(now.getTime() - 60000),
        end: new Date(now.getTime() + 60000),
      });

      const pattern = report.perLayerAccuracy.find(l => l.layer === 'pattern');
      const ai = report.perLayerAccuracy.find(l => l.layer === 'ai');

      expect(pattern!.accuracy).toBeCloseTo(5 / 6, 2);
      expect(ai!.accuracy).toBe(0.4);
    });

    test('calculates AI fallback rate', async () => {
      const now = new Date();
      for (let i = 0; i < 9; i++) {
        store.decisions.push(makeDecision({ source: 'pattern', timestamp: now }));
      }
      store.decisions.push(makeDecision({ source: 'ai', timestamp: now }));

      const report = await improver.getAccuracyMetrics({
        start: new Date(now.getTime() - 60000),
        end: new Date(now.getTime() + 60000),
      });

      expect(report.aiFallbackRate).toBe(0.1);
    });
  });

  describe('onCorrection()', () => {
    test('immediately updates community when 3+ users correct the same way', async () => {
      const now = new Date();
      // 3 different users corrected the same descriptor
      for (const userId of ['user1', 'user2', 'user3']) {
        store.decisions.push(makeDecision({
          cleanedDescriptor: 'Blue Bottle Coffee',
          suggestedCategory: 'Shopping',
          finalCategory: 'Eating Out',
          accepted: false,
          source: 'mcc',
          userId,
          timestamp: now,
        }));
      }

      const result = await improver.onCorrection('Blue Bottle Coffee', 'Shopping', 'Eating Out');

      expect(result.immediateUpdate).toBe(true);
      expect(store.actions.length).toBeGreaterThanOrEqual(1);
      expect(store.actions[0].type).toBe('update_community');
    });

    test('does not immediately update with fewer than 3 users', async () => {
      const now = new Date();
      for (const userId of ['user1', 'user2']) {
        store.decisions.push(makeDecision({
          cleanedDescriptor: 'Some Store',
          suggestedCategory: 'Shopping',
          finalCategory: 'Groceries',
          accepted: false,
          userId,
          timestamp: now,
        }));
      }

      const result = await improver.onCorrection('Some Store', 'Shopping', 'Groceries');
      expect(result.immediateUpdate).toBe(false);
    });
  });

  describe('runNightlyImprovement()', () => {
    test('returns accuracy report and actions', async () => {
      const now = new Date();
      // Add some decisions from yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);

      for (let i = 0; i < 10; i++) {
        store.decisions.push(makeDecision({ timestamp: yesterday }));
      }

      const { report, actions } = await improver.runNightlyImprovement();
      expect(report).toBeDefined();
      expect(report.totalDecisions).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(actions)).toBe(true);
    });

    test('auto-promotes frequent corrections', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);

      // 6 corrections from 4 users
      for (let i = 0; i < 6; i++) {
        store.decisions.push(makeDecision({
          cleanedDescriptor: 'Local Cafe',
          suggestedCategory: 'Shopping',
          finalCategory: 'Eating Out',
          accepted: false,
          userId: `user${(i % 4) + 1}`,
          timestamp: yesterday,
        }));
      }

      const { actions } = await improver.runNightlyImprovement();
      const communityUpdates = actions.filter(a => a.type === 'update_community');
      expect(communityUpdates.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('expandMerchantDatabase()', () => {
    test('identifies promotion candidates', async () => {
      // 25 categorizations from 6 users, all saying "Eating Out"
      for (let i = 0; i < 25; i++) {
        store.decisions.push(makeDecision({
          cleanedDescriptor: 'joes crab shack',
          finalCategory: 'Eating Out',
          userId: `user${(i % 6) + 1}`,
          timestamp: new Date(),
        }));
      }

      const { promoted } = await improver.expandMerchantDatabase();
      expect(promoted.length).toBeGreaterThanOrEqual(1);
      expect(promoted[0].category).toBe('Eating Out');
    });

    test('skips already-known merchants', async () => {
      // Walmart is already in the known merchant DB
      for (let i = 0; i < 30; i++) {
        store.decisions.push(makeDecision({
          descriptor: 'WALMART SUPERCENTER',
          cleanedDescriptor: 'Walmart',
          finalCategory: 'Groceries',
          userId: `user${(i % 8) + 1}`,
          timestamp: new Date(),
        }));
      }

      const { promoted } = await improver.expandMerchantDatabase();
      // Walmart should not be promoted since it's already known
      expect(promoted.find(p => p.cleanName.toLowerCase().includes('walmart'))).toBeUndefined();
    });
  });

  describe('retrainCategoryMappings()', () => {
    test('detects MCC mapping drift', async () => {
      const now = new Date();
      // 12 MCC decisions corrected from "Shopping" to "Groceries"
      for (let i = 0; i < 12; i++) {
        store.decisions.push(makeDecision({
          source: 'mcc',
          suggestedCategory: 'Shopping',
          finalCategory: 'Groceries',
          accepted: false,
          timestamp: now,
        }));
      }

      const { updatedMappings, actions } = await improver.retrainCategoryMappings();
      expect(updatedMappings).toBeGreaterThanOrEqual(1);
      const flagged = actions.filter(a => a.type === 'flag_for_review');
      expect(flagged.length).toBeGreaterThanOrEqual(1);
    });

    test('runs without error on empty data', async () => {
      const { updatedMappings, prunedMappings } = await improver.retrainCategoryMappings();
      expect(updatedMappings).toBe(0);
      expect(prunedMappings).toBe(0);
    });
  });
});
