// ============================================================================
// Crawfish Agent Identity — Type Definitions
// ============================================================================

/** The agent's complete identity configuration */
export interface AgentIdentity {
  name: string;
  owner: string;
  identity: {
    email: EmailConfig;
    phone?: PhoneConfig;
    authenticator: AuthenticatorConfig;
  };
  services: Record<string, ServiceConfig>;
  audit: AuditConfig;
}

export interface EmailConfig {
  provider: 'cloudflare' | 'google-workspace' | 'fastmail';
  domain: string;
  address: string;
}

export interface PhoneConfig {
  provider: 'twilio';
  enabled: boolean;
  number?: string;
}

export interface AuthenticatorConfig {
  type: 'totp';
  vault_path: string;
}

export interface AuditConfig {
  path: string;
  retention_days: number;
}

/** Configuration for a single service integration */
export interface ServiceConfig {
  method: 'oauth' | 'api-key' | 'account-creation' | 'browser';
  scopes?: string[];
  org?: string;
  team?: string;
  username?: string;
  /** Auto-expire grant after this many days */
  expiry_days?: number;
}

/** A stored credential in the vault */
export interface ServiceCredential {
  service: string;
  type: 'oauth' | 'api-key' | 'totp-seed' | 'ssh-key' | 'session';
  /** ISO timestamp when created */
  created_at: string;
  /** ISO timestamp when this expires (null = never) */
  expires_at: string | null;
  /** The credential data (tokens, keys, etc.) */
  data: OAuthToken | ApiKeyData | TOTPSeed | Record<string, unknown>;
}

export interface OAuthToken {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  scope: string;
  expires_in?: number;
}

export interface ApiKeyData {
  key: string;
  label?: string;
}

export interface TOTPSeed {
  secret: string; // base32 encoded
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number;
  issuer?: string;
  account?: string;
}

/** A single audit log entry */
export interface AuditEntry {
  ts: string;
  action: AuditAction;
  service: string;
  principal: string;
  agent: string;
  outcome: 'success' | 'failure' | 'pending';
  metadata?: Record<string, unknown>;
}

export type AuditAction =
  | 'credential.create'
  | 'credential.access'
  | 'credential.rotate'
  | 'credential.revoke'
  | 'credential.test'
  | 'identity.provision'
  | 'config.update';

/** A request to grant access to a service */
export interface GrantRequest {
  service: string;
  method: 'oauth' | 'api-key' | 'account-creation';
  scopes: string[];
  org?: string;
  team?: string;
  expiry_days?: number;
}

/** Result of a provisioning operation */
export interface ProvisioningResult {
  success: boolean;
  service: string;
  method: string;
  credential?: ServiceCredential;
  error?: string;
  /** Human-readable message about what was done */
  message: string;
}

/** Interface for the encrypted vault */
export interface IVault {
  get(service: string): Promise<ServiceCredential | null>;
  set(service: string, credential: ServiceCredential): Promise<void>;
  delete(service: string): Promise<boolean>;
  list(): Promise<Array<{ service: string; type: string; expires_at: string | null }>>;
  rotateKey(newKey: Buffer): Promise<void>;
}

/** Human approval callback — used by orchestrator to ask for permission */
export type ApprovalCallback = (message: string, options?: {
  /** URL the human needs to visit */
  url?: string;
  /** Code the human needs to enter */
  code?: string;
  /** Whether to wait for explicit yes/no */
  requireConfirmation?: boolean;
}) => Promise<boolean>;

/** Interface that all service providers implement */
export interface IServiceProvider {
  readonly name: string;
  readonly requiredScopes: string[];

  /** Authenticate with the service, returns credential to store */
  authenticate(config: ServiceConfig, approve: ApprovalCallback): Promise<ServiceCredential>;

  /** Test that a stored credential still works */
  test(credential: ServiceCredential): Promise<{ valid: boolean; info?: string }>;

  /** Revoke a credential server-side (if supported) */
  revoke(credential: ServiceCredential): Promise<boolean>;
}
