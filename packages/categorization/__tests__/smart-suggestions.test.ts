import { SmartSuggestions } from '../src/smart-suggestions';
import { TransactionInput } from '../src/models';

const suggestions = new SmartSuggestions();

function makeDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

function makeTx(descriptor: string, amount: number, date: Date): TransactionInput {
  return { descriptor, amount, date };
}

describe('SmartSuggestions', () => {
  describe('detectSubscriptions()', () => {
    test('detects monthly Netflix subscription', () => {
      const txs: TransactionInput[] = [
        makeTx('NETFLIX.COM', -15.99, makeDate(2025, 7, 15)),
        makeTx('NETFLIX.COM', -15.99, makeDate(2025, 8, 15)),
        makeTx('NETFLIX.COM', -15.99, makeDate(2025, 9, 15)),
        makeTx('NETFLIX.COM', -15.99, makeDate(2025, 10, 15)),
        makeTx('NETFLIX.COM', -15.99, makeDate(2025, 11, 15)),
      ];

      const subs = suggestions.detectSubscriptions(txs);
      expect(subs.length).toBeGreaterThanOrEqual(1);

      const netflix = subs.find(s => s.merchantName === 'Netflix');
      expect(netflix).toBeDefined();
      expect(netflix!.amount).toBe(15.99);
      expect(netflix!.frequency).toBe('monthly');
      expect(netflix!.dayOfMonth).toBe(15);
    });

    test('detects biweekly pattern', () => {
      const txs: TransactionInput[] = [];
      for (let i = 0; i < 6; i++) {
        const date = new Date(2025, 6, 1 + i * 14);
        txs.push(makeTx('EMPLOYER PAYROLL', 2500, date));
      }

      // detectSubscriptions only looks at outflows, so this won't match
      // This is actually for income detection
      const subs = suggestions.detectSubscriptions(txs);
      expect(subs).toHaveLength(0);
    });

    test('ignores non-recurring purchases', () => {
      const txs: TransactionInput[] = [
        makeTx('AMAZON', -25.00, makeDate(2025, 7, 3)),
        makeTx('AMAZON', -89.99, makeDate(2025, 7, 15)),
        makeTx('AMAZON', -12.50, makeDate(2025, 8, 22)),
      ];

      const subs = suggestions.detectSubscriptions(txs);
      // Different amounts — should not detect as subscription
      expect(subs).toHaveLength(0);
    });

    test('detects Spotify subscription via PayPal', () => {
      const txs: TransactionInput[] = [
        makeTx('PAYPAL *SPOTIFY', -9.99, makeDate(2025, 6, 1)),
        makeTx('PAYPAL *SPOTIFY', -9.99, makeDate(2025, 7, 1)),
        makeTx('PAYPAL *SPOTIFY', -9.99, makeDate(2025, 8, 1)),
        makeTx('PAYPAL *SPOTIFY', -9.99, makeDate(2025, 9, 1)),
      ];

      const subs = suggestions.detectSubscriptions(txs);
      expect(subs.length).toBeGreaterThanOrEqual(1);
      expect(subs[0].amount).toBe(9.99);
      expect(subs[0].frequency).toBe('monthly');
    });
  });

  describe('detectAnomalies()', () => {
    const history: TransactionInput[] = [
      makeTx('STARBUCKS', -5.50, makeDate(2025, 7, 1)),
      makeTx('STARBUCKS', -6.00, makeDate(2025, 7, 5)),
      makeTx('STARBUCKS', -5.75, makeDate(2025, 7, 10)),
      makeTx('STARBUCKS', -5.50, makeDate(2025, 7, 15)),
      makeTx('STARBUCKS', -6.25, makeDate(2025, 7, 20)),
    ];

    test('detects unusually large transaction', () => {
      const anomaly = suggestions.detectAnomalies(
        makeTx('STARBUCKS', -45.00, makeDate(2025, 7, 25)),
        history
      );

      expect(anomaly).not.toBeNull();
      expect(anomaly!.type).toBe('unusually_large');
      expect(anomaly!.severity).not.toBe('low');
    });

    test('does not flag normal transaction', () => {
      const anomaly = suggestions.detectAnomalies(
        makeTx('STARBUCKS', -6.50, makeDate(2025, 7, 25)),
        history
      );

      expect(anomaly).toBeNull();
    });

    test('detects potential duplicate', () => {
      const anomaly = suggestions.detectAnomalies(
        makeTx('STARBUCKS', -5.50, makeDate(2025, 7, 1)),
        [makeTx('STARBUCKS', -5.50, makeDate(2025, 7, 2))]
      );

      // The tx is same amount, within 2 days
      expect(anomaly).not.toBeNull();
      expect(anomaly!.type).toBe('duplicate');
    });

    test('ignores positive amounts', () => {
      const anomaly = suggestions.detectAnomalies(
        makeTx('EMPLOYER', 5000, makeDate(2025, 7, 1)),
        history
      );
      expect(anomaly).toBeNull();
    });
  });

  describe('detectSplittableTransaction()', () => {
    test('suggests split for large Walmart purchase', () => {
      const split = suggestions.detectSplittableTransaction(
        makeTx('WALMART SUPERCENTER', -150.00, makeDate(2025, 7, 1))
      );

      expect(split).not.toBeNull();
      expect(split!.merchantName).toBe('Walmart');
      expect(split!.suggestedCategories).toContain('Groceries');
    });

    test('does not suggest split for small Walmart purchase', () => {
      const split = suggestions.detectSplittableTransaction(
        makeTx('WALMART', -15.00, makeDate(2025, 7, 1))
      );

      expect(split).toBeNull();
    });

    test('suggests split for large Amazon purchase', () => {
      const split = suggestions.detectSplittableTransaction(
        makeTx('AMZN MKTP US*123', -200.00, makeDate(2025, 7, 1))
      );

      expect(split).not.toBeNull();
      expect(split!.suggestedCategories.length).toBeGreaterThan(1);
    });

    test('does not suggest split for unknown merchant', () => {
      const split = suggestions.detectSplittableTransaction(
        makeTx('RANDOM STORE', -200.00, makeDate(2025, 7, 1))
      );

      expect(split).toBeNull();
    });
  });

  describe('detectIncome()', () => {
    test('detects biweekly paycheck', () => {
      const txs: TransactionInput[] = [];
      for (let i = 0; i < 6; i++) {
        txs.push(makeTx('ACME CORP PAYROLL', 2500.00, new Date(2025, 6, 1 + i * 14)));
      }

      const incomes = suggestions.detectIncome(txs);
      expect(incomes.length).toBeGreaterThanOrEqual(1);
      expect(incomes[0].frequency).toBe('biweekly');
      expect(incomes[0].amount).toBe(2500);
    });

    test('detects monthly income', () => {
      const txs: TransactionInput[] = [
        makeTx('RENTAL INCOME', 1200, makeDate(2025, 7, 1)),
        makeTx('RENTAL INCOME', 1200, makeDate(2025, 8, 1)),
        makeTx('RENTAL INCOME', 1200, makeDate(2025, 9, 1)),
        makeTx('RENTAL INCOME', 1200, makeDate(2025, 10, 1)),
      ];

      const incomes = suggestions.detectIncome(txs);
      expect(incomes.length).toBeGreaterThanOrEqual(1);
      expect(incomes[0].frequency).toBe('monthly');
    });

    test('ignores small deposits', () => {
      const txs: TransactionInput[] = [
        makeTx('INTEREST PAYMENT', 0.50, makeDate(2025, 7, 1)),
        makeTx('INTEREST PAYMENT', 0.50, makeDate(2025, 8, 1)),
        makeTx('INTEREST PAYMENT', 0.50, makeDate(2025, 9, 1)),
      ];

      const incomes = suggestions.detectIncome(txs);
      expect(incomes).toHaveLength(0); // Below $100 threshold
    });
  });
});
