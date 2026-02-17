// ============================================================================
// Vercel Provider — OAuth Integration
// ============================================================================

import type { ServiceConfig, ServiceCredential, ApprovalCallback, OAuthToken } from '../types.js';
import { BaseServiceProvider } from './base.js';

const AUTH_URL = 'https://vercel.com/integrations/new';
const TOKEN_URL = 'https://api.vercel.com/v2/oauth/access_token';
const API_URL = 'https://api.vercel.com';

/**
 * Vercel OAuth flow:
 * Vercel uses a standard authorization code flow. For headless agents,
 * we generate the auth URL and ask the human to complete the flow,
 * then paste back the authorization code.
 *
 * Requires: VERCEL_CLIENT_ID, VERCEL_CLIENT_SECRET env vars.
 * Create an integration at https://vercel.com/account/integrations
 */
export class VercelProvider extends BaseServiceProvider {
  readonly name = 'vercel';
  readonly requiredScopes = ['deployments:write'];

  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    super();
    this.clientId = process.env.VERCEL_CLIENT_ID || '';
    this.clientSecret = process.env.VERCEL_CLIENT_SECRET || '';
    this.redirectUri = process.env.VERCEL_REDIRECT_URI || 'http://localhost:9876/callback';
  }

  async authenticate(config: ServiceConfig, approve: ApprovalCallback): Promise<ServiceCredential> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'VERCEL_CLIENT_ID and VERCEL_CLIENT_SECRET not set. ' +
        'Create a Vercel integration at https://vercel.com/account/integrations'
      );
    }

    // For headless: we can either:
    // 1. Start a temporary local HTTP server to catch the redirect
    // 2. Ask the human to paste the code manually
    // Option 2 is simpler and works everywhere.

    const state = Math.random().toString(36).substring(2);
    const authUrl =
      `https://vercel.com/integrations/${this.clientId}/new` +
      `?redirect_uri=${encodeURIComponent(this.redirectUri)}` +
      `&state=${state}`;

    // For API token approach (simpler for MVP):
    const approved = await approve(
      `🔐 Vercel authorization needed.\n\n` +
      `Option A: Go to ${authUrl} and complete the OAuth flow.\n\n` +
      `Option B (easier): Create a token at https://vercel.com/account/tokens\n` +
      `and paste it here.\n\n` +
      `Which would you prefer?`,
      {
        url: authUrl,
        requireConfirmation: true,
      }
    );

    if (!approved) {
      throw new Error('Vercel authorization declined by user');
    }

    // For MVP, we support API token injection
    // Full OAuth would need a callback server or manual code paste
    throw new Error(
      'Vercel OAuth flow requires manual token input for now. ' +
      'Use: crawfish-identity grant vercel --token <your-token>'
    );
  }

  /** Store a manually-provided API token */
  async storeToken(token: string, teamId?: string): Promise<ServiceCredential> {
    const oauthToken: OAuthToken = {
      access_token: token,
      token_type: 'Bearer',
      scope: 'all', // Vercel API tokens have full scope
    };

    return this.makeCredential('oauth', oauthToken);
  }

  async test(credential: ServiceCredential): Promise<{ valid: boolean; info?: string }> {
    try {
      const token = credential.data as OAuthToken;
      const user = await this.apiFetch(`${API_URL}/v2/user`, {
        headers: { 'Authorization': `Bearer ${token.access_token}` },
      });
      return {
        valid: true,
        info: `Authenticated as ${user.user?.username || user.user?.email || 'unknown'}`,
      };
    } catch {
      return { valid: false, info: 'Token invalid or expired' };
    }
  }

  async revoke(credential: ServiceCredential): Promise<boolean> {
    // Vercel API tokens can be deleted via API if we stored the token ID
    // For now, just remove from vault
    return true;
  }

  // ─── Vercel API helpers ────────────────────────────────────────────

  static async listDeployments(token: string, teamId?: string): Promise<any[]> {
    const url = teamId
      ? `${API_URL}/v6/deployments?teamId=${teamId}`
      : `${API_URL}/v6/deployments`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await response.json() as any;
    return data.deployments || [];
  }
}
