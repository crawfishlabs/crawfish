/**
 * @fileoverview Firestore-based prompt configuration system
 * @description Live-editable prompts with version history, rollback, caching, and fallback
 */

import * as admin from 'firebase-admin';
import { RequestType } from './types';
import { DEFAULT_PROMPTS } from './default-prompts';

/**
 * Prompt configuration stored in Firestore
 */
export interface PromptConfig {
  /** Unique identifier, e.g., 'fitness:coach-chat' */
  id: string;
  /** Application namespace */
  app: 'fitness' | 'nutrition' | 'meetings' | 'budget' | 'cross';
  /** Task type matching RequestType */
  taskType: string;
  /** Current version number (auto-incremented) */
  version: number;
  /** The actual system prompt text */
  systemPrompt: string;
  /** Temperature override (0-1) */
  temperature?: number;
  /** Max tokens override */
  maxTokens?: number;
  /** Force specific model for this prompt */
  modelOverride?: string;
  /** Template variables like {{user_name}}, {{context}}, etc. */
  variables?: Record<string, string>;
  /** Metadata about the prompt */
  metadata: {
    /** Who last edited this prompt */
    author: string;
    /** Change note, e.g., "increased specificity for macro breakdown" */
    note?: string;
    /** Creation timestamp */
    createdAt: admin.firestore.Timestamp;
    /** Last update timestamp */
    updatedAt: admin.firestore.Timestamp;
  };
  /** Whether this prompt is active (can deactivate without deleting) */
  active: boolean;
  /** A/B testing configuration */
  abTest?: {
    /** Variant name: 'control' | 'variant_a' | 'variant_b' */
    variant: string;
    /** Traffic percentage (0-1) */
    weight: number;
  };
}

/**
 * Historical version of a prompt
 */
export interface PromptVersion {
  /** Version number */
  version: number;
  /** System prompt at this version */
  systemPrompt: string;
  /** Temperature at this version */
  temperature?: number;
  /** Max tokens at this version */
  maxTokens?: number;
  /** Who created this version */
  author: string;
  /** Change note */
  note?: string;
  /** When this version was created */
  timestamp: admin.firestore.Timestamp;
}

/**
 * Firestore-based prompt store with live editing and version history
 * 
 * Firestore collections:
 * - _prompts/{promptId} → current active config
 * - _prompts/{promptId}/versions/{versionId} → version history
 */
export class PromptStore {
  private db: admin.firestore.Firestore;
  private cache: Map<string, { config: PromptConfig; fetchedAt: number }> = new Map();
  private readonly cacheTTL: number = 60_000; // 1 minute cache

  constructor(firestore?: admin.firestore.Firestore) {
    this.db = firestore || admin.firestore();
  }

  /**
   * Get prompt config for a task type
   * 1. Check local cache (if < TTL)
   * 2. Fetch from Firestore
   * 3. Fall back to DEFAULT_PROMPTS if Firestore unavailable
   */
  async getPrompt(taskType: RequestType): Promise<PromptConfig> {
    const cacheKey = taskType;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTTL) {
      return cached.config;
    }

    try {
      // Try to fetch from Firestore
      const promptDoc = await this.db.collection('_prompts').doc(taskType).get();
      
      if (promptDoc.exists) {
        const data = promptDoc.data() as PromptConfig;
        
        // Only return if active
        if (data.active) {
          // Cache the result
          this.cache.set(cacheKey, {
            config: data,
            fetchedAt: Date.now(),
          });
          
          return data;
        }
      }
      
      // Fall back to default if not found or inactive
      return this.getDefaultPromptConfig(taskType);
      
    } catch (error) {
      console.warn(`Failed to fetch prompt for ${taskType}, falling back to default:`, error);
      return this.getDefaultPromptConfig(taskType);
    }
  }

  /**
   * Resolve template variables in prompt
   * e.g., "Hello {{user_name}}, your goal is {{goal}}" → "Hello Sam, your goal is cut"
   */
  resolveTemplate(prompt: string, variables: Record<string, string>): string {
    let resolved = prompt;
    
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      resolved = resolved.replace(new RegExp(placeholder, 'g'), value);
    }
    
    return resolved;
  }

  /**
   * Update a prompt (creates new version automatically)
   */
  async updatePrompt(taskType: RequestType, update: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    modelOverride?: string;
    variables?: Record<string, string>;
    note?: string;
    author?: string;
  }): Promise<PromptConfig> {
    const now = admin.firestore.Timestamp.now();
    const author = update.author || 'system';
    
    try {
      // Get current config or create new one
      const currentRef = this.db.collection('_prompts').doc(taskType);
      const currentDoc = await currentRef.get();
      
      let currentConfig: PromptConfig;
      let newVersion: number;
      
      if (currentDoc.exists) {
        currentConfig = currentDoc.data() as PromptConfig;
        newVersion = currentConfig.version + 1;
      } else {
        // Create new prompt from default
        const defaultConfig = this.getDefaultPromptConfig(taskType);
        const appName = this.getAppFromTaskType(taskType);
        
        currentConfig = {
          id: taskType,
          app: appName,
          taskType,
          version: 1,
          systemPrompt: defaultConfig.systemPrompt,
          temperature: defaultConfig.temperature,
          maxTokens: defaultConfig.maxTokens,
          metadata: {
            author: 'system',
            createdAt: now,
            updatedAt: now,
          },
          active: true,
        };
        newVersion = 1;
      }
      
      // Create version record before updating
      const versionData: PromptVersion = {
        version: currentConfig.version,
        systemPrompt: currentConfig.systemPrompt,
        temperature: currentConfig.temperature,
        maxTokens: currentConfig.maxTokens,
        author: currentConfig.metadata.author,
        note: update.note,
        timestamp: now,
      };
      
      // Save current version to history
      await currentRef.collection('versions').doc(currentConfig.version.toString()).set(versionData);
      
      // Update current config
      const updatedConfig: PromptConfig = {
        ...currentConfig,
        version: newVersion,
        systemPrompt: update.systemPrompt ?? currentConfig.systemPrompt,
        temperature: update.temperature ?? currentConfig.temperature,
        maxTokens: update.maxTokens ?? currentConfig.maxTokens,
        modelOverride: update.modelOverride ?? currentConfig.modelOverride,
        variables: update.variables ?? currentConfig.variables,
        metadata: {
          ...currentConfig.metadata,
          author,
          updatedAt: now,
          note: update.note,
        },
      };
      
      // Save updated config
      await currentRef.set(updatedConfig);
      
      // Invalidate cache
      this.invalidateCache(taskType);
      
      console.log(`Updated prompt ${taskType} to version ${newVersion} by ${author}`);
      
      return updatedConfig;
      
    } catch (error) {
      console.error(`Failed to update prompt ${taskType}:`, error);
      throw error;
    }
  }

  /**
   * Rollback to a specific version
   */
  async rollbackPrompt(taskType: RequestType, version: number): Promise<PromptConfig> {
    try {
      const currentRef = this.db.collection('_prompts').doc(taskType);
      const versionDoc = await currentRef.collection('versions').doc(version.toString()).get();
      
      if (!versionDoc.exists) {
        throw new Error(`Version ${version} not found for ${taskType}`);
      }
      
      const versionData = versionDoc.data() as PromptVersion;
      const now = admin.firestore.Timestamp.now();
      
      // Create new version with rollback
      return await this.updatePrompt(taskType, {
        systemPrompt: versionData.systemPrompt,
        temperature: versionData.temperature,
        maxTokens: versionData.maxTokens,
        note: `Rollback to version ${version}`,
        author: 'system',
      });
      
    } catch (error) {
      console.error(`Failed to rollback prompt ${taskType} to version ${version}:`, error);
      throw error;
    }
  }

  /**
   * Get version history for a prompt
   */
  async getVersionHistory(taskType: RequestType, limit: number = 50): Promise<PromptVersion[]> {
    try {
      const versionsRef = this.db
        .collection('_prompts')
        .doc(taskType)
        .collection('versions')
        .orderBy('version', 'desc')
        .limit(limit);
      
      const snapshot = await versionsRef.get();
      
      return snapshot.docs.map(doc => doc.data() as PromptVersion);
      
    } catch (error) {
      console.warn(`Failed to fetch version history for ${taskType}:`, error);
      return [];
    }
  }

  /**
   * Seed default prompts into Firestore (run once on first deploy)
   */
  async seedDefaults(): Promise<void> {
    console.log('Seeding default prompts into Firestore...');
    
    const batch = this.db.batch();
    const now = admin.firestore.Timestamp.now();
    
    for (const [taskType, defaultConfig] of Object.entries(DEFAULT_PROMPTS)) {
      const appName = this.getAppFromTaskType(taskType as RequestType);
      
      const promptConfig: PromptConfig = {
        id: taskType,
        app: appName,
        taskType,
        version: 1,
        systemPrompt: defaultConfig.systemPrompt,
        temperature: defaultConfig.temperature,
        maxTokens: defaultConfig.maxTokens,
        metadata: {
          author: 'system',
          note: 'Initial seeding from defaults',
          createdAt: now,
          updatedAt: now,
        },
        active: true,
      };
      
      const docRef = this.db.collection('_prompts').doc(taskType);
      batch.set(docRef, promptConfig);
    }
    
    try {
      await batch.commit();
      console.log(`Seeded ${Object.keys(DEFAULT_PROMPTS).length} default prompts`);
    } catch (error) {
      console.error('Failed to seed default prompts:', error);
      throw error;
    }
  }

  /**
   * Invalidate cache for a specific prompt or all prompts
   */
  invalidateCache(taskType?: RequestType): void {
    if (taskType) {
      this.cache.delete(taskType);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get all prompts for management UI
   */
  async getAllPrompts(): Promise<PromptConfig[]> {
    try {
      const snapshot = await this.db.collection('_prompts').get();
      
      return snapshot.docs.map(doc => doc.data() as PromptConfig);
      
    } catch (error) {
      console.warn('Failed to fetch all prompts:', error);
      return [];
    }
  }

  /**
   * Test a prompt with sample input (dry run)
   */
  async testPrompt(taskType: RequestType, sampleInput: string, variables?: Record<string, string>): Promise<{
    resolvedPrompt: string;
    config: PromptConfig;
  }> {
    const config = await this.getPrompt(taskType);
    let resolvedPrompt = config.systemPrompt;
    
    if (variables && config.variables) {
      resolvedPrompt = this.resolveTemplate(resolvedPrompt, { ...config.variables, ...variables });
    }
    
    return {
      resolvedPrompt,
      config,
    };
  }

  /**
   * Get default prompt configuration
   */
  private getDefaultPromptConfig(taskType: RequestType): PromptConfig {
    const defaultConfig = DEFAULT_PROMPTS[taskType];
    
    if (!defaultConfig) {
      throw new Error(`No default prompt found for task type: ${taskType}`);
    }
    
    const appName = this.getAppFromTaskType(taskType);
    const now = admin.firestore.Timestamp.now();
    
    return {
      id: taskType,
      app: appName,
      taskType,
      version: 0, // Version 0 indicates default/fallback
      systemPrompt: defaultConfig.systemPrompt,
      temperature: defaultConfig.temperature,
      maxTokens: defaultConfig.maxTokens,
      metadata: {
        author: 'system',
        note: 'Default fallback prompt',
        createdAt: now,
        updatedAt: now,
      },
      active: true,
    };
  }

  /**
   * Extract app name from task type
   */
  private getAppFromTaskType(taskType: RequestType): 'fitness' | 'nutrition' | 'meetings' | 'budget' | 'cross' {
    if (taskType.startsWith('fitness:')) return 'fitness';
    if (taskType.startsWith('nutrition:')) return 'nutrition';
    if (taskType.startsWith('meetings:')) return 'meetings';
    if (taskType.startsWith('budget:')) return 'budget';
    if (taskType.startsWith('cross:')) return 'cross';
    
    // Legacy mappings
    if (taskType === 'meal-scan' || taskType === 'meal-text') return 'nutrition';
    if (taskType === 'coach-chat') return 'fitness'; // Could be nutrition too, but defaulting to fitness
    if (taskType === 'workout-analysis') return 'fitness';
    if (taskType === 'memory-refresh') return 'cross';
    
    return 'cross'; // Default for unknown types
  }
}