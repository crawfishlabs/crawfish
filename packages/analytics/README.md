# @claw/analytics — Snowflake Analytics Pipeline

Cross-app analytics and reporting for the Claw ecosystem.

## Why Snowflake
- Clean, standard SQL — no quirky dialect
- Great query UX (Snowsight)
- Auto-suspend warehouse — only pay when querying
- ~$25-40/mo at early stage with XS warehouse

## Architecture

```
Firestore → Cloud Function (onChange) → Snowflake REST API (direct insert)
                                     → GCS bucket → Snowpipe (bulk fallback)
Cloud Functions → EventPublisher → Snowflake (batched, deduplicated)
Snowflake → Views → Dashboard API → Command Center
Snowflake → Reports → Scheduled Cloud Functions → Notifications
```

## Setup

```bash
export SNOWFLAKE_ACCOUNT=your_account
export SNOWFLAKE_USER=your_user
export SNOWFLAKE_PASSWORD=your_password  # or use --authenticator externalbrowser

./setup-snowflake.sh          # Create database, schemas, tables, views
./setup-snowflake.sh --dry-run # Preview without changes
```

### Prerequisites
- Snowflake account (trial works)
- `snowsql` CLI installed
- `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD` env vars

## Database Structure

```
CLAW_ANALYTICS (database)
├── FITNESS        — workouts, exercises, sets, body_measurements, coaching_sessions
├── NUTRITION      — food_logs, meals, water_intake, daily_summaries, coaching_sessions
├── MEETINGS       — meetings, transcripts, action_items, leadership_scores, attendees
├── BUDGET         — transactions, budgets, categories, accounts, goals, coaching_sessions
└── CROSS_APP      — users, subscriptions, llm_usage, feature_usage, errors, funnel_events
    └── Views: DAILY_ACTIVE_USERS, LLM_COST_BY_TASK, MONTHLY_REVENUE, USER_HEALTH_SCORE
```

Warehouse: `CLAW_XS` (X-Small, auto-suspend 60s, auto-resume)

## Usage

### Track events from Cloud Functions
```typescript
import { SnowflakeClient, EventPublisher } from '@claw/analytics';

const sf = new SnowflakeClient();
const analytics = new EventPublisher(sf);

await analytics.trackWorkoutCompleted(userId, { id: workoutId, duration: 45 });
await analytics.trackLLMUsage(userId, { app: 'fitness', model: 'claude-opus-4', cost_usd: 0.05 });
```

### Dashboard API (for Command Center)
```typescript
import { DashboardAPI } from '@claw/analytics';
const dashboard = new DashboardAPI();
app.use('/api/v1/analytics', dashboard.router);
// GET /api/v1/analytics/overview
// GET /api/v1/analytics/costs
// GET /api/v1/analytics/cohorts
// GET /api/v1/analytics/:app/metrics
```

### Reports
```typescript
import { DailyCostReport } from '@claw/analytics';
const report = new DailyCostReport();
const data = await report.generate(100); // $100 monthly budget
// data.alert → "⚠️ LLM spend at 85% of $100 budget"
```

## Pre-built SQL Queries
- `queries/overview.sql` — DAU/WAU/MAU, stickiness
- `queries/fitness-analytics.sql` — Volume trends, PR progression
- `queries/nutrition-analytics.sql` — Calorie compliance, macro balance, water intake
- `queries/meetings-analytics.sql` — Leadership trends, action item rates, speaking ratio
- `queries/budget-analytics.sql` — Spending trends, budget adherence, savings rate
- `queries/cross-app.sql` — Multi-app users, LLM costs, feature adoption

## Cost Estimate
- **XS Warehouse**: 1 credit/hr × ~$2-3/credit
- **Auto-suspend at 60s**: Only charges when actively querying
- **Storage**: $23/TB/mo (negligible at early stage)
- **Estimated at launch**: ~$25-40/mo (mostly idle queries from Command Center)
- **At 10K users**: ~$50-100/mo
