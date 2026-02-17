import { ExperimentReporter, ExperimentListStore } from '../src/reports';
import { ExperimentEngine, ExperimentStore } from '../src/engine';
import {
  Experiment,
  ExperimentEvent,
  FeedbackSignal,
  UserAssignment,
  DecisionLog,
  AppId,
} from '../src/models';

class MockReportStore implements ExperimentStore & ExperimentListStore {
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
  async setAssignment(a: UserAssignment) { this.assignments.set(`${a.experimentId}:${a.userId}`, a); }
  async addEvent(e: ExperimentEvent) { this.events.push(e); }
  async addEvents(events: ExperimentEvent[]) { this.events.push(...events); }
  async getEvents(experimentId: string, metricId?: string) {
    return this.events.filter(e => e.experimentId === experimentId && (!metricId || e.metricId === metricId));
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
  async listExperiments(filters?: { appId?: AppId }) {
    let exps = Array.from(this.experiments.values());
    if (filters?.appId) exps = exps.filter(e => e.appId === filters.appId);
    return exps;
  }
}

function makeExperiment(id: string, status: string = 'running'): Experiment {
  return {
    id,
    name: `Experiment ${id}`,
    hypothesis: 'Test',
    appId: 'fitness',
    status: status as any,
    cohort: { type: 'percentage', percentage: 100 },
    variants: [
      { id: 'control', name: 'control', weight: 50, featureFlags: {} },
      { id: 'treatment', name: 'treatment_a', weight: 50, featureFlags: {} },
    ],
    metrics: [
      { id: 'completion', name: 'Completion', type: 'conversion', aggregation: 'rate', direction: 'increase' },
    ],
    guardrails: [],
    successCriteria: [],
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    minSampleSize: 1,
    minDuration: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('ExperimentReporter', () => {
  let store: MockReportStore;
  let engine: ExperimentEngine;
  let reporter: ExperimentReporter;

  beforeEach(() => {
    store = new MockReportStore();
    engine = new ExperimentEngine(store);
    reporter = new ExperimentReporter(store, engine);
  });

  describe('generateReport', () => {
    it('generates a complete report', async () => {
      const exp = makeExperiment('exp-1');
      store.experiments.set(exp.id, exp);

      // Add some events
      for (let i = 0; i < 20; i++) {
        store.events.push({
          id: `e${i}`, experimentId: 'exp-1', userId: `u${i}`,
          variantId: i < 10 ? 'control' : 'treatment',
          metricId: 'completion', value: i < 10 ? 0.5 : 0.7,
          timestamp: new Date(),
        });
      }

      const report = await reporter.generateReport('exp-1');
      expect(report.experiment.id).toBe('exp-1');
      expect(report.variants.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBeDefined();
      expect(['all_green', 'warning', 'breached']).toContain(report.guardrailStatus);
    });

    it('includes feedback summary', async () => {
      const exp = makeExperiment('exp-1');
      store.experiments.set(exp.id, exp);

      store.feedback.push({
        experimentId: 'exp-1', variant: 'treatment', userId: 'u1',
        type: 'rating', sentiment: 'positive', score: 5, message: 'Great feature!',
        timestamp: new Date(),
      });

      const report = await reporter.generateReport('exp-1');
      const treatmentFeedback = report.feedbackSummary.find(f => f.variant === 'treatment');
      expect(treatmentFeedback?.totalFeedback).toBe(1);
      expect(treatmentFeedback?.sentimentBreakdown.positive).toBe(1);
    });
  });

  describe('generatePortfolioReport', () => {
    it('calculates win rate', async () => {
      store.experiments.set('e1', makeExperiment('e1', 'completed'));
      store.experiments.get('e1')!.decision = 'roll_forward';
      store.experiments.get('e1')!.decisionAt = new Date();

      store.experiments.set('e2', makeExperiment('e2', 'rolled_back'));
      store.experiments.get('e2')!.decision = 'roll_back';
      store.experiments.get('e2')!.decisionAt = new Date();

      const report = await reporter.generatePortfolioReport('fitness');
      expect(report.totalExperiments).toBe(2);
      expect(report.winRate).toBe(0.5);
    });
  });

  describe('generateImpactReport', () => {
    it('generates impact report', async () => {
      store.experiments.set('e1', makeExperiment('e1', 'completed'));
      store.experiments.get('e1')!.decision = 'roll_forward';

      const report = await reporter.generateImpactReport('fitness', 3);
      expect(report.appId).toBe('fitness');
      expect(report.months).toBe(3);
      expect(report.generatedAt).toBeDefined();
    });
  });
});
