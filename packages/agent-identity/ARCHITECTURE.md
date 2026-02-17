# Crawfish Agent Identity — Architecture

## Vision

AI agents should have **real digital identities** — email addresses, phone numbers, authenticator codes, OAuth tokens — managed as scoped delegates of their human owner.

Today, giving an AI agent access to GitHub takes 20 minutes of manual ceremony: create an account, generate SSH keys, copy-paste tokens, send invitations, accept invitations. Multiply that by every service the agent needs. It's unsustainable.

**Agent Identity** solves this: the human authorizes once, and the agent lazily bootstraps its own credentials as needed — scoped, auditable, and revocable with a single command.

The agent isn't pretending to be the human. It has its own identity (`craw@crawfishlabs.ai`), its own accounts, its own credentials. But it acts **on behalf of** the human, with explicit delegation and full audit trail.

---

## System Architecture

The system is **web + API first**. The agent talks to a REST API. The human manages everything through a web dashboard (works on mobile for quick approvals). CLI exists as a thin wrapper for developers.

```
┌──────────────────────────────────────────────────────────────┐
│                      Human Owner                              │
│                                                               │
│  ┌─────────────────┐    ┌──────────────────────────────────┐ │
│  │  Web Dashboard   │    │  Notifications                   │ │
│  │  (browser/mobile)│    │  Telegram · Email · Push · SMS   │ │
│  │                  │    └──────────────┬───────────────────┘ │
│  │  • Approve/deny  │                   │                     │
│  │  • OAuth consent │                   │ "Craw needs GitHub" │
│  │  • Revoke access │                   │                     │
│  │  • Audit log     │                   │                     │
│  └────────┬─────────┘                   │                     │
│           │                             │                     │
└───────────┼─────────────────────────────┼─────────────────────┘
            │ HTTPS                       │
            ▼                             │
┌──────────────────────────────────────────────────────────────┐
│                     API Server (Hono)                         │
│                                                               │
│  POST /v1/grants/request      — agent requests access         │
│  GET  /v1/grants/pending      — human views pending           │
│  POST /v1/grants/:id/approve  — human approves (triggers OAuth│
│  POST /v1/grants/:id/deny     — human denies                  │
│  GET  /v1/credentials/:svc    — agent retrieves credential    │
│  DELETE /v1/credentials/:svc  — revoke                        │
│  GET  /v1/audit               — audit log                     │
│  GET  /v1/oauth/:svc/callback — OAuth redirect handler        │
│  GET  /v1/status              — health + credential status    │
│                                                               │
│  Auth: Bearer token (agent) · Session cookie (human dashboard)│
└──────┬──────────┬──────────┬──────────┬──────────────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
┌──────────┐ ┌────────┐ ┌────────────┐ ┌───────────────────┐
│  Vault   │ │ Audit  │ │ Grant      │ │ Service Providers │
│(encrypted│ │ Log    │ │ Queue      │ │                   │
│credential│ │(append │ │ (pending   │ │ GitHub (OAuth)    │
│  store)  │ │ only)  │ │  requests) │ │ Vercel (OAuth)    │
└──────────┘ └────────┘ └────────────┘ │ Email (CF)        │
                                        │ TOTP (RFC 6238)  │
                                        └───────────────────┘
```

### Key Design Decisions

1. **Agent never needs a browser.** It calls `POST /v1/grants/request`, then polls `GET /v1/credentials/:service` until the credential is ready.
2. **Human does all OAuth in the dashboard.** When approving a GitHub grant, the dashboard redirects to GitHub's OAuth consent page. Human approves in their browser. Callback stores the token.
3. **Notifications bridge the gap.** Agent requests access → human gets a Telegram message / email / push notification → taps the link → approves in dashboard → agent has credentials.
4. **CLI wraps the API.** `crawfish-identity grant github` just calls `POST /v1/grants/request` and polls for completion.

---

## Request → Approve → Use Flow

The core flow that replaces 20 minutes of manual setup:

```
Agent                        API Server                    Human
  │                              │                            │
  ├─ POST /v1/grants/request ──►│                            │
  │  { service: "github",       │                            │
  │    scopes: ["repo"] }       │                            │
  │                              │                            │
  │◄── 201 { grant_id: "g_123", │                            │
  │     status: "pending" }     │                            │
  │                              ├─ Notify ──────────────────►│
  │                              │  "🔐 Craw needs GitHub     │
  │                              │   access (repo). Approve?" │
  │                              │  [Approve] [Deny]          │
  │                              │                            │
  │                              │◄── Human clicks Approve ───┤
  │                              │                            │
  │                              ├─ Redirect to GitHub OAuth ─┤
  │                              │                            │
  │                              │◄── OAuth callback ─────────┤
  │                              │    (token received)        │
  │                              │                            │
  │                              ├─ Store in vault            │
  │                              ├─ Update grant: "active"    │
  │                              │                            │
  │  (polling or webhook)        │                            │
  ├─ GET /v1/credentials/github►│                            │
  │◄── { access_token: "..." }  │                            │
  │                              │                            │
  ├─ Use token to call GitHub    │                            │
```

**Total time for human: ~30 seconds** (tap notification → approve → done).
**Total time for agent: zero friction** (request → wait → use).

---

## API Design

### Authentication

Two auth modes on the same server:

| Actor | Auth Method | Purpose |
|-------|------------|---------|
| Agent | `Authorization: Bearer <agent-token>` | API calls (request grants, get credentials) |
| Human | Session cookie (set after login) | Dashboard (approve, revoke, audit) |

The agent token is generated during `init` and stored in the agent's config. The human logs in via password or magic link to their email.

**MVP:** Single-agent, single-human. Agent token is a shared secret. Human auth is a simple password or env-var token.

### Endpoints

#### Agent-facing

```
POST   /v1/grants/request
       Body: { service, scopes[], method?, org?, team?, reason? }
       → 201 { grant_id, status: "pending", message }

GET    /v1/grants/:id
       → { grant_id, service, scopes, status, created_at, resolved_at? }

GET    /v1/credentials/:service
       → 200 { service, type, data: { access_token, ... }, expires_at }
       → 404 if no credential (not yet approved or doesn't exist)

GET    /v1/credentials
       → [{ service, type, expires_at, status }]

GET    /v1/status
       → { agent, services: [{ name, status, info }] }
```

#### Human-facing (dashboard API)

```
GET    /v1/grants/pending
       → [{ grant_id, service, scopes, reason, requested_at, agent }]

POST   /v1/grants/:id/approve
       → 200 { grant_id, status: "approved", oauth_url? }
       (If OAuth service: returns URL for human to complete consent)

POST   /v1/grants/:id/deny
       Body: { reason? }
       → 200 { grant_id, status: "denied" }

DELETE /v1/credentials/:service
       → 200 { revoked: true }

DELETE /v1/credentials
       Query: ?reason=breach
       → 200 { revoked: ["github", "vercel", ...] }

GET    /v1/audit
       Query: ?service=github&since=7d&limit=50
       → [{ ts, action, service, outcome, metadata }]
```

#### OAuth callbacks

```
GET    /v1/oauth/:service/callback
       Query: ?code=xxx&state=yyy
       (Handles OAuth redirect, stores token, updates grant status)
```

### Grant States

```
pending → approved → active
pending → denied
active  → revoked
active  → expired
```

---

## Web Dashboard

A minimal, responsive web UI for the human. Works in mobile browser — critical for quick approvals from notifications.

### Pages

#### 1. Dashboard Home (`/`)
- Pending grant requests (cards with Approve/Deny buttons)
- Active credentials (list with service, scopes, expiry, status indicator)
- Quick actions: revoke all, view audit

#### 2. Grant Approval (`/grants/:id`)
- Service name, requested scopes, agent name, reason
- "Approve" button → for OAuth services, redirects to provider consent page
- "Deny" button → with optional reason
- For API key services: text input to paste the key

#### 3. Audit Log (`/audit`)
- Chronological log with filters (service, action, date range)
- Each entry: timestamp, action, service, outcome
- Export as CSV

#### 4. Settings (`/settings`)
- Agent configuration (name, email, domain)
- Notification preferences (Telegram, email, push)
- Service configurations (client IDs, scopes)
- Vault key rotation
- Danger zone: revoke all, delete agent

### Design Principles
- **Mobile-first.** Approval notifications link directly to the approval page. Big tap targets.
- **Minimal.** No SPA framework bloat. Server-rendered HTML + minimal JS, or a lightweight React app.
- **Fast.** Human should go from notification tap to approved in <10 seconds.

---

## Notification System

When an agent requests a grant, the human needs to know. Multiple channels, configurable:

### Channels

| Channel | Method | Latency | Best for |
|---------|--------|---------|----------|
| **Telegram** | Bot message via OpenClaw | Instant | Primary (Sam's setup) |
| **Email** | Send to owner's email | Minutes | Fallback, audit trail |
| **Web Push** | Push API from dashboard | Instant | If dashboard is open |
| **SMS** | Twilio API | Seconds | Urgent/fallback |
| **Webhook** | POST to configured URL | Instant | Custom integrations |

### Notification Content

```
🔐 Agent Access Request

Craw needs access to GitHub
Scopes: repo, read:org
Reason: "Need to create a repository for the new project"

[Approve] → https://identity.crawfishlabs.ai/grants/g_123
[Deny]    → https://identity.crawfishlabs.ai/grants/g_123?action=deny
```

The approve link goes directly to the dashboard grant page. One tap to approve.

### Configuration

```yaml
notifications:
  channels:
    - type: telegram
      enabled: true
      # Uses OpenClaw's message system — no additional config needed
    - type: email
      enabled: true
      to: sam@crawfishlabs.ai
    - type: webhook
      enabled: false
      url: https://hooks.example.com/agent-identity
  # Only notify for these actions (default: all)
  on: [grant.requested, credential.revoked, credential.expired]
```

---

## Identity Layer

### Email Provisioning

**Default: Cloudflare Email Routing** (free tier, no additional cost)

- Configure catch-all on owned domain (e.g., `crawfishlabs.ai`)
- Agent gets a real email: `craw@crawfishlabs.ai`
- Emails forwarded to human's inbox or webhook for automated processing
- Verification codes extracted automatically from incoming emails

**Why Cloudflare:** Zero cost, instant setup via API, works with any domain already on Cloudflare. No mailbox to manage — just routing rules.

**Future providers:** Google Workspace (full mailbox), Fastmail (API-friendly), self-hosted (Mailcow/Stalwart).

### Phone Provisioning (V2)

**Provider: Twilio** ($1/month per number)

- Provision a dedicated phone number for the agent
- SMS webhook receives verification codes
- Codes parsed and stored temporarily for automated use
- Number can receive voice calls (IVR navigation for phone verification)

### Software Authenticator

**TOTP (Time-based One-Time Password) — RFC 6238**

- Agent stores TOTP seeds in the encrypted vault
- Generates 6-digit codes on demand, just like Google Authenticator
- When a service requires 2FA setup, agent generates a seed, registers it, stores it
- `getCode("github")` → `"847293"` — works exactly like a human scanning a QR code

**FIDO2/WebAuthn (V2)**

- Software-based authenticator keypairs (no hardware token needed)
- Stored in vault, used for services supporting passkey authentication
- Enables passwordless auth flows

### Credential Vault

**Implementation: AES-256-GCM encrypted JSON file**

- Master key from `CRAWFISH_VAULT_KEY` environment variable
- Each credential encrypted with unique IV + auth tag
- File: `~/.crawfish/vault.enc`
- Upgrade path: AWS KMS, GCP KMS, or HashiCorp Vault for production

**What's stored:**
- OAuth access/refresh tokens with expiry timestamps
- TOTP seeds
- API keys
- SSH private keys
- Session cookies (for browser-automated services)

---

## Authorization Model

### Delegation Chain

```
Principal (Human)
  │
  ├── delegates to → Agent "craw"
  │     ├── github: [repo, read:org, write:org]
  │     ├── vercel: [deployments:write, domains:read]
  │     └── npm: [publish] (time-limited: 30 days)
  │
  └── delegates to → Agent "deploy-bot" (future)
        └── vercel: [deployments:write]
```

### Permission Scopes

Each service grant includes:
- **Service name** — which service (github, vercel, aws, etc.)
- **Method** — how to authenticate (oauth, api-key, account-creation)
- **Scopes** — what the agent can do (service-specific)
- **Org/Team** — organizational context
- **Expiry** — optional TTL (auto-revoke after N days)
- **Conditions** — optional restrictions (IP allowlist, time windows)

### Revocation

- **Per-service:** `DELETE /v1/credentials/github` or dashboard button — revokes OAuth token, deletes from vault
- **Global kill switch:** `DELETE /v1/credentials?reason=breach` — revokes everything, wipes vault
- **Instant:** No propagation delay. Token deleted = access gone.
- **Remote:** Dashboard works from any device. Tap notification → revoke.

### Audit Trail

Every action is logged in append-only JSON Lines format:

```jsonl
{"ts":"2026-02-17T13:00:00Z","action":"credential.access","service":"github","principal":"sam","agent":"craw","outcome":"success","scopes":["repo"],"ip":"192.168.1.50"}
{"ts":"2026-02-17T13:01:00Z","action":"grant.requested","service":"vercel","principal":"sam","agent":"craw","outcome":"pending","scopes":["deployments:write"]}
{"ts":"2026-02-17T13:02:00Z","action":"grant.approved","service":"vercel","principal":"sam","agent":"craw","outcome":"success","method":"oauth"}
{"ts":"2026-02-17T14:00:00Z","action":"credential.revoke","service":"github","principal":"sam","agent":"craw","outcome":"success","reason":"manual"}
```

---

## Service Integration Patterns

### Pattern A — OAuth via Dashboard (Preferred)

**Services:** GitHub, Google, Slack, Vercel, Linear, Notion

```
Agent                  API Server              Dashboard              GitHub
  │                        │                      │                      │
  ├─ POST /grants/request─►│                      │                      │
  │                        ├─ Notify human ──────►│                      │
  │                        │                      │                      │
  │                        │  Human clicks        │                      │
  │                        │◄─ POST /approve ─────┤                      │
  │                        │                      │                      │
  │                        ├─ Redirect URL ──────►│                      │
  │                        │                      ├─ OAuth consent ─────►│
  │                        │                      │◄── authorize ────────┤
  │                        │                      │                      │
  │                        │◄── /oauth/callback ──┤  (code exchange)     │
  │                        │                      │                      │
  │                        ├─ Store token in vault│                      │
  │                        ├─ Grant → "active"    │                      │
  │                        │                      │                      │
  ├─ GET /credentials/gh ─►│                      │                      │
  │◄── { access_token }    │                      │                      │
```

**The human does all the browser work.** The agent never touches a browser.

### Pattern B — Account Creation

**Services:** Those without org-level OAuth (some SaaS tools, forums, etc.)

1. Agent creates account using `craw@crawfishlabs.ai` + generated password
2. Email verification code extracted from forwarded email
3. 2FA enabled using agent's TOTP authenticator
4. Human invites agent account to org/team
5. Agent accepts invitation via API or email link

### Pattern C — API Key via Dashboard

**Services:** Stripe, AWS, Cloudflare, Twilio

1. Agent requests access via API
2. Human gets notified, opens dashboard
3. Dashboard shows: "Paste your Stripe restricted key here"
4. Human creates key in Stripe dashboard, pastes into Agent Identity dashboard
5. API server stores in vault
6. Agent retrieves via `GET /v1/credentials/stripe`

### Pattern D — Browser Automation (Last Resort)

**Services:** Those with no API and no OAuth

1. Headless Playwright navigates signup/login flow
2. Agent uses its email/phone for verification
3. Session cookies stored in vault
4. ⚠️ Flag ToS concerns — many services prohibit automated access
5. Used only when no other option exists

---

## Lazy Loading

The core design principle: **provision on first need, not upfront.**

```typescript
// Agent code — doesn't care about provisioning details
const github = await identity.ensureAccess('github', ['repo', 'read:org']);
// First call: POST /v1/grants/request → waits for human approval → returns credential
// All subsequent calls: returns cached credential instantly

await github.request('GET /user/repos');
```

**Flow:**

1. `ensureAccess("github", ["repo"])` called
2. Check vault → no GitHub credential found
3. `POST /v1/grants/request { service: "github", scopes: ["repo"] }`
4. Human gets notification on Telegram
5. Human taps "Approve" → dashboard opens → redirects to GitHub OAuth
6. Human authorizes → callback stores token → grant status = "active"
7. Agent's polling picks up the credential
8. Store in local cache
9. Return credential to caller
10. **Next call:** vault hit → return immediately

---

## AI Configuration Interface

Agents (or humans talking to agents) can configure access in natural language:

```
Human: "Give Craw access to my Vercel account"
Agent: "I'll request Vercel access with deployment and domain permissions.
        You'll get a notification to approve — just tap it and authorize
        in your browser.
        
        Requesting now..."
→ POST /v1/grants/request { service: "vercel", scopes: ["deployments:write", "domains:read"] }
→ Human gets Telegram notification
→ Human approves in dashboard
→ Agent: "✅ Vercel access granted. I can now deploy."
```

---

## Security Model

### Encryption at Rest

- All credentials encrypted with AES-256-GCM
- 12-byte random IV per encryption operation
- 16-byte authentication tag for tamper detection
- Master key: 32-byte key from `CRAWFISH_VAULT_KEY` env var
- Key derivation: HKDF from passphrase (if using passphrase mode)

### API Authentication

- Agent token: generated at init, stored in agent config, sent as Bearer token
- Human auth: session-based (password or magic link for MVP)
- All API calls over HTTPS (TLS required in production)
- Rate limiting on grant requests (prevent agent from spamming)

### No Plaintext Secrets

- Config files (`agent-identity.yaml`) contain service names and scopes, never tokens
- Vault file is binary/encrypted — useless without master key
- Audit log contains actions and outcomes, never credential values
- Environment variables for master key only
- API responses for credentials are ephemeral — agent should cache locally

### Token Rotation

- OAuth tokens refreshed automatically before expiry
- Configurable rotation schedule (default: refresh tokens every 30 days)
- TOTP seeds rotated on admin request
- API keys: notify human when rotation recommended

### Breach Response

```
DELETE /v1/credentials?reason=breach

This:
1. Calls revoke() on every active provider (invalidates tokens server-side)
2. Deletes all credentials from vault
3. Logs the revocation with reason
4. Notifies human on all channels
5. Returns list of revoked services
```

One tap in the dashboard. Or one API call. Everything gone instantly.

### Principle of Least Privilege

- Request minimum scopes needed for the task
- Prefer read-only when write isn't needed
- Time-limit grants when possible
- Separate agents get separate identities (no credential sharing)

---

## Directory Structure

```
packages/agent-identity/
├── ARCHITECTURE.md              # This document
├── PRODUCT-SPEC.md              # Product positioning and roadmap
├── agent-identity.yaml          # Example configuration
├── package.json                 # NPM package config
├── tsconfig.json                # TypeScript config
├── src/
│   ├── index.ts                 # Main export — AgentIdentityService
│   ├── types.ts                 # All TypeScript interfaces
│   ├── vault.ts                 # Encrypted credential vault
│   ├── email.ts                 # Email provisioning (Cloudflare)
│   ├── totp.ts                  # TOTP authenticator (RFC 6238)
│   ├── audit.ts                 # Append-only audit log
│   ├── config.ts                # Config loader + validation
│   ├── orchestrator.ts          # Lazy-loading brain
│   ├── grants.ts                # Grant queue (pending/approved/denied)
│   ├── notifications.ts         # Notification dispatcher
│   ├── api/
│   │   ├── server.ts            # Hono app + middleware
│   │   ├── routes/
│   │   │   ├── grants.ts        # Grant request/approve/deny endpoints
│   │   │   ├── credentials.ts   # Credential retrieval/revocation
│   │   │   ├── oauth.ts         # OAuth callback handlers
│   │   │   ├── audit.ts         # Audit log endpoint
│   │   │   └── dashboard.ts     # Dashboard page routes
│   │   └── middleware/
│   │       └── auth.ts          # Agent token + human session auth
│   ├── cli.ts                   # CLI (thin wrapper around API)
│   └── providers/
│       ├── base.ts              # Base provider interface
│       ├── github.ts            # GitHub OAuth
│       └── vercel.ts            # Vercel OAuth
└── __tests__/
    ├── vault.test.ts            # Vault encryption tests
    ├── totp.test.ts             # TOTP generation tests
    └── grants.test.ts           # Grant queue tests
```

---

## Dependencies

Minimal — this runs on a Raspberry Pi:

| Package | Purpose | Size |
|---------|---------|------|
| `hono` | HTTP framework (tiny, fast, runs anywhere) | ~30KB |
| `yaml` | Parse agent-identity.yaml | ~50KB |
| `node:crypto` | AES-256-GCM encryption, HMAC for TOTP | Built-in |
| `node:fs` | File I/O | Built-in |

**Why Hono over Express:** 14KB vs 200KB+. Runs on Node, Deno, Bun, Cloudflare Workers. Perfect for a Pi. Web-standard Request/Response API.

**Zero heavy dependencies.** TOTP is implemented using `node:crypto` HMAC-SHA1 directly. No `otplib`, no `passport`, no ORM.
