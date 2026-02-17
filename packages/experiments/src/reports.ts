import {
  Experiment,
  ExperimentReport,
  PortfolioReport,
  ImpactReport,
  FeedbackSummary,
  FeedbackSignal,
  TimelinePoint,
  AppId,
  VariantMetricResult,
  MetricComparison,
  Recommendation,
  ImpactDataPoint,
} from './models';
import { ExperimentStore } from './engine';
import { ExperimentEngine } from './engine';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface ExperimentListStore {
  listExperiments(filters?: { appId?: AppId; status?: string; dateRange?: DateRange }): Promise<Experiment[]>;
}

export class ExperimentReporter {
  constructor(
    private store: ExperimentStore & ExperimentListStore,
    private engine: ExperimentEngine
  ) {}

  // ── Single Experiment Report ──────────────────────────────────────────

  async generateReport(experimentId: string): Promise<ExperimentReport> {
    const evaluation = await this.engine.evaluateExperiment(experimentId);
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const feedback = await this.store.getFeedback(experimentId);
    const events = await this.store.getEvents(experimentId);

    // Build feedback summary per variant
    const feedbackSummary = this.buildFeedbackSummary(experiment, feedback);

    // Build timeline
    const timeline = this.buildTimeline(events, experiment);

    // Overall confidence: max confidence across success criteria metrics
    const confidence = evaluation.comparisons.length > 0
      ? Math.max(...evaluation.comparisons.map(c => c.confidence))
      : 0;

    return {
      experiment,
      variants: evaluation.variantResults,
      comparisons: evaluation.comparisons,
      guardrailStatus: evaluation.guardrailStatus,
      recommendation: evaluation.recommendation,
      confidence,
      feedbackSummary,
      timeline,
      generatedAt: new Date(),
    };
  }

  private buildFeedbackSummary(experiment: Experiment, feedback: FeedbackSignal[]): FeedbackSummary[] {
    return experiment.variants.map(variant => {
      const variantFeedback = feedback.filter(f => f.variant === variant.id);
      const sentimentBreakdown = {
        positive: variantFeedback.filter(f => f.sentiment === 'positive').length,
        neutral: variantFeedback.filter(f => f.sentiment === 'neutral').length,
        negative: variantFeedback.filter(f => f.sentiment === 'negative').length,
      };

      const ratings = variantFeedback.filter(f => f.score != null).map(f => f.score!);
      const averageRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

      // Simple theme extraction: count word frequency in messages
      const topThemes = this.extractThemes(variantFeedback.map(f => f.message).filter(Boolean) as string[]);

      return {
        variant: variant.id,
        totalFeedback: variantFeedback.length,
        sentimentBreakdown,
        topThemes,
        averageRating,
      };
    });
  }

  private extractThemes(messages: string[]): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'it', 'to', 'in', 'for', 'of', 'and', 'or', 'but', 'not', 'with', 'this', 'that', 'i', 'my', 'me']);
    const wordCounts: Record<string, number> = {};

    for (const msg of messages) {
      const words = msg.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && !stopWords.has(word)) {
          wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }
    }

    return Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  private buildTimeline(events: { timestamp: Date; metricId: string; variantId: string; value: number }[], experiment: Experiment): TimelinePoint[] {
    // Group events by day, metric, and variant
    const grouped: Record<string, { sum: number; count: number; metricId: string; variantId: string; date: Date }> = {};

    for (const event of events) {
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      const key = `${day}:${event.metricId}:${event.variantId}`;
      if (!grouped[key]) {
        grouped[key] = { sum: 0, count: 0, metricId: event.metricId, variantId: event.variantId, date: new Date(day) };
      }
      grouped[key].sum += event.value;
      grouped[key].count++;
    }

    return Object.values(grouped).map(g => ({
      timestamp: g.date,
      metricId: g.metricId,
      variantId: g.variantId,
      value: g.sum / g.count,
    })).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // ── Portfolio Report ──────────────────────────────────────────────────

  async generatePortfolioReport(appId?: AppId, dateRange?: DateRange): Promise<PortfolioReport> {
    const experiments = await this.store.listExperiments({ appId, dateRange });

    const completed = experiments.filter(e => e.status === 'completed' || e.status === 'rolled_back');
    const rolledForward = completed.filter(e => e.decision === 'roll_forward');

    const winRate = completed.length > 0 ? rolledForward.length / completed.length : 0;

    // Average lift from comparisons of completed experiments
    const lifts: number[] = [];
    for (const exp of rolledForward) {
      try {
        const evaluation = await this.engine.evaluateExperiment(exp.id);
        const avgLift = evaluation.comparisons.length > 0
          ? evaluation.comparisons.reduce((s, c) => s + c.lift, 0) / evaluation.comparisons.length
          : 0;
        lifts.push(avgLift);
      } catch { /* skip */ }
    }
    const averageLift = lifts.length > 0 ? lifts.reduce((a, b) => a + b, 0) / lifts.length : 0;

    // Average time to decision
    const decisionTimes = completed
      .filter(e => e.decisionAt && e.startDate)
      .map(e => (e.decisionAt!.getTime() - e.startDate.getTime()) / (1000 * 60 * 60));
    const averageTimeToDecisionHours = decisionTimes.length > 0
      ? decisionTimes.reduce((a, b) => a + b, 0) / decisionTimes.length
      : 0;

    // Feedback correlation: do experiments with more negative feedback get rolled back more?
    let negFeedbackRollbackCount = 0;
    let totalWithFeedback = 0;
    for (const exp of completed) {
      const feedback = await this.store.getFeedback(exp.id);
      if (feedback.length > 0) {
        totalWithFeedback++;
        const negRate = feedback.filter(f => f.sentiment === 'negative').length / feedback.length;
        if (negRate > 0.5 && exp.decision === 'roll_back') negFeedbackRollbackCount++;
      }
    }
    const feedbackCorrelation = totalWithFeedback > 0 ? negFeedbackRollbackCount / totalWithFeedback : 0;

    return {
      experiments,
      totalExperiments: experiments.length,
      winRate,
      averageLift,
      averageTimeToDecisionHours,
      cumulativeImpact: {},
      feedbackCorrelation,
      dateRange: dateRange ?? { start: new Date(0), end: new Date() },
      generatedAt: new Date(),
    };
  }

  // ── Impact Report ─────────────────────────────────────────────────────

  async generateImpactReport(appId: AppId, months: number): Promise<ImpactReport> {
    const start = new Date();
    start.setMonth(start.getMonth() - months);

    const experiments = await this.store.listExperiments({
      appId,
      dateRange: { start, end: new Date() },
    });

    const experimentImpacts: { experimentId: string; metricId: string; before: number; after: number; delta: number }[] = [];

    for (const exp of experiments.filter(e => e.decision === 'roll_forward')) {
      try {
        const evaluation = await this.engine.evaluateExperiment(exp.id);
        for (const comparison of evaluation.comparisons) {
          experimentImpacts.push({
            experimentId: exp.id,
            metricId: comparison.metricId,
            before: comparison.controlValue,
            after: comparison.treatmentValue,
            delta: comparison.treatmentValue - comparison.controlValue,
          });
        }
      } catch { /* skip */ }
    }

    const netImpactScore = experimentImpacts.length > 0
      ? experimentImpacts.reduce((sum, i) => sum + i.delta, 0) / experimentImpacts.length
      : 0;

    return {
      appId,
      months,
      trajectories: [],
      experimentImpacts,
      netImpactScore,
      generatedAt: new Date(),
    };
  }
}
