import { CommunityLearning } from '../src/community-learning';
import { CategorizationStore, CommunityMapping, UserRule } from '../src/models';

class MockStore implements CategorizationStore {
  private community = new Map<string, CommunityMapping>();

  async getUserRules(): Promise<UserRule[]> { return []; }
  async saveUserRule(): Promise<void> {}
  async deleteUserRule(): Promise<void> {}
  async getCommunityMapping(hash: string): Promise<CommunityMapping | null> {
    return this.community.get(hash) || null;
  }
  async saveCommunityMapping(hash: string, mapping: CommunityMapping): Promise<void> {
    this.community.set(hash, mapping);
  }
  async recordAccuracy(): Promise<void> {}
}

describe('CommunityLearning', () => {
  let store: MockStore;
  let learning: CommunityLearning;

  beforeEach(() => {
    store = new MockStore();
    learning = new CommunityLearning(store);
  });

  test('records first categorization', async () => {
    await learning.recordCategorization('Whole Foods', 'Groceries');
    const raw = await learning.getRawMapping('Whole Foods');
    expect(raw).not.toBeNull();
    expect(raw!.topCategory).toBe('Groceries');
    expect(raw!.totalVotes).toBe(1);
    expect(raw!.confidence).toBe(1.0);
  });

  test('accumulates votes for same category', async () => {
    for (let i = 0; i < 15; i++) {
      await learning.recordCategorization('Whole Foods', 'Groceries');
    }
    const raw = await learning.getRawMapping('Whole Foods');
    expect(raw!.totalVotes).toBe(15);
    expect(raw!.confidence).toBe(1.0);
    expect(raw!.topCategory).toBe('Groceries');
  });

  test('tracks multiple categories with votes', async () => {
    for (let i = 0; i < 10; i++) {
      await learning.recordCategorization('Costco', 'Groceries');
    }
    for (let i = 0; i < 3; i++) {
      await learning.recordCategorization('Costco', 'Shopping');
    }
    const raw = await learning.getRawMapping('Costco');
    expect(raw!.totalVotes).toBe(13);
    expect(raw!.topCategory).toBe('Groceries');
    expect(raw!.categoryVotes['Groceries']).toBe(10);
    expect(raw!.categoryVotes['Shopping']).toBe(3);
    expect(raw!.confidence).toBeCloseTo(10 / 13, 2);
  });

  test('getCommunityCategory returns null below threshold', async () => {
    // Only 5 votes — below the 10 vote minimum
    for (let i = 0; i < 5; i++) {
      await learning.recordCategorization('Netflix', 'Subscriptions');
    }
    const result = await learning.getCommunityCategory('Netflix');
    expect(result).toBeNull();
  });

  test('getCommunityCategory returns null with low confidence', async () => {
    // 12 votes but split evenly — confidence < 0.8
    for (let i = 0; i < 6; i++) {
      await learning.recordCategorization('Walmart', 'Groceries');
    }
    for (let i = 0; i < 6; i++) {
      await learning.recordCategorization('Walmart', 'Shopping');
    }
    const result = await learning.getCommunityCategory('Walmart');
    expect(result).toBeNull();
  });

  test('getCommunityCategory returns result above both thresholds', async () => {
    for (let i = 0; i < 12; i++) {
      await learning.recordCategorization('Starbucks', 'Eating Out');
    }
    for (let i = 0; i < 2; i++) {
      await learning.recordCategorization('Starbucks', 'Groceries');
    }
    const result = await learning.getCommunityCategory('Starbucks');
    expect(result).not.toBeNull();
    expect(result!.topCategory).toBe('Eating Out');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test('normalizes descriptors consistently', async () => {
    await learning.recordCategorization('whole foods', 'Groceries');
    await learning.recordCategorization('WHOLE FOODS', 'Groceries');
    await learning.recordCategorization('Whole Foods', 'Groceries');

    const raw = await learning.getRawMapping('Whole Foods');
    expect(raw!.totalVotes).toBe(3); // All should map to same key
  });
});
