# Crawfish Platform Architecture

> **Vercel for AI-native apps** — take any vibe-coded app and make it production-ready.

## Vision

Crawfish is a SaaS platform that continuously improves AI-native applications through an automated feedback→fix→experiment→deploy loop. Developers connect their repo, drop in the SDK, and Crawfish handles the rest: collecting user feedback, analyzing issues, generating fixes as PRs, and running experiments to validate improvements.

The platform is **stack-agnostic**. Customers can build with Next.js, Python/FastAPI, Swift, Go, or anything else. Crawfish's own consumer apps (Health, Budget, Meetings) run on Firebase and serve as the reference implementation.

---

## Three-Layer Model

```
┌─────────────────────────────────────────────────────┐
│  1. EVENT INGESTION (Universal HTTP)                │
│     • SDK track(), feedback(), identify()           │
│     • POST https://api.crawfish.dev/v1/events       │
│     • App store reviews, support tickets, webhooks  │
├─────────────────────────────────────────────────────┤
│  2. ANALYSIS (Crawfish Cloud)                       │
│     • Sentiment analysis & NPS tracking             │
│     • Error pattern detection & clustering          │
│     • Guardrail violation monitoring                │
│     • LLM output quality scoring                    │
│     • User journey & funnel analysis                │
├─────────────────────────────────────────────────────┤
│  3. FIX GENERATION (PR-based)                       │
│     • AI-generated code fixes as pull requests      │
│     • Experiment configs (flag definitions)         │
│     • Prompt/guardrail tuning suggestions           │
│     • Automated rollback on regression              │
└─────────────────────────────────────────────────────┘
```

### Layer 1: Event Ingestion

All data enters Crawfish via a universal HTTP API. The SDK is a thin client that posts structured events. No vendor lock-in — customers can also send events directly via curl/fetch.

**Supported event sources:**
- SDK (`@crawfish/sdk`) — in-app tracking
- Webhooks — custom integrations
- App store reviews — Apple App Store, Google Play (via polling)
- Support tools — Intercom, Zendesk, Freshdesk
- Error trackers — Sentry, Bugsnag (forwarding)

### Layer 2: Analysis

Crawfish Cloud processes events through multiple pipelines:
- **Sentiment** — NPS, CSAT, free-text analysis
- **Errors** — clustering, root cause, impact scoring
- **Guardrails** — LLM output safety monitoring
- **Experiments** — statistical analysis of A/B tests
- **Metrics** — custom KPIs, funnel tracking

### Layer 3: Fix Generation

Fixes are **always delivered as PRs** to customer repos. Crawfish never deploys code directly. This preserves the customer's review process and CI/CD pipeline.

Fix types:
- Code changes (bug fixes, UX improvements)
- Prompt modifications (for LLM-powered features)
- Guardrail rule updates
- Experiment flag configurations
- Configuration changes

---

## Adapter Pattern

All infrastructure dependencies are abstracted behind adapter interfaces defined in `@claw/core`. This allows the platform internals to work with any backend.

```
@claw/core/adapters/
├── store.ts      — Database (Firestore, Postgres, MongoDB, etc.)
├── auth.ts       — Authentication (Firebase Auth, Auth0, Clerk, etc.)
├── events.ts     — Event bus (Firestore triggers, Redis, Kafka, HTTP)
├── flags.ts      — Feature flags (LaunchDarkly, Statsig, Crawfish, etc.)
└── storage.ts    — File storage (Cloud Storage, S3, R2, etc.)
```

**Crawfish's own apps** use `@claw/adapters-firebase` — the reference adapter implementation.

**Customers** don't need adapters at all for basic usage — the SDK talks HTTP to Crawfish Cloud. Adapters are for self-hosted / enterprise deployments.

---

## SDK Strategy

### TypeScript (Reference) — `@crawfish/sdk`

Ships first. Thin HTTP client, zero dependencies, works in Node.js, browsers, and edge runtimes.

```typescript
import { Crawfish } from '@crawfish/sdk';

const crawfish = new Crawfish({ appId: 'app_xxx', apiKey: 'ck_xxx' });

crawfish.identify({ userId: 'u123', traits: { plan: 'pro' } });
crawfish.track('checkout_completed', { amount: 49.99 });
crawfish.feedback({ rating: 4, comment: 'Great but slow' });

const variant = await crawfish.experiment('new-onboarding');
```

### Future SDKs
- **Python** — FastAPI/Django/Flask apps
- **Swift** — iOS native apps
- **Kotlin** — Android native apps

All SDKs share the same HTTP API contract. Only the TypeScript SDK exists in the monorepo; others will be separate repos.

---

## crawfish.yaml

Every customer project gets a `crawfish.yaml` in their repo root. See `crawfish.yaml.spec.md` for full field documentation.

```yaml
version: 1
app_id: app_xxx
api_key: ck_xxx

repo:
  provider: github
  owner: acme
  name: acme-app

events:
  endpoint: https://api.crawfish.dev/v1/events  # default
  batch_size: 10
  flush_interval_ms: 5000

flags:
  provider: crawfish          # or: launchdarkly, statsig, custom
  endpoint: https://api.crawfish.dev/v1/flags

fixes:
  auto_pr: true
  base_branch: main
  labels: ["crawfish-fix"]
  require_approval: true

experiments:
  min_sample_size: 100
  confidence_level: 0.95
  max_duration_days: 14

integrations:
  sentry: { dsn: "https://..." }
  intercom: { app_id: "xxx" }
  app_store: { apple_id: "123456", google_package: "com.acme.app" }
```

---

## Integration Points

| Integration | Direction | Purpose |
|---|---|---|
| GitHub/GitLab/Bitbucket | Bidirectional | Repo connection, PR creation, webhook events |
| Event webhook | Inbound | Universal event ingestion |
| Flag providers | Outbound | LaunchDarkly, Statsig, Optimizely, or Crawfish native |
| Support tools | Inbound | Intercom, Zendesk ticket sentiment |
| App store reviews | Inbound | Apple/Google review monitoring |
| Error trackers | Inbound | Sentry, Bugsnag event forwarding |
| CI/CD | Outbound | PR status checks, deployment verification |

---

## Deployment Strategy

### Customer Apps
Crawfish **never** deploys code directly. All changes are delivered as PRs:
1. Analysis identifies an issue or improvement opportunity
2. Crawfish generates a fix (code, prompt, config)
3. PR is created against the customer's repo
4. Customer reviews/approves through their normal process
5. Customer's CI/CD deploys as usual
6. Crawfish monitors the deployment for regressions

### Experiment Orchestration
Two modes:
1. **Crawfish Flags** — Use `GET /v1/flags` endpoint. Simplest setup.
2. **Bring Your Own** — Crawfish writes flag configs for LaunchDarkly/Statsig/etc. Customer's existing flag infrastructure handles evaluation.

---

## Product Tiers

| Tier | Price | Features |
|---|---|---|
| **Scout** | Free | One-time audit: codebase scan, issue report, 3 sample fix PRs |
| **Monitor** | $29/mo | Event ingestion, dashboards, sentiment tracking, alerts |
| **Improve** | $99/mo | Automated fix PRs, experiment orchestration, integrations |
| **Autopilot** | $299/mo | Full loop: auto-PR + auto-experiment + auto-rollback, priority analysis |
| **Enterprise** | Custom | Self-hosted, custom adapters, SLA, dedicated support, SSO |

---

## Package Structure

```
packages/
├── core/                    # Adapter interfaces, shared types
│   └── src/adapters/        # store, auth, events, flags, storage
├── adapters-firebase/       # Firebase implementations (Crawfish's own apps)
├── sdk/                     # Public SDK (@crawfish/sdk)
├── iam/                     # Identity & access management
├── experiments/             # A/B testing engine
├── sentiment/               # NPS & sentiment analysis
├── guardrails/              # LLM safety & output guards
├── analytics/               # Event processing & metrics
├── feature-flags/           # Flag management
├── llm-router/              # Model routing & fallback
├── media/                   # Asset processing
├── memory/                  # Context & conversation memory
├── observability/           # Logging, tracing, monitoring
├── payments/                # Stripe integration
└── support/                 # Support ticket integration
```

---

## Architecture Decision Records

### ADR-001: Adapter Pattern for Stack Agnosticism
**Date:** 2026-02-17
**Status:** Accepted
**Decision:** All infrastructure dependencies abstracted behind adapter interfaces in `@claw/core`. Existing Firebase-coupled packages will migrate to use adapters incrementally.
**Rationale:** The platform must support any customer stack. Firebase remains the implementation for Crawfish's own apps, but the business logic should be decoupled.
