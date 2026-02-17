// ============================================================================
// Orchestrator — The lazy-loading brain
// ============================================================================

import type {
  AgentIdentity,
  ServiceCredential,
  ServiceConfig,
  GrantRequest,
  ProvisioningResult,
  ApprovalCallback,
  IServiceProvider,
  OAuthToken,
} from './types.js';
import type { Vault } from './vault.js';
import type { AuditLog } from './audit.js';
import { GitHubProvider } from './providers/github.js';
import { VercelProvider } from './providers/vercel.js';

export class Orchestrator {
  private vault: Vault;
  private audit: AuditLog;
  private config: AgentIdentity;
  private providers: Map<string, IServiceProvider> = new Map();
  private approvalCallback: ApprovalCallback;

  constructor(opts: {
    vault: Vault;
    audit: AuditLog;
    config: AgentIdentity;
    approvalCallback: ApprovalCallback;
  }) {
    this.vault = opts.vault;
    this.audit = opts.audit;
    this.config = opts.config;
    this.approvalCallback = opts.approvalCallback;

    // Register built-in providers
    this.registerProvider(new GitHubProvider());
    this.registerProvider(new VercelProvider());
  }

  registerProvider(provider: IServiceProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Ensure the agent has access to a service.
   * If credentials exist in vault and are valid, return them.
   * Otherwise, initiate the provisioning flow.
   */
  async ensureAccess(service: string, scopes?: string[]): Promise<ServiceCredential> {
    // 1. Check vault
    const existing = await this.vault.get(service);
    if (existing) {
      // Check expiry
      if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
        await this.audit.log({
          action: 'credential.access',
          service,
          outcome: 'failure',
          metadata: { reason: 'expired' },
        });
      } else {
        return existing;
      }
    }

    // 2. Get provider
    const provider = this.providers.get(service);
    if (!provider) {
      throw new Error(
        `No provider registered for service: ${service}. ` +
        `Available: ${[...this.providers.keys()].join(', ')}`
      );
    }

    // 3. Get service config
    const serviceConfig = this.config.services?.[service] || {
      method: 'oauth' as const,
      scopes: scopes || provider.requiredScopes,
    };

    // 4. Provision
    const credential = await provider.authenticate(serviceConfig, this.approvalCallback);

    // 5. Store
    await this.vault.set(service, credential);

    return credential;
  }

  /** Grant access to a service (explicit, not lazy) */
  async grant(request: GrantRequest): Promise<ProvisioningResult> {
    const provider = this.providers.get(request.service);
    if (!provider) {
      return {
        success: false,
        service: request.service,
        method: request.method,
        message: `No provider for ${request.service}`,
        error: `Unknown service: ${request.service}`,
      };
    }

    try {
      const config: ServiceConfig = {
        method: request.method,
        scopes: request.scopes,
        org: request.org,
        team: request.team,
      };

      const credential = await provider.authenticate(config, this.approvalCallback);

      if (request.expiry_days) {
        credential.expires_at = new Date(
          Date.now() + request.expiry_days * 86400000
        ).toISOString();
      }

      await this.vault.set(request.service, credential);

      return {
        success: true,
        service: request.service,
        method: request.method,
        credential,
        message: `✓ ${request.service} access granted`,
      };
    } catch (error: any) {
      return {
        success: false,
        service: request.service,
        method: request.method,
        message: `✗ ${request.service} provisioning failed: ${error.message}`,
        error: error.message,
      };
    }
  }

  /** Revoke access to a service */
  async revoke(service: string, reason?: string): Promise<boolean> {
    const credential = await this.vault.get(service);
    if (!credential) return false;

    // Try to revoke server-side
    const provider = this.providers.get(service);
    if (provider) {
      try {
        await provider.revoke(credential);
      } catch {
        // Best effort — still delete from vault
      }
    }

    await this.vault.delete(service);
    await this.audit.log({
      action: 'credential.revoke',
      service,
      outcome: 'success',
      metadata: { reason: reason || 'manual' },
    });

    return true;
  }

  /** Revoke ALL credentials */
  async revokeAll(reason?: string): Promise<string[]> {
    const creds = await this.vault.list();
    const revoked: string[] = [];
    for (const { service } of creds) {
      if (await this.revoke(service, reason || 'revoke-all')) {
        revoked.push(service);
      }
    }
    return revoked;
  }

  /** Test all active credentials */
  async status(): Promise<Array<{ service: string; valid: boolean; info?: string }>> {
    const creds = await this.vault.list();
    const results: Array<{ service: string; valid: boolean; info?: string }> = [];

    for (const { service } of creds) {
      const provider = this.providers.get(service);
      if (!provider) {
        results.push({ service, valid: true, info: 'No provider to test' });
        continue;
      }
      const credential = await this.vault.get(service);
      if (!credential) {
        results.push({ service, valid: false, info: 'Could not decrypt' });
        continue;
      }
      const result = await provider.test(credential);
      results.push({ service, ...result });
      await this.audit.log({
        action: 'credential.test',
        service,
        outcome: result.valid ? 'success' : 'failure',
      });
    }

    return results;
  }

  /**
   * Parse a natural language grant request.
   * "Give me access to GitHub with repo and org read permissions"
   * → { service: 'github', method: 'oauth', scopes: ['repo', 'read:org'] }
   */
  parseNaturalLanguageGrant(text: string): GrantRequest | null {
    const lower = text.toLowerCase();

    // Detect service
    const services = ['github', 'vercel', 'npm', 'aws', 'cloudflare', 'stripe', 'linear', 'notion'];
    const service = services.find(s => lower.includes(s));
    if (!service) return null;

    // Detect scopes from context
    const scopeMap: Record<string, string[]> = {
      github: ['repo', 'read:org'],
      vercel: ['deployments:write', 'domains:read'],
      npm: ['publish'],
    };

    // Detect intent modifiers
    const readOnly = lower.includes('read-only') || lower.includes('readonly') || lower.includes('read only');
    let scopes = scopeMap[service] || [];
    if (readOnly && service === 'github') {
      scopes = ['repo:read', 'read:org'];
    }

    // Detect method
    let method: GrantRequest['method'] = 'oauth';
    if (lower.includes('api key') || lower.includes('token')) method = 'api-key';

    return {
      service,
      method,
      scopes,
    };
  }
}
