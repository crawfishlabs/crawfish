import * as crypto from 'crypto';
import {
  CategorizationDecision,
  CategorizationStore,
  DateRange,
  AccuracyReport,
  LayerAccuracy,
  MisCategorizedDescriptor,
  ImprovementAction,
  MerchantCandidate,
} from './models';
import { DescriptorCleaner } from './descriptor-cleaner';
import { CommunityLearning } from './community-learning';

const cleaner = new DescriptorCleaner();

// ─── CategorizationImprover ──────────────────────────────────────────────────

export class CategorizationImprover {
  private communityLearning: CommunityLearning;

  constructor(private store: CategorizationStore) {
    this.communityLearning = new CommunityLearning(store);
  }

  // ─── Record every categorization decision ────────────────────────────────

  async recordDecision(
    descriptor: string,
    suggestedCategory: string,
    finalCategory: string,
    source: string,
    confidence: number,
    userId: string
  ): Promise<void> {
    const { cleaned } = cleaner.cleanAndMatch(descriptor);

    const decision: CategorizationDecision = {
      descriptor,
      cleanedDescriptor: cleaned.cleanName,
      suggestedCategory,
      finalCategory,
      accepted: suggestedCategory.toLowerCase() === finalCategory.toLowerCase(),
      source,
      confidence,
      userId,
      timestamp: new Date(),
    };

    await this.store.recordDecision(decision);
  }

  // ─── Nightly: analyze accuracy and update models ─────────────────────────

  async runNightlyImprovement(): Promise<{
    report: AccuracyReport;
    actions: ImprovementAction[];
  }> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dateRange: DateRange = { start: yesterday, end: today };
    const actions: ImprovementAction[] = [];

    // 1. Calculate per-layer accuracy
    const report = await this.getAccuracyMetrics(dateRange);

    // 2. Identify top mis-categorized descriptors
    const misCategorized = await this.store.getTopMisCategorized(dateRange, 5);

    // 3. Auto-promote frequent corrections to community mappings
    for (const mis of misCategorized) {
      if (mis.occurrences >= 5 && mis.userIds >= 3) {
        // Strong signal — update community mapping
        await this.communityLearning.recordCategorization(mis.descriptor, mis.correctedCategory);
        // Record multiple votes to reflect the correction strength
        for (let i = 1; i < Math.min(mis.occurrences, 10); i++) {
          await this.communityLearning.recordCategorization(mis.descriptor, mis.correctedCategory);
        }

        const action: ImprovementAction = {
          type: 'update_community',
          descriptor: mis.descriptor,
          details: `Auto-updated community mapping: "${mis.descriptor}" ${mis.suggestedCategory} → ${mis.correctedCategory} (${mis.occurrences} corrections by ${mis.userIds} users)`,
          timestamp: new Date(),
        };
        actions.push(action);
        await this.store.recordImprovementAction(action);
      }
    }

    // 4. Flag descriptors where AI disagrees with community consensus
    const aiDecisions = report.perLayerAccuracy.find(l => l.layer === 'ai');
    if (aiDecisions && aiDecisions.accuracy < 0.6) {
      const action: ImprovementAction = {
        type: 'flag_for_review',
        descriptor: '*',
        details: `AI layer accuracy dropped to ${(aiDecisions.accuracy * 100).toFixed(1)}% — review prompt and model quality`,
        timestamp: new Date(),
      };
      actions.push(action);
      await this.store.recordImprovementAction(action);
    }

    return { report, actions };
  }

  // ─── Weekly: expand known merchant database ──────────────────────────────

  async expandMerchantDatabase(): Promise<{
    promoted: MerchantCandidate[];
    newMerchants: MerchantCandidate[];
    actions: ImprovementAction[];
  }> {
    const actions: ImprovementAction[] = [];

    // Find descriptors categorized >20 times with >90% agreement
    const candidates = await this.store.getFrequentDescriptors(20, 0.9);

    const promoted: MerchantCandidate[] = [];
    const newMerchants: MerchantCandidate[] = [];

    for (const candidate of candidates) {
      // Check if already in known merchant database
      const { merchant } = cleaner.cleanAndMatch(candidate.descriptor);

      if (merchant) {
        // Already known — skip
        continue;
      }

      if (candidate.distinctUsers >= 5 && candidate.agreement >= 0.9) {
        // Strong candidate for promotion to known merchant
        promoted.push(candidate);

        // Boost community mapping to ensure it fires before AI
        for (let i = 0; i < 15; i++) {
          await this.communityLearning.recordCategorization(candidate.cleanName, candidate.category);
        }

        const action: ImprovementAction = {
          type: 'promote_to_known',
          descriptor: candidate.cleanName,
          details: `Promoted "${candidate.cleanName}" → ${candidate.category} (${candidate.totalCategorizations} categorizations, ${(candidate.agreement * 100).toFixed(0)}% agreement, ${candidate.distinctUsers} users)`,
          timestamp: new Date(),
        };
        actions.push(action);
        await this.store.recordImprovementAction(action);
      } else if (candidate.distinctUsers >= 2) {
        // New merchant appearing — track but don't promote yet
        newMerchants.push(candidate);
      }
    }

    return { promoted, newMerchants, actions };
  }

  // ─── Monthly: retrain category mappings ──────────────────────────────────

  async retrainCategoryMappings(): Promise<{
    updatedMappings: number;
    prunedMappings: number;
    actions: ImprovementAction[];
  }> {
    const actions: ImprovementAction[] = [];
    let updatedMappings = 0;
    let prunedMappings = 0;

    // 1. Analyze MCC → user category mapping drift
    const last30Days: DateRange = {
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end: new Date(),
    };
    const last90Days: DateRange = {
      start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      end: new Date(),
    };

    const recentDecisions = await this.store.getDecisions(last30Days);

    // Group by source=mcc and track actual user choices
    const mccMappings = new Map<string, Map<string, number>>();
    for (const d of recentDecisions) {
      if (d.source === 'mcc' && !d.accepted) {
        const key = d.suggestedCategory;
        if (!mccMappings.has(key)) mccMappings.set(key, new Map());
        const corrections = mccMappings.get(key)!;
        corrections.set(d.finalCategory, (corrections.get(d.finalCategory) || 0) + 1);
      }
    }

    // Flag drifted mappings
    for (const [suggested, corrections] of mccMappings) {
      for (const [corrected, count] of corrections) {
        if (count >= 10) {
          const action: ImprovementAction = {
            type: 'flag_for_review',
            descriptor: suggested,
            details: `MCC mapping drift: "${suggested}" corrected to "${corrected}" ${count} times in last 30 days`,
            timestamp: new Date(),
          };
          actions.push(action);
          await this.store.recordImprovementAction(action);
          updatedMappings++;
        }
      }
    }

    // 2. Prune stale community mappings (no activity in 90 days)
    const allDecisions90 = await this.store.getDecisions(last90Days);
    const activeDescriptors = new Set(allDecisions90.map(d => d.cleanedDescriptor.toLowerCase()));

    // Get community mappings that haven't been seen recently
    const frequentDescriptors = await this.store.getFrequentDescriptors(1, 0);
    for (const desc of frequentDescriptors) {
      if (!activeDescriptors.has(desc.cleanName.toLowerCase())) {
        const hash = crypto.createHash('sha256')
          .update(desc.cleanName.toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim())
          .digest('hex').slice(0, 16);

        await this.store.pruneStaleMapping(hash);
        prunedMappings++;

        const action: ImprovementAction = {
          type: 'prune_stale',
          descriptor: desc.cleanName,
          details: `Pruned stale community mapping: "${desc.cleanName}" (no activity in 90 days)`,
          timestamp: new Date(),
        };
        actions.push(action);
        await this.store.recordImprovementAction(action);
      }
    }

    // 3. Generate accuracy trend
    const trend = await this.store.getDailyAccuracy(90);
    if (trend.length >= 14) {
      const firstWeek = trend.slice(0, 7);
      const lastWeek = trend.slice(-7);
      const firstAvg = firstWeek.reduce((s, d) => s + d.accuracy, 0) / firstWeek.length;
      const lastAvg = lastWeek.reduce((s, d) => s + d.accuracy, 0) / lastWeek.length;

      if (lastAvg < firstAvg - 0.05) {
        const action: ImprovementAction = {
          type: 'flag_for_review',
          descriptor: '*',
          details: `Accuracy regression: ${(firstAvg * 100).toFixed(1)}% → ${(lastAvg * 100).toFixed(1)}% over 90 days`,
          timestamp: new Date(),
        };
        actions.push(action);
        await this.store.recordImprovementAction(action);
      }
    }

    return { updatedMappings, prunedMappings, actions };
  }

  // ─── Real-time learning on correction ────────────────────────────────────

  async onCorrection(
    descriptor: string,
    wrongCategory: string,
    rightCategory: string
  ): Promise<{ immediateUpdate: boolean; flaggedForReview: boolean }> {
    const { cleaned, merchant } = cleaner.cleanAndMatch(descriptor);
    let immediateUpdate = false;
    let flaggedForReview = false;

    // Check how many users have made this same correction
    const recentDecisions = await this.store.getDecisionsByDescriptor(cleaned.cleanName, 100);
    const sameCorrection = recentDecisions.filter(
      d => !d.accepted &&
        d.suggestedCategory.toLowerCase() === wrongCategory.toLowerCase() &&
        d.finalCategory.toLowerCase() === rightCategory.toLowerCase()
    );

    // Count distinct users making this correction
    const distinctUsers = new Set(sameCorrection.map(d => d.userId)).size;

    // If 3+ users made the same correction → immediately update community
    if (distinctUsers >= 3) {
      // Boost the correct category heavily
      for (let i = 0; i < distinctUsers * 3; i++) {
        await this.communityLearning.recordCategorization(cleaned.cleanName, rightCategory);
      }
      immediateUpdate = true;

      await this.store.recordImprovementAction({
        type: 'update_community',
        descriptor: cleaned.cleanName,
        details: `Immediate update: ${distinctUsers} users corrected "${cleaned.cleanName}" from "${wrongCategory}" to "${rightCategory}"`,
        timestamp: new Date(),
      });
    }

    // If correction contradicts known merchant database → flag
    if (merchant && merchant.defaultCategory.toLowerCase() !== rightCategory.toLowerCase()) {
      const contradictions = recentDecisions.filter(
        d => !d.accepted && d.source === 'pattern'
      );
      if (contradictions.length >= 5) {
        flaggedForReview = true;

        await this.store.recordImprovementAction({
          type: 'flag_for_review',
          descriptor: cleaned.cleanName,
          details: `Known merchant "${merchant.name}" default category "${merchant.defaultCategory}" contradicted ${contradictions.length} times — users prefer "${rightCategory}"`,
          timestamp: new Date(),
        });
      }
    }

    return { immediateUpdate, flaggedForReview };
  }

  // ─── Accuracy metrics ────────────────────────────────────────────────────

  async getAccuracyMetrics(dateRange?: DateRange): Promise<AccuracyReport> {
    const range = dateRange || {
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end: new Date(),
    };

    const stats = await this.store.getDecisionStats(range);
    const topCorrected = await this.store.getTopMisCategorized(range, 3);
    const trend = await this.store.getDailyAccuracy(30);

    // Per-layer accuracy
    const perLayerAccuracy: LayerAccuracy[] = Object.entries(stats.bySource).map(
      ([layer, { total, correct }]) => ({
        layer,
        total,
        correct,
        accuracy: total > 0 ? correct / total : 0,
      })
    );

    // Per-category accuracy
    const perCategoryAccuracy: Record<string, { total: number; correct: number; accuracy: number }> = {};
    for (const [cat, { total, correct }] of Object.entries(stats.byCategory)) {
      perCategoryAccuracy[cat] = { total, correct, accuracy: total > 0 ? correct / total : 0 };
    }

    // AI fallback rate
    const aiTotal = stats.bySource['ai']?.total || 0;
    const aiFallbackRate = stats.total > 0 ? aiTotal / stats.total : 0;

    // Correction rate
    const correctionRate = stats.total > 0 ? (stats.total - stats.accepted) / stats.total : 0;

    return {
      dateRange: range,
      overallAccuracy: stats.total > 0 ? stats.accepted / stats.total : 0,
      totalDecisions: stats.total,
      perLayerAccuracy,
      perCategoryAccuracy,
      aiFallbackRate,
      correctionRate,
      topCorrectedDescriptors: topCorrected,
      improvementTrend: trend.map(d => ({ date: d.date, accuracy: d.accuracy })),
    };
  }
}
