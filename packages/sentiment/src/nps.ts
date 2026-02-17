import { v4 as uuidv4 } from 'uuid';
import {
  NPSPromptConfig,
  NPSResult,
  ExperimentNPS,
  SentimentResponse,
  DateRange,
  npsCategory,
} from './models';
import { SentimentStore } from './collector';

// ─── NPS Store Extension ────────────────────────────────────────────────────

export interface NPSStore extends SentimentStore {
  getNPSResponses(appId: string, dateRange?: DateRange): Promise<SentimentResponse[]>;
  getNPSResponsesByExperiment(experimentId: string): Promise<SentimentResponse[]>;
  getUserDaysSinceInstall(userId: string): Promise<number>;
  getUserMeaningfulActionCount(userId: string, appId: string): Promise<number>;
  getLastNPSDate(userId: string): Promise<Date | null>;
}

// ─── App Display Names ──────────────────────────────────────────────────────

const APP_NAMES: Record<string, string> = {
  fitness: 'Claw Fitness',
  nutrition: 'Claw Nutrition',
  budget: 'Claw Budget',
  meetings: 'Claw Meetings',
};

// ─── NPS Service ────────────────────────────────────────────────────────────

export class NPSService {
  constructor(private store: NPSStore) {}

  // ── Trigger NPS (quarterly, high-value moments only) ────────────────

  async triggerNPS(userId: string, appId: string): Promise<NPSPromptConfig | null> {
    // Only after 30+ days of use
    const daysSinceInstall = await this.store.getUserDaysSinceInstall(userId);
    if (daysSinceInstall < 30) return null;

    // Only after 10+ meaningful actions
    const actionCount = await this.store.getUserMeaningfulActionCount(userId, appId);
    if (actionCount < 10) return null;

    // Max once per 90 days
    const lastNPS = await this.store.getLastNPSDate(userId);
    if (lastNPS) {
      const daysSince = (Date.now() - lastNPS.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 90) return null;
    }

    const appName = APP_NAMES[appId] || appId;

    return {
      promptId: uuidv4(),
      appName,
      followUpPrompts: {
        promoter: 'What do you love most?',
        passive: 'What would make it a 10?',
        detractor: 'What can we do better?',
      },
    };
  }

  // ── Calculate NPS score ─────────────────────────────────────────────

  async calculateNPS(appId: string, dateRange?: DateRange): Promise<NPSResult> {
    const responses = await this.store.getNPSResponses(appId, dateRange);
    const npsResponses = responses.filter(r => r.npsScore !== undefined && !r.dismissed);

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const r of npsResponses) {
      const cat = npsCategory(r.npsScore!);
      if (cat === 'promoter') promoters++;
      else if (cat === 'passive') passives++;
      else detractors++;
    }

    const total = npsResponses.length;
    const score = total > 0
      ? Math.round(((promoters - detractors) / total) * 100)
      : 0;

    return {
      appId,
      score,
      promoters,
      passives,
      detractors,
      totalResponses: total,
      dateRange: dateRange ? { start: dateRange.start, end: dateRange.end } : undefined,
    };
  }

  // ── NPS as experiment metric ────────────────────────────────────────

  async getNPSForExperiment(experimentId: string): Promise<ExperimentNPS> {
    const responses = await this.store.getNPSResponsesByExperiment(experimentId);
    const byVariant = new Map<string, number[]>();

    for (const r of responses) {
      if (r.npsScore === undefined || r.dismissed || !r.variant) continue;
      if (!byVariant.has(r.variant)) byVariant.set(r.variant, []);
      byVariant.get(r.variant)!.push(r.npsScore);
    }

    const variants: { variantId: string; nps: number; count: number }[] = [];
    for (const [variantId, scores] of byVariant) {
      const promoters = scores.filter(s => s >= 9).length;
      const detractors = scores.filter(s => s <= 6).length;
      const nps = scores.length > 0
        ? Math.round(((promoters - detractors) / scores.length) * 100)
        : 0;
      variants.push({ variantId, nps, count: scores.length });
    }

    // Calculate delta between first two variants (control vs treatment)
    const delta = variants.length >= 2 ? variants[1].nps - variants[0].nps : 0;
    const isSignificant = variants.every(v => v.count >= 30) && Math.abs(delta) >= 10;

    return { experimentId, variants, delta, isSignificant };
  }
}
