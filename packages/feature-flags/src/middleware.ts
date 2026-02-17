import { Request, Response, NextFunction } from 'express';
import { isFeatureEnabled, getAllFlags } from './remote-config';
import { getExperiment } from './ab-testing';

declare global {
  namespace Express {
    interface Request {
      featureFlags?: Record<string, any>;
      experiment?: { variant: string };
    }
  }
}

/**
 * Gate a route behind a feature flag. Returns 404 if flag is off.
 */
export function featureGate(flagKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user?.uid;
    const enabled = await isFeatureEnabled(flagKey, userId);
    if (!enabled) {
      return res.status(404).json({ error: 'not_found' });
    }
    next();
  };
}

/**
 * Attach experiment variant to req.experiment.
 */
export function experimentMiddleware(experimentId: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user?.uid;
    if (!userId) {
      return next();
    }

    const result = await getExperiment(experimentId, userId);
    if (result) {
      req.experiment = { variant: result.variant };
    }
    next();
  };
}

/**
 * Attach all active flags to req.featureFlags.
 */
export function flagsMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.featureFlags = await getAllFlags();
    } catch {
      req.featureFlags = {};
    }
    next();
  };
}
