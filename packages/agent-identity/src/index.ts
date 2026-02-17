// ============================================================================
// Crawfish Agent Identity — Main Export
// ============================================================================

import { Vault } from './vault.js';
import { AuditLog } from './audit.js';
import { TOTPManager } from './totp.js';
import { Orchestrator } from './orchestrator.js';
import { loadConfig } from './config.js';
import type { AgentIdentity, ApprovalCallback } from './types.js';

export class AgentIdentityService {
  readonly vault: Vault;
  readonly audit: AuditLog;
  readonly totp: TOTPManager;
  readonly orchestrator: Orchestrator;
  readonly config: AgentIdentity;

  private constructor(opts: {
    vault: Vault;
    audit: AuditLog;
    totp: TOTPManager;
    orchestrator: Orchestrator;
    config: AgentIdentity;
  }) {
    this.vault = opts.vault;
    this.audit = opts.audit;
    this.totp = opts.totp;
    this.orchestrator = opts.orchestrator;
    this.config = opts.config;
  }

  /**
   * Create and initialize the service from config file.
   * @param opts.configPath - Path to agent-identity.yaml
   * @param opts.approvalCallback - How to ask the human for permission
   */
  static async create(opts?: {
    configPath?: string;
    approvalCallback?: ApprovalCallback;
  }): Promise<AgentIdentityService> {
    const config = await loadConfig({ configPath: opts?.configPath });

    const audit = new AuditLog({
      path: config.audit?.path || '~/.crawfish/agent-audit.jsonl',
      principal: config.agent.owner,
      agent: config.agent.name,
    });

    const vault = new Vault({
      vaultPath: config.identity?.authenticator?.vault_path || '~/.crawfish/vault.enc',
      audit,
    });

    const totp = new TOTPManager(vault);

    const approvalCallback: ApprovalCallback = opts?.approvalCallback || (async (message) => {
      console.log(message);
      // In CLI mode, wait for user input
      return new Promise((resolve) => {
        process.stdout.write('\nApprove? [Y/n] ');
        process.stdin.once('data', (data) => {
          const answer = data.toString().trim().toLowerCase();
          resolve(answer !== 'n' && answer !== 'no');
        });
      });
    });

    const orchestrator = new Orchestrator({
      vault,
      audit,
      config,
      approvalCallback,
    });

    return new AgentIdentityService({ vault, audit, totp, orchestrator, config });
  }

  /**
   * Lazy access — the primary interface for agents.
   * Checks vault, provisions if needed, returns credential.
   */
  async ensureAccess(service: string, scopes?: string[]) {
    return this.orchestrator.ensureAccess(service, scopes);
  }
}

// Re-export types and utilities
export type {
  AgentIdentity,
  ServiceCredential,
  OAuthToken,
  TOTPSeed,
  AuditEntry,
  ServiceConfig,
  GrantRequest,
  ProvisioningResult,
  ApprovalCallback,
  IServiceProvider,
  IVault,
} from './types.js';

export { Vault } from './vault.js';
export { AuditLog } from './audit.js';
export { TOTPManager, generateTOTP, base32Encode, base32Decode } from './totp.js';
export { Orchestrator } from './orchestrator.js';
export { loadConfig, generateDefaultConfig } from './config.js';
export { GitHubProvider } from './providers/github.js';
export { VercelProvider } from './providers/vercel.js';
