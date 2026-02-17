import { v4 as uuidv4 } from 'uuid';
import {
  SentimentResponse,
  SentimentMeta,
  SentimentPrompt,
  CooldownConfig,
  PromptType,
  DEFAULT_COOLDOWN,
  REACTION_SCORES,
  Reaction,
  npsCategory,
} from './models';

// ─── Store Abstraction ──────────────────────────────────────────────────────

export interface SentimentStore {
  getSentimentMeta(userId: string): Promise<SentimentMeta | null>;
  setSentimentMeta(meta: SentimentMeta): Promise<void>;
  saveResponse(response: SentimentResponse): Promise<void>;
  getRecentResponses(userId: string, limit: number): Promise<SentimentResponse[]>;
  getUserActionCount(userId: string, appId: string): Promise<number>;
  getUserActionCountForType(userId: string, appId: string, action: string): Promise<number>;
  createSupportTicket(userId: string, appId: string, comment: string, npsScore: number): Promise<void>;
}

export interface ExperimentFeedbackSink {
  submitFeedback(signal: {
    experimentId: string;
    userId: string;
    type: 'rating' | 'nps' | 'in_app_feedback';
    sentiment: 'positive' | 'neutral' | 'negative';
    score: number;
    comment?: string;
  }): Promise<void>;
}

// ─── Action → Prompt Mapping ────────────────────────────────────────────────

interface ActionTriggerRule {
  action: string;
  promptType: PromptType;
  featureId?: string;
  minOccurrences?: number;  // e.g. workout_completed 3rd+ time
  message?: string;
}

const ACTION_TRIGGERS: ActionTriggerRule[] = [
  { action: 'workout_completed', promptType: 'micro_reaction', featureId: 'workout', minOccurrences: 3 },
  { action: 'logging_streak_7', promptType: 'contextual_rating', featureId: 'food_logging' },
  { action: 'food_logged', promptType: 'contextual_rating', featureId: 'food_logging', minOccurrences: 50 },
  { action: 'budget_month_closed', promptType: 'contextual_rating', featureId: 'budget' },
  { action: 'meeting_transcribed', promptType: 'micro_reaction', featureId: 'transcription' },
  { action: 'subscription_renewed', promptType: 'nps' },
];

// ─── Collector ──────────────────────────────────────────────────────────────

export class SentimentCollector {
  constructor(
    private store: SentimentStore,
    private experimentSink?: ExperimentFeedbackSink,
    private cooldown: CooldownConfig = DEFAULT_COOLDOWN,
  ) {}

  // ── Should we prompt this user? ─────────────────────────────────────

  async shouldPrompt(userId: string, _appId: string, promptType: string): Promise<boolean> {
    const meta = await this.store.getSentimentMeta(userId);
    if (!meta) return true; // first time, allow

    const now = new Date();

    // Backoff check
    if (meta.backoffUntil && now < meta.backoffUntil) return false;

    // New user check: must be active >= 3 days
    if (meta.firstActiveAt) {
      const daysSinceFirstActive = (now.getTime() - meta.firstActiveAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceFirstActive < 3) return false;
    }

    // Cooldown: min hours between prompts
    if (meta.lastPromptAt) {
      const hoursSinceLastPrompt = (now.getTime() - meta.lastPromptAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastPrompt < this.cooldown.minHoursBetweenPrompts) return false;
    }

    // Max prompts per month
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (meta.monthKey === currentMonthKey && meta.promptsThisMonth >= this.cooldown.maxPromptsPerMonth) {
      return false;
    }

    // NPS-specific: max once per npsIntervalDays
    if (promptType === 'nps' && meta.lastNPSAt) {
      const daysSinceNPS = (now.getTime() - meta.lastNPSAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceNPS < this.cooldown.npsIntervalDays) return false;
    }

    // Consecutive dismissals → back off
    if (await this.shouldBackOff(userId)) return false;

    // Do-not-disturb: respect hours 22:00-08:00 (simplified, ideally use user TZ)
    if (this.cooldown.respectDoNotDisturb) {
      const hour = now.getUTCHours();
      if (hour >= 22 || hour < 8) return false;
    }

    return true;
  }

  // ── Backoff Logic ───────────────────────────────────────────────────

  async shouldBackOff(userId: string): Promise<boolean> {
    const meta = await this.store.getSentimentMeta(userId);
    if (!meta) return false;

    // 3 consecutive dismissals → stop for 30 days
    if (meta.consecutiveDismissals >= 3) return true;

    // 3 consecutive negative (😤 / 1-star) → stop for 60 days
    if (meta.consecutiveNegative >= 3) return true;

    // New user: active < 3 days
    if (meta.firstActiveAt) {
      const days = (Date.now() - meta.firstActiveAt.getTime()) / (1000 * 60 * 60 * 24);
      if (days < 3) return true;
    }

    return false;
  }

  // ── Record prompt shown ─────────────────────────────────────────────

  async recordPromptShown(userId: string, promptId: string, promptType: PromptType): Promise<void> {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const meta = await this.store.getSentimentMeta(userId) || this.defaultMeta(userId);

    meta.lastPromptAt = now;
    if (promptType === 'nps') meta.lastNPSAt = now;
    if (meta.monthKey === monthKey) {
      meta.promptsThisMonth++;
    } else {
      meta.monthKey = monthKey;
      meta.promptsThisMonth = 1;
    }

    await this.store.setSentimentMeta(meta);
  }

  // ── Record response ─────────────────────────────────────────────────

  async recordResponse(response: SentimentResponse): Promise<void> {
    await this.store.saveResponse(response);

    // Update meta
    const meta = await this.store.getSentimentMeta(response.userId) || this.defaultMeta(response.userId);

    if (response.dismissed) {
      meta.consecutiveDismissals++;
      meta.totalDismissals++;
      // If 3 consecutive dismissals, set 30-day backoff
      if (meta.consecutiveDismissals >= 3) {
        meta.backoffUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
    } else {
      meta.consecutiveDismissals = 0;
      meta.totalResponses++;

      // Track consecutive negative
      const isNegative =
        (response.reaction && REACTION_SCORES[response.reaction] <= 1) ||
        (response.rating !== undefined && response.rating <= 1) ||
        (response.npsScore !== undefined && response.npsScore <= 3);

      if (isNegative) {
        meta.consecutiveNegative++;
        if (meta.consecutiveNegative >= 3) {
          meta.backoffUntil = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        }
      } else {
        meta.consecutiveNegative = 0;
      }
    }

    await this.store.setSentimentMeta(meta);

    // Feed to experiment engine if experiment context present
    if (response.experimentId && this.experimentSink && !response.dismissed) {
      const score = response.reactionScore ?? response.rating ?? response.npsScore ?? 3;
      const sentiment = score >= 4 ? 'positive' : score >= 3 ? 'neutral' : 'negative';
      await this.experimentSink.submitFeedback({
        experimentId: response.experimentId,
        userId: response.userId,
        type: response.promptType === 'nps' ? 'nps' : 'in_app_feedback',
        sentiment,
        score,
        comment: response.comment,
      });
    }

    // NPS detractor with comment → auto-create support ticket
    if (
      response.npsScore !== undefined &&
      npsCategory(response.npsScore) === 'detractor' &&
      response.comment
    ) {
      await this.store.createSupportTicket(
        response.userId,
        response.appId,
        response.comment,
        response.npsScore,
      );
    }
  }

  // ── Smart Trigger: call after user actions ──────────────────────────

  async onUserAction(
    userId: string,
    appId: string,
    action: string,
    metadata?: Record<string, any>,
  ): Promise<SentimentPrompt | null> {
    const rule = ACTION_TRIGGERS.find(t => t.action === action);
    if (!rule) return null;

    // Check minimum occurrences
    if (rule.minOccurrences) {
      const count = await this.store.getUserActionCountForType(userId, appId, action);
      if (count < rule.minOccurrences) return null;
    }

    // Check if we should prompt
    if (!(await this.shouldPrompt(userId, appId, rule.promptType))) return null;

    const prompt: SentimentPrompt = {
      id: uuidv4(),
      type: rule.promptType,
      trigger: {
        kind: 'after_action',
        action,
        experimentId: metadata?.experimentId,
      },
      cooldown: this.cooldown,
    };

    // Record that we showed the prompt
    await this.recordPromptShown(userId, prompt.id, rule.promptType);

    return prompt;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private defaultMeta(userId: string): SentimentMeta {
    const now = new Date();
    return {
      userId,
      promptsThisMonth: 0,
      monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      totalResponses: 0,
      totalDismissals: 0,
      consecutiveDismissals: 0,
      consecutiveNegative: 0,
      firstActiveAt: now,
    };
  }
}
