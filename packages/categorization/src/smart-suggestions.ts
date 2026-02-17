import {
  TransactionInput,
  DetectedSubscription,
  Anomaly,
  SplitSuggestion,
  DetectedIncome,
} from './models';
import { DescriptorCleaner } from './descriptor-cleaner';

const cleaner = new DescriptorCleaner();

// ─── Subscription Detection ──────────────────────────────────────────────────

interface TransactionGroup {
  merchantName: string;
  transactions: TransactionInput[];
}

function groupByMerchant(transactions: TransactionInput[]): TransactionGroup[] {
  const groups = new Map<string, TransactionInput[]>();

  for (const tx of transactions) {
    const { cleaned, merchant } = cleaner.cleanAndMatch(tx.descriptor);
    const key = (merchant?.name || cleaned.cleanName).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  return Array.from(groups.entries()).map(([name, txs]) => ({
    merchantName: name,
    transactions: txs.sort((a, b) => a.date.getTime() - b.date.getTime()),
  }));
}

function detectFrequency(
  dates: Date[]
): { frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'; avgInterval: number } | null {
  if (dates.length < 3) return null;

  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    intervals.push((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24));
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const stdDev = Math.sqrt(
    intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length
  );

  // Check if intervals are consistent (low variance relative to mean)
  if (stdDev > avgInterval * 0.35) return null;

  if (avgInterval >= 5 && avgInterval <= 9) return { frequency: 'weekly', avgInterval };
  if (avgInterval >= 12 && avgInterval <= 17) return { frequency: 'biweekly', avgInterval };
  if (avgInterval >= 25 && avgInterval <= 35) return { frequency: 'monthly', avgInterval };
  if (avgInterval >= 80 && avgInterval <= 100) return { frequency: 'quarterly', avgInterval };
  if (avgInterval >= 340 && avgInterval <= 400) return { frequency: 'yearly', avgInterval };

  return null;
}

// ─── SmartSuggestions Class ──────────────────────────────────────────────────

export class SmartSuggestions {
  /**
   * Detect subscription patterns in transaction history.
   */
  detectSubscriptions(transactions: TransactionInput[]): DetectedSubscription[] {
    const outflows = transactions.filter(tx => tx.amount < 0);
    const groups = groupByMerchant(outflows);
    const subscriptions: DetectedSubscription[] = [];

    for (const group of groups) {
      if (group.transactions.length < 3) continue;

      // Group by similar amounts (within 10%)
      const amountGroups = new Map<number, TransactionInput[]>();
      for (const tx of group.transactions) {
        const amount = Math.abs(tx.amount);
        let matched = false;
        for (const [key, txs] of amountGroups) {
          if (Math.abs(amount - key) / key < 0.1) {
            txs.push(tx);
            matched = true;
            break;
          }
        }
        if (!matched) {
          amountGroups.set(amount, [tx]);
        }
      }

      for (const [amount, txs] of amountGroups) {
        if (txs.length < 3) continue;

        const dates = txs.map(tx => tx.date);
        const freq = detectFrequency(dates);
        if (!freq) continue;

        // Predict next date
        const lastDate = dates[dates.length - 1];
        const nextDate = new Date(lastDate.getTime() + freq.avgInterval * 24 * 60 * 60 * 1000);

        // Calculate day of month for monthly subscriptions
        let dayOfMonth: number | undefined;
        if (freq.frequency === 'monthly') {
          const days = dates.map(d => d.getDate());
          const avgDay = Math.round(days.reduce((a, b) => a + b, 0) / days.length);
          dayOfMonth = avgDay;
        }

        // Confidence based on number of data points and consistency
        const confidence = Math.min(0.5 + txs.length * 0.1, 0.95);

        const { merchant } = cleaner.cleanAndMatch(txs[0].descriptor);
        subscriptions.push({
          merchantName: merchant?.name || group.merchantName,
          amount,
          frequency: freq.frequency,
          nextExpectedDate: nextDate,
          dayOfMonth,
          confidence,
          transactionCount: txs.length,
        });
      }
    }

    return subscriptions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Detect unusual spending patterns.
   */
  detectAnomalies(transaction: TransactionInput, userHistory: TransactionInput[]): Anomaly | null {
    if (transaction.amount >= 0) return null; // Only check outflows

    const { cleaned, merchant } = cleaner.cleanAndMatch(transaction.descriptor);
    const merchantName = merchant?.name || cleaned.cleanName;
    const txAmount = Math.abs(transaction.amount);

    // Find similar past transactions by merchant
    const similar = userHistory.filter(h => {
      const { merchant: hm, cleaned: hc } = cleaner.cleanAndMatch(h.descriptor);
      const hName = hm?.name || hc.cleanName;
      return hName.toLowerCase() === merchantName.toLowerCase() && h.amount < 0;
    });

    if (similar.length >= 3) {
      const amounts = similar.map(s => Math.abs(s.amount));
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const stdDev = Math.sqrt(amounts.reduce((sum, a) => sum + Math.pow(a - avg, 2), 0) / amounts.length);

      // Unusually large: more than 2 standard deviations above mean
      if (txAmount > avg + 2 * stdDev && txAmount > avg * 2) {
        return {
          type: 'unusually_large',
          description: `$${txAmount.toFixed(2)} at ${merchantName} is unusually high (avg: $${avg.toFixed(2)})`,
          severity: txAmount > avg * 5 ? 'high' : txAmount > avg * 3 ? 'medium' : 'low',
          transaction,
          referenceAmount: avg,
        };
      }
    }

    // Duplicate detection: same merchant + same amount within 2 days
    const recentDupes = userHistory.filter(h => {
      const { merchant: hm, cleaned: hc } = cleaner.cleanAndMatch(h.descriptor);
      const hName = hm?.name || hc.cleanName;
      const daysDiff = Math.abs(transaction.date.getTime() - h.date.getTime()) / (1000 * 60 * 60 * 24);
      return (
        hName.toLowerCase() === merchantName.toLowerCase() &&
        Math.abs(h.amount - transaction.amount) < 0.01 &&
        daysDiff <= 2 &&
        daysDiff > 0
      );
    });

    if (recentDupes.length > 0) {
      return {
        type: 'duplicate',
        description: `Potential duplicate charge of $${txAmount.toFixed(2)} at ${merchantName}`,
        severity: 'medium',
        transaction,
      };
    }

    return null;
  }

  /**
   * Detect if a transaction might benefit from splitting.
   */
  detectSplittableTransaction(transaction: TransactionInput): SplitSuggestion | null {
    if (transaction.amount >= 0) return null;
    const txAmount = Math.abs(transaction.amount);

    const { merchant } = cleaner.cleanAndMatch(transaction.descriptor);
    if (!merchant) return null;

    const name = merchant.name.toLowerCase();

    // Large purchases at multi-category retailers
    const splittableRetailers: { names: string[]; categories: string[]; threshold: number }[] = [
      { names: ['walmart', 'target', 'costco', "sam's club", "bj's wholesale", 'meijer'],
        categories: ['Groceries', 'Household', 'Clothing'], threshold: 75 },
      { names: ['amazon'], categories: ['Shopping', 'Groceries', 'Electronics', 'Household'], threshold: 100 },
      { names: ['cvs', 'walgreens', 'rite aid'], categories: ['Healthcare', 'Groceries', 'Personal Care'], threshold: 50 },
      { names: ['home depot', "lowe's", 'menards'], categories: ['Home Improvement', 'Household'], threshold: 100 },
    ];

    for (const retailer of splittableRetailers) {
      if (retailer.names.some(n => name.includes(n)) && txAmount >= retailer.threshold) {
        return {
          merchantName: merchant.name,
          suggestedCategories: retailer.categories,
          reason: `$${txAmount.toFixed(2)} at ${merchant.name} — consider splitting between categories`,
        };
      }
    }

    return null;
  }

  /**
   * Detect income patterns (regular deposits).
   */
  detectIncome(transactions: TransactionInput[]): DetectedIncome[] {
    const inflows = transactions.filter(tx => tx.amount > 0 && tx.amount >= 100);
    const groups = groupByMerchant(inflows);
    const incomes: DetectedIncome[] = [];

    for (const group of groups) {
      if (group.transactions.length < 2) continue;

      // Group by similar amounts
      const amountGroups = new Map<number, TransactionInput[]>();
      for (const tx of group.transactions) {
        let matched = false;
        for (const [key, txs] of amountGroups) {
          if (Math.abs(tx.amount - key) / key < 0.05) {
            txs.push(tx);
            matched = true;
            break;
          }
        }
        if (!matched) {
          amountGroups.set(tx.amount, [tx]);
        }
      }

      for (const [amount, txs] of amountGroups) {
        if (txs.length < 2) continue;

        const dates = txs.map(tx => tx.date);
        const freq = detectFrequency(dates);
        if (!freq) continue;

        const lastDate = dates[dates.length - 1];
        const nextDate = new Date(lastDate.getTime() + freq.avgInterval * 24 * 60 * 60 * 1000);

        const { merchant } = cleaner.cleanAndMatch(txs[0].descriptor);
        incomes.push({
          merchantName: merchant?.name || group.merchantName,
          amount,
          frequency: freq.frequency as 'weekly' | 'biweekly' | 'monthly',
          nextExpectedDate: nextDate,
          confidence: Math.min(0.5 + txs.length * 0.15, 0.95),
        });
      }
    }

    return incomes.sort((a, b) => b.confidence - a.confidence);
  }
}
