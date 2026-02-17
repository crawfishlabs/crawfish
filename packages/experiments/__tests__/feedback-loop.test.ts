import { FeedbackLoop, FeedbackLoopStore } from '../src/feedback-loop';
import { ExperimentEngine, ExperimentStore } from '../src/engine';
import {
  Experiment,
  ExperimentEvent,
  FeedbackSignal,
  UserAssignment,
  DecisionLog,
  AppId,
} from '../src/models';

// ─── In-Memory Store ────────────────────────────────────────────────────────

class MockStore implements FeedbackLoopStore {
  experiments: Map<string, Experiment> = new Map();
  assignments: Map<string, UserAssignment> = new Map();
  events: ExperimentEvent[] = [];
  feedback: FeedbackSignal[] = [];
  decisions: DecisionLog[] = [];
  featureFlags: Record<string, any> = {};

  async getExperiment(id: string) { return this.experiments.get(id) ?? null; }
  async updateExperiment(id: string, data: Partial<Experiment>) {
    const exp = this.experiments.get(id);
    if (exp) this.experiments.set(id, { ...exp, ...data } as Experiment);
  }
  async getAssignment(experimentId: string, userId: string) {
    return this.assignments.get(`${experimentId}:${userId}`) ?? null;
  }
  async setAssignment(a: UserAssignment) {
    this.assignments.set(`${a.experimentId}:${a.userId}`, a);
  }
  async addEvent(e: ExperimentEvent) { this.events.push(e); }
  async addEvents(events: ExperimentEvent[]) { this.events.push(...events); }
  async getEvents(experimentId: string) {
    return this.events.filter(e => e.experimentId === experimentId);
  }
  async getEventsByVariant(experimentId: string, variantId: string) {
    return this.events.filter(e => e.experimentId === experimentId && e.variantId === variantId);
  }
  async addFeedback(s: FeedbackSignal) { this.feedback.push(s); }
  async getFeedback(experimentId: string) { return this.feedback.filter(f => f.experimentId === experimentId); }
  async addDecisionLog(log: DecisionLog) { this.decisions.push(log); }
  async getUserSegments() { return []; }
  async getActiveExperimentsForUser(userId: string) {
    return Array.from(this.assignments.values()).filter(a => a.userId === userId);
  }
  async setFeatureFlags(flags: Record<string, any>) { this.featureFlags = flags; }
  async getFeatureFlags() { return this.featureFlags; }

  async getRunningExperimentsForApp(appId: AppId) {
    return Array.from(this.experiments.values()).filter(e => e.appId === appId && e.status === 'running');
  }
  async getAssignmentsByUser(userId: string) {
    return Array.from(this.assignments.values())
      .filter(a => a.userId === userId)
      .map(a => ({ experimentId: a.experimentId, variantId: a.variantId }));
  }
}

function makeExperiment(id: string, appId: AppId = 'fitness'): Experiment {
  return {
    id,
    name: `Test ${id}`,
    hypothesis: 'Test',
    appId,
    status: 'running',
    cohort: { type: 'percentage', percentage: 100 },
    variants: [
      { id: 'control', name: 'control', weight: 50, featureFlags: {} },
      { id: 'treatment', name: 'treatment_a', weight: 50, featureFlags: {} },
    ],
    metrics: [],
    guardrails: [],
    successCriteria: [],
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    minSampleSize: 10,
    minDuration: 24,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('FeedbackLoop', () => {
  let store: MockStore;
  let engine: ExperimentEngine;
  let loop: FeedbackLoop;

  beforeEach(() => {
    store = new MockStore();
    engine = new ExperimentEngine(store);
    loop = new FeedbackLoop(store, engine);
  });

  describe('onTicketCreated', () => {
    it('links ticket to active experiment', async () => {
      const exp = makeExperiment('exp-1', 'fitness');
      store.experiments.set(exp.id, exp);
      store.assignments.set('exp-1:user-1', {
        experimentId: 'exp-1', userId: 'user-1', variantId: 'treatment', assignedAt: new Date(),
      });

      await loop.onTicketCreated({
        id: 'ticket-1', userId: 'user-1', appId: 'fitness',
        subject: 'App crashes on startup', body: 'The app keeps crashing', createdAt: new Date(),
      });

      expect(store.feedback).toHaveLength(1);
      expect(store.feedback[0].experimentId).toBe('exp-1');
      expect(store.feedback[0].sentiment).toBe('negative');
    });

    it('ignores tickets from users not in experiments', async () => {
      await loop.onTicketCreated({
        id: 'ticket-1', userId: 'no-exp-user', appId: 'fitness',
        subject: 'Question', body: 'How do I use this?', createdAt: new Date(),
      });

      expect(store.feedback).toHaveLength(0);
    });

    it('ignores experiments from different apps', async () => {
      const exp = makeExperiment('exp-1', 'budget');
      store.experiments.set(exp.id, exp);
      store.assignments.set('exp-1:user-1', {
        experimentId: 'exp-1', userId: 'user-1', variantId: 'treatment', assignedAt: new Date(),
      });

      await loop.onTicketCreated({
        id: 'ticket-1', userId: 'user-1', appId: 'fitness',
        subject: 'Bug', body: 'Something broke', createdAt: new Date(),
      });

      expect(store.feedback).toHaveLength(0);
    });
  });

  describe('onRatingReceived', () => {
    it('creates positive feedback for high rating', async () => {
      const exp = makeExperiment('exp-1');
      store.experiments.set(exp.id, exp);
      store.assignments.set('exp-1:user-1', {
        experimentId: 'exp-1', userId: 'user-1', variantId: 'treatment', assignedAt: new Date(),
      });

      await loop.onRatingReceived('user-1', 'fitness', 5, 'Love it!');

      expect(store.feedback).toHaveLength(1);
      expect(store.feedback[0].sentiment).toBe('positive');
      expect(store.feedback[0].score).toBe(5);
    });

    it('creates negative feedback for low rating', async () => {
      const exp = makeExperiment('exp-1');
      store.experiments.set(exp.id, exp);
      store.assignments.set('exp-1:user-1', {
        experimentId: 'exp-1', userId: 'user-1', variantId: 'control', assignedAt: new Date(),
      });

      await loop.onRatingReceived('user-1', 'fitness', 1, 'Terrible');

      expect(store.feedback[0].sentiment).toBe('negative');
    });
  });

  describe('onChurnDetected', () => {
    it('creates churn feedback signal and tracks event', async () => {
      const exp = makeExperiment('exp-1');
      store.experiments.set(exp.id, exp);
      store.assignments.set('exp-1:user-1', {
        experimentId: 'exp-1', userId: 'user-1', variantId: 'treatment', assignedAt: new Date(),
      });

      await loop.onChurnDetected('user-1', 'fitness');

      expect(store.feedback).toHaveLength(1);
      expect(store.feedback[0].type).toBe('churn');
      expect(store.feedback[0].sentiment).toBe('negative');

      // Also check that a metric event was tracked
      expect(store.events).toHaveLength(1);
      expect(store.events[0].metricId).toBe('churn_event');
    });
  });

  describe('analyzeFeedbackImpact', () => {
    it('detects worse sentiment in treatment variant', async () => {
      const exp = makeExperiment('exp-1');
      store.experiments.set(exp.id, exp);

      // Add feedback: control is fine, treatment is negative
      for (let i = 0; i < 15; i++) {
        store.feedback.push({
          experimentId: 'exp-1', variant: 'control', userId: `u${i}`,
          type: 'rating', sentiment: i < 12 ? 'positive' : 'neutral', timestamp: new Date(),
        });
        store.feedback.push({
          experimentId: 'exp-1', variant: 'treatment', userId: `t${i}`,
          type: 'rating', sentiment: i < 5 ? 'negative' : 'neutral', timestamp: new Date(),
        });
      }

      const result = await loop.analyzeFeedbackImpact('exp-1');
      expect(result.significantDifference).toBe(true);
      expect(result.warningVariants).toContain('treatment');
    });
  });
});
