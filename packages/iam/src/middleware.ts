import { Request, Response, NextFunction } from 'express';
import { AppId, Entitlements } from './models';
import { IAMService } from './iam-service';

// ---------------------------------------------------------------------------
// Augment Express Request
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      entitlements?: Entitlements;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

// ---------------------------------------------------------------------------
// Factory — call once at app startup with your IAMService instance
// ---------------------------------------------------------------------------

export function createIAMMiddleware(iamService: IAMService) {
  /**
   * Core auth + entitlement middleware.
   *
   * Usage:
   *   router.get('/workouts', iamAuth({ requireApp: 'fitness' }), handler)
   */
  function iamAuth(options?: { requireApp?: AppId; requireFeature?: string }) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const token = extractBearerToken(req);
        if (!token) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const { uid, entitlements } = await iamService.verifyToken(token);
        req.userId = uid;
        req.entitlements = entitlements;

        // Check app access
        if (options?.requireApp) {
          const appEnt = entitlements.apps[options.requireApp];
          if (!appEnt?.hasAccess) {
            return res.status(403).json({
              error: 'upgrade_required',
              message: 'This feature requires a subscription',
              upgradeUrl: `https://crawfishlabs.ai/upgrade?app=${options.requireApp}`,
            });
          }
        }

        // Check feature access
        if (options?.requireFeature && !entitlements.globalFeatures[options.requireFeature]) {
          return res.status(403).json({ error: 'feature_not_available' });
        }

        next();
      } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    };
  }

  /**
   * AI quota gate — returns 429 when daily quota exceeded.
   *
   * Usage:
   *   router.post('/ai/chat', iamAuth(), aiQuota('fitness'), handler)
   */
  function aiQuota(appId: AppId) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.userId!;
        const { allowed, remaining, resetsAt } = await iamService.checkAIQuota(uid, appId);

        if (!allowed) {
          return res.status(429).json({
            error: 'ai_quota_exceeded',
            remaining: 0,
            resetsAt,
            upgradeUrl: 'https://crawfishlabs.ai/upgrade',
          });
        }

        res.set('X-AI-Remaining', String(remaining));

        // Consume one query
        await iamService.consumeAIQuota(uid, appId);
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  /**
   * Permission check for shared resources.
   *
   * Usage:
   *   router.put('/budgets/:id', iamAuth(), requirePermission('budget', 'write'), handler)
   */
  function requirePermission(resourceType: string, action: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.userId!;
        const resourceId = req.params.id || req.params.resourceId;

        const allowed = await iamService.checkPermission(uid, resourceType, resourceId, action);
        if (!allowed) {
          return res.status(403).json({ error: 'permission_denied' });
        }

        next();
      } catch (err) {
        next(err);
      }
    };
  }

  return { iamAuth, aiQuota, requirePermission };
}
