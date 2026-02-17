# Trust Principles — Crawfish Platform

These are non-negotiable. Every product, feature, and AI interaction we build follows these principles. No exceptions.

## 1. Every AI Action Is Reviewable

Nothing the AI does is hidden. Every LLM-generated output — categorization, suggestion, fix, insight, forecast — is visible to the user with full context of how it was produced.

**In practice:**
- Transaction auto-categorized? User sees the category with a one-tap confirm/change.
- AI generated a budget? User reviews every line before it takes effect.
- Forecast says "you'll be short on the 15th"? User can tap to see the math.
- Agent pushed a code fix? Full diff visible in dashboard before it goes live.
- Receipt scanned? User confirms every extracted field.

**Never:**
- Auto-apply an LLM decision without user visibility
- Hide the reasoning behind a suggestion
- Bury corrections in a settings menu — make them inline, instant

## 2. Humans Approve, AI Proposes

The AI is an assistant, not an authority. It proposes actions. The human decides.

**Confidence tiers:**

| Confidence | Behavior | User Experience |
|-----------|----------|----------------|
| **High (>95%)** | Auto-apply, show for review | ✅ badge + "Undo" for 30 seconds |
| **Medium (70-95%)** | Suggest, wait for confirmation | 💡 "We think this is Dining Out — confirm?" |
| **Low (<70%)** | Ask explicitly | ❓ "What category is this $47 charge at AMZN?" |

Even at high confidence, the action is VISIBLE and REVERSIBLE. Auto-apply ≠ hidden.

**Graduating to background:** Over time, as we measure accuracy per user and per action type, we may auto-apply more. But:
- The user must opt in to increased automation ("Let Crawfish auto-categorize transactions it's 95%+ confident about")
- There's always a daily/weekly review digest: "Here's what I did automatically this week"
- The user can dial it back at any time

## 3. Full Audit Trail, Always

Every AI action is logged and accessible to the user. Not just for compliance — for trust.

**User-facing audit:**
- "Activity" tab in every app showing all AI actions
- Filter by: auto-applied, suggested, corrected, rejected
- Each entry shows: what the AI did, why (reasoning summary), when, and the outcome
- Exportable (CSV/JSON) for users who want to verify

**Internal audit:**
- Full LLM request/response logging (PII-scrubbed)
- Model used, tokens consumed, latency, confidence score
- User's response (approved, modified, rejected)
- Feeds into accuracy tracking and model improvement

## 4. Show Your Work

When the AI makes a suggestion, show why. Not a black box.

**Examples:**
- "Categorized as Dining Out because you've filed Chipotle there 12 times before"
- "Forecast based on: $3,200 paycheck on the 1st, $1,800 rent on the 5th, average $45/day variable spending"
- "Flagged this subscription because no transactions from Hulu in 43 days"
- "Suggested this fix because 23 users reported the same issue and the error trace points to line 47 of checkout.ts"

Users don't need to read the explanation every time. But it's ONE TAP away, always.

## 5. Corrections Make It Smarter

When a user corrects the AI, that's gold. Acknowledge it. Learn from it. Close the loop.

**Flow:**
1. AI suggests category: "Groceries"
2. User corrects to: "Pet Supplies"
3. AI responds: "Got it — I'll remember PetSmart is Pet Supplies for next time"
4. Next PetSmart transaction: auto-categorized as Pet Supplies (high confidence)
5. User sees: "Auto-categorized as Pet Supplies (learned from your correction on Jan 15)"

**Never:**
- Silently ignore a correction
- Make the same mistake repeatedly after being corrected
- Require the user to set up "rules" manually — corrections ARE the rules

## 6. No Dark Patterns

We don't use AI to manipulate users into spending more, upgrading, or staying subscribed.

- AI insights are honest, even when they're "your spending is fine, you don't need premium features"
- Cancellation is one tap, no guilt trip, no "are you sure?" dark pattern
- Free tier is genuinely useful, not crippled to force upgrades
- We never sell user data. Ever.

## 7. Accountability Reports

Regular, automatic transparency:

**Weekly Digest (optional, default on):**
- "This week, Crawfish auto-categorized 34 transactions (97% accuracy)"
- "3 were corrected by you — I've updated my patterns"
- "I flagged 2 unusual charges and 1 subscription price increase"
- "Your Safe to Spend was accurate within $12 of actual"

**Monthly Report:**
- AI accuracy metrics for that user
- What was auto-applied vs. suggested vs. asked
- Corrections and what was learned
- Forecast accuracy (predicted vs. actual cash flow)

**This is marketing, not just compliance.** Users who see "97% accuracy" trust the system more. Users who see "I learned from your 3 corrections" feel heard.

## 8. Graceful Degradation

When the AI doesn't know, it says so. It doesn't guess and hope.

- "I'm not sure what this $47 charge is — can you help me categorize it?"
- "I don't have enough history to forecast accurately yet. After 2 weeks of data, I'll be much better."
- "This receipt is blurry — I got the total ($34.50) but couldn't read the merchant. What store was this?"

Honesty > false confidence. Always.

## 9. User Controls AI Autonomy

The user decides how much the AI does automatically. Settings spectrum:

```
← Manual                                      Autonomous →
Ask me         Suggest &        Auto-apply &      Full auto
everything     wait             show for review    with digest
```

Default: "Suggest & wait" — safest starting position.
User can slide right as trust builds.
User can slide left at any time.

## 10. These Principles Apply to the Platform Too

When Crawfish Platform generates fix proposals for other developers' apps:
- Every fix is a visible PR, never a silent code change
- The diff is clear, the reasoning is documented
- Experiment results are transparent — not just "variant B won" but "here's the statistical analysis"
- Auto-pilot mode requires explicit opt-in and produces a daily digest of actions taken

## 11. Optimized Experiences — The Best of Both Worlds

"We know best" and "the customer knows best" is a false dichotomy. In an AI-native world, we can do both simultaneously.

**The concept:** Learn from power users and top performers across the entire user base what actually works — then offer those patterns as an "optimized experience" that any user can opt into, customize, or opt out of at any time.

**How it works:**

```
Aggregate data: What do the top 10% of budgeters do?
    → They categorize within 24 hours
    → They check Safe to Spend before purchases
    → They review subscriptions monthly
    → They use rollover, not fresh-start
    ↓
Offer as "Optimized Experience":
    "Based on what successful budgeters do, we'd suggest:
     • Auto-prompt to categorize daily (not weekly)
     • Safe to Spend widget on home screen
     • Monthly subscription review reminder
     Try it for 2 weeks? You can switch back anytime."
```

**Key principles:**

1. **Optimized ≠ locked.** It's a starting point, not a prison. The user can customize any individual setting while keeping the rest optimized.

2. **Transparent reasoning.** Never just "trust us." Always: "Users who do X see 23% better budget adherence. Want to try it?"

3. **Partial adoption.** User can accept some optimized suggestions and reject others. "I like the daily categorization reminder but I don't want the subscription review."

4. **Easy escape hatch.** One toggle: "Switch to optimized" / "Switch to custom." If someone's gone too far customizing and is struggling, we can suggest: "Want to try the optimized experience for a week? Based on your usage, we think [specific changes] would help."

5. **Segment-aware.** "Optimized" isn't one-size-fits-all. A college student's optimized experience differs from a dual-income family's. The AI knows which segment's power users to learn from.

6. **Evolves with data.** As more users join and we collect more data, the optimized experience gets better. This is the adaptive loop applied to UX itself, not just features.

**Per-app examples:**

| App | What optimized looks like |
|-----|--------------------------|
| **Budget** | Category structure, categorization frequency, rollover mode, Safe to Spend placement, alert thresholds |
| **Health** | Rest timer duration, progressive overload %, exercise ordering, AI coaching frequency |
| **Meetings** | Summary format, action item style, follow-up timing, sharing defaults |

**The pitch to users:** "You can set everything up yourself, or let us configure your experience based on what works best for people like you. Either way, you're always in control."

**The pitch to the platform:** This is a meta-experiment. The optimized experience IS an experiment variant — we can measure whether users who adopt it have better outcomes (retention, goal achievement, NPS) vs. fully custom users. The data feeds back into improving the optimized defaults.

---

## Implementation Checklist

For every feature that involves AI:

- [ ] Is the AI action visible to the user?
- [ ] Can the user confirm, modify, or reject it?
- [ ] Is there an undo/revert path?
- [ ] Does the UI show why the AI made this decision (one tap away)?
- [ ] Are corrections captured and used to improve?
- [ ] Is the action logged in the user-facing activity feed?
- [ ] Is the action logged in the internal audit trail?
- [ ] Does the weekly digest include this action type?
- [ ] Is accuracy tracked for this action type?
- [ ] Does the system degrade gracefully when confidence is low?

If any answer is "no" — the feature isn't ready to ship.
