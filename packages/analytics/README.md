# @claw/analytics — BigQuery Analytics Pipeline

Cross-app analytics and reporting for the Claw ecosystem.

## Architecture

```
Firebase/Firestore → BigQuery Export Extension → BigQuery (automatic)
Cloud Functions → EventPublisher → BigQuery Streaming Inserts (real-time)
BigQuery → Views → Dashboard API → Command Center
BigQuery → Reports → Scheduled Cloud Functions → Notifications
```

## Setup

```bash
export GOOGLE_CLOUD_PROJECT=your-project-id
./setup-bigquery.sh          # Create datasets, tables, views
./setup-bigquery.sh --dry-run # Preview without changes
```

### Prerequisites
- Google Cloud project with BigQuery enabled
- `bq` CLI installed (`gcloud components install bq`)
- Firebase BigQuery Export extension enabled

## Datasets

| Dataset | Contents |
|---------|----------|
| `claw_fitness` | Workouts, exercises, sets, body measurements, coaching |
| `claw_nutrition` | Food logs, meals, water, daily summaries, coaching |
| `claw_meetings` | Meetings, transcripts, action items, leadership scores |
| `claw_budget` | Transactions, budgets, accounts, goals, coaching |
| `claw_cross_app` | Users, subscriptions, LLM usage, feature events, errors |

## Usage

### Track events from Cloud Functions
```typescript
import { EventPublisher } from '@claw/analytics';

const analytics = new EventPublisher();
await analytics.track('workout_completed', { userId, workoutId, duration });
```

### Dashboard API (for Command Center)
```typescript
import { DashboardAPI } from '@claw/analytics';

const api = new DashboardAPI();
app.use('/api/v1/analytics', api.router);
```

### Reports
```typescript
import { WeeklyExecutiveReport } from '@claw/analytics';
const report = new WeeklyExecutiveReport();
const data = await report.generate();
```

## Pre-built SQL Queries
- `queries/overview.sql` — DAU/WAU/MAU, revenue, key metrics
- `queries/fitness-analytics.sql` — Volume trends, PR progression
- `queries/nutrition-analytics.sql` — Calorie compliance, macro balance
- `queries/meetings-analytics.sql` — Leadership trends, action item rates
- `queries/budget-analytics.sql` — Spending trends, budget adherence
- `queries/cross-app.sql` — Cross-app correlation, LLM costs

## Views
- `daily_active_users` — Union across all 4 apps
- `monthly_revenue` — Stripe revenue aggregated
- `llm_cost_by_task` — Cost per model per task per app
- `user_health_score` — Composite engagement score

## Cost
- **Free tier**: 1TB queries/mo, 10GB storage
- **At scale**: ~$5/TB queried, $0.02/GB/mo storage
- **Estimated cost at 10K users**: ~$5-15/mo
