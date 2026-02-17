import { Router, Request, Response } from 'express';
import { ExperimentEngine, ExperimentStore } from './engine';
import { ExperimentReporter, ExperimentListStore } from './reports';
import { FeedbackLoop, FeedbackLoopStore } from './feedback-loop';
import { Experiment, AppId } from './models';

export interface RouteDeps {
  engine: ExperimentEngine;
  reporter: ExperimentReporter;
  feedbackLoop: FeedbackLoop;
  store: ExperimentStore & ExperimentListStore & FeedbackLoopStore;
}

export function createExperimentRoutes(deps: RouteDeps): Router {
  const router = Router();
  const { engine, reporter, feedbackLoop, store } = deps;

  // ── CRUD ────────────────────────────────────────────────────────────

  router.post('/experiments', async (req: Request, res: Response) => {
    try {
      const experiment: Experiment = {
        ...req.body,
        id: req.body.id || crypto.randomUUID(),
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Store via the store interface (caller must implement create)
      await (store as any).createExperiment(experiment);
      res.status(201).json({ experiment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/experiments', async (req: Request, res: Response) => {
    try {
      const filters: any = {};
      if (req.query.app) filters.appId = req.query.app as AppId;
      if (req.query.status) filters.status = req.query.status as string;
      const experiments = await store.listExperiments(filters);
      res.json({ experiments });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/experiments/portfolio', async (req: Request, res: Response) => {
    try {
      const appId = req.query.app as AppId | undefined;
      const report = await reporter.generatePortfolioReport(appId);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/experiments/impact', async (req: Request, res: Response) => {
    try {
      const appId = req.query.app as AppId;
      const months = parseInt(req.query.months as string) || 3;
      const report = await reporter.generateImpactReport(appId, months);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/experiments/:id', async (req: Request, res: Response) => {
    try {
      const experiment = await store.getExperiment(req.params.id);
      if (!experiment) return res.status(404).json({ error: 'Not found' });
      res.json({ experiment });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/experiments/:id', async (req: Request, res: Response) => {
    try {
      await store.updateExperiment(req.params.id, { ...req.body, updatedAt: new Date() });
      const experiment = await store.getExperiment(req.params.id);
      res.json({ experiment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  router.post('/experiments/:id/start', async (req: Request, res: Response) => {
    try {
      await store.updateExperiment(req.params.id, {
        status: 'running',
        startDate: new Date(),
        updatedAt: new Date(),
      });
      const experiment = await store.getExperiment(req.params.id);
      res.json({ experiment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/experiments/:id/pause', async (req: Request, res: Response) => {
    try {
      await store.updateExperiment(req.params.id, { status: 'paused', updatedAt: new Date() });
      const experiment = await store.getExperiment(req.params.id);
      res.json({ experiment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/experiments/:id/rollforward', async (req: Request, res: Response) => {
    try {
      const { variantId } = req.body;
      await engine.rollForward(req.params.id, variantId);
      const experiment = await store.getExperiment(req.params.id);
      res.json({ experiment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/experiments/:id/rollback', async (req: Request, res: Response) => {
    try {
      const reason = req.body.reason || 'Manual rollback';
      await engine.rollBack(req.params.id, reason);
      const experiment = await store.getExperiment(req.params.id);
      res.json({ experiment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/experiments/:id/graduate', async (req: Request, res: Response) => {
    try {
      const { percentage } = req.body;
      await engine.graduateRollout(req.params.id, percentage);
      const experiment = await store.getExperiment(req.params.id);
      res.json({ experiment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Reporting ─────────────────────────────────────────────────────────

  router.get('/experiments/:id/report', async (req: Request, res: Response) => {
    try {
      const report = await reporter.generateReport(req.params.id);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Event Tracking ────────────────────────────────────────────────────

  router.post('/experiments/:id/events', async (req: Request, res: Response) => {
    try {
      const { userId, metricId, value } = req.body;
      await engine.trackEvent(req.params.id, userId, metricId, value);
      res.status(201).json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Client API ────────────────────────────────────────────────────────

  router.get('/api/user/experiments', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId || req.headers['x-user-id'] as string;
      const appId = req.query.app as AppId | undefined;
      if (!userId) return res.status(401).json({ error: 'User ID required' });

      const assignments = await store.getActiveExperimentsForUser(userId, appId);

      // Resolve variants
      const results = [];
      for (const a of assignments) {
        const exp = await store.getExperiment(a.experimentId);
        if (!exp || exp.status !== 'running') continue;
        const variant = exp.variants.find(v => v.id === a.variantId);
        results.push({
          experimentId: a.experimentId,
          experimentName: exp.name,
          variantId: a.variantId,
          variantName: variant?.name,
          featureFlags: variant?.featureFlags ?? {},
        });
      }

      res.json({ experiments: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
