# Claw Ecosystem — Master Testing Plan

**Target Date:** Tuesday, Feb 18, 2026
**Context:** All code written on Raspberry Pi without Xcode. Nothing compiled or run yet. Expect issues at every stage.
**Total Estimated Time:** ~9 hours

---

## Phase 1: Environment Setup (30 min)

### 1.1 Install Core Tools
```bash
# Xcode (install from App Store first — takes ~30 min, start this FIRST)
xcode-select --install

# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node 22
brew install node@22
echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node --version  # Should show v22.x

# Firebase CLI
npm install -g firebase-tools
firebase login

# CocoaPods
sudo gem install cocoapods

# Meilisearch
brew install meilisearch
```

### 1.2 Clone/Sync All Repos
```bash
mkdir -p ~/projects/claw
cd ~/projects/claw

# Option A: Clone from GitLab
git clone git@gitlab.com:claw-app/claw-platform.git
git clone git@gitlab.com:claw-app/claw-fitness.git
git clone git@gitlab.com:claw-app/claw-nutrition.git
git clone git@gitlab.com:claw-app/claw-budget.git
git clone git@gitlab.com:claw-app/claw-meetings.git
git clone git@gitlab.com:claw-app/claw-web.git

# Option B: Sync from Pi
rsync -avz sam@pi-hostname:~/projects/claw/ ~/projects/claw/
```

### 1.3 Environment Variables
Create `.env` in each app's `backend/functions/` directory:
```bash
# Template — adjust per app
FIREBASE_PROJECT_ID=claw-<app>-dev
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_API_KEY=your-key
STRIPE_SECRET_KEY=sk_test_...        # budget only
STRIPE_WEBHOOK_SECRET=whsec_...      # budget only
USDA_API_KEY=...                     # nutrition only
```

### 1.4 Firebase Projects
Create 4 Firebase projects (if not already existing):
- `claw-fitness-dev`
- `claw-nutrition-dev`
- `claw-budget-dev`
- `claw-meetings-dev`

For each:
1. Go to https://console.firebase.google.com
2. Create project → Enable Firestore, Auth (Email/Password + Apple Sign-In), Functions
3. Download `GoogleService-Info.plist` → place in each iOS app's root directory
4. Generate service account key → save as `serviceAccountKey.json` in `backend/functions/`

### 1.5 Verify Setup
```bash
node --version      # v22.x
npm --version       # 10.x
firebase --version  # 13.x
pod --version       # 1.x
xcodebuild -version # Xcode 16.x
meilisearch --version
```

---

## Phase 2: Platform Packages First (1 hour)

**Order matters!** Some packages depend on others. Build in this order:

### Build Order
1. `observability` — no deps on other claw packages
2. `analytics` — no deps
3. `auth` — depends on observability
4. `feature-flags` — depends on auth
5. `experiments` — depends on feature-flags, auth
6. `guardrails` — depends on auth, observability
7. `llm-router` — depends on guardrails, observability
8. `memory` — depends on auth, llm-router
9. `payments` — depends on auth, observability
10. `support` — depends on auth, observability
11. `sentiment` — depends on auth, analytics

### For Each Package
```bash
cd claw-platform/packages/<package>
npm install
npm run build    # Fix TypeScript errors
npm test         # Fix failing tests
```

### Package Reference

| Package | Purpose | Expected Tests |
|---------|---------|---------------|
| auth | Firebase Auth middleware, token verification, user context | 15-20 |
| memory | Conversation memory with Firestore persistence | 10-15 |
| llm-router | Multi-provider LLM routing (OpenAI, Anthropic, etc.) | 20-25 |
| payments | Stripe integration, subscription management | 10-15 |
| observability | Structured logging, error reporting, tracing | 10-15 |
| analytics | Event tracking, user analytics pipeline | 8-12 |
| guardrails | Input validation, output filtering, rate limiting | 25-30 |
| support | Ticket creation, admin management | 10-15 |
| feature-flags | Feature flag evaluation, LaunchDarkly-style | 10-15 |
| experiments | A/B testing, variant assignment, analysis | 15-20 |
| sentiment | Micro-reaction collection, sentiment scoring | 8-12 |

### Common Issues — Phase 2
- **Missing peer deps:** `npm install` may warn about peer dependencies. Install them explicitly.
- **TypeScript version:** Ensure all packages use the same TS version. Check root `package.json`.
- **firebase-admin init:** Packages that use Firebase must not call `initializeApp()` at import time. It should be lazy or injected.
- **`npm link` for local deps:** If package A depends on package B:
  ```bash
  cd packages/B && npm link
  cd packages/A && npm link @claw/B
  ```

---

## Phase 3: Backend Functions (2 hours)

### For Each App (fitness, nutrition, budget, meetings)

```bash
cd claw-<app>/backend/functions
npm install
npm run build
npm test
```

### 3.1 TypeScript Compilation
Fix errors in order of frequency:
1. **Import path issues** — relative paths may be wrong
2. **Missing types** — install `@types/*` packages
3. **Strict mode** — `strictNullChecks` will catch nullable values
4. **Firebase Admin types** — `Timestamp`, `DocumentReference`, etc.

### 3.2 Run Tests
```bash
npm test                    # All tests
npm test -- --grep "unit"   # Unit tests only
npm test -- --grep "e2e"    # E2E tests (need emulators)
```

### 3.3 Firebase Emulators
```bash
firebase emulators:start --project claw-<app>-dev
# Emulators: Auth (:9099), Firestore (:8080), Functions (:5001)
```

### 3.4 Test API Endpoints
```bash
# Get auth token first
TOKEN=$(curl -s -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123","returnSecureToken":true}' | jq -r '.idToken')

# Fitness examples
curl -H "Authorization: Bearer $TOKEN" http://localhost:5001/claw-fitness-dev/us-central1/api/workouts
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"exercise":"bench press","sets":3,"reps":10}' \
  http://localhost:5001/claw-fitness-dev/us-central1/api/workouts

# Nutrition examples
curl -H "Authorization: Bearer $TOKEN" http://localhost:5001/claw-nutrition-dev/us-central1/api/foods/search?q=apple
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"barcode":"0012345678905"}' \
  http://localhost:5001/claw-nutrition-dev/us-central1/api/foods/barcode

# Budget examples
curl -H "Authorization: Bearer $TOKEN" http://localhost:5001/claw-budget-dev/us-central1/api/envelopes
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":50.00,"category":"groceries","description":"Whole Foods"}' \
  http://localhost:5001/claw-budget-dev/us-central1/api/transactions

# Meetings examples
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: multipart/form-data" \
  -F "audio=@test-audio.m4a" \
  http://localhost:5001/claw-meetings-dev/us-central1/api/meetings/transcribe
```

### 3.5 Deploy to Dev
```bash
firebase deploy --only functions --project claw-<app>-dev
```

### Common Issues — Phase 3
- **Circular imports:** Backend may have circular dependencies. Look for "ReferenceError: Cannot access X before initialization"
- **Missing env vars:** Functions need `.env` or `firebase functions:config:set` for secrets
- **Firestore rules:** Default rules deny all access. Deploy rules: `firebase deploy --only firestore:rules`
- **Wrong collection paths:** Verify Firestore paths match between iOS and backend (e.g., `users/{uid}/workouts` vs `workouts`)
- **ES modules vs CommonJS:** If using `"type": "module"` in package.json, ensure Jest config matches

---

## Phase 4: iOS Apps (3 hours)

### For Each App (fitness, nutrition, budget, meetings)

### 4.1 Open & Resolve Dependencies
```bash
cd claw-<app>/ios
open ClawFitness.xcodeproj  # or .xcworkspace if using CocoaPods
```

In Xcode:
1. File → Packages → Resolve Package Versions (wait for SPM)
2. If using CocoaPods: `pod install` first, then open `.xcworkspace`

### 4.2 Fix Compilation Errors
Expected error categories (in order of likelihood):

1. **Missing modules** — SPM didn't resolve, or package URL wrong in Package.swift
2. **Deployment target** — Set to iOS 16.0+ in project settings
3. **Signing** — Select your development team
4. **Info.plist keys** — Missing privacy descriptions (camera, microphone, etc.)
5. **Firebase config** — GoogleService-Info.plist not added to target
6. **SwiftUI API changes** — Some APIs differ between iOS versions
7. **Bundle ID mismatch** — Must match Firebase project config

### 4.3 Required Info.plist Keys by App

**Fitness:**
- `NSHealthShareUsageDescription` (HealthKit read)
- `NSHealthUpdateUsageDescription` (HealthKit write)
- `UIBackgroundModes` → `processing` (workout timer)

**Nutrition:**
- `NSCameraUsageDescription` (barcode scanner, food photo)
- `NSPhotoLibraryUsageDescription` (food photo from gallery)

**Budget:**
- `NSFaceIDUsageDescription` (biometric auth for financial data)

**Meetings:**
- `NSMicrophoneUsageDescription` (audio recording)
- `NSSpeechRecognitionUsageDescription` (on-device transcription)

### 4.4 Run on Simulator
1. Select iPhone 15 Pro simulator
2. Cmd+R to build and run
3. Test login flow first (Firebase Auth)
4. Test core feature (log workout / log food / create budget / record meeting)

### 4.5 Run Tests
- Cmd+U to run all unit tests
- Check test navigator for failures

### Common Issues — Phase 4
- **GoogleService-Info.plist:** Must be added to the correct target. Verify bundle ID matches.
- **SPM cache:** If packages fail to resolve: File → Packages → Reset Package Caches
- **Simulator not booting:** Delete derived data: `rm -rf ~/Library/Developer/Xcode/DerivedData`
- **SwiftUI previews crash:** Add `#if DEBUG` guards around preview providers
- **Minimum deployment target:** All targets and dependencies must agree on iOS 16+

---

## Phase 5: Web App (1 hour)

```bash
cd claw-web
npm install
```

### 5.1 Development Server
```bash
npm run dev
# Open http://localhost:3000
```

### 5.2 Environment Variables
Create `.env.local`:
```bash
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
FIREBASE_ADMIN_SDK_KEY=...   # Server-side only (no NEXT_PUBLIC_ prefix)
NEXT_PUBLIC_API_BASE_URL=http://localhost:5001
```

### 5.3 Tests
```bash
npm test                # Vitest unit tests
npx playwright install  # Install browsers first
npx playwright test     # E2E tests
```

### 5.4 Manual Testing
- [ ] Admin login works
- [ ] Support ticket list loads
- [ ] Experiment dashboard shows data
- [ ] Feature flag toggle works
- [ ] User management page loads

### Common Issues — Phase 5
- **Hydration errors:** Server/client HTML mismatch. Check for `typeof window` guards.
- **Tailwind not loading:** Verify `tailwind.config.js` content paths include all component directories
- **CORS:** API routes may need CORS headers for cross-origin requests
- **`NEXT_PUBLIC_` prefix:** Client-side env vars MUST have this prefix or they'll be undefined

---

## Phase 6: Integration Testing (1 hour)

### 6.1 Full Round-Trip Test
1. Start all emulators (4 terminals):
   ```bash
   cd claw-fitness/backend && firebase emulators:start &
   cd claw-nutrition/backend && firebase emulators:start &
   cd claw-budget/backend && firebase emulators:start &
   cd claw-meetings/backend && firebase emulators:start &
   ```
2. Run each iOS app on simulator
3. Perform core action → verify data appears in Firestore emulator UI

### 6.2 Feature Flags
```bash
# Set a flag via Firestore
curl -X POST "http://localhost:8080/v1/projects/claw-fitness-dev/databases/(default)/documents/featureFlags" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"enabled":{"booleanValue":true},"name":{"stringValue":"new_workout_ui"}}}'
```
Verify the iOS app respects the flag.

### 6.3 Experiments
1. Create experiment in admin dashboard
2. Open iOS app — verify variant assignment
3. Check Firestore for experiment assignment document

### 6.4 Support
1. Create support ticket from iOS app
2. Verify it appears in claw-web admin dashboard

### 6.5 Sentiment
1. Trigger a micro-reaction in iOS app (e.g., after completing a workout)
2. Verify sentiment data appears in Firestore

---

## Phase 7: Meilisearch Food Database (30 min)

### 7.1 Start Meilisearch
```bash
meilisearch --master-key="your-master-key" --db-path=./meili-data
```

### 7.2 Index Food Data
```bash
cd claw-nutrition/backend/scripts
node index-foods.js  # or npm run index-foods
```

### 7.3 Test Search
```bash
curl "http://localhost:7700/indexes/foods/search" \
  -H "Authorization: Bearer your-master-key" \
  -H "Content-Type: application/json" \
  -d '{"q": "apple", "limit": 5}'
```

### 7.4 Test from Nutrition App
- Open nutrition app on simulator
- Search for "chicken breast"
- Scan a barcode (use simulator camera override or manual entry)

### Common Issues — Phase 7
- **OOM on indexing:** Process large dataset in batches (10k documents at a time)
- **Connection refused:** Ensure Meilisearch is running and port 7700 is not blocked
- **Empty results:** Check index name matches what the app expects

---

## Success Criteria

At the end of the day, all of these should be true:
- [ ] All platform packages build and pass tests
- [ ] All 4 backend functions compile, pass tests, and deploy
- [ ] All 4 iOS apps build and run on simulator
- [ ] claw-web builds and runs locally
- [ ] At least one full integration test passes per app
- [ ] All fixes committed and pushed to GitLab
