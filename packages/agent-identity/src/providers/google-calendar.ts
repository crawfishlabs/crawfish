// ============================================================================
// Google Calendar Provider — OAuth 2.0
//
// Standard OAuth 2.0 authorization code flow via Google's APIs.
// Uses Google Calendar API v3.
//
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Create credentials at: https://console.cloud.google.com/apis/credentials
// Enable: Google Calendar API
// ============================================================================

import type { ServiceConfig, ServiceCredential, ApprovalCallback, OAuthToken } from '../types.js';
import { BaseServiceProvider } from './base.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API_URL = 'https://www.googleapis.com/calendar/v3';

/** Google Calendar OAuth scopes */
export const GOOGLE_CALENDAR_SCOPES = {
  /** Read-only access to events */
  'calendar.readonly': 'https://www.googleapis.com/auth/calendar.readonly',
  /** Full read/write access to events */
  'calendar': 'https://www.googleapis.com/auth/calendar',
  /** Read-only access to events on all calendars */
  'calendar.events.readonly': 'https://www.googleapis.com/auth/calendar.events.readonly',
  /** Read/write access to events */
  'calendar.events': 'https://www.googleapis.com/auth/calendar.events',
  /** Read-only free/busy information */
  'calendar.freebusy': 'https://www.googleapis.com/auth/calendar.readonly',
} as const;

export class GoogleCalendarProvider extends BaseServiceProvider {
  readonly name = 'google-calendar';
  readonly requiredScopes = ['calendar.readonly'];

  private clientId: string;
  private clientSecret: string;

  constructor() {
    super();
    this.clientId = process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  }

  /**
   * In the broker flow, authenticate is called during the grant approval.
   * For Google, we redirect the user to Google's consent page.
   * This method is used by the CLI; the API server uses buildOAuthUrl + callback instead.
   */
  async authenticate(config: ServiceConfig, approve: ApprovalCallback): Promise<ServiceCredential> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set. ' +
        'Create OAuth credentials at https://console.cloud.google.com/apis/credentials'
      );
    }

    // For headless/CLI: show URL, ask user to paste the code
    const scopes = (config.scopes || this.requiredScopes)
      .map(s => GOOGLE_CALENDAR_SCOPES[s as keyof typeof GOOGLE_CALENDAR_SCOPES] || s)
      .join(' ');

    const state = Math.random().toString(36).slice(2);
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';

    const authUrl = `${AUTH_URL}?` + new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline', // Get refresh token
      prompt: 'consent',
      state,
    }).toString();

    await approve(
      `🔐 Google Calendar authorization needed.\n\n` +
      `Go to: ${authUrl}\n\n` +
      `Authorize access, then paste the code here.`,
      { url: authUrl, requireConfirmation: true }
    );

    // In the API server flow, the callback handles this automatically.
    throw new Error(
      'Google Calendar OAuth requires the API server callback flow. ' +
      'Use the dashboard to approve this grant.'
    );
  }

  /**
   * Build the OAuth authorization URL for the dashboard redirect.
   * Used by the API server when the human approves a grant.
   */
  buildAuthUrl(opts: {
    scopes: string[];
    state: string;
    redirectUri: string;
  }): string {
    const googleScopes = opts.scopes
      .map(s => GOOGLE_CALENDAR_SCOPES[s as keyof typeof GOOGLE_CALENDAR_SCOPES] || s)
      .join(' ');

    return `${AUTH_URL}?` + new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: opts.redirectUri,
      response_type: 'code',
      scope: googleScopes,
      access_type: 'offline',
      prompt: 'consent',
      state: opts.state,
    }).toString();
  }

  /**
   * Exchange authorization code for tokens.
   * Called by the OAuth callback route.
   */
  async exchangeCode(code: string, redirectUri: string): Promise<ServiceCredential> {
    const response = await this.formPost(TOKEN_URL, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const token: OAuthToken = {
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      token_type: response.token_type || 'Bearer',
      scope: response.scope || '',
      expires_in: response.expires_in,
    };

    return this.makeCredential('oauth', token, response.expires_in);
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    const response = await this.formPost(TOKEN_URL, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    return {
      access_token: response.access_token,
      refresh_token: refreshToken, // Keep the original refresh token
      token_type: response.token_type || 'Bearer',
      scope: response.scope || '',
      expires_in: response.expires_in,
    };
  }

  async test(credential: ServiceCredential): Promise<{ valid: boolean; info?: string }> {
    try {
      const token = credential.data as OAuthToken;
      const data = await this.apiFetch(`${API_URL}/users/me/calendarList?maxResults=1`, {
        headers: { 'Authorization': `Bearer ${token.access_token}` },
      });
      const primaryCal = data.items?.find((c: any) => c.primary);
      return {
        valid: true,
        info: `Connected: ${primaryCal?.summary || 'Google Calendar'} (${primaryCal?.id || 'unknown'})`,
      };
    } catch (err: any) {
      // Check if token needs refresh
      if (err.message?.includes('401')) {
        return { valid: false, info: 'Token expired — needs refresh' };
      }
      return { valid: false, info: err.message };
    }
  }

  async revoke(credential: ServiceCredential): Promise<boolean> {
    try {
      const token = credential.data as OAuthToken;
      const tokenToRevoke = token.refresh_token || token.access_token;
      await fetch(`${REVOKE_URL}?token=${tokenToRevoke}`, { method: 'POST' });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Google Calendar API Helpers ───────────────────────────────

  /** List calendars */
  static async listCalendars(accessToken: string): Promise<any[]> {
    const response = await fetch(`${API_URL}/users/me/calendarList`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const data = await response.json() as any;
    return data.items || [];
  }

  /** List events from a calendar */
  static async listEvents(accessToken: string, opts?: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  }): Promise<any[]> {
    const calId = opts?.calendarId || 'primary';
    const params = new URLSearchParams({
      orderBy: 'startTime',
      singleEvents: 'true',
      maxResults: String(opts?.maxResults || 50),
    });
    if (opts?.timeMin) params.set('timeMin', opts.timeMin);
    if (opts?.timeMax) params.set('timeMax', opts.timeMax);

    const response = await fetch(`${API_URL}/calendars/${encodeURIComponent(calId)}/events?${params}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const data = await response.json() as any;
    return data.items || [];
  }

  /** Get free/busy information */
  static async getFreeBusy(accessToken: string, opts: {
    timeMin: string;
    timeMax: string;
    calendarIds?: string[];
  }): Promise<any> {
    const response = await fetch(`${API_URL}/freeBusy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: opts.timeMin,
        timeMax: opts.timeMax,
        items: (opts.calendarIds || ['primary']).map(id => ({ id })),
      }),
    });
    return response.json();
  }
}
