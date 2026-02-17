// ============================================================================
// Base Service Provider
// ============================================================================

import type { IServiceProvider, ServiceConfig, ServiceCredential, ApprovalCallback, OAuthToken } from '../types.js';

export abstract class BaseServiceProvider implements IServiceProvider {
  abstract readonly name: string;
  abstract readonly requiredScopes: string[];

  abstract authenticate(config: ServiceConfig, approve: ApprovalCallback): Promise<ServiceCredential>;
  abstract test(credential: ServiceCredential): Promise<{ valid: boolean; info?: string }>;
  abstract revoke(credential: ServiceCredential): Promise<boolean>;

  /** Helper: make a credential object */
  protected makeCredential(
    type: ServiceCredential['type'],
    data: ServiceCredential['data'],
    expiresIn?: number
  ): ServiceCredential {
    return {
      service: this.name,
      type,
      created_at: new Date().toISOString(),
      expires_at: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
      data,
    };
  }

  /** Helper: perform a fetch with error handling */
  protected async apiFetch(url: string, opts?: RequestInit): Promise<any> {
    const response = await fetch(url, opts);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${this.name} API error: ${response.status} ${body}`);
    }
    return response.json();
  }

  /** Helper: URL-encoded form POST */
  protected async formPost(url: string, params: Record<string, string>): Promise<any> {
    return this.apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
  }
}
