# Claw LLM Router

Intelligent task-based model selection system for all Claw applications with quality-first routing, budget enforcement, and comprehensive cost tracking.

## Overview

The Claw LLM Router provides centralized, intelligent model selection across all 4 Claw apps (Fitness, Nutrition, Meetings, Budget) with three routing preferences and automatic budget enforcement.

### Key Features

- **🎯 Task-based routing**: 25+ specific request types optimized for each app
- **🏆 Quality-first**: Prefers quality over cost (configurable)  
- **💰 Budget enforcement**: Automatic preference downgrading when limits approached
- **📊 Cost tracking**: Real-time usage monitoring and trend analysis
- **🔄 Fallback support**: Automatic provider failover
- **⚡ Performance**: Intelligent caching and rate limiting
- **🛡️ Error handling**: Comprehensive retry logic and logging

## Quick Start

```typescript
import { routeLLMCall, setRoutingPreference } from '@claw/llm-router';

// Configure global preference (quality/balanced/cost)
setRoutingPreference('quality'); // Default: prefer quality over cost

// Route a fitness coaching conversation
const response = await routeLLMCall(
  'fitness:coach-chat',
  'How should I progress my bench press?',
  { userGoals: 'strength', experience: 'intermediate' },
  { 
    metadata: { userId: 'user123' },
    preferenceOverride: 'balanced' // Optional: override for this call
  }
);

console.log(`Response: ${response.content}`);
console.log(`Model: ${response.provider}/${response.model}`);
console.log(`Cost: $${response.estimatedCost.toFixed(4)}`);
```

## Request Types

### Fitness App (`fitness:*`)

| Request Type | Model (Quality) | Model (Balanced) | Model (Cost) | Use Case |
|--------------|-----------------|------------------|--------------|----------|
| `fitness:coach-chat` | Opus 4 | Sonnet 4 | Sonnet 4 | Complex coaching conversations |
| `fitness:workout-analysis` | Sonnet 4 | Sonnet 4 | Haiku 3.5 | Analyze workout data & form |
| `fitness:exercise-recommend` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Recommend exercises |
| `fitness:form-check` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Check exercise form |
| `fitness:quick-lookup` | Sonnet 4 | Haiku 3.5 | Flash 2.0 | Exercise info, plate math |

### Nutrition App (`nutrition:*`)

| Request Type | Model (Quality) | Model (Balanced) | Model (Cost) | Use Case |
|--------------|-----------------|------------------|--------------|----------|
| `nutrition:meal-scan` | GPT-4o | GPT-4o | GPT-4o mini | Photo → food recognition |
| `nutrition:meal-text` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Text → calorie estimation |
| `nutrition:coach-chat` | Sonnet 4 | Sonnet 4 | Sonnet 4 | Nutrition coaching |
| `nutrition:barcode-enrich` | Haiku 3.5 | Haiku 3.5 | Flash 2.0 | Enrich barcode data |
| `nutrition:weekly-insights` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Pattern analysis |
| `nutrition:quick-log` | Haiku 3.5 | Haiku 3.5 | Flash 2.0 | Simple food logging |

### Meetings App (`meetings:*`)

| Request Type | Model (Quality) | Model (Balanced) | Model (Cost) | Use Case |
|--------------|-----------------|------------------|--------------|----------|
| `meetings:transcribe` | GPT-4o | GPT-4o | GPT-4o mini | Audio → text transcription |
| `meetings:analyze` | Opus 4 | Sonnet 4 | Haiku 3.5 | Full meeting analysis |
| `meetings:extract-actions` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Pull action items |
| `meetings:leadership-score` | Opus 4 | Opus 4 | Sonnet 4 | Score competencies (nuanced) |
| `meetings:leadership-coach` | Opus 4 | Opus 4 | Sonnet 4 | High-stakes coaching |
| `meetings:meeting-prep` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Prep briefs & agendas |
| `meetings:search` | Haiku 3.5 | Flash 2.5 | Flash 2.0 | NL search transcripts |
| `meetings:summarize` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Quick summaries |

### Budget App (`budget:*`)

| Request Type | Model (Quality) | Model (Balanced) | Model (Cost) | Use Case |
|--------------|-----------------|------------------|--------------|----------|
| `budget:categorize` | Haiku 3.5 | Haiku 3.5 | Flash 2.0 | Auto-categorize transactions |
| `budget:coach-chat` | Sonnet 4 | Sonnet 4 | Sonnet 4 | Financial coaching |
| `budget:receipt-scan` | GPT-4o mini | GPT-4o mini | GPT-4o mini | Receipt → structured data |
| `budget:spending-analysis` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Spending patterns |
| `budget:proactive-alert` | Haiku 3.5 | Flash 2.5 | Flash 2.0 | Generate budget alerts |
| `budget:ynab-import-map` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Map YNAB categories |
| `budget:weekly-digest` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Weekly summaries |

### Cross-App (`cross:*`)

| Request Type | Model (Quality) | Model (Balanced) | Model (Cost) | Use Case |
|--------------|-----------------|------------------|--------------|----------|
| `cross:memory-refresh` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Weekly memory updates |
| `cross:daily-overview` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Cross-domain summary |
| `cross:security-review` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Code security scan |
| `cross:performance-analysis` | Sonnet 4 | Haiku 3.5 | Haiku 3.5 | Performance root cause |

## Model Pricing (Current)

| Model | Input Cost (per 1M tokens) | Output Cost (per 1M tokens) | Best For |
|-------|----------------------------|------------------------------|----------|
| **Claude Opus 4** | $15.00 | $75.00 | Complex reasoning, leadership coaching |
| **Claude Sonnet 4** | $3.00 | $15.00 | Balanced quality & cost, general coaching |
| **Claude Haiku 3.5** | $0.25 | $1.25 | Fast responses, categorization |
| **GPT-4o** | $2.50 | $10.00 | Vision tasks, strong general use |
| **GPT-4o mini** | $0.15 | $0.60 | Cheap vision, structured extraction |
| **Gemini 2.5 Pro** | $1.25 | $10.00 | Long context, competitive quality |
| **Gemini 2.5 Flash** | $0.15 | $0.60 | Fast & cheap alternative |
| **Gemini 2.0 Flash** | $0.10 | $0.40 | Ultra-cheap fallback |

## Routing Preferences

### Quality (Default)
- **Philosophy**: Best possible results, cost secondary
- **Use Cases**: Production apps, important user interactions
- **Models**: Opus 4 for reasoning, Sonnet 4 for general tasks, GPT-4o for vision
- **Avg Cost/Call**: $0.02 - $0.15

### Balanced  
- **Philosophy**: Good quality with cost consciousness
- **Use Cases**: High-volume features, non-critical tasks
- **Models**: Sonnet 4 for complex, Haiku 3.5 for simple, GPT-4o for vision
- **Avg Cost/Call**: $0.005 - $0.05

### Cost
- **Philosophy**: Minimize costs while maintaining functionality
- **Use Cases**: Development, testing, high-volume automation
- **Models**: Haiku 3.5, Flash models, GPT-4o mini for vision only
- **Avg Cost/Call**: $0.001 - $0.01

## Budget Enforcement

### Automatic Downgrading

When users approach their budget limits, the router automatically downgrades preferences:

```
User at 80% of daily limit:
Quality → Balanced → Cost (if still over budget)

User at 95% of daily limit:
Any preference → Cost (forced)
```

### Budget Configuration

```typescript
import { updateBudgetConfig } from '@claw/llm-router';

updateBudgetConfig({
  maxCostPerCall: 0.50,          // $0.50 max per call
  maxCostPerUserPerDay: 10.00,   // $10 per user per day
  maxCostPerAppPerDay: 100.00,   // $100 per app per day
  autoDowngrade: true,           // Enable auto-downgrading
  alertThresholds: [0.5, 0.8, 0.95] // Alert at 50%, 80%, 95%
});
```

### User Limits by Role

| Role | Daily Calls | Daily Cost | Features |
|------|-------------|------------|----------|
| **Free** | 10 | $1.00 | Basic routing, cost preference |
| **Pro** | 100 | $10.00 | All preferences, priority routing |
| **Premium** | 500 | $50.00 | Unlimited preferences, custom models |
| **Admin** | Unlimited | Unlimited | Full access, analytics |

## Advanced Usage

### Model Override

```typescript
// Force a specific model for one call
const response = await routeLLMCall(
  'fitness:coach-chat',
  prompt,
  context,
  { modelOverride: 'claude-haiku-3-5' } // Override routing
);
```

### Preference Override

```typescript
// Override preference for specific call
const response = await routeLLMCall(
  'nutrition:weekly-insights',
  prompt,
  context,  
  { preferenceOverride: 'cost' } // Use cost model instead of quality
);
```

### Context-Aware Routing

```typescript
// Enhanced context for better routing decisions
const response = await routeLLMCall(
  'meetings:analyze',
  transcript,
  {
    meetingType: 'leadership-review',
    participants: 8,
    duration: 60,
    isHighStakes: true
  },
  {
    metadata: {
      userId: 'user123',
      meetingId: 'mtg456',
      urgency: 'high'
    }
  }
);
```

## Cost Estimation

### Pre-Call Estimation

```typescript
import { getCostEstimate } from '@claw/llm-router';

// Estimate cost before making call
const estimatedCost = getCostEstimate(
  'anthropic',           // provider
  'claude-sonnet-4-20250514', // model
  1500,                 // estimated input tokens
  500                   // estimated output tokens
);

console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`);
```

### Cost Analysis

```typescript
import { getUserUsage, getCostTrends } from '@claw/llm-router';

// Get user's usage for last 7 days
const usage = await getUserUsage(
  'user123',
  new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
  new Date()
);

console.log(`Total cost: $${usage.totalCost.toFixed(2)}`);
console.log(`Calls made: ${usage.totalCalls}`);
console.log(`Downgrades: ${usage.downgradedCalls}`);
console.log(`Success rate: ${(usage.successRate * 100).toFixed(1)}%`);

// Get cost trends and predictions
const trends = await getCostTrends(30); // Last 30 days
console.log(`Trend: ${trends.trend} (${trends.trendPercentage.toFixed(1)}%)`);
console.log(`Projected monthly: $${trends.projectedMonthlyCost.toFixed(2)}`);
```

## Error Handling & Fallbacks

### Automatic Fallbacks

The router automatically tries fallback models when primary models fail:

```
fitness:coach-chat (Quality preference):
1. claude-opus-4-6 (primary)
2. claude-sonnet-4-20250514 (fallback 1)  
3. gpt-4o (fallback 2)
```

### Custom Error Handling

```typescript
import { LLMErrorType } from '@claw/llm-router';

try {
  const response = await routeLLMCall('fitness:coach-chat', prompt);
} catch (error) {
  if (error.errorType === LLMErrorType.RATE_LIMIT) {
    // Handle rate limiting
    console.log('Rate limited, waiting...');
    await new Promise(resolve => setTimeout(resolve, 60000));
  } else if (error.errorType === LLMErrorType.BUDGET_EXCEEDED) {
    // Handle budget limits  
    console.log('Budget exceeded for user');
  } else {
    // Handle other errors
    console.error('LLM call failed:', error.message);
  }
}
```

## Monitoring & Analytics

### Real-Time Monitoring

```typescript
import { healthCheckProviders, getRoutingStats } from '@claw/llm-router';

// Check provider health
const health = await healthCheckProviders();
console.log('Provider health:', health);
// { anthropic: true, openai: true, google: false }

// Get routing statistics
const stats = await getRoutingStats(7); // Last 7 days
console.log(`Total calls: ${stats.totalCalls}`);
console.log(`Total cost: $${stats.totalCost.toFixed(2)}`);
console.log(`Average cost: $${stats.averageCost.toFixed(4)}`);
console.log(`Preference breakdown:`, stats.byPreference);
console.log(`Provider breakdown:`, stats.byProvider);
```

### Budget Alerts

```typescript
import { checkBudgetAlerts } from '@claw/llm-router';

// Check for budget alerts
const alerts = await checkBudgetAlerts('user123');

alerts.forEach(alert => {
  console.log(`${alert.level.toUpperCase()}: ${alert.message}`);
  console.log(`Usage: ${alert.percentage.toFixed(1)}% of limit`);
});
```

## Configuration

### Environment Variables

```bash
# Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Router Configuration  
LLM_ROUTER_DEFAULT_PREFERENCE=quality
LLM_ROUTER_ENABLE_BUDGET_ENFORCEMENT=true
LLM_ROUTER_MAX_COST_PER_CALL=0.50
LLM_ROUTER_MAX_COST_PER_USER_DAY=10.00

# Logging & Monitoring
LLM_ROUTER_LOG_ALL_CALLS=true
LLM_ROUTER_ENABLE_ANALYTICS=true
```

### Runtime Configuration

```typescript
import { 
  setRoutingPreference, 
  updateRouterConfig, 
  updateBudgetConfig 
} from '@claw/llm-router';

// Global routing preference
setRoutingPreference('quality');

// Router settings
updateRouterConfig({
  preference: 'quality',
  enableFallback: true,
  logAllCalls: true
});

// Budget enforcement
updateBudgetConfig({
  maxCostPerCall: 0.50,
  maxCostPerUserPerDay: 10.00,
  autoDowngrade: true,
  alertThresholds: [0.5, 0.8, 0.95]
});
```

## Adding New Request Types

To add support for new request types:

1. **Update types.ts** - Add new request type to `RequestType` union
2. **Update router.ts** - Add routing configuration for all 3 preferences
3. **Update cost-tracker.ts** - Add any specific cost tracking logic
4. **Test thoroughly** - Ensure routing works across all preference levels

Example:

```typescript
// 1. Add to RequestType in types.ts
export type RequestType = 
  | 'fitness:coach-chat'
  | 'nutrition:meal-scan'
  | 'your-new:request-type'  // New type
  | ...

// 2. Add routing in router.ts
const MODEL_ROUTING: Record<RequestType, PreferenceRouting> = {
  'your-new:request-type': {
    quality: {
      primary: { provider: 'anthropic', model: 'claude-opus-4-6' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai', model: 'gpt-4o' }
      ],
      defaultOptions: {
        maxTokens: 1500,
        temperature: 0.4,
        systemPrompt: 'Your specialized prompt...'
      }
    },
    balanced: { /* ... */ },
    cost: { /* ... */ }
  }
}
```

## Migration Guide

### From Legacy Routing

If you're migrating from a legacy routing system:

1. **Replace direct model calls** with `routeLLMCall`
2. **Map legacy task types** to new request types  
3. **Update configuration** to use new preference system
4. **Test cost implications** with different preferences

Example migration:

```typescript
// OLD
const llmRouter = new ClawLLMRouter();
const response = await llmRouter.sendMessage({
  model: 'claude-3-5-sonnet-20241022',
  messages: [...],
  maxTokens: 2000
});

// NEW  
const response = await routeLLMCall(
  'fitness:coach-chat',    // Specific request type
  promptText,              // Single prompt string
  context,                 // Context object
  {                        // Options
    metadata: { userId: 'user123' }
  }
);
```

## Troubleshooting

### Common Issues

**High Costs**
- Check if users are on quality preference when they should be balanced/cost
- Monitor for inefficient prompt patterns  
- Implement better token estimation
- Use `preferenceOverride: 'cost'` for testing

**Rate Limiting**
- Implement exponential backoff in your application
- Distribute calls across time windows
- Use different request types to balance across models

**Poor Response Quality**
- Verify you're using appropriate request types
- Check if budget enforcement is downgrading models unexpectedly  
- Ensure context is properly structured
- Consider upgrading user tier for access to better models

**Budget Exceeded**
- Check user's daily limits and usage
- Implement usage notifications in your app
- Consider automatic plan upgrades for power users
- Use cost estimates to warn users before expensive operations

### Debug Mode

```typescript
// Enable detailed logging
process.env.LLM_ROUTER_DEBUG = 'true';

const response = await routeLLMCall('fitness:coach-chat', prompt);
// Logs will show: model selection, cost calculations, fallback attempts
```

## Contributing

To contribute to the LLM router:

1. **Add tests** for new request types or routing logic
2. **Update documentation** when changing routing behavior  
3. **Test cost implications** of routing changes
4. **Follow conventional commits** for version tracking

## Support

For issues or questions:
- **Internal**: #claw-llm-router Slack channel
- **Docs**: This README and inline code comments
- **Monitoring**: Check Firebase console for error logs
- **Costs**: View cost dashboards in admin panel

---

*Built with ❤️ for intelligent, cost-effective LLM routing across all Claw applications.*