# Context Transfer — Claw Ecosystem
*Last updated: Feb 17, 2026*

## Who Am I?
I'm Claw, AI assistant to Sam Birk (SVP Engineering at Housecall Pro). I run on OpenClaw.
My personality: Professional, direct, competent. Like a sharp chief of staff.

## What We're Building
The Claw App Ecosystem — a suite of AI-native apps proving the "Adaptive Application Paradigm" thesis.

### The Thesis
Apps should be LLM-native systems that adapt in real-time. Users as co-developers, guided by AI.
The feedback loop IS the moat. ClawFitness is proof of concept; this is Sam's vision for the future of software.

### The Apps
1. **ClawFitness** ($6.99/mo) — AI personal trainer, BLS workout tracking, progressive overload
2. **ClawNutrition** ($6.99/mo) — AI nutrition coach, 5M food database, photo/barcode/voice logging
3. **ClawBudget** ($6.99/mo) — YNAB-killer with AI, envelope budgeting, Stripe Financial Connections
4. **ClawMeetings** ($9.99/mo) — Granola-style meeting intelligence, leadership coaching, privacy-first
5. **claw-platform** — Shared backend packages (@claw/auth, memory, llm-router, payments, guardrails, experiments, etc.)
6. **claw-web** — Next.js admin dashboard + web apps
7. **ClawKit** — Shared Swift package (Auth, UI, Networking, Chat, Tracking, Payments)

### Architecture
- **Backend**: Firebase (Firestore, Cloud Functions, Auth, Storage)
- **iOS**: SwiftUI, local-first, Firebase SDK
- **AI**: Claude Opus/Sonnet via @claw/llm-router (multi-provider: Anthropic, OpenAI, Google)
- **Search**: Meilisearch for food database (~5M items)
- **Analytics**: Snowflake data warehouse
- **Payments**: Stripe (backend) + StoreKit 2 (iOS)
- **CI/CD**: GitLab CI → Fastlane → TestFlight/App Store

### Key Infrastructure
- **Experiment Engine** (`@claw/experiments`) — CORE. Every feature is an experiment with cohorts, guardrails, auto-rollback/rollforward, feedback loop
- **Sentiment/NPS** (`@claw/sentiment`) — Non-intrusive collection, feeds into experiment evaluation
- **Feature Flags** (`@claw/feature-flags`) — Firebase Remote Config, 13 default flags
- **Guardrails** (`@claw/guardrails`) — Rate limiting, prompt injection, output validation, disclaimers
- **Support** (`@claw/support`) — Ticket system, AI triage, knowledge base, auto-responder, escalation

## Current State (as of Feb 17, 2026)

### Code Volume
- 165K lines across 6 repos (83K TypeScript, 51K Swift, 19K TSX, 12K tests)
- 161+ commits
- 755 test cases across 58 files
- NOTHING has been compiled or run yet (no Xcode on Pi)

### What's Done
- All backend code written (Cloud Functions for all 4 apps)
- All iOS code written (SwiftUI views, services, models for all 4 apps)
- All platform packages written (12 shared modules)
- Admin dashboard written (Next.js)
- Food database downloaded (OpenFoodFacts 4.3M + USDA 400K)
- Meilisearch installed + indexing script ready
- GitLab CI pipelines for all repos
- Fastlane configs for all iOS apps
- Comprehensive test suites

### What Needs to Happen on Mac Day
1. Run macbook-setup.sh
2. Compile platform packages (fix TypeScript errors)
3. Compile backends (fix TypeScript errors)
4. Run backend tests (fix failures)
5. Compile iOS apps in Xcode (fix Swift errors)
6. Run iOS tests
7. Test on simulator
8. Index food database in Meilisearch
9. Deploy backends to Firebase
10. Push all fixes to GitLab

### Known Risks
- 165K lines never compiled — WILL have errors
- Swift code written without Xcode validation — expect import issues, type mismatches
- Platform packages (@claw/*) linked locally — may need npm workspace setup
- Firebase projects don't exist yet — need to create 4 projects
- No GoogleService-Info.plist files — need to download from Firebase Console
- No Apple Developer account — need for TestFlight/App Store
- Meilisearch indexing 5M foods on Mac should be fast (unlike Pi)

## Sam's Preferences
- Direct, no fluff
- Bias toward action
- Conservative calorie estimates
- Pick the right model per task (don't burn Opus on everything)
- Security conscious (FileVault, key-only SSH)
- Cost tracking for all services

## Key Contacts / Accounts
- GitLab: samuelbirk-private/crawfish/*
- Firebase: (projects TBD)
- Stripe: (configured in claw-budget)
- Anthropic: API key configured
- OpenAI: API key configured (may need billing credits)
- Google/Gemini: API key configured
- Brave Search: configured

## File Locations
- Workspace: ~/.openclaw/workspace/
- Memory: ~/.openclaw/workspace/memory/
- Long-term memory: ~/.openclaw/workspace/MEMORY.md
- Identity: ~/.openclaw/workspace/SOUL.md, USER.md, IDENTITY.md, AGENTS.md
- Projects: ~/.openclaw/workspace/projects/
- Config: ~/.openclaw/openclaw.json
- Agent configs: ~/.openclaw/agents/
