# How OpenClaw Actually Works — And How Our Apps Should Copy It

## The Core Insight

OpenClaw has **no orchestration framework**. No LangGraph, no LangChain, no agent graph. It's:

```
System Prompt + Memory Files + Conversation History + Tool Calls → Claude → Response
```

That's it. The "intelligence" comes from Claude being good at deciding what to do, not from a framework telling it what to do. Here's exactly how each piece works and what our apps should steal.

---

## OpenClaw Architecture (from source)

### The Agent Loop (`agent-loop.md`)

Every interaction follows this cycle:

1. **Intake** — message arrives from Telegram/WhatsApp/Slack/etc.
2. **Context Assembly** — system prompt + workspace files (SOUL.md, USER.md, AGENTS.md) + memory files + conversation history + tool definitions
3. **Model Inference** — Claude sees everything and decides what to do
4. **Tool Execution** — if Claude calls tools (exec, read, write, web_search, etc.), they run and results go back into context
5. **Loop** — Claude sees tool results and decides: respond to user, or call more tools
6. **Reply** — final response streams to the user

**Key insight**: Steps 3-5 loop automatically. Claude decides when to stop. There is no hardcoded "max steps" or "tool chain." The model IS the orchestrator.

### Memory (`memory.md`)

- **MEMORY.md** — curated long-term memory (manually maintained markdown file)
- **memory/YYYY-MM-DD.md** — daily logs (append-only)
- **Vector search** — semantic search over memory files (sqlite + embeddings)
- **Pre-compaction flush** — before context gets summarized, a silent turn reminds the model to save anything important to files

**No database, no vector DB, no RAG pipeline.** Just markdown files + a small sqlite index for search. The model reads files, writes files, and searches files.

### Sub-Agents (`session-tool.md`)

`sessions_spawn` creates an isolated session with:
- Its own context window (fresh, not shared with parent)
- Its own model (can be different — Sonnet for sub-agents, Opus for main)
- Full tool access (minus session tools — no sub-agent spawning sub-agents)
- An announce step that posts results back to the parent chat

**Sub-agents are NOT graph nodes.** They're independent conversations that happen to report back. The parent doesn't "orchestrate" them — it fires and forgets, then gets a notification when they finish.

### Multi-Agent (`multi-agent.md`)

Multiple fully isolated agents can run on one gateway:
- Separate workspaces, memory, auth, sessions
- Routing via bindings (channel/peer/account matching)
- Agent-to-agent messaging (opt-in, allowlisted)

### Compaction (`compaction.md`)

When context gets too long:
1. Silent memory flush (save important stuff to files)
2. Summarize older conversation into a compact summary
3. Keep recent messages intact
4. Continue with summary + recent context

**This is how the model maintains continuity across long sessions without infinite context.**

### Session Management (`session.md`)

- Sessions reset daily (4am) or on idle timeout
- Per-peer isolation available for multi-user
- Send policy controls who can message which sessions
- JSONL transcripts for full history

---

## What Our Apps Should Steal

### Pattern 1: The Model IS the Orchestrator

**OpenClaw way**: Claude decides what tools to call and when to stop.
**App equivalent**: Don't build pipelines. Let the LLM decide the workflow.

```typescript
// ❌ Hardcoded pipeline (what most apps do)
async function analyzeMeeting(audio: Buffer) {
  const transcript = await transcribe(audio);
  const summary = await summarize(transcript);
  const actions = await extractActions(transcript);
  const scores = await scoreLeadership(transcript);
  return { summary, actions, scores };
}

// ✅ Agent-style (what OpenClaw does)
async function analyzeMeeting(audio: Buffer, userContext: UserMemory) {
  const transcript = await transcribe(audio); // This is always step 1
  
  return await routeLLMCall('meetings:analyze', 
    `Analyze this meeting. Here's the transcript and the user's context.
     Decide what analysis is valuable based on the meeting type and content.
     For a 1:1, focus on coaching and action items.
     For an all-hands, focus on decisions and announcements.
     For a retro, focus on action items and sentiment.
     Extract what matters. Skip what doesn't.`,
    { transcript, userContext }
  );
}
```

The model decides depth and focus based on content. A retro gets different analysis than a 1:1 without us hardcoding that logic.

### Pattern 2: Memory as Files, Not Infrastructure

**OpenClaw way**: Markdown files, edited by the model, searched by embeddings.
**App equivalent**: Per-user memory in Firestore, structured as readable docs.

```typescript
// User memory document (Firestore)
// users/{userId}/memory/profile
{
  summary: "Sam is a 41yo SVP of Engineering doing BLS 5-Day Split...",
  preferences: {
    calorieEstimates: "conservative",
    units: "imperial",
    communicationStyle: "direct, no fluff"
  },
  patterns: {
    workoutDays: ["Mon", "Tue", "Thu", "Fri", "Sat"],
    typicalMealTimes: ["7am", "12pm", "6pm"],
    budgetPainPoints: ["dining out", "subscriptions"]
  },
  lastUpdated: "2026-02-16"
}
```

The LLM reads this before every interaction and updates it periodically — exactly like I read MEMORY.md.

### Pattern 3: Sub-Agents for Parallel Work

**OpenClaw way**: `sessions_spawn` fires independent sessions that report back.
**App equivalent**: Background Cloud Functions that run independently and store results.

```typescript
// After a meeting is transcribed, spawn parallel analysis
async function onMeetingTranscribed(meetingId: string, transcript: string) {
  // Fire all in parallel — each is independent
  await Promise.all([
    spawnAnalysis('meetings:analyze', meetingId, transcript),
    spawnAnalysis('meetings:extract-actions', meetingId, transcript),
    spawnAnalysis('meetings:leadership-score', meetingId, transcript),
    spawnAnalysis('meetings:meeting-prep', meetingId, transcript), // prep for next meeting with same people
  ]);
  // Results stored in Firestore, UI updates reactively
}
```

No orchestrator needed. Each task is independent. If leadership scoring fails, the summary still works.

### Pattern 4: Context Window as Working Memory

**OpenClaw way**: Everything relevant is stuffed into the system prompt + conversation. The model has full context for every decision.
**App equivalent**: Every LLM call includes relevant user context.

```typescript
async function coachChat(userId: string, message: string) {
  const memory = await getUserMemory(userId);       // Long-term memory
  const recentWorkouts = await getRecentWorkouts(userId, 7); // Last week
  const todayNutrition = await getDailyNutrition(userId);    // Today's intake
  const budget = await getBudgetSummary(userId);              // Monthly budget status
  
  // Stuff it all into context — let the model decide what's relevant
  return await routeLLMCall('fitness:coach-chat', message, {
    memory,
    recentWorkouts,
    todayNutrition,
    budget  // Cross-domain context
  });
}
```

### Pattern 5: Compaction = Memory Refresh

**OpenClaw way**: When context gets long, summarize and continue.
**App equivalent**: Weekly memory refresh agent distills recent activity into updated profile.

```typescript
// Weekly scheduled function
async function refreshUserMemory(userId: string) {
  const recentActivity = await getLast7Days(userId);
  const currentMemory = await getUserMemory(userId);
  
  const updatedMemory = await routeLLMCall('cross:memory-refresh',
    `Here's the user's current memory profile and their last 7 days of activity.
     Update the profile with new patterns, preferences, and notable changes.
     Remove anything that's no longer accurate.
     Keep it concise — this gets included in every future interaction.`,
    { currentMemory, recentActivity }
  );
  
  await saveUserMemory(userId, updatedMemory);
}
```

### Pattern 6: No Framework, Just Good Prompts + Tools

**OpenClaw way**: The system prompt tells Claude what tools exist and how to behave. Claude figures out the rest.
**App equivalent**: Well-crafted prompts + clear tool definitions > any framework.

The prompt store we built IS our "framework." Each task type has:
- A system prompt that defines behavior
- Temperature and token limits
- Template variables for user context
- A model assignment via the router

That's functionally equivalent to a LangGraph node definition — but without the framework overhead, vendor lock-in, or abstraction layers.

---

## When to Break This Pattern

The patterns above handle ~95% of our use cases. For the remaining 5%:

### Iterative Planning (Budget Debt Payoff)
**Problem**: Needs to try allocation → check constraints → adjust → retry
**Solution**: Don't use a framework. Use a **tool-calling loop** — give the LLM a `check_constraints` tool and let it iterate. Claude already does this naturally with tool calls (steps 3-5 of the agent loop).

```typescript
// Give the LLM tools to iterate
const tools = [
  { name: 'simulate_allocation', description: 'Test a budget allocation against constraints' },
  { name: 'check_goal_progress', description: 'Check if goals are met with current allocation' },
  { name: 'get_expense_history', description: 'Get historical spending for a category' },
];

// The LLM will naturally loop: simulate → check → adjust → simulate again
const result = await routeLLMCall('budget:plan', 
  `Create a debt payoff plan. Goals: ${goals}. Constraints: ${constraints}. 
   Use the simulation tools to test allocations. Iterate until all constraints are satisfied.`,
  { userContext },
  { tools, maxTokens: 4000 }
);
```

### Multi-Step with External APIs (Meeting Follow-Up)
**Problem**: Need to call Slack, Calendar, email in sequence with error handling
**Solution**: Use **Cloud Functions chaining** with error recovery — not an agent graph.

```typescript
// Pub/Sub chain — each step is a separate function
// Step 1: Extract actions (LLM)
// Step 2: For each action → publish to "action-followup" topic
// Step 3: action-followup function: check assignee's Slack → send message → create calendar block
// Step 4: If any step fails → publish to "action-followup-retry" with backoff

// This is just event-driven architecture — no framework needed.
```

### Real-Time Stateful Coaching
**Problem**: Need to maintain state across rapid interactions (live workout)
**Solution**: Use **in-memory state** (Redis or just a Firestore doc) + short-context LLM calls.

```typescript
// Workout session state (Firestore doc, updated in real-time)
const sessionState = {
  currentExercise: 'Barbell Deadlift',
  currentSet: 3,
  completedSets: [
    { weight: 315, reps: 8, rpe: 8 },
    { weight: 315, reps: 7, rpe: 9 },
  ],
  restTimerActive: true,
  restStartedAt: Date.now(),
};

// Each interaction is still a single LLM call — but with full session state
const coaching = await routeLLMCall('fitness:live-coach',
  `Set 2 complete: 315x7, felt harder. What should I do for set 3?`,
  { sessionState, userMemory }
);
// Model has full context, decides: "Drop to 305" or "Stay at 315, aim for 6"
```

---

## Summary: The OpenClaw Way

| Principle | Implementation |
|-----------|---------------|
| Model is the orchestrator | LLM decides what tools to call and when to stop |
| Memory is files | Markdown/Firestore docs, not vector DBs |
| Sub-agents are independent | Fire-and-forget with announce back |
| Context is king | Stuff relevant data into every call |
| Compaction = refresh | Periodically summarize and update memory |
| No framework | Good prompts + tools > any abstraction layer |
| Iterate with tools | Give LLM simulation/check tools, it loops naturally |

**The secret: Claude is already a good orchestrator. You don't need to orchestrate it.**
