# Crawfish Agent Identity — Product Spec

## The Problem

Every AI agent today is either:

1. **Using the human's credentials** — shared API keys, logged-in browser sessions, copy-pasted tokens. No audit trail, no scoping, no revocation. A security nightmare hiding in plain sight.

2. **Locked out entirely** — can write code but can't deploy it, can plan but can't execute, can draft but can't send. The last mile is always a human copy-pasting.

3. **Manually provisioned** — someone spends 20 minutes creating accounts, generating SSH keys, accepting invitations, configuring 2FA. Per service. Per agent. Every time.

There is no identity layer for AI agents.

---

## The Solution

**Agent Identity** gives AI agents real digital identities — managed, scoped, and revocable.

```
Human: "Give Craw access to GitHub and Vercel"

Agent Identity:
  ✓ Email: craw@crawfishlabs.ai (Cloudflare routing)
  ✓ GitHub: OAuth device flow → scoped token → vault
  ✓ Vercel: OAuth → deployment permissions → vault
  ✓ 2FA: TOTP authenticator codes, generated on demand
  ✓ Audit: every access logged, every action traceable
  ✓ Revoke: one command kills everything
```

The agent has its own email, its own accounts, its own credentials. It acts **as a delegate** of the human — not impersonating them, but operating on their behalf with explicit, auditable authorization.

---

## Positioning

> **The identity layer for AI agents.**
> Your agent gets a real email, phone number, and credentials — managed, scoped, and revocable.

**Category:** Developer Infrastructure / Agent Infrastructure
**Tagline:** "Stop sharing your passwords with robots."

---

## Target Users

### Primary: Developers with AI coding agents

- Using Cursor, Claude Code, OpenClaw, Aider, Devin, or custom agents
- Agent can write code but needs to deploy, create PRs, manage infrastructure
- Currently copy-pasting tokens or using personal credentials
- **Pain:** "I spend more time giving my agent access to things than the agent spends doing the work"

### Secondary: DevOps teams with automation agents

- CI/CD bots, monitoring agents, incident responders
- Need scoped, rotatable credentials per automation
- Currently using shared service accounts with over-broad permissions
- **Pain:** "We have 15 bots using the same AWS key and nobody knows which one does what"

### Tertiary: Enterprises with shadow AI

- Employees giving ChatGPT/Claude access to internal tools via copy-paste
- No visibility, no governance, no revocation
- **Pain:** "Someone pasted our Stripe key into ChatGPT and we have no idea what happened to it"

---

## Competitive Landscape

| Solution | What they do | What they don't do |
|----------|-------------|-------------------|
| **Composio** | 500+ tool integrations | No identity provisioning. You bring your own credentials. |
| **Auth0 AI/AuthKit** | Human auth extended to agents | Bolted onto human identity. Agent doesn't get its own. |
| **Okta Agent Discovery** | Discover & govern agent access | Governance, not enablement. Tells you what's wrong, doesn't fix it. |
| **Strata/BeyondTrust** | Enterprise PAM | $100K+ contracts. Not for indie devs or startups. |
| **Akeyless** | Secrets management | Stores secrets, doesn't provision identities. |
| **Agent Identity** | **Provisions real identities. Creates accounts lazily. Manages the full lifecycle.** | — |

**The gap:** Everyone is building agent auth (proving who the agent is) or agent governance (controlling what agents do). **Nobody is building agent identity provisioning** — actually giving agents their own emails, phone numbers, and service accounts, managed as delegates of a human.

---

## MVP (V1) — What we build now

### Capabilities

| Feature | Implementation | Status |
|---------|---------------|--------|
| Encrypted vault | AES-256-GCM, env-var key | ✅ Build now |
| TOTP authenticator | RFC 6238, node:crypto | ✅ Build now |
| Audit log | Append-only JSONL | ✅ Build now |
| GitHub OAuth | Device flow (headless-friendly) | ✅ Build now |
| Vercel OAuth | Standard OAuth with callback | ✅ Build now |
| Email identity | Cloudflare Email Routing API | ✅ Build now |
| Config file | agent-identity.yaml | ✅ Build now |
| API server | Hono REST API | ✅ Build now |
| Web dashboard | Responsive approval UI (mobile-friendly) | ✅ Build now |
| Notifications | Telegram + email on grant request | ✅ Build now |
| CLI tool | Thin wrapper around API | ✅ Build now |

### Non-goals for V1

- Phone provisioning (Twilio — V2)
- FIDO2/WebAuthn (V2)
- Browser automation (V2)
- Multi-agent support (V3)
- Enterprise features (V3)

### CLI Interface

### Web Dashboard

The primary interface for humans. Responsive — works on mobile for quick approvals.

**Pages:**
- **Home** — Pending requests (approve/deny), active credentials, quick revoke
- **Grant approval** — Service details, scopes, approve button → redirects to OAuth consent
- **Audit log** — Filterable timeline of all actions
- **Settings** — Agent config, notification preferences, vault management

**Flow: Notification → Approve → Done**
1. Agent needs GitHub access → calls API
2. Human gets Telegram notification: "🔐 Craw needs GitHub access. [Approve]"
3. Human taps link → dashboard opens on mobile
4. Taps "Approve" → redirected to GitHub OAuth consent
5. Authorizes → callback stores token → agent has access
6. **Total time: ~30 seconds**

### Agent API

```typescript
// Agent calls REST API — never needs a browser

// Request access (triggers notification to human)
POST /v1/grants/request
{ "service": "github", "scopes": ["repo", "read:org"], "reason": "Need to create repo" }
→ { "grant_id": "g_123", "status": "pending" }

// Poll until approved (or use webhook)
GET /v1/credentials/github
→ 404 (not yet approved)
→ 200 { "access_token": "gho_...", "scope": "repo read:org" }

// Programmatic SDK
import { AgentIdentityClient } from '@crawfish/agent-identity/client';
const identity = new AgentIdentityClient({ baseUrl, token });

const github = await identity.ensureAccess('github', ['repo']);
// Requests access if needed, waits for human approval, returns credential
```

### CLI (thin wrapper around API)

```bash
crawfish-identity server                    # Start API server
crawfish-identity grant github              # POST /v1/grants/request + poll
crawfish-identity list                      # GET /v1/credentials
crawfish-identity revoke github             # DELETE /v1/credentials/github
crawfish-identity revoke --all              # DELETE /v1/credentials?reason=manual
crawfish-identity audit --since 7d          # GET /v1/audit?since=7d
```

---

## V2 — Platform Expansion

**Timeline:** After MVP is battle-tested with Craw on Crawfish development

| Feature | Details |
|---------|---------|
| Phone provisioning | Twilio number, SMS webhook, verification code extraction |
| FIDO2 authenticator | Software passkeys for services supporting WebAuthn |
| Browser automation | Playwright fallback for services without APIs |
| 20+ providers | NPM, AWS, GCP, Cloudflare, Linear, Notion, Slack, Discord, etc. |
| Web dashboard | Human manages agent permissions visually |
| Team support | Multiple agents per org, shared service connections |
| Token refresh | Automatic OAuth token refresh before expiry |

---

## Platform Service — The Bigger Play

Agent identity is use case #1. But the broker is generic: **any time a principal authorizes a delegate to access a service, it flows through the same system.** This makes it a platform service for every Crawfish app.

### The Insight

Every Crawfish platform customer needs their users to connect third-party services:
- **Crawfish Budget** → bank accounts (Plaid), Apple Card (FinanceKit)
- **Crawfish Health** → fitness trackers (Garmin, Fitbit, Whoop), Apple HealthKit
- **Crawfish Meetings** → calendars (Google, Outlook), video (Zoom), messaging (Slack)
- **Any future app** → whatever services their users need

Today, every app builds its own OAuth integration, token storage, refresh logic, and revocation UI. It's the same plumbing every time. The broker eliminates this.

### What We Become

**"Plaid but for everything"** — a unified connection management layer across:
- Banks and financial accounts
- Fitness trackers and health data
- Calendars and productivity tools
- Developer tools and infrastructure
- AI agent credentials

One API. One vault. One audit trail. One "Connected Services" UI.

### Same Broker, Two Personas

| | Agent Identity | User Account Linking |
|---|---|---|
| **Principal** | Developer (Sam) | App user (anyone) |
| **Delegate** | AI agent (Craw) | Consumer app |
| **Services** | GitHub, Vercel, AWS | Plaid, Garmin, Google Cal |
| **Approval UX** | Dashboard / notification | In-app OAuth / consent |
| **Tenancy** | Single-tenant | Multi-tenant (per user) |
| **API** | Identical | Identical |

### Revenue Model

| Tier | Price | Included |
|------|-------|----------|
| **Free** | $0/mo | 3 active connections, 1 app |
| **Pro** | $10/mo | Unlimited connections, 3 apps, priority support |
| **Platform** | $0.05/active connection/mo | For apps with many users — scales with usage |
| **Enterprise** | Custom | SOC2, SSO, SLA, dedicated vault |

An app with 10,000 users averaging 3 connections each = 30,000 active connections = $1,500/mo.

### Crawfish Platform Integration

Every app built on the Crawfish platform gets the broker as a built-in service:
```typescript
// In any Crawfish app
import { connections } from '@crawfish/platform';

// User connects their bank
const plaidLink = await connections.requestAccess(userId, 'plaid', {
  scopes: ['transactions:read'],
});
// Returns Plaid Link URL → user completes in-app

// Later: fetch transactions
const token = await connections.getCredential(userId, 'plaid');
const transactions = await plaid.getTransactions(token);
```

No OAuth boilerplate. No token storage. No refresh logic. It just works.

### Competitive Position as Platform

| Solution | What they do | Gap |
|----------|-------------|-----|
| **Plaid** | Financial data only | $$$, banks only, no fitness/calendar/dev tools |
| **Merge.dev** | Unified API for HR/ATS/CRM | Enterprise only, no consumer, no agents |
| **Nango** | 250+ OAuth integrations | Token management only, no identity provisioning, no consumer UX |
| **Paragon** | Embedded integrations | White-label OAuth UX, not a credential broker |
| **Crawfish Broker** | **Universal connection broker: agents + apps + users** | — |

## V3 — Standalone Product

**Timeline:** When the broker proves itself across Crawfish apps

| Feature | Details |
|---------|---------|
| Multi-agent | Multiple agents per human, each with own identity |
| Multi-tenant vault | SQLite/Turso → PostgreSQL scaling path |
| Enterprise SSO | SAML/OIDC integration for corporate identity providers |
| SOC2 compliance | Audit trail meets compliance requirements |
| Agent directory | Discover and verify agent identities (like Keybase for agents) |
| Hosted vault | Cloud-managed vault option (vs. local file) |
| Provider marketplace | Community-contributed provider integrations |
| Usage-based pricing | Per active connection per month |

---

## Success Metrics

### MVP

- **Time to grant access:** < 2 minutes (vs. 20 minutes manual)
- **Services connected:** GitHub + Vercel working for Craw
- **Zero plaintext secrets** in any config or log file
- **Revocation time:** < 5 seconds from command to token invalidated

### V2

- **10+ services** integrated
- **5+ external users** (other OpenClaw / AI agent operators)
- **Dashboard** used weekly by at least 3 people

### V3

- **Agent Identity** recognized as a category
- **100+ users**
- **Revenue** from Pro/Enterprise tiers

---

## Why Now

1. **AI agents are becoming autonomous** — they need their own identities, not borrowed human ones
2. **Security teams are panicking** — shared credentials with AI are an audit nightmare
3. **The developer experience is terrible** — 20 minutes of friction per service is unacceptable
4. **OAuth device flow exists** — headless auth is a solved problem, just not wired up for agents
5. **Nobody else is doing this** — the market is wide open for agent identity provisioning

---

## Open Questions

1. **Legal:** Is an AI agent a valid "person" for service ToS? Most say "automated access requires API" — we use APIs. But account creation in the agent's name may be gray area for some services.
2. **Liability:** If an agent with delegated access causes damage, the human principal is responsible. How do we make this clear?
3. **Service provider relationships:** Should we work with GitHub/Vercel to create an "agent account" type? Long-term yes.
4. **Standards:** Should we propose an "Agent Identity" standard (like OAuth for agents)? Interesting for V3+.
