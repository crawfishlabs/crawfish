# Common Patterns Across Claw Apps

Patterns used in all (or most) apps. Reference this when adding new features or debugging.

---

## 1. Firebase Auth Middleware

Every backend route that needs authentication uses this pattern:

```typescript
import { authMiddleware } from '@claw/auth';

// In your Express app setup:
app.use('/api', authMiddleware());

// The middleware:
// 1. Reads Authorization header (Bearer token)
// 2. Verifies token with Firebase Admin
// 3. Sets req.uid and req.user on the request
// 4. Returns 401 if invalid/missing

// Access in route handlers:
app.get('/api/profile', (req, res) => {
  const uid = req.uid;  // Set by auth middleware
  // ...
});
```

**Common issue:** Middleware order matters. Auth must come before any route that reads `req.uid`.

---

## 2. LLM Router Usage

Making AI calls through the unified router:

```typescript
import { createLLMRouter } from '@claw/llm-router';

const router = createLLMRouter({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
});

// Simple completion
const response = await router.complete({
  messages: [
    { role: 'system', content: 'You are a fitness coach.' },
    { role: 'user', content: userMessage },
  ],
  // Optional: override provider/model per call
  provider: 'openai',
  model: 'gpt-4o',
});

// Streaming
const stream = await router.stream({ messages, onToken: (token) => { ... } });
```

**Common issue:** Missing API key env var causes "model not found" — it's actually an auth failure.

---

## 3. Guardrails Middleware Chain

**Correct order matters!** Apply middleware in this exact sequence:

```typescript
import { authMiddleware } from '@claw/auth';
import { rateLimiter } from '@claw/guardrails';
import { injectionGuard } from '@claw/guardrails';
import { outputValidator } from '@claw/guardrails';

// Route setup (order = execution order):
app.post('/api/ai/chat',
  authMiddleware(),           // 1. Verify user identity
  rateLimiter({ max: 20, windowMs: 60000 }), // 2. Rate limit (before expensive ops)
  injectionGuard(),           // 3. Check input for prompt injection
  handleAIChat,               // 4. Your route handler (calls LLM)
  outputValidator({           // 5. Validate AI output (runs after handler)
    requireDisclaimer: true,  //    Ensures disclaimer is appended
    blockPII: true,           //    Strips PII from responses
  })
);
```

**Why this order:**
- Auth first: reject unauthenticated requests cheaply
- Rate limit second: prevent abuse before expensive processing
- Injection guard third: catch malicious input before it reaches the LLM
- Output validator last: ensure AI responses meet safety requirements

**Common issue:** If disclaimer isn't showing, check that `outputValidator` is AFTER the route handler, not before.

---

## 4. Feature Flag Checking

### Backend (TypeScript)
```typescript
import { getFeatureFlag } from '@claw/feature-flags';

// Check a flag
const isEnabled = await getFeatureFlag('new_workout_ui', {
  userId: req.uid,
  // Optional targeting attributes
  platform: 'ios',
  appVersion: '1.0.0',
});

if (isEnabled) {
  // New behavior
} else {
  // Default behavior
}
```

### iOS (Swift)
```swift
import ClawFeatureFlags

// Check a flag (async)
let isEnabled = await FeatureFlags.shared.isEnabled("new_workout_ui")

// In SwiftUI views
struct WorkoutView: View {
    @FeatureFlag("new_workout_ui") var useNewUI

    var body: some View {
        if useNewUI {
            NewWorkoutView()
        } else {
            LegacyWorkoutView()
        }
    }
}
```

**Common issue:** Flags are cached. After changing a flag in Firestore, the app may take up to 5 minutes to reflect the change. Force refresh with `FeatureFlags.shared.refresh()`.

---

## 5. Experiment Assignment

```typescript
import { assignExperiment } from '@claw/experiments';

// Assign user to a variant
const variant = await assignExperiment('onboarding_flow_v2', {
  userId: req.uid,
});
// variant = 'control' | 'variant_a' | 'variant_b'

// Track conversion
await trackExperimentConversion('onboarding_flow_v2', {
  userId: req.uid,
  metric: 'completed_onboarding',
  value: 1,
});
```

**How it works:** First call assigns and persists the variant in Firestore (`experiments/{experimentId}/assignments/{userId}`). Subsequent calls return the same variant.

---

## 6. Support Ticket Creation

```typescript
import { createTicket } from '@claw/support';

await createTicket({
  userId: req.uid,
  category: 'bug',           // 'bug' | 'feature' | 'billing' | 'general'
  subject: 'Workout not saving',
  description: 'When I try to...',
  appName: 'fitness',
  metadata: {
    appVersion: '1.0.0',
    platform: 'ios',
    deviceModel: 'iPhone 15 Pro',
  },
});
```

Tickets are stored in Firestore: `supportTickets/{ticketId}`. The admin dashboard (claw-web) reads from this collection.

---

## 7. Sentiment Collection

Trigger micro-reactions at natural moments in the user flow:

```typescript
import { collectSentiment } from '@claw/sentiment';

await collectSentiment({
  userId: req.uid,
  trigger: 'post_workout',       // When to show
  context: { workoutId: '...' }, // Additional context
  reaction: 'thumbs_up',        // User's reaction
  score: 4,                     // 1-5 scale (optional)
});
```

### Trigger Points Across Apps:
- **Fitness:** After completing workout, after AI coach response
- **Nutrition:** After logging meal, after viewing daily summary
- **Budget:** After completing monthly review, after AI categorization
- **Meetings:** After viewing meeting summary, after action items extracted

---

## 8. Observability — Adding Logging

```typescript
import { logger, withTrace } from '@claw/observability';

// Structured logging
logger.info('Workout created', { userId: req.uid, workoutId: workout.id });
logger.warn('Rate limit approaching', { userId: req.uid, count: 18, limit: 20 });
logger.error('LLM call failed', { error: err.message, provider: 'openai' });

// Trace a function (auto-measures duration, catches errors)
const result = await withTrace('createWorkout', async (span) => {
  span.setAttribute('userId', req.uid);
  const workout = await db.collection('workouts').add(data);
  return workout;
});
```

---

## 9. Analytics — Tracking Events

```typescript
import { trackEvent } from '@claw/analytics';

// Track user actions
await trackEvent({
  userId: req.uid,
  event: 'workout_completed',
  properties: {
    duration: 3600,
    exerciseCount: 8,
    workoutType: 'strength',
  },
});
```

### Standard Events Across Apps:
- `app_opened`, `session_started`, `session_ended`
- `signup_completed`, `onboarding_completed`
- `feature_used` (with `featureName` property)
- `ai_response_received` (with `provider`, `latencyMs`)
- `error_occurred` (with `errorType`, `errorMessage`)

---

## 10. Error Handling Pattern

```typescript
import { reportError } from '@claw/observability';

// In route handlers:
app.post('/api/workouts', async (req, res) => {
  try {
    const result = await createWorkout(req.uid, req.body);
    res.json(result);
  } catch (error) {
    // Report to observability
    reportError(error, {
      userId: req.uid,
      route: 'POST /api/workouts',
      body: req.body,
    });

    // Return appropriate status
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});
```

Every app should follow this pattern. Never return raw error messages to users in production — they may contain sensitive details.
