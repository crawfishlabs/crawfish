import { CategorizationEngine } from '../src/categorization-engine';
import { CategorizationStore, UserRule, CommunityMapping, AICategorizationProvider } from '../src/models';

// ─── Mock Store ──────────────────────────────────────────────────────────────

class MockStore implements CategorizationStore {
  private rules: UserRule[] = [];
  private community = new Map<string, CommunityMapping>();

  async getUserRules(userId: string): Promise<UserRule[]> {
    return this.rules.filter(r => r.userId === userId);
  }
  async saveUserRule(rule: UserRule): Promise<void> {
    const idx = this.rules.findIndex(r => r.userId === rule.userId && r.pattern === rule.pattern);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
  }
  async deleteUserRule(userId: string, ruleId: string): Promise<void> {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }
  async getCommunityMapping(hash: string): Promise<CommunityMapping | null> {
    return this.community.get(hash) || null;
  }
  async saveCommunityMapping(hash: string, mapping: CommunityMapping): Promise<void> {
    this.community.set(hash, mapping);
  }
  async recordAccuracy(): Promise<void> {}

  // Test helpers
  addRule(rule: UserRule) { this.rules.push(rule); }
  addCommunity(hash: string, mapping: CommunityMapping) { this.community.set(hash, mapping); }
}

// ─── Mock AI Provider ────────────────────────────────────────────────────────

class MockAIProvider implements AICategorizationProvider {
  async categorize(
    merchantName: string,
    _mccCode: string | undefined,
    _mccDescription: string | undefined,
    _amount: number,
    userCategories: string[]
  ): Promise<{ category: string; confidence: number }> {
    // Simple mock: return first user category
    return { category: userCategories[0] || 'Shopping', confidence: 0.7 };
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const USER_CATEGORIES = ['Groceries', 'Eating Out', 'Shopping', 'Auto & Gas', 'Subscriptions', 'Utilities', 'Healthcare'];

describe('CategorizationEngine', () => {
  let store: MockStore;
  let engine: CategorizationEngine;

  beforeEach(() => {
    store = new MockStore();
    engine = new CategorizationEngine(store, new MockAIProvider());
  });

  describe('Layer 1: User Rules', () => {
    test('matches user rule by substring', async () => {
      store.addRule({
        userId: 'user1',
        pattern: 'Blue Bottle',
        merchantName: 'Blue Bottle Coffee',
        category: 'Eating Out',
        createdAt: new Date(),
        matchCount: 5,
      });

      const result = await engine.categorize(
        { descriptor: 'SQ *BLUE BOTTLE COFF San Francisco CA', amount: -5.50, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.source).toBe('user_rule');
      expect(result.suggestedCategory).toBe('Eating Out');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('user rule takes priority over known merchant', async () => {
      store.addRule({
        userId: 'user1',
        pattern: 'Costco',
        category: 'Shopping', // User categorizes Costco as Shopping, not Groceries
        createdAt: new Date(),
        matchCount: 10,
      });

      const result = await engine.categorize(
        { descriptor: 'COSTCO WHSE #1234', amount: -150.00, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.source).toBe('user_rule');
      expect(result.suggestedCategory).toBe('Shopping');
    });
  });

  describe('Layer 2: Known Merchant Database', () => {
    test('matches known merchant from descriptor', async () => {
      const result = await engine.categorize(
        { descriptor: 'WHOLEFDS MKT 10847 SILVER SPRING MD', amount: -85.32, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.source).toBe('pattern');
      expect(result.merchantInfo.cleanName).toBe('Whole Foods');
      expect(result.suggestedCategory).toBe('Groceries');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    test('matches Netflix as subscription', async () => {
      const result = await engine.categorize(
        { descriptor: 'NETFLIX.COM LOS GATOS CA', amount: -15.99, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.merchantInfo.cleanName).toBe('Netflix');
      expect(result.suggestedCategory).toBe('Subscriptions');
    });

    test('matches Chick-fil-A as eating out', async () => {
      const result = await engine.categorize(
        { descriptor: 'CHICK-FIL-A #0374 BETHESDA MD', amount: -12.50, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.merchantInfo.cleanName).toBe('Chick-fil-A');
      expect(result.suggestedCategory).toBe('Eating Out');
    });

    test('matches Shell as Auto & Gas', async () => {
      const result = await engine.categorize(
        { descriptor: 'SHELL OIL 57442660084 COLLEGE PARK MD', amount: -45.00, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.merchantInfo.cleanName).toBe('Shell');
      expect(result.suggestedCategory).toBe('Auto & Gas');
    });
  });

  describe('Layer 3: MCC Code Lookup', () => {
    test('uses MCC code when merchant not recognized', async () => {
      const result = await engine.categorize(
        { descriptor: 'SOME RANDOM RESTAURANT', amount: -42.50, mccCode: '5812', date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.source).toBe('mcc');
      expect(result.suggestedCategory).toBe('Eating Out');
    });

    test('uses MCC code for gas station', async () => {
      const result = await engine.categorize(
        { descriptor: 'UNKNOWN GAS 12345', amount: -35.00, mccCode: '5541', date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.source).toBe('mcc');
      expect(result.suggestedCategory).toBe('Auto & Gas');
    });
  });

  describe('Confidence & Confirmation', () => {
    test('high confidence does not need confirmation', async () => {
      const result = await engine.categorize(
        { descriptor: 'WHOLEFDS MKT 10847', amount: -50.00, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.confidence).toBeGreaterThan(0.85);
      expect(result.needsUserConfirmation).toBe(false);
    });

    test('unknown merchant needs confirmation', async () => {
      const result = await engine.categorize(
        { descriptor: 'XYZZYPLUGH LOCAL SHOP', amount: -25.00, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.needsUserConfirmation).toBe(true);
    });
  });

  describe('Learning (onUserCategorize)', () => {
    test('creates a user rule after correction', async () => {
      await engine.onUserCategorize('user1', 'tx123', 'BLUE BOTTLE COFF', 'Eating Out');

      const result = await engine.categorize(
        { descriptor: 'BLUE BOTTLE COFF', amount: -5.00, date: new Date() },
        USER_CATEGORIES,
        'user1'
      );

      expect(result.source).toBe('user_rule');
      expect(result.suggestedCategory).toBe('Eating Out');
    });
  });

  describe('Batch Categorization', () => {
    test('deduplicates same merchant across batch', async () => {
      const transactions = [
        { descriptor: 'WHOLEFDS MKT 10847', amount: -50, date: new Date() },
        { descriptor: 'WHOLEFDS MKT 10847', amount: -30, date: new Date() },
        { descriptor: 'SHELL OIL 574', amount: -40, date: new Date() },
      ];

      const results = await engine.categorizeBatch(transactions, USER_CATEGORIES, 'user1');
      expect(results).toHaveLength(3);
      expect(results[0].suggestedCategory).toBe(results[1].suggestedCategory);
      expect(results[0].suggestedCategory).toBe('Groceries');
      expect(results[2].suggestedCategory).toBe('Auto & Gas');
    });
  });

  describe('Category Mapping', () => {
    test('maps exact match', () => {
      const result = engine.mapToUserCategory('Groceries', USER_CATEGORIES);
      expect(result.category).toBe('Groceries');
      expect(result.confidence).toBe(1.0);
    });

    test('maps synonym', () => {
      const result = engine.mapToUserCategory('Dining', ['Eating Out', 'Shopping']);
      expect(result.category).toBe('Eating Out');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    test('maps substring', () => {
      const result = engine.mapToUserCategory('Grocery Stores', ['Groceries', 'Shopping']);
      expect(result.category).toBe('Groceries');
    });
  });
});
