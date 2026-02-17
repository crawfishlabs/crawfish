# Crawfish Identity Broker — Security & Compliance Specification

**Version:** 1.0.0  
**Last Updated:** 2026-02-17  
**Classification:** Internal — Security Sensitive  
**Owner:** Crawfish Platform Security  

---

## Executive Summary

The Crawfish Identity Broker mediates access to bank accounts (Plaid), health data (Apple HealthKit), calendars (Google/Apple), and developer tools (GitHub, etc.) on behalf of AI agents acting under human principal authorization. A single credential leak, unauthorized access, or audit gap would be an extinction-level event for the product.

This document specifies the security architecture, threat model, encryption design, audit logging, PII handling, access control, compliance posture, and incident response for the Identity Broker. It is written to satisfy a CISO-level security review.

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Encryption Architecture](#2-encryption-architecture)
3. [Audit Logging](#3-audit-logging)
4. [PII Safeguards](#4-pii-safeguards)
5. [Access Control](#5-access-control)
6. [Compliance Framework](#6-compliance-framework)
7. [Incident Response Plan](#7-incident-response-plan)
8. [Security Headers & Hardening](#8-security-headers--hardening)
9. [Dependency Security](#9-dependency-security)
10. [Penetration Testing Checklist](#10-penetration-testing-checklist)

---

## 1. Threat Model

### T1 — Credential Theft from Vault (At Rest)

| | |
|---|---|
| **Description** | Attacker gains access to the vault storage layer (database, filesystem) and extracts encrypted credential blobs. Attempts offline decryption. |
| **Severity** | **Critical** |
| **Likelihood** | Medium — requires infrastructure compromise or backup exfiltration |
| **Mitigations** | AES-256-GCM per-credential encryption with unique IV per entry. Master key never stored alongside ciphertext. Production uses KMS envelope encryption — master key never leaves the HSM. Per-credential DEKs limit blast radius: compromising one DEK exposes one credential, not the vault. Cryptographic erasure on deletion (destroy DEK → ciphertext irrecoverable). Disk encryption (LUKS/dm-crypt or cloud-provider volume encryption) as defense-in-depth. |

### T2 — Token Interception in Transit

| | |
|---|---|
| **Description** | Man-in-the-middle attack intercepts OAuth tokens or API keys during agent-to-broker or broker-to-provider communication. |
| **Severity** | **Critical** |
| **Likelihood** | Low (with TLS), Medium (misconfigured environments) |
| **Mitigations** | TLS 1.3 minimum on all endpoints — TLS 1.2 and below rejected at the load balancer. mTLS for agent-to-broker communication in production (agents present client certificates). Certificate pinning in mobile SDK prevents CA compromise attacks. No plaintext tokens ever cross the wire — tokens are always behind TLS or additionally encrypted in the request payload. HSTS with `includeSubDomains` and `preload` prevents downgrade. |

### T3 — Compromised Agent Acting Beyond Scope

| | |
|---|---|
| **Description** | An AI agent, through prompt injection, bug, or malicious modification, requests credentials or scopes beyond what its principal granted. |
| **Severity** | **High** |
| **Likelihood** | High — this is the most likely attack vector given the agent threat model |
| **Mitigations** | Scope enforcement at the broker level — agent cannot self-escalate (see [scope-enforcer.ts](src/security/scope-enforcer.ts)). Every credential access validated against the explicit grant record. Scope escalation attempts: denied, logged, alert pushed to principal. Rate limiting per agent (100 req/min). Anomaly detection: flag agents requesting credentials they've never used before. Agent lockout after 5 consecutive failed access attempts (15-minute cooldown). |

### T4 — Insider Threat (Rogue Developer)

| | |
|---|---|
| **Description** | A developer with production access extracts vault keys, credential data, or audit logs. |
| **Severity** | **Critical** |
| **Likelihood** | Low but non-zero — insider threats are the hardest to prevent |
| **Mitigations** | KMS envelope encryption in production — no human ever sees the master key (it lives in the HSM). Access to KMS `Decrypt` permission restricted to the broker service account, not developer IAM roles. All production credential access logged in tamper-evident audit chain. Break-glass procedure for emergency access: requires two approvals, generates alert. No developer SSH access to production — all operations via audited CI/CD pipelines. Quarterly access reviews. |

### T5 — Principal Impersonation

| | |
|---|---|
| **Description** | Attacker impersonates the human principal to approve grants, access the dashboard, or modify credentials. |
| **Severity** | **Critical** |
| **Likelihood** | Medium — depends on authentication strength |
| **Mitigations** | Firebase Auth with Google/Apple/Email providers — leverages their anti-fraud infrastructure. Session cookies: `httpOnly`, `secure`, `sameSite=strict`, `__Host-` prefix. Admin operations (revoke-all, key rotation, grant approval for Tier 1 services) require re-authentication + 2FA. Session timeout: 24 hours idle, 7 days absolute. IP-based anomaly detection on login (new country → force re-auth). Device fingerprinting for the approval flow — new device triggers SMS/email confirmation. |

### T6 — Supply Chain Attack on OAuth Providers

| | |
|---|---|
| **Description** | An OAuth provider (Google, GitHub, Plaid) is compromised, issuing malicious tokens or allowing unauthorized token generation. |
| **Severity** | **High** |
| **Likelihood** | Low — major providers have strong security, but it has happened (e.g., CircleCI 2023) |
| **Mitigations** | Token validation: verify `iss`, `aud`, `exp` claims on every JWT. For opaque tokens, validate via provider introspection endpoint. Monitor provider security advisories — automated alerts. Token rotation: short-lived access tokens (1 hour max), refresh tokens stored encrypted. Ability to mass-revoke all tokens for a specific provider within minutes. Provider allow-list: only pre-approved OAuth providers can be integrated. |

### T7 — PII Leakage Through Logs, Errors, or Analytics

| | |
|---|---|
| **Description** | Credentials, tokens, or personal data appear in application logs, error messages, stack traces, or analytics payloads. |
| **Severity** | **High** |
| **Likelihood** | High — this is the #1 accidental data leak vector in every system |
| **Mitigations** | PII scrubber middleware on all log output and API responses (see [pii-scrubber.ts](src/security/pii-scrubber.ts)). Regex-based detection for: OAuth tokens, API keys, credit card numbers, SSNs, phone numbers, emails. Error messages use reference IDs, never credential values. Stack traces stripped of sensitive function parameters before logging. Database query logging disabled for credential-related tables. CI pipeline includes a log-scanning step that fails the build if credential patterns detected in test output. |

### T8 — Replay Attacks on Audit Log

| | |
|---|---|
| **Description** | Attacker with write access to audit storage deletes or modifies entries to cover tracks, or replays old entries to create false trails. |
| **Severity** | **High** |
| **Likelihood** | Low — requires storage-level access |
| **Mitigations** | HMAC-SHA256 hash chain: each entry includes the HMAC of the previous entry (see [audit-chain.ts](src/security/audit-chain.ts)). Chain verification detects any insertion, deletion, or modification. UUID v7 IDs are time-ordered — out-of-sequence entries are detectable. Production storage: S3 Object Lock (compliance mode) or GCS retention policy — immutable for retention period. HMAC key stored separately from audit data (in KMS). Periodic integrity verification (daily cron). External audit log mirror to separate AWS account for tamper resistance. |

### T9 — Vault Key Compromise

| | |
|---|---|
| **Description** | The vault master key or a data encryption key is leaked, allowing decryption of credentials. |
| **Severity** | **Critical** |
| **Likelihood** | Low in production (KMS), Medium in dev (env var) |
| **Mitigations** | Production: master key never leaves KMS HSM — only `Encrypt`/`Decrypt` API calls. Key hierarchy: master key → DEKs per credential. Compromising one DEK exposes one credential. Key rotation: re-encrypt all credentials with new DEK, zero-downtime (dual-read during rotation window). Rotation triggered automatically on: personnel departure, suspected compromise, quarterly schedule. Old key material destroyed after rotation confirmation. Development: `CRAWFISH_VAULT_KEY` env var — acceptable risk for local development, documented upgrade path to KMS. |

### T10 — Social Engineering via Approval Flow

| | |
|---|---|
| **Description** | Attacker crafts a convincing agent grant request that tricks the principal into approving excessive permissions. |
| **Severity** | **Medium** |
| **Likelihood** | Medium — especially as agents become more autonomous |
| **Mitigations** | Grant approval UI shows plain-language scope descriptions, not raw OAuth scope strings. Dangerous scopes (financial write, health data, delete permissions) highlighted in red with explicit warnings. Time-limited grants: default 24-hour expiry, principal must explicitly choose longer durations. Grant requests include: requesting agent identity, specific scopes, justification text, and risk rating. Cool-down period: if a grant was denied, same agent cannot re-request for 1 hour. Principal notification on every new grant — push notification, not just in-app. |

---

## 2. Encryption Architecture

### 2.1 At Rest

**Algorithm:** AES-256-GCM  
**IV:** 96-bit random IV generated per encryption operation (never reused)  
**Authentication Tag:** 128-bit (GCM provides authenticated encryption — tampering detected)

**Per-Credential Encryption:**
Each credential is encrypted individually with its own Data Encryption Key (DEK). This limits blast radius: compromising a single DEK exposes a single credential, not the entire vault.

```
┌─────────────────────────────────────────┐
│              KMS Master Key              │  ← Never leaves HSM
│         (AWS KMS / GCP KMS)              │
└──────────────┬──────────────────────────┘
               │ Envelope encrypt
               ▼
┌─────────────────────────────────────────┐
│     Encrypted DEK (per credential)       │  ← Stored alongside ciphertext
│     Plaintext DEK lives only in memory   │
└──────────────┬──────────────────────────┘
               │ AES-256-GCM
               ▼
┌─────────────────────────────────────────┐
│     Encrypted Credential Blob            │  ← Stored in database
│     [IV || Ciphertext || Auth Tag]       │
└─────────────────────────────────────────┘
```

**Credential Storage Format:**
```typescript
interface EncryptedCredential {
  id: string;                    // credential identifier
  encryptedDek: Buffer;          // DEK encrypted by master key (envelope)
  iv: Buffer;                    // 12 bytes, random per encryption
  ciphertext: Buffer;            // AES-256-GCM encrypted credential
  authTag: Buffer;               // 16 bytes, GCM authentication tag
  algorithm: 'aes-256-gcm';     // explicit algorithm identifier
  kmsKeyId: string;              // which master key version encrypted the DEK
  createdAt: string;             // ISO 8601
  rotatedAt?: string;            // last DEK rotation timestamp
}
```

**Key Rotation (Zero-Downtime):**
1. Generate new DEK for the credential
2. Decrypt credential with old DEK
3. Re-encrypt with new DEK
4. Encrypt new DEK with current master key
5. Atomic write: update `encryptedDek`, `iv`, `ciphertext`, `authTag`, `rotatedAt`
6. Old DEK material zeroed in memory
7. Audit log: `credential.rotated`

**Cryptographic Erasure:**
To delete a credential, destroy its DEK. The ciphertext becomes irrecoverable without the DEK. This is faster and more reliable than overwriting ciphertext, and works even when backups exist.

### 2.2 In Transit

| Control | Specification |
|---------|--------------|
| **Minimum TLS** | TLS 1.3. TLS 1.2 and below rejected at load balancer. |
| **Cipher Suites** | TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256 only. |
| **mTLS** | Required for agent-to-broker in production. Agents present X.509 client certificates issued by our internal CA. |
| **Certificate Pinning** | Mobile SDK pins the broker's leaf certificate and one intermediate. Pin rotation via app update with 90-day overlap. |
| **HSTS** | `max-age=31536000; includeSubDomains; preload` |
| **Token Handling** | No plaintext tokens ever cross the wire. Tokens returned to agents are always behind TLS. Token values never appear in URL query strings — always in request body or headers. |

### 2.3 Key Management

**Environment Progression:**

| Environment | Key Storage | Master Key Access | Acceptable Risk |
|-------------|-----------|------------------|----------------|
| **Development** | `CRAWFISH_VAULT_KEY` env var | Developer's machine | Yes — local dev only, no real credentials |
| **Staging** | HashiCorp Vault or AWS Secrets Manager | Service account with IAM role | Moderate — synthetic test credentials only |
| **Production** | AWS KMS / GCP KMS / Azure Key Vault | Service account, no human `Decrypt` access | Minimal — HSM-backed, audited |

**Key Hierarchy:**
```
Master Key (KMS)
  └── DEK-credential-001 (AES-256, encrypted by master key)
  └── DEK-credential-002
  └── DEK-credential-003
  └── HMAC Key (audit chain, encrypted by master key)
```

**Upgrade Path (env var → KMS):**
1. Deploy broker with KMS integration enabled alongside env var
2. Broker reads `CRAWFISH_VAULT_KEY` for existing credentials, KMS for new ones
3. Background migration: re-encrypt all existing credentials under KMS
4. Verify migration: all credentials readable via KMS path
5. Remove `CRAWFISH_VAULT_KEY` from environment
6. Audit log: `vault.migration.completed`

---

## 3. Audit Logging

### 3.1 Requirements

- **Append-only:** No edits, no deletions (enforced at storage layer)
- **Complete:** Every credential access, creation, rotation, revocation, and failed attempt
- **Tamper-evident:** HMAC-SHA256 hash chain — each entry includes the HMAC of the previous entry
- **Immutable in production:** S3 Object Lock (compliance mode) or GCS retention policy
- **Retention:** Configurable, default 1 year, minimum 90 days for compliance

### 3.2 Logged Events

| Action | Trigger |
|--------|---------|
| `credential.create` | New credential stored in vault |
| `credential.access` | Agent or principal reads a credential |
| `credential.rotate` | Credential DEK rotated |
| `credential.revoke` | Credential revoked |
| `credential.delete` | Credential cryptographically erased |
| `credential.access.denied` | Access attempted without valid grant |
| `grant.request` | Agent requests access to a credential |
| `grant.approve` | Principal approves a grant |
| `grant.deny` | Principal denies a grant |
| `grant.expire` | Grant expires automatically |
| `grant.revoke` | Principal revokes an active grant |
| `auth.login` | Principal authenticates to dashboard |
| `auth.login.failed` | Failed authentication attempt |
| `auth.logout` | Principal logs out |
| `auth.2fa.challenge` | 2FA challenge issued |
| `agent.lockout` | Agent locked out after failed attempts |
| `agent.suspend` | Agent suspended (manual or automatic) |
| `vault.key.rotate` | Master key or DEK rotation |
| `vault.migration` | Key management migration events |
| `scope.escalation.attempt` | Agent requested scopes beyond grant |
| `system.integrity.check` | Audit chain verification result |

### 3.3 Log Entry Schema

```typescript
type AuditAction =
  | 'credential.create' | 'credential.access' | 'credential.rotate'
  | 'credential.revoke' | 'credential.delete' | 'credential.access.denied'
  | 'grant.request' | 'grant.approve' | 'grant.deny'
  | 'grant.expire' | 'grant.revoke'
  | 'auth.login' | 'auth.login.failed' | 'auth.logout' | 'auth.2fa.challenge'
  | 'agent.lockout' | 'agent.suspend'
  | 'vault.key.rotate' | 'vault.migration'
  | 'scope.escalation.attempt'
  | 'system.integrity.check';

interface AuditEntry {
  id: string;                              // UUID v7 (time-ordered)
  timestamp: string;                       // ISO 8601 with timezone
  previousHash: string;                    // HMAC-SHA256 of previous entry (chain)

  // Who
  principalId: string;                     // human owner
  agentId?: string;                        // agent performing action
  sourceIp: string;
  userAgent: string;

  // What
  action: AuditAction;
  service: string;                         // 'github' | 'plaid' | 'google-calendar' | 'system'
  scopes?: string[];
  resourceId?: string;                     // credential ID, grant ID, etc.

  // Outcome
  outcome: 'success' | 'denied' | 'error';
  errorCode?: string;
  errorMessage?: string;                   // NEVER contains credentials or PII

  // Context
  requestId: string;                       // correlation ID for request tracing
  metadata?: Record<string, string>;       // NEVER contains credentials or PII
}
```

### 3.4 Hash Chain Integrity

Each log entry's `previousHash` is computed as:

```
previousHash = HMAC-SHA256(key=auditHmacKey, message=serialize(previousEntry))
```

The first entry in the chain uses a well-known genesis hash: `HMAC-SHA256(key, "GENESIS")`.

**Verification:** Replay the chain from genesis, recomputing each HMAC. If any computed hash doesn't match the stored `previousHash` of the next entry, the chain is broken at that index. See [audit-chain.ts](src/security/audit-chain.ts).

### 3.5 Storage

| Environment | Backend | Immutability |
|-------------|---------|-------------|
| **Development** | JSON Lines file (`audit.jsonl`, `chmod 0600`) | OS-level file permissions |
| **Staging** | S3 bucket with versioning | Versioning prevents silent overwrites |
| **Production** | S3 with Object Lock (compliance mode, 1-year retention) | Cannot be deleted by anyone, including root account |

**Optional SIEM Integration:** Webhook adapter streams entries to Splunk, Datadog, or any SIEM that accepts JSON over HTTPS.

---

## 4. PII Safeguards

### 4.1 Data Classification

| Tier | Classification | Examples | Handling |
|------|---------------|----------|----------|
| **Tier 1** | Critical | OAuth tokens, API keys, TOTP seeds, vault encryption keys | Encrypted at rest, never logged, never displayed, never in error messages |
| **Tier 2** | Sensitive | Email addresses, phone numbers, account IDs, bank account numbers | Encrypted at rest, hashed in logs, masked in UI, full only to authenticated owner |
| **Tier 3** | Internal | Agent names, service names, scope lists, timestamps | Normal handling, logged freely, displayed normally |

### 4.2 Handling Matrix

| Data | Stored | Logged | Displayed | API Response |
|------|--------|--------|-----------|-------------|
| OAuth tokens | Encrypted in vault | NEVER (only `token_id`) | NEVER | Masked (`····a1b2`) |
| API keys | Encrypted in vault | NEVER | NEVER | Masked (`····wxyz`) |
| TOTP seeds | Encrypted in vault | NEVER | NEVER | NEVER returned |
| Email addresses | Encrypted | Hashed (SHA-256) only | Masked (`s***@domain.com`) | Full (to authenticated owner only) |
| Phone numbers | Encrypted | Hashed only | Masked (`***-***-1234`) | Full (to authenticated owner only) |
| Bank account numbers | NEVER stored (Plaid handles) | NEVER | Masked | NEVER |
| IP addresses | In audit log | Yes (required for security forensics) | Full (to owner) | In audit queries |
| Agent names | Plaintext | Yes | Yes | Yes |
| Request IDs | Plaintext | Yes | Yes | Yes |

### 4.3 Technical Controls

**PII Scrubber Middleware** (see [pii-scrubber.ts](src/security/pii-scrubber.ts)):
- Scans all log output, API responses, and error messages
- Regex patterns detect: OAuth bearer tokens, GitHub PATs (`ghp_`/`gho_`/`ghs_`), Plaid tokens, AWS keys (`AKIA`), credit card numbers (Luhn-valid), SSNs, phone numbers, email addresses
- Matches replaced with `[REDACTED]`
- Deep-scrubs nested objects for structured logging
- Express middleware variant scrubs response bodies before sending
- Zero false negatives preferred over zero false positives — over-redact rather than leak

**Additional Controls:**
- Error messages reference request IDs, never credential values
- Stack traces: sensitive function parameters replaced with `[SCRUBBED]` before logging
- Database query logging: disabled for `credentials`, `tokens`, and `secrets` tables
- Analytics/telemetry: PII scrubber applied before any data leaves the broker
- CI pipeline: log-scanning step fails the build if credential patterns detected in test output

---

## 5. Access Control

### 5.1 Authentication

**Agent-to-Broker:**
```
Authorization: Bearer <agent-api-key>
X-Request-Signature: HMAC-SHA256(<request-body>, <shared-secret>)
X-Request-Timestamp: <ISO-8601>
```
- API key identifies the agent
- Request signature prevents tampering
- Timestamp within 5-minute window prevents replay
- Shared secret rotated quarterly

**Human-to-Dashboard:**
- Firebase Auth (Google, Apple, Email providers)
- Session cookie: `__Host-session` with `httpOnly`, `secure`, `sameSite=strict`
- Session lifetime: 24 hours idle timeout, 7 days absolute maximum
- Re-authentication required for admin operations

**Admin Operations (elevated privilege):**
- Revoke-all credentials
- Vault key rotation
- Grant approval for Tier 1 services (financial, health)
- User deletion / data export

All require: re-authentication within last 5 minutes + TOTP or WebAuthn 2FA.

### 5.2 Authorization

**Row-Level Security:**
All database queries include `WHERE principal_id = :authenticatedPrincipalId`. No exceptions. No admin override in the application layer. Cross-principal access is architecturally impossible.

**Agent Access Control:**
```
Agent requests credential → Broker checks:
  1. Agent API key valid? (authentication)
  2. Active grant exists for this agent + credential? (authorization)
  3. Grant not expired? (time-bound)
  4. Requested scopes ⊆ granted scopes? (scope enforcement)
  5. Agent not locked out? (brute force protection)
  6. Rate limit not exceeded? (abuse prevention)
  → All pass: return credential
  → Any fail: deny, log, potentially alert
```

**Rate Limiting:**

| Subject | Limit | Window | Action on Exceed |
|---------|-------|--------|-----------------|
| Per agent | 100 requests | 1 minute | 429 Too Many Requests |
| Per principal | 1,000 requests | 1 minute | 429 Too Many Requests |
| Per IP | 50 requests | 1 minute | 429 + CAPTCHA challenge |
| Failed auth per agent | 5 attempts | 15 minutes | Agent lockout, principal alerted |
| Failed auth per IP | 20 attempts | 1 hour | IP blocked, security alert |

### 5.3 Scope Enforcement

See [scope-enforcer.ts](src/security/scope-enforcer.ts) for implementation.

**Hierarchical Scopes:**
```
repo          → includes repo:read, repo:write
calendar      → includes calendar:read, calendar:write
plaid         → includes plaid:transactions:read, plaid:balance:read
health        → includes health:read (health:write never granted to agents)
```

**Rules:**
- Requested scopes must be a subset of granted scopes
- Wildcard `*` grants all scopes for a service (discouraged, requires explicit principal acknowledgment)
- Scope escalation attempt: denied immediately, logged as `scope.escalation.attempt`, push notification to principal
- Principle of least privilege enforced in UI: recommend minimum scopes, show warning for broad grants

---

## 6. Compliance Framework

### 6.1 SOC 2 Type II Readiness

We do not pursue SOC 2 certification at this time, but we architect all controls to be certification-ready within 6 months of the decision to pursue.

| SOC 2 Trust Criteria | Control | Implementation |
|---------------------|---------|---------------|
| **CC6.1** Access Control | Role-based access, row-level security | Firebase Auth + database RLS |
| **CC6.2** Encryption | AES-256-GCM at rest, TLS 1.3 in transit | Vault encryption + KMS |
| **CC6.3** Audit Logging | Tamper-evident append-only log | HMAC chain + S3 Object Lock |
| **CC7.2** Incident Response | Documented response plan with SLAs | See Section 7 |
| **CC8.1** Change Management | All changes via PR + CI/CD | GitHub branch protection + required reviews |

### 6.2 GDPR

| Right | Implementation |
|-------|---------------|
| **Right to Erasure (Art. 17)** | `DELETE /api/v1/principals/:id` — deletes all credentials (cryptographic erasure), PII, grants, and audit entries. Audit entries anonymized (principal ID replaced with hash) rather than deleted to maintain chain integrity. Completed within 30 days. |
| **Right to Data Portability (Art. 20)** | `GET /api/v1/principals/:id/export` — returns JSON archive of all stored data: credential metadata (not values), grants, audit entries, profile data. Available within 72 hours. |
| **Data Minimization (Art. 5(1)(c))** | We store only: credential ciphertext, grant records, audit entries, minimal profile (email, auth provider ID). No analytics profiles, no behavioral tracking. |
| **Lawful Basis (Art. 6)** | Consent — explicit, per-service, revocable. Each OAuth connection is a separate consent event. Revocation deletes the credential. |
| **Data Processing Agreements** | DPA templates for: Plaid (financial data processor), Firebase (auth provider), cloud storage (S3/GCS). |

### 6.3 CCPA

- **Right to Know:** Same as GDPR data export
- **Right to Delete:** Same as GDPR erasure
- **Right to Opt-Out of Sale:** We never sell personal information. Documented in privacy policy. No "Do Not Sell" toggle needed because there is no sale.
- **Non-Discrimination:** Service is identical regardless of privacy rights exercise

### 6.4 HIPAA Considerations

**Scope Assessment:**
- The broker stores **access tokens** to Apple HealthKit, not health data itself
- Health data flows directly from HealthKit → consuming application, never through the broker
- Access tokens to health data are **not PHI** under HIPAA, but we treat them as Tier 1 (Critical) regardless

**Architectural Boundary:**
```
HealthKit API ←→ Agent (direct) — health data flows here
     ↑
     │ OAuth token
     │
Crawfish Broker — only the token lives here, never the data
```

**If We Ever Store Health Data Directly:**
- BAA (Business Associate Agreement) required with all subprocessors
- HIPAA Security Rule compliance required (administrative, physical, technical safeguards)
- Encryption requirements already met (AES-256, TLS 1.3)
- Audit logging requirements already met (append-only, 6-year retention for HIPAA)
- This is a significant scope change — requires dedicated compliance review before implementation

### 6.5 PCI DSS

**Scope Assessment: NOT IN SCOPE**

- We never store, process, or transmit cardholder data (card numbers, CVVs, expiration dates)
- We never store bank account numbers or routing numbers
- Plaid handles all financial data connections — we store only Plaid access tokens
- Plaid access tokens are not cardholder data under PCI DSS
- Plaid maintains PCI DSS Level 1 compliance — their certification covers the bank connection

**Documentation:** Our PCI Self-Assessment Questionnaire (SAQ) answer is SAQ-A: we fully outsource all payment/financial data handling to PCI-compliant third parties.

---

## 7. Incident Response Plan

### 7.1 Severity Levels

| Level | Description | Response Time | Escalation |
|-------|-------------|--------------|------------|
| **P1 — Critical** | Vault breach, mass credential compromise, active exploitation | 15 minutes | Immediate: all engineers + executive notification |
| **P2 — High** | Single credential compromise, authentication bypass, PII leak | 1 hour | On-call engineer + security lead |
| **P3 — Medium** | Scope escalation attempt, anomalous agent behavior, rate limit abuse | 4 hours | On-call engineer |
| **P4 — Low** | Failed brute force, single denied access, minor policy violation | 24 hours | Logged, reviewed in daily security review |

### 7.2 Response Procedures

**Credential Compromise Detected (P1/P2):**
1. **Immediate (automated):** Revoke affected credential at the OAuth provider (token revocation endpoint)
2. **Immediate (automated):** Cryptographically erase credential from vault (delete DEK)
3. **<5 min:** Notify affected principal via push notification + email
4. **<15 min:** Determine blast radius — which agents had access, what actions were taken
5. **<1 hour:** Rotate vault DEK for all of the principal's credentials (precautionary)
6. **<24 hours:** Root cause analysis, forensic audit of access logs
7. **<72 hours:** Post-incident report published to affected principal

**Vault Breach Detected (P1):**
1. **Immediate:** Revoke ALL credentials across ALL principals (automated kill switch)
2. **Immediate:** Rotate master key in KMS
3. **<5 min:** Notify all affected principals
4. **<15 min:** Full system lockdown — broker enters read-only mode, no new credentials accepted
5. **<1 hour:** Re-encrypt all surviving credentials with new master key
6. **<4 hours:** Forensic audit: determine attack vector, scope of data accessed
7. **<24 hours:** Restore service after security review
8. **<72 hours:** Post-incident report to all principals and relevant regulators (if PII exposed)

**Anomalous Agent Behavior (P2/P3):**
1. **Immediate (automated):** Suspend agent — all credential access denied
2. **Immediate (automated):** Freeze all grants for this agent
3. **<5 min:** Alert principal with details: what the agent did, what it tried to access
4. **<1 hour:** Principal reviews and either reinstates or permanently revokes
5. **Anomaly triggers:** Unusual access patterns, scope escalation attempts, access from new IP, access outside normal hours

### 7.3 Communication

- **Principals:** Push notification + email for P1/P2. In-app notification for P3/P4.
- **Regulators:** GDPR requires notification within 72 hours of confirmed personal data breach. Template prepared.
- **Public:** Status page updated for P1 incidents affecting service availability.

---

## 8. Security Headers & Hardening

### 8.1 HTTP Security Headers

All responses from the web dashboard include:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.firebaseio.com https://*.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
X-XSS-Protection: 0
```

Note: `X-XSS-Protection: 0` because the `Content-Security-Policy` is the correct mitigation; the XSS auditor is deprecated and can introduce vulnerabilities.

### 8.2 Cookie Configuration

```
Set-Cookie: __Host-session=<token>; Path=/; Secure; HttpOnly; SameSite=Strict
```

- `__Host-` prefix: prevents cookie from being set by subdomains or non-HTTPS origins
- `HttpOnly`: inaccessible to JavaScript (XSS cannot steal session)
- `Secure`: only sent over HTTPS
- `SameSite=Strict`: not sent on cross-origin requests (CSRF protection)

### 8.3 CSRF Protection

- `SameSite=Strict` cookies provide primary CSRF protection
- Additionally: synchronizer token pattern on all state-changing endpoints
- CSRF token bound to session, rotated on authentication
- `Origin` header validation as defense-in-depth

### 8.4 Additional Hardening

- **Request size limits:** 1 MB maximum body size (prevents denial of service)
- **Helmet.js** or equivalent middleware for header management
- **No server version disclosure:** `Server` header removed
- **DNS rebinding protection:** validate `Host` header against allowlist
- **Clickjacking:** `frame-ancestors 'none'` in CSP + `X-Frame-Options: DENY`

---

## 9. Dependency Security

### 9.1 Automated Scanning

| Control | Tool | Frequency |
|---------|------|-----------|
| **Vulnerability scanning** | `npm audit` | Every CI run + daily scheduled |
| **Dependency updates** | Dependabot or Renovate | Automatic PRs for security patches |
| **License compliance** | `license-checker` | Every CI run |
| **Lock file integrity** | `npm ci` (fails on mismatch) | Every CI run |
| **SBOM generation** | `@cyclonedx/cyclonedx-npm` | Every release |

### 9.2 Dependency Policy

- **Minimal dependencies:** Every dependency is an attack surface. Justify each addition.
- **No native modules** where avoidable — native modules expand the build attack surface
- **Pin exact versions** in `package-lock.json` — no floating ranges for direct dependencies
- **Review transitive dependencies:** `npm ls --all` before adding new packages
- **Banned packages:** Maintain a deny-list of known-compromised or abandoned packages
- **Two-person rule:** New dependency additions require security review in PR

### 9.3 Supply Chain Hardening

- **npm provenance:** Verify package provenance signatures where available
- **Corepack:** Pin package manager version
- **CI environment:** Isolated build environment, no network access during test phase
- **Reproducible builds:** `npm ci` from lock file, verify checksums

---

## 10. Penetration Testing Checklist

### Pre-Launch Security Assessment

Run before every major release and at minimum quarterly.

#### OWASP Top 10 Coverage

- [ ] **A01 Broken Access Control:** Attempt to access another principal's credentials by manipulating IDs. Attempt cross-principal grant access. Verify row-level security cannot be bypassed.
- [ ] **A02 Cryptographic Failures:** Verify vault ciphertext is indistinguishable from random (entropy analysis). Verify no plaintext credentials in database, logs, or backups. Verify TLS 1.3 enforcement.
- [ ] **A03 Injection:** SQL injection in all query parameters. NoSQL injection if applicable. Command injection in any shell-out paths.
- [ ] **A04 Insecure Design:** Review grant approval flow for social engineering vectors. Verify scope enforcement cannot be bypassed by design.
- [ ] **A05 Security Misconfiguration:** Verify all security headers present. Verify no default credentials. Verify error messages don't leak internals.
- [ ] **A06 Vulnerable Components:** `npm audit` with zero high/critical findings. Verify no known CVEs in dependency tree.
- [ ] **A07 Authentication Failures:** Brute force login attempts. Session fixation. Token reuse after logout.
- [ ] **A08 Data Integrity Failures:** Tamper with audit log entries and verify detection. Attempt deserialization attacks on stored credentials.
- [ ] **A09 Logging Failures:** Verify all security events are logged. Grep all logs for credential patterns — must find zero matches.
- [ ] **A10 SSRF:** Attempt to make broker issue requests to internal services via OAuth callback manipulation.

#### Broker-Specific Tests

- [ ] **Vault encryption strength:** Statistical analysis of ciphertext — chi-squared test for randomness
- [ ] **Token leakage scan:** Grep all logs, API responses, error messages, and HTML source for: OAuth tokens, API keys, JWTs, `ghp_`, `gho_`, `AKIA`, bearer tokens
- [ ] **Authorization bypass:** Modify agent ID in requests, attempt to use revoked grants, attempt to use expired grants
- [ ] **Scope escalation:** Request `repo:write` when granted only `repo:read`. Request `*` wildcard. Request scopes for ungranted services.
- [ ] **Rate limit bypass:** Rotate source IPs, attempt distributed brute force
- [ ] **Replay attack on audit:** Copy old audit entries, insert into chain, verify detection
- [ ] **CSRF on dashboard:** Attempt state-changing operations (grant approval, credential deletion) from cross-origin page
- [ ] **XSS in display fields:** Inject scripts in agent names, service names, scope descriptions, error messages
- [ ] **Timing attacks:** Measure response times for valid vs. invalid credential IDs to detect enumeration
- [ ] **Key rotation verification:** Rotate keys, verify old keys cannot decrypt new data, verify new keys can decrypt re-encrypted data

#### Infrastructure Tests

- [ ] **KMS access control:** Verify developer IAM roles cannot call `Decrypt` on production KMS keys
- [ ] **S3 Object Lock:** Attempt to delete audit log entries from S3 — must fail
- [ ] **Network segmentation:** Verify broker cannot reach internal services it shouldn't (database admin ports, other service internals)
- [ ] **Secrets in source:** Scan entire codebase for hardcoded credentials, API keys, private keys (`trufflehog`, `gitleaks`)

---

## Appendix A: Implementation References

| Component | Source | Purpose |
|-----------|--------|---------|
| PII Scrubber | [`src/security/pii-scrubber.ts`](src/security/pii-scrubber.ts) | Regex-based PII detection and redaction |
| Audit Chain | [`src/security/audit-chain.ts`](src/security/audit-chain.ts) | Append-only HMAC-chained audit log |
| Scope Enforcer | [`src/security/scope-enforcer.ts`](src/security/scope-enforcer.ts) | Hierarchical scope validation |
| PII Tests | [`__tests__/security/pii-scrubber.test.ts`](__tests__/security/pii-scrubber.test.ts) | |
| Audit Tests | [`__tests__/security/audit-chain.test.ts`](__tests__/security/audit-chain.test.ts) | |
| Scope Tests | [`__tests__/security/scope-enforcer.test.ts`](__tests__/security/scope-enforcer.test.ts) | |

## Appendix B: Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-17 | Crawfish Security | Initial specification |
