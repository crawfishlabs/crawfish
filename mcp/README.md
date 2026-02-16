# Claw Platform MCP Gateway

Unified MCP (Model Context Protocol) server that combines all Claw platform applications into a single interface for LLM integration.

## Overview

The Claw Platform MCP Gateway provides a single entry point for accessing:
- **ClawFitness** - Workout tracking and fitness coaching
- **ClawNutrition** - Meal logging and nutrition coaching  
- **ClawMeetings** - Meeting transcription and leadership coaching
- **ClawBudget** - Budget management and financial coaching

## Installation

```bash
npm install -g mcp-server-claw
```

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration file:

```json
{
  "mcpServers": {
    "claw": {
      "command": "npx",
      "args": ["mcp-server-claw"],
      "env": {
        "CLAW_TOKEN": "your-oauth-token-here"
      }
    }
  }
}
```

### OpenClaw

Add to your OpenClaw MCP configuration:

```json
{
  "servers": {
    "claw": {
      "command": ["npx", "mcp-server-claw"],
      "env": {
        "CLAW_TOKEN": "${CLAW_TOKEN}",
        "CLAW_FITNESS_API": "https://us-central1-claw-fitness-prod.cloudfunctions.net/api",
        "CLAW_NUTRITION_API": "https://us-central1-claw-nutrition-prod.cloudfunctions.net/api", 
        "CLAW_MEETINGS_API": "https://us-central1-claw-meetings-prod.cloudfunctions.net/api",
        "CLAW_BUDGET_API": "https://us-central1-claw-budget-prod.cloudfunctions.net/api"
      }
    }
  }
}
```

## Available Tools

### Cross-Domain Tools

#### `get_daily_overview(date?)`
Get a comprehensive daily overview combining data from all Claw apps:
- Today's workouts and fitness progress
- Meals logged and nutrition summary
- Meeting schedule and action items
- Daily spending and budget status

**Example:**
```javascript
get_daily_overview() // Today's overview
get_daily_overview({ date: "2024-02-15" }) // Specific date
```

#### `ask_claw(message, context?)`
Ask any question - automatically routes to the appropriate AI coach:
- Fitness questions → ClawFitness Coach
- Nutrition questions → ClawNutrition Coach  
- Meeting/leadership questions → ClawMeetings Coach
- Budget/finance questions → ClawBudget Coach

**Example:**
```javascript
ask_claw({ message: "How many calories should I eat to lose weight?" })
ask_claw({ message: "What should I focus on in my workout today?" })
ask_claw({ message: "How can I improve my leadership skills?" })
ask_claw({ message: "Am I overspending this month?" })
```

### Fitness Tools (fitness_*)

- `fitness_log_workout(exercises, duration?, notes?, date?)` - Log a workout
- `fitness_get_workout_history(limit?, from?, to?)` - Get workout history

### Nutrition Tools (nutrition_*)

- `nutrition_log_meal(description, meal_type?, date?)` - Log a meal
- `nutrition_get_daily_summary(date?)` - Get daily nutrition summary

### Meetings Tools (meetings_*)

- `meetings_get_upcoming(days?)` - Get upcoming meetings
- `meetings_get_action_items(status?)` - Get action items

### Budget Tools (budget_*)

- `budget_add_transaction(payee, amount, category?, account?, date?)` - Add transaction
- `budget_get_current(month?)` - Get current budget overview

## Resources

### Unified Resources
- `fitness://workouts` - Recent workout history
- `fitness://programs` - Available training programs
- `nutrition://today` - Today's meals and macros
- `nutrition://goals` - Current nutrition goals
- `meetings://today` - Today's meeting schedule
- `meetings://actions` - Open action items
- `budget://current` - Current month budget
- `budget://accounts` - All accounts with balances

## Authentication

Requires a single OAuth token that works across all Claw apps:

1. Sign in to any Claw app web interface
2. Go to Settings > API Access  
3. Generate new OAuth token with all scopes
4. Add token to MCP configuration as `CLAW_TOKEN`

## Smart Routing

The gateway automatically routes requests to the appropriate service:

- **Fitness keywords**: workout, exercise, gym, training, fitness, muscle, strength
- **Nutrition keywords**: food, meal, eat, nutrition, calorie, protein, diet  
- **Meetings keywords**: meeting, leadership, team, action, agenda
- **Budget keywords**: budget, money, spend, finance, transaction, account

## Error Handling

If individual services are unavailable, the gateway gracefully handles errors:
- Cross-domain tools return partial data with error indicators
- Individual service tools return specific error messages
- Resources show service availability status

## Development

```bash
git clone https://github.com/claw-platform/claw-platform
cd claw-platform/mcp
npm install
npm run dev
```

## License

MIT