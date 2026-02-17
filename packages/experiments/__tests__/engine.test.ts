import { ExperimentEngine, ExperimentStore } from '../src/engine';
import {
  Experiment,
  Variant,
  ExperimentEvent,
  FeedbackSignal,
  UserAssignment,
  DecisionLog,
} from '../src/models';

// ─── In-Memory Store ────────────────────────────────────────────────────────

class InMemoryStore implements ExperimentStore {
  experiments: Map<string, Experiment> = new Map();
  assignments: Map<string, UserAssignment> = new Map();
  events: ExperimentEvent[] = [];
  feedback: FeedbackSignal[] = [];
  decisions: DecisionLog[] = [];
  userSegments: Map<string, string[]> = new Map();
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
  async getEvents(experimentId: string, metricId?: string) {
    return this.events.filter(e => e.experimentId === experimentId && (!metricId || e.metricId === metricId));
  }
  async getEventsByVariant(experimentId: string, variantId: string, metricId?: string) {
    return this.events.filter(e => e.experimentId === experimentId && e.variantId === variantId && (!metricId || e.metricId === metricId));
  }
  async addFeedback(s: FeedbackSignal) { this.feedback.push(s); }
  async getFeedback(experimentId: string) { return this.feedback.filter(f => f.experimentId === experimentId); }
  async addDecisionLog(log: DecisionLog) { this.decisions.push(log); }
  async getUserSegments(userId: string) { return this.userSegments.get(userId) ?? []; }
  async getActiveExperimentsForUser(userId: string) {
    return Array.from(this.assignments.values()).filter(a => a.userId === userId);
  }
  async setFeatureFlags(flags: Record<string, any>) { this.featureFlags = { ...this.featureFlags, ...flags }; }
  async getFeatureFlags() { return this.featureFlags; }
}

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-1',
    name: 'Test Experiment',
    hypothesis: 'Users will engage more with new feature',
    appId: 'fitness',
    status: 'running',
    cohort: { type: 'percentage', percentage: 100 },
    variants: [
      { id: 'control', name: 'control', weight: 50, featureFlags: { new_feature: false } },
      { id: 'treatment', name: 'treatment_a', weight: 50, featureFlags: { new_feature: true } },
    ],
    metrics: [
      { id: 'completion_rate', name: 'Completion Rate', type: 'conversion', aggregation: 'rate', direction: 'increase' },
    ],
    guardrails: [
      { metricId: 'error_rate', threshold: 0.05, comparison: 'lt', description: 'Error rate < 5%', action: 'rollback' },
    ],
    successCriteria: [
      { metricId: 'completion_rate', minLift: 0.05, confidence: 0.95 },
    ],
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    minSampleSize: 10,
    minDuration: 24,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ExperimentEngine', () => {
  let store: InMemoryStore;
  let engine: ExperimentEngine;

  beforeEach(() => {
    store = new InMemoryStore();
    engine = new ExperimentEngine(store);
  });

  describe('assignUser', () => {
    it('assigns user to a variant deterministically', async () => {
      const exp = makeExperiment();
      store.experiments.set(exp.id, exp);

      const v1 = await engine.assignUser(exp.id, 'user-1');
      const v2 = await engine.assignUser(exp.id, 'user-1');

      expect(v1.id).toBe(v2.id); // sticky
    });

    it('returns control for excluded users', async () => {
      const exp = makeExperiment({
        cohort: { type: 'percentage', percentage: 100, excludeList: ['excluded-user'] },
      });
      store.experiments.set(exp.id, exp);

      const variant = await engine.assignUser(exp.id, 'excluded-user');
      expect(variant.name).toBe('control');
    });

    it('respects percentage cohort', async () => {
      const exp = makeExperiment({
        cohort: { type: 'percentage', percentage: 0 }, // 0% = nobody in
      });
      store.experiments.set(exp.id, exp);

      const variant = await engine.assignUser(exp.id, 'user-1');
      expect(variant.name).toBe('control');
    });

    it('respects allowlist cohort', async () => {
      const exp = makeExperiment({
        cohort: { type: 'allowlist', allowlist: ['allowed-user'] },
      });
      store.experiments.set(exp.id, exp);

      const allowed = await engine.assignUser(exp.id, 'allowed-user');
      const notAllowed = await engine.assignUser(exp.id, 'other-user');

      // Allowed user gets a real variant, not-allowed gets control
      expect(notAllowed.name).toBe('control');
    });

    it('respects segment cohort', async () => {
      const exp = makeExperiment({
        cohort: { type: 'segment', segments: ['pro_users'] },
      });
      store.experiments.set(exp.id, exp);
      store.userSegments.set('pro-user', ['pro_users']);
      store.userSegments.set('free-user', ['free_users']);

      const proVariant = await engine.assignUser(exp.id, 'pro-user');
      const freeVariant = await engine.assignUser(exp.id, 'free-user');

      expect(freeVariant.name).toBe('control');
    });
  });

  describe('trackEvent', () => {
    it('records events for assigned users', async () => {
      const exp = makeExperiment();
      store.experiments.set(exp.id, exp);
      await engine.assignUser(exp.id, 'user-1');

      await engine.trackEvent(exp.id, 'user-1', 'completion_rate', 1);
      expect(store.events).toHaveLength(1);
      expect(store.events[0].metricId).toBe('completion_rate');
    });

    it('ignores events for unassigned users', async () => {
      const exp = makeExperiment();
      store.experiments.set(exp.id, exp);

      await engine.trackEvent(exp.id, 'unknown-user', 'completion_rate', 1);
      expect(store.events).toHaveLength(0);
    });
  });

  describe('evaluateExperiment', () => {
    it('returns insufficient_data when sample is too small', async () => {
      const exp = makeExperiment({ minSampleSize: 1000 });
      store.experiments.set(exp.id, exp);

      const evaluation = await engine.evaluateExperiment(exp.id);
      expect(evaluation.recommendation).toBe('insufficient_data');
    });

    it('detects guardrail breach', async () => {
      const exp = makeExperiment({
        guardrails: [
          { metricId: 'error_rate', threshold: 0.05, comparison: 'gt', description: 'Error rate > 5%', action: 'rollback' },
        ],
        minSampleSize: 1,
      });
      store.experiments.set(exp.id, exp);

      // Assign and track high error rate for treatment
      await engine.assignUser(exp.id, 'user-1');
      const assignment = await store.getAssignment(exp.id, 'user-1');

      // Manually inject events with treatment variant having high error
      store.events.push({
        id: 'e1', experimentId: exp.id, userId: 'user-1',
        variantId: 'treatment', metricId: 'error_rate', value: 0.1, timestamp: new Date(),
      });

      const evaluation = await engine.evaluateExperiment(exp.id);
      expect(evaluation.guardrailStatus).toBe('breached');
    });
  });

  describe('rollForward', () => {
    it('marks experiment as completed', async () => {
      const exp = makeExperiment();
      store.experiments.set(exp.id, exp);

      await engine.rollForward(exp.id, 'treatment');
      const updated = await store.getExperiment(exp.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.decision).toBe('roll_forward');
    });
  });

  describe('rollBack', () => {
    it('marks experiment as rolled_back', async () => {
      const exp = makeExperiment();
      store.experiments.set(exp.id, exp);

      await engine.rollBack(exp.id, 'Test rollback');
      const updated = await store.getExperiment(exp.id);
      expect(updated?.status).toBe('rolled_back');
      expect(updated?.decision).toBe('roll_back');
    });
  });

  describe('graduateRollout', () => {
    it('updates cohort percentage', async () => {
      const exp = makeExperiment({ cohort: { type: 'percentage', percentage: 10 } });
      store.experiments.set(exp.id, exp);

      await engine.graduateRollout(exp.id, 25);
      const updated = await store.getExperiment(exp.id);
      expect(updated?.cohort.percentage).toBe(25);
    });

    it('rejects invalid percentages', async () => {
      const exp = makeExperiment();
      store.experiments.set(exp.id, exp);

      await expect(engine.graduateRollout(exp.id, 150)).rejects.toThrow();
    });
  });
});
