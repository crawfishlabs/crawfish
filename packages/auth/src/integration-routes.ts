/**
 * @fileoverview Integration API Routes
 * @description Express routes for OAuth integrations and third-party services
 */

import { Router, Request, Response, NextFunction } from 'express';
import { 
  IntegrationManager, 
  GoogleIntegration, 
  ZoomIntegration, 
  StripeFinancialConnectionsIntegration, 
  SlackIntegration 
} from './integrations';
import { authMiddleware, AuthenticatedRequest } from './middleware';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Initialize integration classes
const integrationManager = new IntegrationManager();
const googleIntegration = new GoogleIntegration();
const zoomIntegration = new ZoomIntegration();
const stripeFinancialConnectionsIntegration = new StripeFinancialConnectionsIntegration();
const slackIntegration = new SlackIntegration();

// Error handler
const handleIntegrationError = (error: any, res: Response) => {
  console.error('Integration error:', error);
  
  if (error.message.includes('not connected')) {
    return res.status(400).json({ 
      error: 'Integration not connected', 
      code: 'NOT_CONNECTED' 
    });
  }
  
  if (error.message.includes('expired')) {
    return res.status(401).json({ 
      error: 'Integration token expired', 
      code: 'TOKEN_EXPIRED' 
    });
  }
  
  return res.status(500).json({ 
    error: 'Integration service error', 
    code: 'INTEGRATION_ERROR' 
  });
};

// Google OAuth Routes
router.post('/integrations/google/auth', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scopes = req.body.scopes || [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/drive.readonly'
    ];
    
    const authUrl = googleIntegration.getAuthUrl(req.user!.uid, scopes);
    
    res.json({ 
      authUrl,
      provider: 'google',
      scopes 
    });
  } catch (error) {
    handleIntegrationError(error, res);
  }
});

router.get('/integrations/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state: userId, error } = req.query;
    
    if (error) {
      return res.redirect(`${process.env.CLIENT_URL}/integrations?error=google_oauth_error`);
    }
    
    if (!code || !userId) {
      return res.redirect(`${process.env.CLIENT_URL}/integrations?error=invalid_callback`);
    }
    
    await googleIntegration.handleCallback(userId as string, code as string);
    
    res.redirect(`${process.env.CLIENT_URL}/integrations?success=google_connected`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}/integrations?error=google_connection_failed`);
  }
});

// Zoom OAuth Routes
router.post('/integrations/zoom/auth', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const authUrl = zoomIntegration.getAuthUrl(req.user!.uid);
    
    res.json({ 
      authUrl,
      provider: 'zoom' 
    });
  } catch (error) {
    handleIntegrationError(error, res);
  }
});

router.get('/integrations/zoom/callback', async (req: Request, res: Response) => {
  try {
    const { code, state: userId, error } = req.query;
    
    if (error) {
      return res.redirect(`${process.env.CLIENT_URL}/integrations?error=zoom_oauth_error`);
    }
    
    if (!code || !userId) {
      return res.redirect(`${process.env.CLIENT_URL}/integrations?error=invalid_callback`);
    }
    
    await zoomIntegration.handleCallback(userId as string, code as string);
    
    res.redirect(`${process.env.CLIENT_URL}/integrations?success=zoom_connected`);
  } catch (error) {
    console.error('Zoom OAuth callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}/integrations?error=zoom_connection_failed`);
  }
});

// Stripe Financial Connections Routes
router.post('/integrations/stripe-financial-connections/create-session', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const clientSecret = await stripeFinancialConnectionsIntegration.createLinkToken(req.user!.uid);
    
    res.json({ 
      client_secret: clientSecret,
      provider: 'stripe-financial-connections' 
    });
  } catch (error) {
    handleIntegrationError(error, res);
  }
});

router.post('/integrations/stripe-financial-connections/complete-session', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { session_id } = req.body;
    
    if (!session_id) {
      return res.status(400).json({ 
        error: 'session_id is required' 
      });
    }
    
    const session = await stripeFinancialConnectionsIntegration.exchangePublicToken(
      req.user!.uid, 
      session_id
    );
    
    res.json({ 
      success: true,
      session: {
        id: session.id,
        status: 'completed'
      }
    });
  } catch (error) {
    handleIntegrationError(error, res);
  }
});

// Slack OAuth Routes
router.post('/integrations/slack/auth', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const authUrl = slackIntegration.getAuthUrl(req.user!.uid);
    
    res.json({ 
      authUrl,
      provider: 'slack' 
    });
  } catch (error) {
    handleIntegrationError(error, res);
  }
});

router.get('/integrations/slack/callback', async (req: Request, res: Response) => {
  try {
    const { code, state: userId, error } = req.query;
    
    if (error) {
      return res.redirect(`${process.env.CLIENT_URL}/integrations?error=slack_oauth_error`);
    }
    
    if (!code || !userId) {
      return res.redirect(`${process.env.CLIENT_URL}/integrations?error=invalid_callback`);
    }
    
    await slackIntegration.handleCallback(userId as string, code as string);
    
    res.redirect(`${process.env.CLIENT_URL}/integrations?success=slack_connected`);
  } catch (error) {
    console.error('Slack OAuth callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}/integrations?error=slack_connection_failed`);
  }
});

// Generic Integration Management Routes
router.get('/integrations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const connections = await integrationManager.listConnections(req.user!.uid);
    
    // Transform connections for client
    const integrations = connections.map(conn => ({
      provider: conn.provider,
      status: conn.status,
      connectedAt: conn.connectedAt,
      expiresAt: conn.expiresAt,
      scopes: conn.scopes,
      metadata: {
        // Only include safe metadata (no sensitive tokens)
        institution_name: conn.metadata?.institution_name,
        team_name: conn.metadata?.team_name,
        user_email: conn.metadata?.user_email
      }
    }));
    
    res.json({ integrations });
  } catch (error) {
    handleIntegrationError(error, res);
  }
});

router.delete('/integrations/:provider', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { provider } = req.params;
    
    if (!['google', 'zoom', 'stripe-financial-connections', 'slack'].includes(provider)) {
      return res.status(400).json({ 
        error: 'Invalid provider' 
      });
    }
    
    await integrationManager.disconnect(req.user!.uid, provider);
    
    res.json({ 
      success: true,
      message: `${provider} integration disconnected` 
    });
  } catch (error) {
    handleIntegrationError(error, res);
  }
});

router.post('/integrations/:provider/refresh', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { provider } = req.params;
    
    if (!['google', 'zoom', 'stripe-financial-connections', 'slack'].includes(provider)) {
      return res.status(400).json({ 
        error: 'Invalid provider' 
      });
    }
    
    await integrationManager.refreshIfNeeded(req.user!.uid, provider);
    
    res.json({ 
      success: true,
      message: `${provider} token refreshed if needed` 
    });
  } catch (error) {
    handleIntegrationError(error, res);
  }
});

// Integration status check (public route - no auth required)
router.get('/integrations/status', async (req: Request, res: Response) => {
  res.json({
    available_integrations: [
      {
        provider: 'google',
        name: 'Google Calendar',
        scopes: ['calendar.readonly', 'calendar.events', 'drive.readonly'],
        description: 'Connect your Google Calendar for meeting detection and sync'
      },
      {
        provider: 'zoom',
        name: 'Zoom',
        scopes: ['meeting:read', 'recording:read', 'user:read'],
        description: 'Access Zoom meetings and recordings'
      },
      {
        provider: 'stripe-financial-connections',
        name: 'Stripe Financial Connections',
        scopes: ['accounts', 'transactions'],
        description: 'Connect your bank accounts for budget tracking via Stripe'
      },
      {
        provider: 'slack',
        name: 'Slack',
        scopes: ['chat:write', 'channels:read'],
        description: 'Send notifications and action items to Slack'
      }
    ]
  });
});

// Health check for integration services
router.get('/integrations/health', async (req: Request, res: Response) => {
  const health = {
    google: {
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      redirect_uri: process.env.GOOGLE_REDIRECT_URI
    },
    zoom: {
      configured: !!(process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET),
      redirect_uri: process.env.ZOOM_REDIRECT_URI
    },
    'stripe-financial-connections': {
      configured: !!process.env.STRIPE_SECRET_KEY,
      environment: process.env.NODE_ENV || 'development'
    },
    slack: {
      configured: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
      redirect_uri: process.env.SLACK_REDIRECT_URI
    },
    encryption: {
      configured: !!process.env.TOKEN_ENCRYPTION_KEY
    }
  };
  
  const allConfigured = Object.values(health).every(service => service.configured);
  
  res.json({
    status: allConfigured ? 'healthy' : 'partially_configured',
    services: health,
    timestamp: new Date().toISOString()
  });
});

export default router;