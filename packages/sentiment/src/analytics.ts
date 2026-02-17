import {
  AppSentiment,
  FeatureSentiment,
  ExperimentSentimentReport,
  GuardrailResult,
  DateRange,
  Reaction,
  REACTION_SCORES,
  SentimentResponse,
  npsCategory,
} from './models';

// ─── Analytics Store ────────────────────────────────────────────────────────

export interface AnalyticsStore {
  getResponses(appId: string, dateRange?: DateRange): Promise<SentimentResponse[]>;
  getResponsesByFeature(appId: string, featureId: string, dateRange?: DateRange): Promise<SentimentResponse[]>;
  getResponsesByExperiment(experimentId: string): Promise<SentimentResponse[]>;
  getPromptsShownCount(appId: string, dateRange?: DateRange): Promise<number>;
  extractThemes(comments: string[], sentiment: 'positive' | 'negative'): Promise<string[]>;
}

// ─── Sentiment Analytics ────────────────────────────────────────────────────

export class SentimentAnalytics {
  constructor(private store: AnalyticsStore) {}

  // ── App-level sentiment ─────────────────────────────────────────────

  async getAppSentiment(appId: string, dateRange?: DateRange): Promise<AppSentiment> {
    const responses = await this.store.getResponses(appId, dateRange);
    const promptsShown = await this.store.getPromptsShownCount(appId, dateRange);

    const nonDismissed = responses.filter(r => !r.dismissed);
    const dismissed = responses.filter(r => r.dismissed);

    // Reaction scores
    const reactionResponses = nonDismissed.filter(r => r.reactionScore !== undefined);
    const avgReactionScore = reactionResponses.length > 0
      ? reactionResponses.reduce((s, r) => s + r.reactionScore!, 0) / reactionResponses.length
      : 0;

    // Reaction distribution
    const reactionDistribution: Record<Reaction, number> = { '😍': 0, '🙂': 0, '😐': 0, '😕': 0, '😤': 0 };
    for (const r of reactionResponses) {
      if (r.reaction) reactionDistribution[r.reaction]++;
    }

    // NPS
    const npsResponses = nonDismissed.filter(r => r.npsScore !== undefined);
    const promoters = npsResponses.filter(r => npsCategory(r.npsScore!) === 'promoter').length;
    const detractors = npsResponses.filter(r => npsCategory(r.npsScore!) === 'detractor').length;
    const nps = npsResponses.length > 0
      ? Math.round(((promoters - detractors) / npsResponses.length) * 100)
      : 0;

    // Rates
    const responseRate = promptsShown > 0 ? nonDismissed.length / promptsShown : 0;
    const dismissRate = promptsShown > 0 ? dismissed.length / promptsShown : 0;

    // Themes
    const positiveComments = nonDismissed
      .filter(r => (r.reactionScore ?? r.rating ?? r.npsScore ?? 3) >= 4 && r.comment)
      .map(r => r.comment!);
    const negativeComments = nonDismissed
      .filter(r => (r.reactionScore ?? r.rating ?? r.npsScore ?? 3) <= 2 && r.comment)
      .map(r => r.comment!);

    const topPositiveThemes = await this.store.extractThemes(positiveComments, 'positive');
    const topNegativeThemes = await this.store.extractThemes(negativeComments, 'negative');

    const start = dateRange?.start ?? new Date(0);
    const end = dateRange?.end ?? new Date();

    return {
      appId,
      avgReactionScore,
      reactionDistribution,
      nps,
      npsTrend: [], // populated by time-series query in production
      responseRate,
      dismissRate,
      topPositiveThemes,
      topNegativeThemes,
      dateRange: { start, end },
    };
  }

  // ── Feature-level sentiment ─────────────────────────────────────────

  async getFeatureSentiment(appId: string, featureId: string, dateRange?: DateRange): Promise<FeatureSentiment> {
    const responses = await this.store.getResponsesByFeature(appId, featureId, dateRange);
    const valid = responses.filter(r => !r.dismissed);

    const scores = valid.map(r => r.reactionScore ?? r.rating ?? 3);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return {
      featureId,
      appId,
      avgScore,
      responseCount: valid.length,
    };
  }

  // ── Experiment sentiment (called by ExperimentEngine.evaluateExperiment) ──

  async getSentimentForExperiment(experimentId: string): Promise<ExperimentSentimentReport> {
    const responses = await this.store.getResponsesByExperiment(experimentId);
    const valid = responses.filter(r => !r.dismissed && r.variant);

    const byVariant = new Map<string, SentimentResponse[]>();
    for (const r of valid) {
      if (!byVariant.has(r.variant!)) byVariant.set(r.variant!, []);
      byVariant.get(r.variant!)!.push(r);
    }

    const variants: ExperimentSentimentReport['variants'] = [];
    for (const [variantId, vResponses] of byVariant) {
      const reactions = vResponses.filter(r => r.reactionScore !== undefined);
      const ratings = vResponses.filter(r => r.rating !== undefined);
      const npsR = vResponses.filter(r => r.npsScore !== undefined);

      const avgReaction = reactions.length > 0
        ? reactions.reduce((s, r) => s + r.reactionScore!, 0) / reactions.length : 0;
      const avgRating = ratings.length > 0
        ? ratings.reduce((s, r) => s + r.rating!, 0) / ratings.length : 0;

      const promoters = npsR.filter(r => npsCategory(r.npsScore!) === 'promoter').length;
      const detractors = npsR.filter(r => npsCategory(r.npsScore!) === 'detractor').length;
      const nps = npsR.length > 0 ? Math.round(((promoters - detractors) / npsR.length) * 100) : 0;

      variants.push({ variantId, avgReaction, avgRating, nps, responseCount: vResponses.length });
    }

    // Delta between first two variants
    const sentimentDelta = variants.length >= 2
      ? variants[1].avgReaction - variants[0].avgReaction
      : 0;
    const isSignificant = variants.every(v => v.responseCount >= 30) && Math.abs(sentimentDelta) >= 0.5;

    // Combined score: weighted average of reactions (40%), ratings (30%), NPS (30%)
    const combinedScore = variants.length > 0
      ? variants.reduce((s, v) => s + (v.avgReaction * 0.4 + v.avgRating * 0.3 + (v.nps / 20) * 0.3), 0) / variants.length
      : 0;

    return { experimentId, variants, sentimentDelta, isSignificant, combinedScore };
  }

  // ── Guardrail check ─────────────────────────────────────────────────

  async sentimentGuardrail(experimentId: string): Promise<GuardrailResult[]> {
    const report = await this.getSentimentForExperiment(experimentId);
    const results: GuardrailResult[] = [];

    if (report.variants.length < 2) return results;

    const control = report.variants[0];
    const treatment = report.variants[1];

    // Sentiment drop > 0.5 points → WARNING
    const reactionDelta = treatment.avgReaction - control.avgReaction;
    if (reactionDelta < -0.5) {
      results.push({
        status: 'warning',
        details: `Treatment sentiment ${treatment.avgReaction.toFixed(2)} is ${Math.abs(reactionDelta).toFixed(2)} points below control`,
        metricId: 'micro_reaction_avg',
        value: reactionDelta,
        threshold: -0.5,
      });
    }

    // NPS drop > 10 points → BREACH
    const npsDelta = treatment.nps - control.nps;
    if (npsDelta < -10) {
      results.push({
        status: 'breach',
        details: `Treatment NPS ${treatment.nps} is ${Math.abs(npsDelta)} points below control (${control.nps})`,
        metricId: 'nps_score',
        value: npsDelta,
        threshold: -10,
      });
    }

    // High dismiss rate on treatment → WARNING
    // (would need prompt-level data; simplified here)

    if (results.length === 0) {
      results.push({
        status: 'green',
        details: 'All sentiment metrics within bounds',
        metricId: 'sentiment_overall',
        value: 0,
        threshold: 0,
      });
    }

    return results;
  }
}
