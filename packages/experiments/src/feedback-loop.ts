import {
  FeedbackSignal,
  SupportTicket,
  AppId,
  Experiment,
  Sentiment,
} from './models';
import { ExperimentStore, ExperimentEngine } from './engine';

export interface FeedbackLoopStore extends ExperimentStore {
  getRunningExperimentsForApp(appId: AppId): Promise<Experiment[]>;
  getAssignmentsByUser(userId: string): Promise<{ experimentId: string; variantId: string }[]>;
}

export class FeedbackLoop {
  constructor(
    private store: FeedbackLoopStore,
    private engine: ExperimentEngine
  ) {}

  // ── Ticket Created ────────────────────────────────────────────────────

  async onTicketCreated(ticket: SupportTicket): Promise<void> {
    const assignments = await this.store.getAssignmentsByUser(ticket.userId);
    if (assignments.length === 0) return;

    const sentiment = this.analyzeSentiment(ticket.subject + ' ' + ticket.body);

    for (const assignment of assignments) {
      const experiment = await this.store.getExperiment(assignment.experimentId);
      if (!experiment || experiment.status !== 'running') continue;
      if (experiment.appId !== ticket.appId) continue;

      const signal: FeedbackSignal = {
        experimentId: assignment.experimentId,
        variant: assignment.variantId,
        userId: ticket.userId,
        type: 'ticket',
        sentiment,
        message: ticket.subject,
        timestamp: new Date(),
      };

      await this.engine.ingestFeedback(signal);
    }

    // Check for negative spike
    await this.checkNegativeSentimentSpike(ticket.appId);
  }

  // ── Rating Received ───────────────────────────────────────────────────

  async onRatingReceived(userId: string, appId: AppId, rating: number, review?: string): Promise<void> {
    const assignments = await this.store.getAssignmentsByUser(userId);

    const sentiment: Sentiment = rating >= 4 ? 'positive' : rating >= 3 ? 'neutral' : 'negative';

    for (const assignment of assignments) {
      const experiment = await this.store.getExperiment(assignment.experimentId);
      if (!experiment || experiment.status !== 'running') continue;
      if (experiment.appId !== appId) continue;

      const signal: FeedbackSignal = {
        experimentId: assignment.experimentId,
        variant: assignment.variantId,
        userId,
        type: 'rating',
        sentiment,
        score: rating,
        message: review,
        timestamp: new Date(),
      };

      await this.engine.ingestFeedback(signal);
    }
  }

  // ── Churn Detected ────────────────────────────────────────────────────

  async onChurnDetected(userId: string, appId: AppId): Promise<void> {
    const assignments = await this.store.getAssignmentsByUser(userId);

    for (const assignment of assignments) {
      const experiment = await this.store.getExperiment(assignment.experimentId);
      if (!experiment || experiment.status !== 'running') continue;
      if (experiment.appId !== appId) continue;

      const signal: FeedbackSignal = {
        experimentId: assignment.experimentId,
        variant: assignment.variantId,
        userId,
        type: 'churn',
        sentiment: 'negative',
        score: 0,
        message: 'User churned (subscription cancel or 14-day inactivity)',
        timestamp: new Date(),
      };

      await this.engine.ingestFeedback(signal);

      // Also track as a metric event with weight multiplier
      await this.engine.trackEvent(assignment.experimentId, userId, 'churn_event', 1);
    }
  }

  // ── Aggregate Analysis ────────────────────────────────────────────────

  async analyzeFeedbackImpact(experimentId: string): Promise<{
    variantSentiment: Record<string, { positive: number; neutral: number; negative: number; total: number }>;
    significantDifference: boolean;
    warningVariants: string[];
  }> {
    const feedback = await this.store.getFeedback(experimentId);
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const variantSentiment: Record<string, { positive: number; neutral: number; negative: number; total: number }> = {};

    for (const variant of experiment.variants) {
      const vf = feedback.filter(f => f.variant === variant.id);
      variantSentiment[variant.id] = {
        positive: vf.filter(f => f.sentiment === 'positive').length,
        neutral: vf.filter(f => f.sentiment === 'neutral').length,
        negative: vf.filter(f => f.sentiment === 'negative').length,
        total: vf.length,
      };
    }

    // Check if any treatment variant has significantly worse sentiment than control
    const controlVariant = experiment.variants.find(v => v.name === 'control') ?? experiment.variants[0];
    const controlSentiment = variantSentiment[controlVariant.id];
    const warningVariants: string[] = [];

    for (const variant of experiment.variants) {
      if (variant.id === controlVariant.id) continue;
      const vs = variantSentiment[variant.id];
      if (vs.total < 10 || controlSentiment.total < 10) continue;

      const controlNegRate = controlSentiment.negative / controlSentiment.total;
      const treatmentNegRate = vs.negative / vs.total;

      if (treatmentNegRate > controlNegRate * 1.5 && treatmentNegRate > 0.2) {
        warningVariants.push(variant.id);
      }
    }

    return {
      variantSentiment,
      significantDifference: warningVariants.length > 0,
      warningVariants,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private analyzeSentiment(text: string): Sentiment {
    const lower = text.toLowerCase();
    const negativeWords = ['bug', 'crash', 'broken', 'error', 'fail', 'terrible', 'awful', 'hate', 'worst', 'unusable', 'slow', 'freeze', 'lost', 'missing', 'wrong'];
    const positiveWords = ['great', 'love', 'amazing', 'excellent', 'perfect', 'awesome', 'fantastic', 'helpful', 'thank', 'wonderful'];

    const negScore = negativeWords.filter(w => lower.includes(w)).length;
    const posScore = positiveWords.filter(w => lower.includes(w)).length;

    if (negScore > posScore) return 'negative';
    if (posScore > negScore) return 'positive';
    return 'neutral';
  }

  private async checkNegativeSentimentSpike(appId: AppId): Promise<void> {
    const experiments = await this.store.getRunningExperimentsForApp(appId);

    for (const experiment of experiments) {
      const feedback = await this.store.getFeedback(experiment.id);
      const recentFeedback = feedback.filter(
        f => f.timestamp.getTime() > Date.now() - 60 * 60 * 1000 // last hour
      );

      if (recentFeedback.length >= 5) {
        const negRate = recentFeedback.filter(f => f.sentiment === 'negative').length / recentFeedback.length;
        if (negRate > 0.7) {
          // Trigger guardrail evaluation
          await this.engine.runAutoPilot(experiment.id);
        }
      }
    }
  }
}
