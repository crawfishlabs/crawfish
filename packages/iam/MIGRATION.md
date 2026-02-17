# IAM Migration Guide

## Per-App Backend Migration

For each app (fitness, nutrition, budget, meetings):

### 1. Install `@claw/iam`
```bash
npm install @claw/iam
```

### 2. Replace auth middleware

**Before** (per-app auth):
```typescript
import { authMiddleware } from './middleware/auth';
router.get('/workouts', authMiddleware, handler);
```

**After** (unified IAM):
```typescript
import { IAMService, createIAMMiddleware } from '@claw/iam';
import * as admin from 'firebase-admin';

// Initialize once at app startup
const iamApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'crawfish-iam',
}, 'iam');

const iamService = new IAMService({
  firebaseApp: iamApp,
  crossAppSecret: process.env.CROSS_APP_SECRET!,
});

const { iamAuth, aiQuota, requirePermission } = createIAMMiddleware(iamService);

// Routes
router.get('/workouts', iamAuth({ requireApp: 'fitness' }), handler);
router.post('/ai/chat', iamAuth({ requireApp: 'fitness' }), aiQuota('fitness'), handler);
router.put('/budgets/:id', iamAuth({ requireApp: 'budget' }), requirePermission('budget', 'write'), handler);
```

### 3. Wire Stripe webhooks
```typescript
import { IAMBilling, createIAMRoutes } from '@claw/iam';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const billing = new IAMBilling({
  stripe,
  iamService,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
});

// Mount IAM routes
app.use(createIAMRoutes({ iamService, billing, stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET! }));
```

### 4. Remove old auth files
- Delete `middleware/auth.ts`
- Delete local user models
- Remove per-app Firebase Auth initialization

## Per-App iOS Migration

### 1. Add CrawfishAuth package
In Xcode: File → Add Package → path to `claw-platform/swift/CrawfishAuth`

### 2. Replace auth
```swift
// Before
import LocalAuth
AuthService.shared.signIn(...)

// After
import CrawfishAuth
try await CrawfishAuth.shared.signIn(email: email, password: password)
```

### 3. Replace auth UI
```swift
// Before
LoginView() // local

// After
import CrawfishAuthUI
LoginView() // from CrawfishAuthUI — handles all sign-in methods
```

### 4. Add upgrade prompts
```swift
if !CrawfishAuth.shared.hasAccess(app: .fitness) {
    UpgradePromptView(appId: .fitness, featureName: "Workout AI") {
        dismiss()
    } onUpgrade: {
        // Open checkout
    }
}
```

### 5. Remove old files
- Delete `AuthService.swift`
- Delete local `LoginView.swift`, `SignUpView.swift`
