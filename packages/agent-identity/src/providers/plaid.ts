// ============================================================================
// Plaid Provider — Bank Account Linking
//
// Plaid uses a non-standard OAuth-like flow:
// 1. Server creates a link_token via Plaid API
// 2. Client opens Plaid Link (WebView/SDK) with the link_token
// 3. User authenticates with their bank inside Plaid Link
// 4. Plaid Link returns a public_token to the client
// 5. Server exchanges public_token for a permanent access_token
// 6. Server uses access_token to fetch transactions, balances, etc.
//
// Requires: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|development|production)
// ============================================================================

import type { ServiceConfig, ServiceCredential, ApprovalCallback } from '../types.js';
import { BaseServiceProvider } from './base.js';

const PLAID_ENVS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export interface PlaidCredentialData {
  access_token: string;
  item_id: string;
  institution_id?: string;
  institution_name?: string;
  /** Available products for this item */
  available_products?: string[];
  /** Consent expiration (if applicable) */
  consent_expiration_time?: string;
}

export interface PlaidLinkResult {
  public_token: string;
  metadata: {
    institution: { institution_id: string; name: string };
    accounts: Array<{
      id: string;
      name: string;
      type: string;
      subtype: string;
      mask: string;
    }>;
  };
}

export class PlaidProvider extends BaseServiceProvider {
  readonly name = 'plaid';
  readonly requiredScopes = ['transactions'];

  private clientId: string;
  private secret: string;
  private baseUrl: string;

  constructor() {
    super();
    this.clientId = process.env.PLAID_CLIENT_ID || '';
    this.secret = process.env.PLAID_SECRET || '';
    const env = process.env.PLAID_ENV || 'sandbox';
    this.baseUrl = PLAID_ENVS[env] || PLAID_ENVS.sandbox;
  }

  /**
   * For Plaid, "authenticate" means creating a link_token.
   * The actual token exchange happens after the user completes Plaid Link,
   * via the OAuth callback route (exchangePublicToken).
   */
  async authenticate(config: ServiceConfig, approve: ApprovalCallback): Promise<ServiceCredential> {
    // In the broker flow, this is called to initiate — but Plaid needs
    // a two-phase flow. We return a "pending" credential with the link_token.
    throw new Error(
      'Plaid uses a two-phase flow. Use createLinkToken() + exchangePublicToken() instead.'
    );
  }

  /**
   * Phase 1: Create a Plaid Link token for the client to use.
   * @param userId - The user/principal ID
   * @param products - Plaid products to request (transactions, auth, balance, etc.)
   * @param redirectUri - OAuth redirect URI (for OAuth-based institutions)
   */
  async createLinkToken(opts: {
    userId: string;
    products?: string[];
    redirectUri?: string;
    countryCodes?: string[];
  }): Promise<{ link_token: string; expiration: string }> {
    this.ensureCredentials();

    const response = await this.plaidPost('/link/token/create', {
      client_id: this.clientId,
      secret: this.secret,
      user: { client_user_id: opts.userId },
      client_name: 'Crawfish',
      products: opts.products || ['transactions'],
      country_codes: opts.countryCodes || ['US'],
      language: 'en',
      ...(opts.redirectUri ? { redirect_uri: opts.redirectUri } : {}),
    });

    return {
      link_token: response.link_token,
      expiration: response.expiration,
    };
  }

  /**
   * Phase 2: Exchange the public_token from Plaid Link for a permanent access_token.
   */
  async exchangePublicToken(publicToken: string): Promise<ServiceCredential> {
    this.ensureCredentials();

    const response = await this.plaidPost('/item/public_token/exchange', {
      client_id: this.clientId,
      secret: this.secret,
      public_token: publicToken,
    });

    const data: PlaidCredentialData = {
      access_token: response.access_token,
      item_id: response.item_id,
    };

    return this.makeCredential('oauth', data as any);
  }

  async test(credential: ServiceCredential): Promise<{ valid: boolean; info?: string }> {
    try {
      this.ensureCredentials();
      const data = credential.data as unknown as PlaidCredentialData;

      const response = await this.plaidPost('/item/get', {
        client_id: this.clientId,
        secret: this.secret,
        access_token: data.access_token,
      });

      const institution = response.item?.institution_id || 'unknown';
      return { valid: true, info: `Connected to ${institution} (item: ${data.item_id})` };
    } catch (err: any) {
      if (err.message?.includes('ITEM_LOGIN_REQUIRED')) {
        return { valid: false, info: 'Bank login expired — user needs to re-authenticate' };
      }
      return { valid: false, info: err.message };
    }
  }

  async revoke(credential: ServiceCredential): Promise<boolean> {
    try {
      this.ensureCredentials();
      const data = credential.data as unknown as PlaidCredentialData;

      await this.plaidPost('/item/remove', {
        client_id: this.clientId,
        secret: this.secret,
        access_token: data.access_token,
      });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Plaid API Helpers ─────────────────────────────────────────

  /** Fetch transactions for a connected account */
  async getTransactions(accessToken: string, opts?: {
    startDate?: string;
    endDate?: string;
    count?: number;
    offset?: number;
  }): Promise<any> {
    this.ensureCredentials();

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    return this.plaidPost('/transactions/get', {
      client_id: this.clientId,
      secret: this.secret,
      access_token: accessToken,
      start_date: opts?.startDate || thirtyDaysAgo.toISOString().slice(0, 10),
      end_date: opts?.endDate || now.toISOString().slice(0, 10),
      options: {
        count: opts?.count || 100,
        offset: opts?.offset || 0,
      },
    });
  }

  /** Fetch account balances */
  async getBalances(accessToken: string): Promise<any> {
    this.ensureCredentials();

    return this.plaidPost('/accounts/balance/get', {
      client_id: this.clientId,
      secret: this.secret,
      access_token: accessToken,
    });
  }

  private ensureCredentials(): void {
    if (!this.clientId || !this.secret) {
      throw new Error(
        'PLAID_CLIENT_ID and PLAID_SECRET not set. ' +
        'Get credentials at https://dashboard.plaid.com/developers/keys'
      );
    }
  }

  private async plaidPost(path: string, body: Record<string, unknown>): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json() as any;
    if (data.error_code) {
      throw new Error(`Plaid error [${data.error_code}]: ${data.error_message}`);
    }
    return data;
  }
}
