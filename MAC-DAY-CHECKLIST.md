# Mac Day Checklist — Tuesday Feb 18, 2026

## Legal (Do First)
- [ ] File **Crawfish Labs LLC** — Maryland SDAT online (~$100, 10 min)
- [ ] Get **EIN** from IRS (free, instant online: https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online)
- [ ] Open business bank account (separate from personal)
- [ ] Register Apple Developer as **Organization** under Crawfish Labs LLC ($99)

## Environment Setup
- [ ] Xcode installed + command line tools (`xcode-select --install`)
- [ ] Homebrew installed
- [ ] Node 22 + npm (`brew install node@22`)
- [ ] Firebase CLI (`npm i -g firebase-tools && firebase login`)
- [ ] CocoaPods (`sudo gem install cocoapods`)
- [ ] Meilisearch (`brew install meilisearch`)
- [ ] All 6 repos cloned/synced to MacBook
- [ ] .env files created in each `backend/functions/` (see TESTING-PLAN.md for template)

## Firebase Setup
- [ ] Firebase project: `claw-fitness-dev`
- [ ] Firebase project: `claw-nutrition-dev`
- [ ] Firebase project: `claw-budget-dev`
- [ ] Firebase project: `claw-meetings-dev`
- [ ] Firestore enabled in each project
- [ ] Auth enabled (Email/Password + Apple Sign-In) in each project
- [ ] GoogleService-Info.plist downloaded → placed in each iOS app

## Apple Developer
- [ ] Apple Developer account set up
- [ ] Signing certificate created
- [ ] Fastlane match initialized (if using)

## Platform Packages (do first!)
- [ ] `packages/observability` — build ✓ test ✓
- [ ] `packages/analytics` — build ✓ test ✓
- [ ] `packages/auth` — build ✓ test ✓
- [ ] `packages/feature-flags` — build ✓ test ✓
- [ ] `packages/experiments` — build ✓ test ✓
- [ ] `packages/guardrails` — build ✓ test ✓
- [ ] `packages/llm-router` — build ✓ test ✓
- [ ] `packages/memory` — build ✓ test ✓
- [ ] `packages/payments` — build ✓ test ✓
- [ ] `packages/support` — build ✓ test ✓
- [ ] `packages/sentiment` — build ✓ test ✓

## Fitness App
- [ ] Backend: `npm install` ✓
- [ ] Backend: `npm run build` — ERRORS FIXED ✓
- [ ] Backend: `npm test` — FAILURES FIXED ✓
- [ ] iOS: SPM resolve ✓
- [ ] iOS: Xcode build — ERRORS FIXED ✓
- [ ] iOS: Xcode test (Cmd+U) ✓
- [ ] iOS: Run on simulator ✓
- [ ] iOS: Manual smoke test (log a workout) ✓

## Nutrition App
- [ ] Backend: `npm install` ✓
- [ ] Backend: `npm run build` — ERRORS FIXED ✓
- [ ] Backend: `npm test` — FAILURES FIXED ✓
- [ ] iOS: SPM resolve ✓
- [ ] iOS: Xcode build — ERRORS FIXED ✓
- [ ] iOS: Xcode test (Cmd+U) ✓
- [ ] iOS: Run on simulator ✓
- [ ] iOS: Manual smoke test (log a meal) ✓

## Budget App
- [ ] Backend: `npm install` ✓
- [ ] Backend: `npm run build` — ERRORS FIXED ✓
- [ ] Backend: `npm test` — FAILURES FIXED ✓
- [ ] iOS: SPM resolve ✓
- [ ] iOS: Xcode build — ERRORS FIXED ✓
- [ ] iOS: Xcode test (Cmd+U) ✓
- [ ] iOS: Run on simulator ✓
- [ ] iOS: Manual smoke test (create envelope, log transaction) ✓

## Meetings App
- [ ] Backend: `npm install` ✓
- [ ] Backend: `npm run build` — ERRORS FIXED ✓
- [ ] Backend: `npm test` — FAILURES FIXED ✓
- [ ] iOS: SPM resolve ✓
- [ ] iOS: Xcode build — ERRORS FIXED ✓
- [ ] iOS: Xcode test (Cmd+U) ✓
- [ ] iOS: Run on simulator ✓
- [ ] iOS: Manual smoke test (record & transcribe) ✓

## Web App
- [ ] `npm install` ✓
- [ ] `npm run dev` — builds ✓
- [ ] `npm test` — passes ✓
- [ ] Admin dashboard loads ✓

## Integration & Final
- [ ] Meilisearch running + food data indexed
- [ ] `firebase emulators:start` works for all projects
- [ ] Full integration test (iOS → Backend → Firestore round-trip)
- [ ] All fixes committed and pushed to GitLab

## Notes / Blockers
_Write issues here as you encounter them:_

-
-
-
