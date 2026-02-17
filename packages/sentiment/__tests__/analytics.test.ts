import { SentimentAnalytics, AnalyticsStore } from '../src/analytics';
import { SentimentResponse, Reaction } from '../src/models';

function createMockAnalyticsStore(overrides: Partial<AnalyticsStore> = {}): AnalyticsStore {
  return {
    getResponses: jest.fn().mockResolvedValue([]),
    getResponsesByFeature: jest.fn().mockResolvedValue([]),
    getResponsesByExperiment: jest.fn().mockResolvedValue([]),
    getPromptsShownCount: jest.fn().mockResolvedValue(100),
    extractThemes: jest.fn().mockResolvedValue(['great UX', 'fast']),
    ...overrides,
  };
}

function makeResponse(overrides: Partial<SentimentResponse> = {}): SentimentResponse {
  return {
    id: `r-${Math.random()}`,
    userId: 'user1',
    appId: 'fitness',
    promptType: 'micro_reaction',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('SentimentAnalytics', () => {
  describe('getAppSentiment', () => {
    it('computes averages and distribution', async () => {
      const responses: SentimentResponse[] = [
        makeResponse({ reaction: '😍' as Reaction, reactionScore: 5 }),
        makeResponse({ reaction: '🙂' as Reaction, reactionScore: 4 }),
        makeResponse({ reaction: '😐' as Reaction, reactionScore: 3 }),
        makeResponse({ reaction: '😕' as Reaction, reactionScore: 2 }),
        makeResponse({ reaction: '😤' as Reaction, reactionScore: 1 }),
        makeResponse({ dismissed: true }), // dismissed
      ];

      const store = createMockAnalyticsStore({
        getResponses: jest.fn().mockResolvedValue(responses),
        getPromptsShownCount: jest.fn().mockResolvedValue(10),
      });
      const analytics = new SentimentAnalytics(store);

      const result = await analytics.getAppSentiment('fitness');
      expect(result.avgReactionScore).toBe(3);
      expect(result.reactionDistribution['😍']).toBe(1);
      expect(result.reactionDistribution['😤']).toBe(1);
      expect(result.responseRate).toBe(0.5); // 5 non-dismissed / 10 shown
      expect(result.dismissRate).toBe(0.1);  // 1 dismissed / 10 shown
    });
  });

  describe('getSentimentForExperiment', () => {
    it('compares variants', async () => {
      const responses: SentimentResponse[] = [
        // Control: high scores
        ...Array(5).fill(null).map(() => makeResponse({ variant: 'control', reactionScore: 5, reaction: '😍' as Reaction })),
        // Treatment: low scores
        ...Array(5).fill(null).map(() => makeResponse({ variant: 'treatment', reactionScore: 2, reaction: '😕' as Reaction })),
      ];

      const store = createMockAnalyticsStore({
        getResponsesByExperiment: jest.fn().mockResolvedValue(responses),
      });
      const analytics = new SentimentAnalytics(store);

      const report = await analytics.getSentimentForExperiment('exp1');
      expect(report.variants).toHaveLength(2);

      const control = report.variants.find(v => v.variantId === 'control')!;
      const treatment = report.variants.find(v => v.variantId === 'treatment')!;
      expect(control.avgReaction).toBe(5);
      expect(treatment.avgReaction).toBe(2);
      expect(report.sentimentDelta).toBe(-3);
    });
  });

  describe('sentimentGuardrail', () => {
    it('returns breach when NPS delta > 10', async () => {
      // Control: all promoters, Treatment: all detractors
      const responses: SentimentResponse[] = [
        ...Array(30).fill(null).map(() => makeResponse({
          variant: 'control', promptType: 'nps', npsScore: 10,
        })),
        ...Array(30).fill(null).map(() => makeResponse({
          variant: 'treatment', promptType: 'nps', npsScore: 3,
        })),
      ];

      const store = createMockAnalyticsStore({
        getResponsesByExperiment: jest.fn().mockResolvedValue(responses),
      });
      const analytics = new SentimentAnalytics(store);

      const results = await analytics.sentimentGuardrail('exp1');
      const breach = results.find(r => r.status === 'breach');
      expect(breach).toBeDefined();
      expect(breach!.metricId).toBe('nps_score');
    });

    it('returns green when everything is fine', async () => {
      const responses: SentimentResponse[] = [
        ...Array(5).fill(null).map(() => makeResponse({ variant: 'control', reactionScore: 4, reaction: '🙂' as Reaction })),
        ...Array(5).fill(null).map(() => makeResponse({ variant: 'treatment', reactionScore: 4, reaction: '🙂' as Reaction })),
      ];

      const store = createMockAnalyticsStore({
        getResponsesByExperiment: jest.fn().mockResolvedValue(responses),
      });
      const analytics = new SentimentAnalytics(store);

      const results = await analytics.sentimentGuardrail('exp1');
      expect(results[0].status).toBe('green');
    });
  });
});
