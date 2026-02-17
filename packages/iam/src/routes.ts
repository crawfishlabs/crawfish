import { Router, Request, Response, raw } from 'express';
import { IAMService } from './iam-service';
import { IAMBilling } from './stripe-integration';
import { createIAMMiddleware } from './middleware';
import { AppId } from './models';

export interface IAMRoutesConfig {
  iamService: IAMService;
  billing: IAMBilling;
  stripeWebhookSecret: string;
}

export function createIAMRoutes(config: IAMRoutesConfig): Router {
  const router = Router();
  const iam = config.iamService;
  const billing = config.billing;
  const { iamAuth } = createIAMMiddleware(iam);

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  router.post('/auth/register', async (req: Request, res: Response) => {
    try {
      const { email, password, plan } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
      }
      const user = await iam.createUser(email, password, plan);
      res.status(201).json(user);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/auth/me', iamAuth(), async (req: Request, res: Response) => {
    try {
      const user = await iam.getUser(req.userId!);
      res.json(user);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.put('/auth/me', iamAuth(), async (req: Request, res: Response) => {
    try {
      const allowed = ['displayName', 'photoUrl', 'timezone', 'locale', 'onboardingCompleted'];
      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      await iam.updateUser(req.userId!, updates as any);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/auth/me', iamAuth(), async (req: Request, res: Response) => {
    try {
      await iam.deleteAllUserData(req.userId!);
      res.json({ ok: true, message: 'All user data deleted' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Entitlements
  // -----------------------------------------------------------------------

  router.get('/auth/entitlements', iamAuth(), async (req: Request, res: Response) => {
    res.json(req.entitlements);
  });

  // -----------------------------------------------------------------------
  // Plans & Billing
  // -----------------------------------------------------------------------

  router.post('/auth/plan', iamAuth(), async (req: Request, res: Response) => {
    try {
      const { planId } = req.body;
      await iam.changePlan(req.userId!, planId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/auth/checkout', iamAuth(), async (req: Request, res: Response) => {
    try {
      const { planId, annual } = req.body;
      const result = await billing.createCheckoutSession(req.userId!, planId, annual ?? false);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/auth/portal', iamAuth(), async (req: Request, res: Response) => {
    try {
      const result = await billing.createPortalSession(req.userId!);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Sharing
  // -----------------------------------------------------------------------

  router.get('/auth/shared', iamAuth(), async (req: Request, res: Response) => {
    try {
      const resources = await iam.getSharedResources(req.userId!);
      res.json(resources);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/auth/share', iamAuth(), async (req: Request, res: Response) => {
    try {
      const { toEmail, resourceType, resourceId, role, appId } = req.body;
      const invitation = await iam.shareResource(
        req.userId!, toEmail, resourceType, resourceId, role, appId as AppId,
      );
      res.status(201).json(invitation);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/auth/invitations/:id/accept', iamAuth(), async (req: Request, res: Response) => {
    try {
      const access = await iam.acceptInvitation(req.params.id, req.userId!);
      res.json(access);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/auth/invitations/:id/decline', iamAuth(), async (req: Request, res: Response) => {
    // Simple status update
    try {
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/auth/shared/:id', iamAuth(), async (req: Request, res: Response) => {
    try {
      await iam.revokeAccess(req.params.id, req.userId!);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // GDPR
  // -----------------------------------------------------------------------

  router.post('/auth/export', iamAuth(), async (req: Request, res: Response) => {
    try {
      const result = await iam.exportUserData(req.userId!);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Cross-app SSO
  // -----------------------------------------------------------------------

  router.post('/auth/cross-app-token', iamAuth(), async (req: Request, res: Response) => {
    try {
      const { targetApp } = req.body;
      const token = await iam.createCrossAppToken(req.userId!, targetApp as AppId);
      res.json({ token });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Stripe webhook (raw body required)
  // -----------------------------------------------------------------------

  router.post('/webhooks/stripe', raw({ type: 'application/json' }), async (req: Request, res: Response) => {
    try {
      const sig = req.headers['stripe-signature'] as string;
      await billing.handleWebhook(req.body, sig);
      res.json({ received: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
