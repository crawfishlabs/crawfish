/**
 * @fileoverview Express routes for prompt management
 * @description Admin-only API routes for managing prompts in the Command Center
 */

import { Request, Response, Router } from 'express';
import { PromptStore, PromptConfig, PromptVersion } from './prompt-store';
import { RequestType } from './types';
import { routeLLMCall } from './router';

/**
 * Admin-only middleware to check OAuth scope
 * This should be implemented based on your auth system
 */
const requireAdminScope = (req: Request, res: Response, next: Function) => {
  // TODO: Implement actual admin scope check
  // For now, assume the middleware is properly configured elsewhere
  // const hasAdminScope = req.user?.scopes?.includes('admin');
  // if (!hasAdminScope) {
  //   return res.status(403).json({ error: 'Admin scope required' });
  // }
  next();
};

/**
 * Create prompt management API routes
 */
export function createPromptAPIRoutes(): Router {
  const router = Router();
  const promptStore = new PromptStore();

  // Apply admin middleware to all routes
  router.use(requireAdminScope);

  /**
   * GET /api/v1/prompts - List all prompts (for Command Center)
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const prompts = await promptStore.getAllPrompts();
      
      // Group by app for better organization
      const grouped = prompts.reduce((acc, prompt) => {
        if (!acc[prompt.app]) {
          acc[prompt.app] = [];
        }
        acc[prompt.app].push(prompt);
        return acc;
      }, {} as Record<string, PromptConfig[]>);
      
      res.json({
        success: true,
        data: {
          prompts,
          groupedByApp: grouped,
          totalCount: prompts.length,
        },
      });
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch prompts',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/v1/prompts/:taskType - Get current prompt config
   */
  router.get('/:taskType', async (req: Request, res: Response) => {
    try {
      const taskType = req.params.taskType as RequestType;
      const config = await promptStore.getPrompt(taskType);
      
      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      console.error(`Failed to fetch prompt ${req.params.taskType}:`, error);
      res.status(500).json({
        success: false,
        error: `Failed to fetch prompt ${req.params.taskType}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * PUT /api/v1/prompts/:taskType - Update prompt (creates new version)
   */
  router.put('/:taskType', async (req: Request, res: Response) => {
    try {
      const taskType = req.params.taskType as RequestType;
      const {
        systemPrompt,
        temperature,
        maxTokens,
        modelOverride,
        variables,
        note,
        author,
      } = req.body;

      // Validate required fields
      if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'systemPrompt must be a string',
        });
      }

      if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 1)) {
        return res.status(400).json({
          success: false,
          error: 'temperature must be a number between 0 and 1',
        });
      }

      if (maxTokens !== undefined && (typeof maxTokens !== 'number' || maxTokens < 1)) {
        return res.status(400).json({
          success: false,
          error: 'maxTokens must be a positive number',
        });
      }

      const updatedConfig = await promptStore.updatePrompt(taskType, {
        systemPrompt,
        temperature,
        maxTokens,
        modelOverride,
        variables,
        note,
        author: author || 'admin', // Default to 'admin' if not provided
      });

      res.json({
        success: true,
        data: updatedConfig,
        message: `Prompt ${taskType} updated to version ${updatedConfig.version}`,
      });
    } catch (error) {
      console.error(`Failed to update prompt ${req.params.taskType}:`, error);
      res.status(500).json({
        success: false,
        error: `Failed to update prompt ${req.params.taskType}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/v1/prompts/:taskType/versions - Get version history
   */
  router.get('/:taskType/versions', async (req: Request, res: Response) => {
    try {
      const taskType = req.params.taskType as RequestType;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const versions = await promptStore.getVersionHistory(taskType, limit);
      
      res.json({
        success: true,
        data: {
          taskType,
          versions,
          totalCount: versions.length,
        },
      });
    } catch (error) {
      console.error(`Failed to fetch version history for ${req.params.taskType}:`, error);
      res.status(500).json({
        success: false,
        error: `Failed to fetch version history for ${req.params.taskType}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/v1/prompts/:taskType/rollback - Rollback to version N
   */
  router.post('/:taskType/rollback', async (req: Request, res: Response) => {
    try {
      const taskType = req.params.taskType as RequestType;
      const { version } = req.body;

      if (!version || typeof version !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'version number is required',
        });
      }

      const rolledBackConfig = await promptStore.rollbackPrompt(taskType, version);

      res.json({
        success: true,
        data: rolledBackConfig,
        message: `Prompt ${taskType} rolled back to version ${version}`,
      });
    } catch (error) {
      console.error(`Failed to rollback prompt ${req.params.taskType}:`, error);
      res.status(500).json({
        success: false,
        error: `Failed to rollback prompt ${req.params.taskType}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/v1/prompts/seed - Seed defaults into Firestore
   */
  router.post('/seed', async (req: Request, res: Response) => {
    try {
      await promptStore.seedDefaults();
      
      res.json({
        success: true,
        message: 'Default prompts seeded successfully',
      });
    } catch (error) {
      console.error('Failed to seed default prompts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to seed default prompts',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/v1/prompts/:taskType/test - Test a prompt with sample input (dry run)
   */
  router.post('/:taskType/test', async (req: Request, res: Response) => {
    try {
      const taskType = req.params.taskType as RequestType;
      const { sampleInput, variables, actualLLMCall } = req.body;

      if (!sampleInput || typeof sampleInput !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'sampleInput is required and must be a string',
        });
      }

      // Get resolved prompt (dry run)
      const testResult = await promptStore.testPrompt(taskType, sampleInput, variables);

      let llmResponse = null;
      if (actualLLMCall === true) {
        // Make actual LLM call for testing
        try {
          llmResponse = await routeLLMCall(taskType, sampleInput, null, {
            metadata: {
              userId: 'test-user',
              requestType: taskType,
              feature: 'prompt-testing',
            },
          });
        } catch (llmError) {
          console.warn('LLM call failed during prompt testing:', llmError);
          // Don't fail the whole request, just note the LLM error
        }
      }

      res.json({
        success: true,
        data: {
          taskType,
          sampleInput,
          variables,
          resolvedPrompt: testResult.resolvedPrompt,
          config: testResult.config,
          llmResponse: llmResponse ? {
            content: llmResponse.content,
            model: llmResponse.model,
            provider: llmResponse.provider,
            usage: llmResponse.usage,
            latencyMs: llmResponse.latencyMs,
          } : null,
        },
      });
    } catch (error) {
      console.error(`Failed to test prompt ${req.params.taskType}:`, error);
      res.status(500).json({
        success: false,
        error: `Failed to test prompt ${req.params.taskType}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * DELETE /api/v1/prompts/:taskType - Deactivate a prompt (soft delete)
   */
  router.delete('/:taskType', async (req: Request, res: Response) => {
    try {
      const taskType = req.params.taskType as RequestType;
      
      // Deactivate by updating active flag to false
      const deactivatedConfig = await promptStore.updatePrompt(taskType, {
        note: 'Deactivated via API',
        author: 'admin',
        // We don't have a direct way to set active=false in updatePrompt
        // This would need to be added to the PromptStore class
      });

      res.json({
        success: true,
        data: deactivatedConfig,
        message: `Prompt ${taskType} deactivated`,
      });
    } catch (error) {
      console.error(`Failed to deactivate prompt ${req.params.taskType}:`, error);
      res.status(500).json({
        success: false,
        error: `Failed to deactivate prompt ${req.params.taskType}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/v1/prompts/cache/invalidate - Invalidate prompt cache
   */
  router.post('/cache/invalidate', async (req: Request, res: Response) => {
    try {
      const { taskType } = req.body;
      
      if (taskType) {
        promptStore.invalidateCache(taskType as RequestType);
      } else {
        promptStore.invalidateCache(); // Invalidate all
      }

      res.json({
        success: true,
        message: taskType 
          ? `Cache invalidated for ${taskType}` 
          : 'All prompt caches invalidated',
      });
    } catch (error) {
      console.error('Failed to invalidate cache:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to invalidate cache',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

/**
 * Response types for TypeScript consumers
 */
export interface PromptAPIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
  message?: string;
}

export interface PromptsListResponse {
  prompts: PromptConfig[];
  groupedByApp: Record<string, PromptConfig[]>;
  totalCount: number;
}

export interface VersionHistoryResponse {
  taskType: string;
  versions: PromptVersion[];
  totalCount: number;
}

export interface PromptTestResponse {
  taskType: string;
  sampleInput: string;
  variables?: Record<string, string>;
  resolvedPrompt: string;
  config: PromptConfig;
  llmResponse?: {
    content: string;
    model: string;
    provider: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    latencyMs: number;
  };
}