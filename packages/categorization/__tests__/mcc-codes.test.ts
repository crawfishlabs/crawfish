import { MCC_CODES, lookupMCC, getAllBudgetCategories } from '../src/mcc-codes';

describe('MCC Codes', () => {
  test('should have at least 200 MCC codes', () => {
    expect(Object.keys(MCC_CODES).length).toBeGreaterThanOrEqual(200);
  });

  test('should have no invalid entries', () => {
    for (const [code, entry] of Object.entries(MCC_CODES)) {
      expect(code).toMatch(/^\d{4}$/);
      expect(entry.category).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.suggestedBudgetCategory).toBeTruthy();
    }
  });

  test('lookupMCC returns correct entry', () => {
    const grocery = lookupMCC('5411');
    expect(grocery).not.toBeNull();
    expect(grocery!.suggestedBudgetCategory).toBe('Groceries');

    const restaurant = lookupMCC('5812');
    expect(restaurant).not.toBeNull();
    expect(restaurant!.suggestedBudgetCategory).toBe('Eating Out');
  });

  test('lookupMCC returns null for unknown codes', () => {
    expect(lookupMCC('0000')).toBeNull();
    expect(lookupMCC('9999')).toBeNull();
  });

  test('getAllBudgetCategories returns reasonable categories', () => {
    const categories = getAllBudgetCategories();
    expect(categories.length).toBeGreaterThan(10);
    expect(categories).toContain('Groceries');
    expect(categories).toContain('Eating Out');
    expect(categories).toContain('Travel');
    expect(categories).toContain('Healthcare');
    expect(categories).toContain('Entertainment');
  });

  test('covers all major budget category types', () => {
    const categories = getAllBudgetCategories();
    const expectedCategories = [
      'Groceries', 'Eating Out', 'Auto & Gas', 'Shopping', 'Entertainment',
      'Travel', 'Healthcare', 'Insurance', 'Utilities', 'Subscriptions',
      'Home Improvement', 'Clothing', 'Electronics', 'Education', 'Childcare',
      'Pet', 'Fitness & Sports', 'Personal Care', 'Charity',
    ];
    for (const expected of expectedCategories) {
      expect(categories).toContain(expected);
    }
  });
});
