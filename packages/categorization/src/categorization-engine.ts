import { v4 as uuidv4 } from 'uuid';
import {
  CategorizationResult,
  MerchantInfo,
  TransactionInput,
  UserRule,
  CategorizationStore,
  AICategorizationProvider,
} from './models';
import { DescriptorCleaner } from './descriptor-cleaner';
import { lookupMCC } from './mcc-codes';
import { CommunityLearning } from './community-learning';

// ─── Category Mapping Helpers ────────────────────────────────────────────────

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  'Groceries':          ['grocery', 'groceries', 'food', 'supermarket'],
  'Eating Out':         ['eating out', 'dining', 'restaurants', 'dining out', 'food & drink', 'eating places'],
  'Auto & Gas':         ['auto', 'gas', 'fuel', 'car', 'automotive', 'transportation', 'gas & auto'],
  'Shopping':           ['shopping', 'retail', 'general merchandise', 'misc'],
  'Entertainment':      ['entertainment', 'fun', 'recreation', 'leisure'],
  'Travel':             ['travel', 'vacation', 'lodging', 'hotels', 'flights'],
  'Healthcare':         ['healthcare', 'health', 'medical', 'pharmacy', 'doctor'],
  'Insurance':          ['insurance'],
  'Utilities':          ['utilities', 'bills', 'electric', 'gas bill', 'water'],
  'Subscriptions':      ['subscriptions', 'streaming', 'membership', 'digital services', 'software'],
  'Home Improvement':   ['home improvement', 'home', 'household', 'home repair', 'home maintenance'],
  'Clothing':           ['clothing', 'apparel', 'clothes', 'fashion'],
  'Electronics':        ['electronics', 'tech', 'computers', 'gadgets'],
  'Education':          ['education', 'school', 'college', 'tuition', 'learning'],
  'Childcare':          ['childcare', 'child care', 'daycare', 'kids'],
  'Pet':                ['pet', 'pets', 'vet', 'veterinary'],
  'Fitness & Sports':   ['fitness', 'gym', 'sports', 'exercise', 'workout'],
  'Personal Care':      ['personal care', 'beauty', 'salon', 'spa', 'barber', 'hair'],
  'Charity':            ['charity', 'donation', 'donations', 'giving', 'nonprofit'],
  'Government & Tax':   ['government', 'tax', 'taxes', 'gov', 'irs'],
  'Financial Services': ['financial', 'finance', 'banking', 'bank fees', 'investment'],
  'Professional Services': ['professional services', 'legal', 'accounting', 'consulting'],
  'Rent & Mortgage':    ['rent', 'mortgage', 'housing', 'rent & mortgage'],
  'Transportation':     ['transportation', 'transit', 'rideshare', 'uber', 'lyft', 'parking', 'tolls'],
};

function mapToUserCategory(
  suggestedCategory: string,
  userCategories: string[]
): { category: string; confidence: number } {
  if (!userCategories.length) {
    return { category: suggestedCategory, confidence: 0.5 };
  }

  const suggestedLower = suggestedCategory.toLowerCase();

  // 1. Exact match
  const exact = userCategories.find(c => c.toLowerCase() === suggestedLower);
  if (exact) return { category: exact, confidence: 1.0 };

  // 2. Substring / contains match
  const contains = userCategories.find(
    c => suggestedLower.includes(c.toLowerCase()) || c.toLowerCase().includes(suggestedLower)
  );
  if (contains) return { category: contains, confidence: 0.9 };

  // 3. Synonym matching
  for (const [canonical, synonyms] of Object.entries(CATEGORY_SYNONYMS)) {
    const matchesSuggested = synonyms.some(s => suggestedLower.includes(s));
    if (matchesSuggested) {
      // Find user category matching this canonical group
      const userMatch = userCategories.find(uc => {
        const ucLower = uc.toLowerCase();
        return ucLower === canonical.toLowerCase() || synonyms.some(s => ucLower.includes(s));
      });
      if (userMatch) return { category: userMatch, confidence: 0.85 };
    }
  }

  // 4. Word overlap scoring
  const suggestedWords = new Set(suggestedLower.split(/[\s\/&,]+/).filter(w => w.length > 2));
  let bestMatch = '';
  let bestScore = 0;

  for (const uc of userCategories) {
    const ucWords = new Set(uc.toLowerCase().split(/[\s\/&,]+/).filter(w => w.length > 2));
    let overlap = 0;
    for (const w of suggestedWords) {
      if (ucWords.has(w)) overlap++;
    }
    const score = overlap / Math.max(suggestedWords.size, ucWords.size);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = uc;
    }
  }

  if (bestScore > 0.3) {
    return { category: bestMatch, confidence: Math.min(bestScore + 0.3, 0.8) };
  }

  // 5. Fallback — return suggested as-is with low confidence
  return { category: suggestedCategory, confidence: 0.3 };
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export class CategorizationEngine {
  private cleaner = new DescriptorCleaner();
  private communityLearning: CommunityLearning;

  constructor(
    private store: CategorizationStore,
    private aiProvider?: AICategorizationProvider
  ) {
    this.communityLearning = new CommunityLearning(store);
  }

  /**
   * Categorize a single transaction using the cascading engine.
   */
  async categorize(
    transaction: TransactionInput,
    userCategories: string[],
    userId: string
  ): Promise<CategorizationResult> {
    const { cleaned, merchant } = this.cleaner.cleanAndMatch(transaction.descriptor);

    // ── Layer 1: User rules ──
    const userRuleResult = await this.tryUserRules(transaction.descriptor, cleaned.cleanName, userId, userCategories);
    if (userRuleResult && userRuleResult.confidence >= 0.8) {
      return userRuleResult;
    }

    // ── Layer 2: Known merchant database ──
    if (merchant) {
      const mapped = mapToUserCategory(merchant.defaultCategory, userCategories);
      const mccEntry = transaction.mccCode ? lookupMCC(transaction.mccCode) : null;

      return this.buildResult({
        id: uuidv4(),
        rawDescriptor: transaction.descriptor,
        cleanName: merchant.name,
        mccCode: transaction.mccCode || '',
        mccCategory: mccEntry?.category || '',
        confidence: mapped.confidence * 0.95,
        source: 'pattern',
        logoUrl: merchant.logoUrl,
        suggestedCategory: mapped.category,
      }, mapped.category, mapped.confidence * 0.95, 'pattern', userCategories);
    }

    // ── Layer 3: MCC code lookup ──
    if (transaction.mccCode) {
      const mccEntry = lookupMCC(transaction.mccCode);
      if (mccEntry) {
        const mapped = mapToUserCategory(mccEntry.suggestedBudgetCategory, userCategories);
        return this.buildResult({
          id: uuidv4(),
          rawDescriptor: transaction.descriptor,
          cleanName: cleaned.cleanName,
          mccCode: transaction.mccCode,
          mccCategory: mccEntry.category,
          confidence: mapped.confidence * 0.8,
          source: 'mcc',
          suggestedCategory: mapped.category,
        }, mapped.category, mapped.confidence * 0.8, 'mcc', userCategories);
      }
    }

    // ── Layer 4: Community categorization ──
    const communityResult = await this.communityLearning.getCommunityCategory(cleaned.cleanName);
    if (communityResult && communityResult.confidence >= 0.8 && communityResult.totalVotes >= 10) {
      const mapped = mapToUserCategory(communityResult.topCategory, userCategories);
      return this.buildResult({
        id: uuidv4(),
        rawDescriptor: transaction.descriptor,
        cleanName: cleaned.cleanName,
        mccCode: transaction.mccCode || '',
        mccCategory: '',
        confidence: mapped.confidence * communityResult.confidence,
        source: 'community',
        suggestedCategory: mapped.category,
      }, mapped.category, mapped.confidence * communityResult.confidence, 'community', userCategories);
    }

    // ── Layer 5: AI categorization ──
    if (this.aiProvider) {
      try {
        const mccEntry = transaction.mccCode ? lookupMCC(transaction.mccCode) : null;
        const aiResult = await this.aiProvider.categorize(
          cleaned.cleanName,
          transaction.mccCode,
          mccEntry?.description,
          transaction.amount,
          userCategories
        );

        if (aiResult.category) {
          const mapped = mapToUserCategory(aiResult.category, userCategories);
          return this.buildResult({
            id: uuidv4(),
            rawDescriptor: transaction.descriptor,
            cleanName: cleaned.cleanName,
            mccCode: transaction.mccCode || '',
            mccCategory: mccEntry?.category || '',
            confidence: Math.min(aiResult.confidence, mapped.confidence) * 0.7,
            source: 'ai',
            suggestedCategory: mapped.category,
          }, mapped.category, Math.min(aiResult.confidence, mapped.confidence) * 0.7, 'ai', userCategories);
        }
      } catch (err) {
        console.error('AI categorization failed:', err);
      }
    }

    // ── Fallback ──
    return this.buildResult({
      id: uuidv4(),
      rawDescriptor: transaction.descriptor,
      cleanName: cleaned.cleanName,
      mccCode: transaction.mccCode || '',
      mccCategory: '',
      confidence: 0,
      source: 'pattern',
    }, 'Uncategorized', 0, 'none', userCategories);
  }

  /**
   * Learn from a user's manual categorization.
   */
  async onUserCategorize(
    userId: string,
    _transactionId: string,
    descriptor: string,
    chosenCategory: string
  ): Promise<void> {
    const { cleaned } = this.cleaner.cleanAndMatch(descriptor);

    // Create / update user rule
    const rules = await this.store.getUserRules(userId);
    const existingRule = rules.find(
      r => r.pattern.toLowerCase() === cleaned.cleanName.toLowerCase()
    );

    if (existingRule) {
      existingRule.category = chosenCategory;
      existingRule.matchCount++;
      await this.store.saveUserRule(existingRule);
    } else {
      await this.store.saveUserRule({
        userId,
        pattern: cleaned.cleanName,
        merchantName: cleaned.cleanName,
        category: chosenCategory,
        createdAt: new Date(),
        matchCount: 1,
      });
    }

    // Update community mapping
    await this.communityLearning.recordCategorization(cleaned.cleanName, chosenCategory);
  }

  /**
   * Bulk categorize — deduplicates by merchant.
   */
  async categorizeBatch(
    transactions: TransactionInput[],
    userCategories: string[],
    userId: string
  ): Promise<CategorizationResult[]> {
    // Group by cleaned descriptor to minimize duplicate work
    const groups = new Map<string, { transactions: TransactionInput[]; result?: CategorizationResult }>();

    for (const tx of transactions) {
      const { cleaned } = this.cleaner.cleanAndMatch(tx.descriptor);
      const key = cleaned.cleanName.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { transactions: [] });
      }
      groups.get(key)!.transactions.push(tx);
    }

    // Categorize one representative from each group
    for (const [, group] of groups) {
      const representative = group.transactions[0];
      group.result = await this.categorize(representative, userCategories, userId);
    }

    // Map results back to original transaction order
    return transactions.map(tx => {
      const { cleaned } = this.cleaner.cleanAndMatch(tx.descriptor);
      const key = cleaned.cleanName.toLowerCase();
      return groups.get(key)!.result!;
    });
  }

  /**
   * Map a suggested category to the user's category list.
   */
  mapToUserCategory = mapToUserCategory;

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async tryUserRules(
    rawDescriptor: string,
    cleanName: string,
    userId: string,
    userCategories: string[]
  ): Promise<CategorizationResult | null> {
    const rules = await this.store.getUserRules(userId);
    const upper = rawDescriptor.toUpperCase();
    const cleanUpper = cleanName.toUpperCase();

    for (const rule of rules) {
      const patternUpper = rule.pattern.toUpperCase();
      let isRegex = false;
      let matches = false;

      // Try regex first
      try {
        if (rule.pattern.startsWith('/') && rule.pattern.lastIndexOf('/') > 0) {
          const regexBody = rule.pattern.slice(1, rule.pattern.lastIndexOf('/'));
          const flags = rule.pattern.slice(rule.pattern.lastIndexOf('/') + 1);
          const regex = new RegExp(regexBody, flags || 'i');
          isRegex = true;
          matches = regex.test(rawDescriptor) || regex.test(cleanName);
        }
      } catch {
        // Not a valid regex, treat as substring
      }

      if (!isRegex) {
        matches = upper.includes(patternUpper) || cleanUpper.includes(patternUpper);
      }

      if (matches) {
        const mccEntry = null; // User rules don't need MCC
        const mapped = mapToUserCategory(rule.category, userCategories);

        // Increment match count
        rule.matchCount++;
        this.store.saveUserRule(rule).catch(() => {});

        return this.buildResult({
          id: uuidv4(),
          rawDescriptor,
          cleanName: rule.merchantName || cleanName,
          mccCode: '',
          mccCategory: '',
          confidence: 0.95,
          source: 'user_rule',
          suggestedCategory: mapped.category,
        }, mapped.category, 0.95, 'user_rule', userCategories);
      }
    }

    return null;
  }

  private buildResult(
    merchantInfo: MerchantInfo,
    suggestedCategory: string,
    confidence: number,
    source: string,
    userCategories: string[]
  ): CategorizationResult {
    // Build alternative categories
    const alternatives: { category: string; confidence: number }[] = [];

    if (userCategories.length > 0) {
      for (const uc of userCategories) {
        if (uc.toLowerCase() !== suggestedCategory.toLowerCase()) {
          const altMapping = mapToUserCategory(uc, [uc]);
          if (altMapping.confidence > 0.3) {
            alternatives.push({ category: uc, confidence: altMapping.confidence * 0.3 });
          }
        }
      }
      alternatives.sort((a, b) => b.confidence - a.confidence);
    }

    return {
      merchantInfo: { ...merchantInfo, confidence },
      suggestedCategory,
      confidence,
      alternativeCategories: alternatives.slice(0, 3),
      source,
      needsUserConfirmation: confidence < 0.85,
    };
  }
}
