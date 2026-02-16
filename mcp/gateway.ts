#!/usr/bin/env node

/**
 * Claw Platform MCP Gateway
 * Unified MCP server that combines all Claw apps into a single interface
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Service configurations
const SERVICES = {
  fitness: {
    name: 'ClawFitness',
    api: process.env.CLAW_FITNESS_API || 'https://us-central1-claw-fitness-prod.cloudfunctions.net/api',
    prefix: 'fitness_',
    resourcePrefix: 'fitness://',
  },
  nutrition: {
    name: 'ClawNutrition', 
    api: process.env.CLAW_NUTRITION_API || 'https://us-central1-claw-nutrition-prod.cloudfunctions.net/api',
    prefix: 'nutrition_',
    resourcePrefix: 'nutrition://',
  },
  meetings: {
    name: 'ClawMeetings',
    api: process.env.CLAW_MEETINGS_API || 'https://us-central1-claw-meetings-prod.cloudfunctions.net/api',
    prefix: 'meetings_',
    resourcePrefix: 'meetings://',
  },
  budget: {
    name: 'ClawBudget',
    api: process.env.CLAW_BUDGET_API || 'https://us-central1-claw-budget-prod.cloudfunctions.net/api',
    prefix: 'budget_',
    resourcePrefix: 'budget://',
  },
};

// Server configuration
const server = new Server(
  {
    name: 'claw-platform-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// OAuth token from environment
const CLAW_TOKEN = process.env.CLAW_TOKEN;

if (!CLAW_TOKEN) {
  console.error('CLAW_TOKEN environment variable is required');
  process.exit(1);
}

// HTTP helper
async function apiRequest(service: string, endpoint: string, options: RequestInit = {}) {
  const baseUrl = SERVICES[service].api;
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${CLAW_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new McpError(ErrorCode.InternalError, `${SERVICES[service].name} API Error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Cross-domain tools
      {
        name: 'get_daily_overview',
        description: 'Get comprehensive daily overview combining fitness, nutrition, meetings, and budget',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
          },
        },
      },
      {
        name: 'ask_claw',
        description: 'Ask any question - routes to appropriate AI coach based on content',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            context: {
              type: 'object',
              description: 'Additional context to help with routing'
            },
          },
          required: ['message'],
        },
      },

      // Fitness tools (prefixed)
      {
        name: 'fitness_log_workout',
        description: 'Log a workout with exercises and sets',
        inputSchema: {
          type: 'object',
          properties: {
            exercises: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  exercise_id: { type: 'string' },
                  sets: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        reps: { type: 'number' },
                        weight: { type: 'number' },
                        rpe: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
            duration: { type: 'number' },
            notes: { type: 'string' },
            date: { type: 'string', format: 'date' },
          },
          required: ['exercises'],
        },
      },
      {
        name: 'fitness_get_workout_history',
        description: 'Get workout history',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', default: 20 },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
          },
        },
      },

      // Nutrition tools (prefixed)
      {
        name: 'nutrition_log_meal',
        description: 'Log a meal with food description',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            meal_type: {
              type: 'string',
              enum: ['breakfast', 'lunch', 'dinner', 'snack']
            },
            date: { type: 'string', format: 'date' },
          },
        },
      },
      {
        name: 'nutrition_get_daily_summary',
        description: 'Get daily nutrition summary',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
          },
        },
      },

      // Meetings tools (prefixed)
      {
        name: 'meetings_get_upcoming',
        description: 'Get upcoming meetings',
        inputSchema: {
          type: 'object',
          properties: {
            days: { type: 'number', default: 7 },
          },
        },
      },
      {
        name: 'meetings_get_action_items',
        description: 'Get action items',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'completed', 'cancelled']
            },
          },
        },
      },

      // Budget tools (prefixed)
      {
        name: 'budget_add_transaction',
        description: 'Add a financial transaction',
        inputSchema: {
          type: 'object',
          properties: {
            payee: { type: 'string' },
            amount: { type: 'number' },
            category: { type: 'string' },
            account: { type: 'string' },
            date: { type: 'string', format: 'date' },
          },
          required: ['payee', 'amount'],
        },
      },
      {
        name: 'budget_get_current',
        description: 'Get current month budget overview',
        inputSchema: {
          type: 'object',
          properties: {
            month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          },
        },
      },
    ],
  };
});

// Tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Cross-domain tools
    if (name === 'get_daily_overview') {
      return await getDailyOverview(args.date);
    }

    if (name === 'ask_claw') {
      return await routeToCoach(args.message, args.context);
    }

    // Route prefixed tools to appropriate service
    for (const [serviceKey, service] of Object.entries(SERVICES)) {
      if (name.startsWith(service.prefix)) {
        const toolName = name.substring(service.prefix.length);
        return await executeServiceTool(serviceKey, toolName, args);
      }
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error.message}`);
  }
});

// Cross-domain tool implementations
async function getDailyOverview(date?: string) {
  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    // Fetch data from all services in parallel
    const [fitnessData, nutritionData, meetingsData, budgetData] = await Promise.allSettled([
      apiRequest('fitness', `/workouts?from=${targetDate}&to=${targetDate}`).catch(e => null),
      apiRequest('nutrition', `/dashboard/daily?date=${targetDate}`).catch(e => null),
      apiRequest('meetings', `/calendar/events?days=1`).catch(e => null),
      apiRequest('budget', `/transactions?from_date=${targetDate}&to_date=${targetDate}&limit=10`).catch(e => null),
    ]);

    const overview = {
      date: targetDate,
      fitness: fitnessData.status === 'fulfilled' ? fitnessData.value : { error: 'Service unavailable' },
      nutrition: nutritionData.status === 'fulfilled' ? nutritionData.value : { error: 'Service unavailable' },
      meetings: meetingsData.status === 'fulfilled' ? meetingsData.value : { error: 'Service unavailable' },
      budget: budgetData.status === 'fulfilled' ? budgetData.value : { error: 'Service unavailable' },
      generated_at: new Date().toISOString(),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(overview, null, 2),
        },
      ],
    };
  } catch (error) {
    throw new McpError(ErrorCode.InternalError, `Daily overview failed: ${error.message}`);
  }
}

async function routeToCoach(message: string, context?: any) {
  // Simple routing logic based on message content
  const lowerMessage = message.toLowerCase();
  
  let service = 'fitness'; // default
  let endpoint = '/coach/chat';

  if (lowerMessage.includes('food') || lowerMessage.includes('eat') || lowerMessage.includes('meal') || 
      lowerMessage.includes('nutrition') || lowerMessage.includes('calorie')) {
    service = 'nutrition';
  } else if (lowerMessage.includes('meeting') || lowerMessage.includes('leadership') || 
             lowerMessage.includes('team') || lowerMessage.includes('action')) {
    service = 'meetings';
    endpoint = '/leadership/coach';
  } else if (lowerMessage.includes('budget') || lowerMessage.includes('money') || 
             lowerMessage.includes('spend') || lowerMessage.includes('finance')) {
    service = 'budget';
  }

  try {
    const response = await fetch(`${SERVICES[service].api}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLAW_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ message, context }),
    });

    if (!response.ok) {
      throw new Error(`Coach API Error: ${response.status}`);
    }

    const result = await response.json();
    return {
      content: [
        {
          type: 'text',
          text: `[${SERVICES[service].name} Coach]: ${result.response}`,
        },
      ],
    };
  } catch (error) {
    throw new McpError(ErrorCode.InternalError, `Coach routing failed: ${error.message}`);
  }
}

async function executeServiceTool(service: string, toolName: string, args: any) {
  // Map tool names to API endpoints
  const toolMappings = {
    fitness: {
      log_workout: { method: 'POST', endpoint: '/workouts' },
      get_workout_history: { method: 'GET', endpoint: '/workouts' },
    },
    nutrition: {
      log_meal: { method: 'POST', endpoint: '/meals' },
      get_daily_summary: { method: 'GET', endpoint: '/dashboard/daily' },
    },
    meetings: {
      get_upcoming: { method: 'GET', endpoint: '/calendar/events' },
      get_action_items: { method: 'GET', endpoint: '/actions' },
    },
    budget: {
      add_transaction: { method: 'POST', endpoint: '/transactions' },
      get_current: { method: 'GET', endpoint: '/budget' },
    },
  };

  const mapping = toolMappings[service]?.[toolName];
  if (!mapping) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${service}_${toolName}`);
  }

  const options: RequestInit = {
    method: mapping.method,
  };

  if (mapping.method === 'POST' || mapping.method === 'PUT') {
    options.body = JSON.stringify(args);
  } else if (mapping.method === 'GET' && Object.keys(args).length > 0) {
    const params = new URLSearchParams();
    Object.entries(args).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    mapping.endpoint += `?${params.toString()}`;
  }

  const result = await apiRequest(service, mapping.endpoint, options);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

// Resource definitions
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      // Fitness resources
      {
        uri: 'fitness://workouts',
        mimeType: 'application/json',
        name: 'Recent workout history',
        description: 'List of recent workouts with exercises and stats',
      },
      {
        uri: 'fitness://programs',
        mimeType: 'application/json',
        name: 'Available training programs', 
        description: 'Training programs available to start',
      },

      // Nutrition resources
      {
        uri: 'nutrition://today',
        mimeType: 'application/json',
        name: 'Today\'s meals and macros',
        description: 'Current day nutrition summary',
      },
      {
        uri: 'nutrition://goals',
        mimeType: 'application/json',
        name: 'Nutrition goals',
        description: 'Current calorie and macro targets',
      },

      // Meetings resources
      {
        uri: 'meetings://today',
        mimeType: 'application/json',
        name: 'Today\'s schedule',
        description: 'Upcoming meetings for today',
      },
      {
        uri: 'meetings://actions',
        mimeType: 'application/json',
        name: 'Open action items',
        description: 'All open action items across meetings',
      },

      // Budget resources
      {
        uri: 'budget://current',
        mimeType: 'application/json',
        name: 'Current month budget',
        description: 'Complete budget for current month',
      },
      {
        uri: 'budget://accounts',
        mimeType: 'application/json',
        name: 'All accounts with balances',
        description: 'Complete account list with balances',
      },
    ],
  };
});

// Resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  try {
    // Route resource requests to appropriate service
    for (const [serviceKey, service] of Object.entries(SERVICES)) {
      if (uri.startsWith(service.resourcePrefix)) {
        const resourceName = uri.substring(service.resourcePrefix.length);
        return await readServiceResource(serviceKey, resourceName, uri);
      }
    }

    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(ErrorCode.InternalError, `Resource read failed: ${error.message}`);
  }
});

async function readServiceResource(service: string, resourceName: string, uri: string) {
  const resourceMappings = {
    fitness: {
      workouts: '/workouts?limit=10',
      programs: '/programs',
    },
    nutrition: {
      today: '/dashboard/daily',
      goals: '/goals',
    },
    meetings: {
      today: '/calendar/events?days=1',
      actions: '/actions?status=open',
    },
    budget: {
      current: `/budget/${new Date().toISOString().substring(0, 7)}`,
      accounts: '/accounts',
    },
  };

  const endpoint = resourceMappings[service]?.[resourceName];
  if (!endpoint) {
    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${resourceName} for ${service}`);
  }

  const result = await apiRequest(service, endpoint);

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Claw Platform MCP Gateway running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});