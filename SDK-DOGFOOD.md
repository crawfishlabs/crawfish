# SDK Dogfood Integration Guide

> **Principle:** Our three apps — Health, Budget, and Meetings — use `@crawfish/sdk` exactly the way an external customer would. No backdoors, no internal APIs. Every friction point we hit, we fix before customers see it.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Event Naming Conventions](#event-naming-conventions)
3. [App: Health (claw-fitness)](#app-health)
4. [App: Budget (claw-budget)](#app-budget)
5. [App: Meetings (claw-meetings)](#app-meetings)
6. [Swift SDK Integration](#swift-sdk-integration)
7. [Dashboard Views](#dashboard-views)

---

## Quick Start

For each app, the integration is three steps:

```bash
# 1. Install the SDK
npm install @crawfish/sdk

# 2. Add crawfish.yaml to repo root (already created — see below)

# 3. Import and use in your code
import { cf } from './crawfish';   // our bootstrap file
cf.track('something_happened', { key: 'value' });
```

Each app has:
- `crawfish.yaml` — repo-root config
- `backend/functions/src/crawfish.ts` — SDK init + typed helpers + Express middleware
- Swift: shared `CrawfishSDK.swift` wrapper in `claw-platform/packages/sdk-swift/`

---

## Event Naming Conventions

All events use `snake_case`. Consistent across all three apps.

### Universal Events (every app tracks these)

| Event | Type | Properties |
|-------|------|------------|
| `llm_request` | track | `model`, `input_tokens`, `output_tokens`, `latency_ms`, `cost_usd`, `prompt_type` |
| `guardrail` | track | `rule_name`, `action` (blocked/warned/passed), `input_snippet` |
| `error` | track | `error_type`, `message`, `stack`, `severity` (low/medium/high/critical), `route` |
| `request` | track | `method`, `route`, `status_code`, `latency_ms`, `user_agent` |
| `billing` | track | `action` (subscribed/cancelled/upgraded/downgraded), `plan`, `mrr_delta`, `period` |
| `screen_view` | track | `screen_name`, `previous_screen`, `duration_ms` |
| `feedback` | feedback | `rating` (1-5), `comment`, `category`, `screen` |
| `feature_use` | track | `feature_name`, `action`, `context` |
| `onboarding` | track | `step`, `step_index`, `completed`, `time_on_step_ms` |

### Event Property Standards

- Durations → always `_ms` suffix, integer milliseconds
- Money → always `_usd` suffix, float
- Counts → no suffix, integer
- Booleans → `is_` or `has_` prefix
- Timestamps → ISO 8601 strings

---

## App: Health

**App ID:** `app_health`
**Repo:** `claw-fitness`

### Backend Integration

Add `cf.track()` calls at these points:

| Location | Event | Key Properties |
|----------|-------|---------------|
| `functions/src/ai/coach.ts` — after each LLM call | `llm_request` | `model`, `input_tokens`, `output_tokens`, `latency_ms`, `cost_usd`, `prompt_type: "coaching"` |
| `functions/src/ai/coach.ts` — guardrail check | `guardrail` | `rule_name`, `action`, `input_snippet` |
| `functions/src/ai/foodRecognition.ts` — LLM call | `llm_request` | `prompt_type: "food_recognition"` |
| Express error handler | `error` | `error_type`, `message`, `stack`, `severity` |
| Express middleware (all routes) | `request` | `method`, `route`, `status_code`, `latency_ms` |
| `functions/src/billing/subscriptions.ts` | `billing` | `action`, `plan`, `mrr_delta` |

### High-Value Events

| Event | Properties | Where to Track |
|-------|-----------|----------------|
| `workout_completed` | `exercises: number`, `sets: number`, `total_volume_kg: number`, `duration_ms`, `workout_type` | `functions/src/workouts/complete.ts` |
| `food_logged` | `method: "barcode" \| "search" \| "ai"`, `time_to_log_ms`, `calories`, `meal_type` | `functions/src/nutrition/log.ts` |
| `ai_coaching_interaction` | `prompt_type`, `response_quality: number \| null`, `accepted: boolean` | `functions/src/ai/coach.ts` |
| `progressive_overload_suggestion` | `exercise`, `suggestion_type`, `accepted: boolean`, `previous_weight`, `suggested_weight` | `functions/src/workouts/overload.ts` |

### Frontend (Swift) Integration

```swift
// AppDelegate or main App init
Crawfish.shared.configure(apiKey: "ck_health_xxx", appId: "app_health")

// On auth
Crawfish.shared.identify(userId: uid, traits: ["plan": plan, "goal": fitnessGoal])

// Screen views — in each ViewController/View .onAppear
Crawfish.shared.track(event: "screen_view", properties: ["screen_name": "workout_log"])

// Workout completed
Crawfish.shared.track(event: "workout_completed", properties: [
    "exercises": 5, "sets": 18, "total_volume_kg": 4500, "duration_ms": 3600000
])

// Feedback after AI coaching
Crawfish.shared.feedback(text: "Great suggestion!", rating: 5, screen: "ai_coach")

// Onboarding
Crawfish.shared.track(event: "onboarding", properties: ["step": "set_goal", "step_index": 2, "completed": true])
```

### Experiments

| Experiment Key | Variants | Hypothesis |
|---------------|----------|------------|
| `health_ai_coach_model` | `gpt-4o-mini`, `claude-haiku`, `gemini-flash` | Haiku gives comparable coaching quality at lower cost |
| `health_food_log_default` | `search`, `barcode`, `ai_camera` | AI camera as default increases logging frequency |
| `health_overload_aggression` | `conservative` (+2.5%), `moderate` (+5%), `aggressive` (+10%) | Moderate progression maximizes adherence without injury reports |
| `health_onboarding_length` | `3_steps`, `5_steps`, `7_steps` | Shorter onboarding improves day-7 retention |
| `health_rest_timer_nudge` | `control`, `vibrate`, `voice` | Voice cues improve workout completion rate |

### Dashboard Views

1. **Workout Funnel** — started → exercises logged → completed (daily/weekly)
2. **Food Logging Velocity** — avg `time_to_log_ms` by method, daily active loggers
3. **AI Coach Quality** — response ratings distribution, accepted/rejected ratio
4. **LLM Cost Tracker** — daily cost by `prompt_type`, tokens used
5. **Retention Cohorts** — day-1/7/30 by onboarding variant

---

## App: Budget

**App ID:** `app_budget`
**Repo:** `claw-budget`

### Backend Integration

| Location | Event | Key Properties |
|----------|-------|---------------|
| `functions/src/ai/insights.ts` — LLM call | `llm_request` | `model`, `tokens`, `latency_ms`, `cost_usd`, `prompt_type: "insight"` |
| `functions/src/ai/categorize.ts` — LLM call | `llm_request` | `prompt_type: "categorization"` |
| `functions/src/ai/categorize.ts` — guardrail | `guardrail` | `rule_name`, `action` |
| Express error handler | `error` | full error context |
| Express middleware | `request` | route, status, latency |
| `functions/src/billing/subscriptions.ts` | `billing` | `action`, `plan`, `mrr_delta` |

### High-Value Events

| Event | Properties | Where to Track |
|-------|-----------|----------------|
| `transaction_categorized` | `method: "auto" \| "manual"`, `accuracy: boolean`, `category`, `amount_usd`, `correction: boolean` | `functions/src/transactions/categorize.ts` |
| `budget_created` | `category`, `amount_usd`, `period: "monthly" \| "weekly"` | `functions/src/budgets/create.ts` |
| `budget_modified` | `category`, `old_amount_usd`, `new_amount_usd`, `reason` | `functions/src/budgets/update.ts` |
| `rollover_calculated` | `categories_count`, `total_rollover_usd`, `month` | `functions/src/budgets/rollover.ts` |
| `partner_invited` | `method: "email" \| "link"` | `functions/src/sharing/invite.ts` |
| `partner_joined` | `invite_age_ms` | `functions/src/sharing/join.ts` |
| `ai_insight_generated` | `insight_type`, `model`, `latency_ms`, `relevance_score` | `functions/src/ai/insights.ts` |

### Frontend (Swift) Integration

```swift
Crawfish.shared.configure(apiKey: "ck_budget_xxx", appId: "app_budget")
Crawfish.shared.identify(userId: uid, traits: ["plan": plan, "has_partner": hasPartner])

// Transaction logged
Crawfish.shared.track(event: "feature_use", properties: ["feature_name": "quick_add", "action": "transaction_added"])

// Feedback on AI insight
Crawfish.shared.feedback(text: comment, rating: rating, screen: "insights")

// Onboarding
Crawfish.shared.track(event: "onboarding", properties: ["step": "link_bank", "step_index": 3, "completed": true])
```

### Experiments

| Experiment Key | Variants | Hypothesis |
|---------------|----------|------------|
| `budget_auto_categorize_model` | `rules_only`, `llm_assisted`, `llm_primary` | LLM-primary reduces manual corrections by 60% |
| `budget_insight_frequency` | `daily`, `weekly`, `on_threshold` | Threshold-based (e.g. 80% budget used) drives more engagement than scheduled |
| `budget_onboarding_bank_link` | `upfront`, `deferred` | Deferring bank link to day-2 improves completion rate |
| `budget_partner_nudge` | `control`, `weekly_summary`, `real_time` | Real-time partner notifications reduce duplicate purchases |
| `budget_rollover_visibility` | `hidden`, `subtle`, `prominent` | Prominent rollover display reduces overspending next month |

### Dashboard Views

1. **Categorization Accuracy** — auto vs manual, correction rate over time
2. **AI Insight Engagement** — generated vs viewed vs acted-on
3. **Partner Adoption** — invited → joined → active (funnel)
4. **LLM Cost Tracker** — daily cost by prompt type
5. **Budget Adherence** — % users under budget by category, monthly trend

---

## App: Meetings

**App ID:** `app_meetings`
**Repo:** `claw-meetings`

### Backend Integration

| Location | Event | Key Properties |
|----------|-------|---------------|
| `functions/src/ai/transcribe.ts` — LLM/Whisper call | `llm_request` | `model`, `tokens`, `latency_ms`, `cost_usd`, `prompt_type: "transcription"` |
| `functions/src/ai/summarize.ts` — LLM call | `llm_request` | `prompt_type: "summary"` |
| `functions/src/ai/actions.ts` — LLM call | `llm_request` | `prompt_type: "action_extraction"` |
| `functions/src/ai/pii.ts` — guardrail | `guardrail` | `rule_name: "pii_detection"`, `action`, `entities_found` |
| Express error handler | `error` | full error context |
| Express middleware | `request` | route, status, latency |
| `functions/src/billing/subscriptions.ts` | `billing` | `action`, `plan`, `mrr_delta` |

### High-Value Events

| Event | Properties | Where to Track |
|-------|-----------|----------------|
| `meeting_transcribed` | `duration_ms`, `word_count`, `language`, `model`, `latency_ms` | `functions/src/ai/transcribe.ts` |
| `summary_generated` | `model`, `summary_length`, `user_rating: number \| null`, `latency_ms` | `functions/src/ai/summarize.ts` |
| `action_items_extracted` | `count`, `completion_rate: number \| null`, `model` | `functions/src/ai/actions.ts` |
| `pii_redacted` | `entity_types: string[]`, `count`, `method: "auto" \| "manual"` | `functions/src/ai/pii.ts` |

### Frontend (Swift) Integration

```swift
Crawfish.shared.configure(apiKey: "ck_meetings_xxx", appId: "app_meetings")
Crawfish.shared.identify(userId: uid, traits: ["plan": plan, "org_size": orgSize])

// After viewing summary
Crawfish.shared.track(event: "feature_use", properties: ["feature_name": "summary_view", "action": "viewed"])

// Rating a summary
Crawfish.shared.feedback(text: comment, rating: rating, screen: "meeting_summary")

// Action item completed
Crawfish.shared.track(event: "feature_use", properties: ["feature_name": "action_item", "action": "completed"])
```

### Experiments

| Experiment Key | Variants | Hypothesis |
|---------------|----------|------------|
| `meetings_summary_model` | `gpt-4o`, `claude-sonnet`, `gemini-pro` | Claude Sonnet has best quality/cost ratio for meeting summaries |
| `meetings_summary_length` | `brief` (3 bullets), `standard` (paragraph), `detailed` (full) | Brief summaries get higher ratings and more shares |
| `meetings_action_format` | `checklist`, `kanban`, `inline` | Checklist format has highest completion rate |
| `meetings_pii_strictness` | `conservative`, `balanced`, `aggressive` | Balanced catches 95% of PII without false-positive frustration |
| `meetings_post_meeting_nudge` | `control`, `email_digest`, `push_immediate` | Immediate push drives faster action item completion |

### Dashboard Views

1. **Transcription Pipeline** — meetings recorded → transcribed → summarized (funnel, latency)
2. **Summary Quality** — user ratings distribution by model variant
3. **Action Item Lifecycle** — extracted → assigned → completed (funnel + avg time)
4. **PII Detection** — entities found by type, false positive rate
5. **LLM Cost Tracker** — daily cost by prompt type

---

## Swift SDK Integration

All three iOS apps use the shared `CrawfishSDK.swift` wrapper at `claw-platform/packages/sdk-swift/CrawfishSDK.swift`.

### Installation

Copy or link `CrawfishSDK.swift` into each Xcode project (eventually: SPM package).

### Initialization Pattern

```swift
// In AppDelegate.didFinishLaunching or @main App.init
Crawfish.shared.configure(
    apiKey: ProcessInfo.processInfo.environment["CRAWFISH_API_KEY"] ?? "ck_xxx",
    appId: "app_health"  // or app_budget, app_meetings
)

// After auth
Crawfish.shared.identify(userId: user.uid, traits: [
    "email": user.email,
    "plan": user.subscriptionPlan
])
```

### Automatic Tracking

Each app should add to its base view controller or SwiftUI root:

```swift
// SwiftUI
.onAppear { Crawfish.shared.track(event: "screen_view", properties: ["screen_name": screenName]) }

// UIKit
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Crawfish.shared.track(event: "screen_view", properties: ["screen_name": String(describing: type(of: self))])
}
```

---

## Dashboard Views (Cross-App)

These views inform what we build in `claw-web`:

### Global Dashboard
- **LLM Spend** — total cost across all apps, broken down by app and prompt type
- **Error Rate** — errors/minute by app, severity breakdown
- **Active Users** — DAU/WAU/MAU per app
- **API Latency** — p50/p95/p99 by app

### Per-App Dashboards
- Event volume over time (stacked by event type)
- Experiment status (running, concluded, results)
- Feedback sentiment trend
- Onboarding funnel completion
- Feature usage heatmap

### Experiment Dashboard
- Active experiments across all apps
- Sample size progress toward significance
- Variant performance on primary + guardrail metrics
- Recommended winner with confidence interval

---

## File Checklist

| File | Status |
|------|--------|
| `claw-platform/SDK-DOGFOOD.md` | ✅ This file |
| `claw-fitness/backend/functions/src/crawfish.ts` | ✅ Created |
| `claw-budget/backend/functions/src/crawfish.ts` | ✅ Created |
| `claw-meetings/backend/functions/src/crawfish.ts` | ✅ Created |
| `claw-fitness/crawfish.yaml` | ✅ Created |
| `claw-budget/crawfish.yaml` | ✅ Created |
| `claw-meetings/crawfish.yaml` | ✅ Created |
| `claw-platform/packages/sdk-swift/CrawfishSDK.swift` | ✅ Created |
