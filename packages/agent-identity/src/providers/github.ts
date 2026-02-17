// ============================================================================
// GitHub Provider — OAuth Device Flow
// Perfect for headless agents (Raspberry Pi, servers, CI runners)
// ============================================================================

import type { ServiceConfig, ServiceCredential, ApprovalCallback, OAuthToken } from '../types.js';
import { BaseServiceProvider } from './base.js';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_URL = 'https://api.github.com';

/**
 * GitHub OAuth Device Flow:
 * 1. POST to /login/device/code with client_id → get user_code + device_code
 * 2. Show user_code to human → they enter it at github.com/login/device
 * 3. Poll /login/oauth/access_token until human approves
 * 4. Store access token in vault
 *
 * Requires a GitHub OAuth App with device flow enabled.
 * Set GITHUB_CLIENT_ID env var.
 */
export class GitHubProvider extends BaseServiceProvider {
  readonly name = 'github';
  readonly requiredScopes = ['repo'];

  private clientId: string;

  constructor() {
    super();
    this.clientId = process.env.GITHUB_CLIENT_ID || '';
  }

  async authenticate(config: ServiceConfig, approve: ApprovalCallback): Promise<ServiceCredential> {
    if (!this.clientId) {
      throw new Error(
        'GITHUB_CLIENT_ID not set. Create a GitHub OAuth App at ' +
        'https://github.com/settings/applications/new with device flow enabled.'
      );
    }

    const scopes = config.scopes?.join(' ') || this.requiredScopes.join(' ');

    // Step 1: Request device code
    const deviceResponse = await this.formPost(DEVICE_CODE_URL, {
      client_id: this.clientId,
      scope: scopes,
    });

    const { device_code, user_code, verification_uri, expires_in, interval } = deviceResponse;

    // Step 2: Ask human to approve
    const approved = await approve(
      `🔐 GitHub authorization needed.\n\n` +
      `Go to: ${verification_uri}\n` +
      `Enter code: **${user_code}**\n\n` +
      `This code expires in ${Math.floor(expires_in / 60)} minutes.`,
      {
        url: verification_uri,
        code: user_code,
        requireConfirmation: false, // Just needs them to do it, not confirm here
      }
    );

    if (!approved) {
      throw new Error('GitHub authorization declined by user');
    }

    // Step 3: Poll for token
    const token = await this.pollForToken(device_code, interval || 5, expires_in);

    return this.makeCredential('oauth', token);
  }

  private async pollForToken(deviceCode: string, interval: number, expiresIn: number): Promise<OAuthToken> {
    const deadline = Date.now() + expiresIn * 1000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval * 1000));

      try {
        const response = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: new URLSearchParams({
            client_id: this.clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }).toString(),
        });

        const data = await response.json() as any;

        if (data.access_token) {
          return {
            access_token: data.access_token,
            token_type: data.token_type || 'bearer',
            scope: data.scope || '',
          };
        }

        if (data.error === 'authorization_pending') continue;
        if (data.error === 'slow_down') {
          interval = (data.interval || interval) + 1;
          continue;
        }
        if (data.error === 'expired_token') throw new Error('Device code expired. Please try again.');
        if (data.error === 'access_denied') throw new Error('Authorization was denied.');
        if (data.error) throw new Error(`GitHub OAuth error: ${data.error}`);
      } catch (err: any) {
        if (err.message?.includes('OAuth error') || err.message?.includes('expired') || err.message?.includes('denied')) {
          throw err;
        }
        // Network error — retry
        continue;
      }
    }

    throw new Error('Device code expired while waiting for authorization.');
  }

  async test(credential: ServiceCredential): Promise<{ valid: boolean; info?: string }> {
    try {
      const token = credential.data as OAuthToken;
      const user = await this.apiFetch(`${API_URL}/user`, {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      return {
        valid: true,
        info: `Authenticated as ${user.login} (scopes: ${token.scope || 'unknown'})`,
      };
    } catch {
      return { valid: false, info: 'Token invalid or expired' };
    }
  }

  async revoke(credential: ServiceCredential): Promise<boolean> {
    // GitHub doesn't have a token revocation endpoint for OAuth device flow tokens.
    // The user must revoke from GitHub settings, or we delete from vault.
    // For GitHub Apps (not OAuth Apps), there's a DELETE endpoint.
    return true; // Credential will be removed from vault by caller
  }

  // ─── GitHub API helpers ────────────────────────────────────────────

  /** List repos accessible to the agent */
  static async listRepos(token: string): Promise<any[]> {
    const response = await fetch(`${API_URL}/user/repos?per_page=100&sort=updated`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    return response.json() as any;
  }

  /** Accept a repository invitation */
  static async acceptInvitation(token: string, invitationId: number): Promise<boolean> {
    const response = await fetch(`${API_URL}/user/repository_invitations/${invitationId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    return response.ok;
  }

  /** List pending invitations */
  static async listInvitations(token: string): Promise<any[]> {
    const response = await fetch(`${API_URL}/user/repository_invitations`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    return response.json() as any;
  }
}
