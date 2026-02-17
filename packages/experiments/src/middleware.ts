import { Request, Response, NextFunction } from 'express';
import { ExperimentEngine } from './engine';
import { FeedbackLoop, FeedbackLoopStore } from './feedback-loop';
import { Variant, AppId } from './models';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      experimentVariants?: Record<string, Variant>;
      userId?: string;
      appId?: AppId;
    }
  }
}

/**
 * Middleware: assigns user to all active experiments and attaches variants to request.
 */
export function experimentAssignment(engine: ExperimentEngine, experimentIds: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId || req.headers['x-user-id'] as string;
      if (!userId) return next();

      const variants: Record<string, Variant> = {};
      for (const expId of experimentIds) {
        try {
          variants[expId] = await engine.assignUser(expId, userId);
        } catch { /* skip failed assignments */ }
      }

      req.experimentVariants = variants;
      next();
    } catch (err) {
      next(); // Don't block requests on experiment failures
    }
  };
}

/**
 * Middleware: auto-tracks API call events per experiment.
 * Tracks that the user made an API call (useful for engagement metrics).
 */
export function experimentTracking(engine: ExperimentEngine, metricId: string = 'api_call') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId || req.headers['x-user-id'] as string;
      if (!userId || !req.experimentVariants) return next();

      // Fire and forget — don't block the request
      const trackPromises = Object.keys(req.experimentVariants).map(expId =>
        engine.trackEvent(expId, userId, metricId, 1).catch(() => {})
      );
      Promise.all(trackPromises).catch(() => {});

      next();
    } catch {
      next();
    }
  };
}

/**
 * Middleware: hooks into support ticket creation to link to experiments.
 */
export function feedbackIntegration(feedbackLoop: FeedbackLoop) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Store original json method to intercept ticket creation responses
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      // If this looks like a ticket creation response, link to experiments
      if (body?.ticket?.id && body?.ticket?.userId) {
        feedbackLoop.onTicketCreated(body.ticket).catch(() => {});
      }
      return originalJson(body);
    };

    next();
  };
}
