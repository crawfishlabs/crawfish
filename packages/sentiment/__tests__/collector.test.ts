import { SentimentCollector, SentimentStore, ExperimentFeedbackSink } from '../src/collector';
import { SentimentMeta, SentimentResponse, CooldownConfig, DEFAULT_COOLDOWN } from '../src/models';

// ─── Mock Store ─────────────────────────────────────────────────────────────

function createMockStore(meta: SentimentMeta | null = null): SentimentStore {
  return {
    getSentimentMeta: jest.fn().mockResolvedValue(meta),
    setSentimentMeta: jest.fn().mockResolvedValue(undefined),
    saveResponse: jest.fn().mockResolvedValue(undefined),
    getRecentResponses: jest.fn().mockResolvedValue([]),
    getUserActionCount: jest.fn().mockResolvedValue(10),
    getUserActionCountForType: jest.fn().mockResolvedValue(5),
    createSupportTicket: jest.fn().mockResolvedValue(undefined),
  };
}

function activeMeta(overrides: Partial<SentimentMeta> = {}): SentimentMeta {
  return {
    userId: 'user1',
    promptsThisMonth: 0,
    monthKey: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    totalResponses: 5,
    totalDismissals: 0,
    consecutiveDismissals: 0,
    consecutiveNegative: 0,
    firstActiveAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SentimentCollector', () => {
  describe('shouldPrompt', () => {
    it('allows first-time users (no meta)', async () => {
      const collector = new SentimentCollector(createMockStore(null));
      expect(await collector.shouldPrompt('user1', 'fitness', 'micro_reaction')).toBe(true);
    });

    it('blocks users active < 3 days', async () => {
      const meta = activeMeta({ firstActiveAt: new Date() }); // just now
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldPrompt('user1', 'fitness', 'micro_reaction')).toBe(false);
    });

    it('respects cooldown between prompts', async () => {
      const meta = activeMeta({ lastPromptAt: new Date() }); // just now
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldPrompt('user1', 'fitness', 'micro_reaction')).toBe(false);
    });

    it('allows prompt after cooldown expires', async () => {
      const meta = activeMeta({
        lastPromptAt: new Date(Date.now() - 200 * 60 * 60 * 1000), // 200 hours ago
      });
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldPrompt('user1', 'fitness', 'micro_reaction')).toBe(true);
    });

    it('blocks when max prompts per month reached', async () => {
      const now = new Date();
      const meta = activeMeta({
        promptsThisMonth: 3,
        monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      });
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldPrompt('user1', 'fitness', 'micro_reaction')).toBe(false);
    });

    it('blocks NPS within 90-day interval', async () => {
      const meta = activeMeta({
        lastNPSAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      });
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldPrompt('user1', 'fitness', 'nps')).toBe(false);
    });

    it('allows NPS after 90 days', async () => {
      const meta = activeMeta({
        lastNPSAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 100 days ago
        lastPromptAt: new Date(Date.now() - 200 * 60 * 60 * 1000),
      });
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldPrompt('user1', 'fitness', 'nps')).toBe(true);
    });

    it('respects backoff from consecutive dismissals', async () => {
      const meta = activeMeta({ consecutiveDismissals: 3 });
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldPrompt('user1', 'fitness', 'micro_reaction')).toBe(false);
    });

    it('respects backoffUntil date', async () => {
      const meta = activeMeta({
        backoffUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
      });
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldPrompt('user1', 'fitness', 'micro_reaction')).toBe(false);
    });
  });

  describe('shouldBackOff', () => {
    it('backs off after 3 consecutive dismissals', async () => {
      const meta = activeMeta({ consecutiveDismissals: 3 });
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldBackOff('user1')).toBe(true);
    });

    it('backs off after 3 consecutive negative reactions', async () => {
      const meta = activeMeta({ consecutiveNegative: 3 });
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldBackOff('user1')).toBe(true);
    });

    it('does not back off for healthy user', async () => {
      const meta = activeMeta();
      const collector = new SentimentCollector(createMockStore(meta));
      expect(await collector.shouldBackOff('user1')).toBe(false);
    });
  });

  describe('recordResponse', () => {
    it('resets consecutive dismissals on response', async () => {
      const meta = activeMeta({ consecutiveDismissals: 2 });
      const store = createMockStore(meta);
      const collector = new SentimentCollector(store);

      await collector.recordResponse({
        id: 'r1', userId: 'user1', appId: 'fitness',
        promptType: 'micro_reaction', reaction: '🙂', reactionScore: 4,
        timestamp: new Date(),
      });

      expect(store.setSentimentMeta).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveDismissals: 0 })
      );
    });

    it('increments dismissals on dismiss', async () => {
      const meta = activeMeta({ consecutiveDismissals: 1 });
      const store = createMockStore(meta);
      const collector = new SentimentCollector(store);

      await collector.recordResponse({
        id: 'r1', userId: 'user1', appId: 'fitness',
        promptType: 'micro_reaction', dismissed: true,
        timestamp: new Date(),
      });

      expect(store.setSentimentMeta).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveDismissals: 2 })
      );
    });

    it('creates support ticket for NPS detractor with comment', async () => {
      const store = createMockStore(activeMeta());
      const collector = new SentimentCollector(store);

      await collector.recordResponse({
        id: 'r1', userId: 'user1', appId: 'fitness',
        promptType: 'nps', npsScore: 3, npsCategory: 'detractor',
        comment: 'App is too slow',
        timestamp: new Date(),
      });

      expect(store.createSupportTicket).toHaveBeenCalledWith('user1', 'fitness', 'App is too slow', 3);
    });

    it('feeds experiment sink when experimentId present', async () => {
      const store = createMockStore(activeMeta());
      const sink: ExperimentFeedbackSink = { submitFeedback: jest.fn().mockResolvedValue(undefined) };
      const collector = new SentimentCollector(store, sink);

      await collector.recordResponse({
        id: 'r1', userId: 'user1', appId: 'fitness',
        promptType: 'micro_reaction', reaction: '😍', reactionScore: 5,
        experimentId: 'exp1', variant: 'treatment_a',
        timestamp: new Date(),
      });

      expect(sink.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({
        experimentId: 'exp1',
        userId: 'user1',
        sentiment: 'positive',
        score: 5,
      }));
    });
  });

  describe('onUserAction', () => {
    it('triggers micro_reaction after 3rd workout', async () => {
      const store = createMockStore(activeMeta({
        lastPromptAt: new Date(Date.now() - 200 * 60 * 60 * 1000),
      }));
      (store.getUserActionCountForType as jest.Mock).mockResolvedValue(5);
      const collector = new SentimentCollector(store);

      const prompt = await collector.onUserAction('user1', 'fitness', 'workout_completed');
      expect(prompt).not.toBeNull();
      expect(prompt!.type).toBe('micro_reaction');
    });

    it('returns null for unknown action', async () => {
      const collector = new SentimentCollector(createMockStore(activeMeta()));
      const prompt = await collector.onUserAction('user1', 'fitness', 'random_action');
      expect(prompt).toBeNull();
    });

    it('returns null when min occurrences not met', async () => {
      const store = createMockStore(activeMeta({
        lastPromptAt: new Date(Date.now() - 200 * 60 * 60 * 1000),
      }));
      (store.getUserActionCountForType as jest.Mock).mockResolvedValue(1); // < 3
      const collector = new SentimentCollector(store);

      const prompt = await collector.onUserAction('user1', 'fitness', 'workout_completed');
      expect(prompt).toBeNull();
    });
  });
});
