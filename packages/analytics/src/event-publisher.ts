import { v4 as uuidv4 } from 'uuid';
import SnowflakeClient from './snowflake-config';

export interface AnalyticsEvent {
  eventId?: string;
  userId?: string;
  sessionId?: string;
  timestamp?: Date;
  [key: string]: any;
}

export interface BatchInsertOptions {
  maxBatchSize?: number;
  maxWaitTimeMs?: number;
  retryAttempts?: number;
  enableUpsert?: boolean;
  upsertIdColumn?: string;
}

export interface PublisherConfig {
  enableBatching?: boolean;
  batchOptions?: BatchInsertOptions;
  enableDedup?: boolean;
  gcsStaging?: {
    enabled: boolean;
    bucketName: string;
    stageName: string;
  };
}

interface StagingData {
  events: AnalyticsEvent[];
  retryCount: number;
  lastAttempt: Date;
}

class EventPublisher {
  private snowflakeClient: SnowflakeClient;
  private config: PublisherConfig;
  private eventBatches: Map<string, AnalyticsEvent[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private recentEventIds: Set<string> = new Set();
  private stagingBuffer: Map<string, StagingData> = new Map();

  constructor(snowflakeClient: SnowflakeClient, config: PublisherConfig = {}) {
    this.snowflakeClient = snowflakeClient;
    this.config = {
      enableBatching: config.enableBatching ?? true,
      enableDedup: config.enableDedup ?? true,
      batchOptions: {
        maxBatchSize: 100,
        maxWaitTimeMs: 5000,
        retryAttempts: 3,
        enableUpsert: true,
        upsertIdColumn: 'id',
        ...config.batchOptions,
      },
      gcsStaging: config.gcsStaging || {
        enabled: false,
        bucketName: 'claw-analytics-staging',
        stageName: 'GCS_STAGE',
      },
    };
  }

  /**
   * Track an event with automatic batching and deduplication
   */
  async track(
    eventName: string,
    eventData: AnalyticsEvent,
    options: {
      schemaName?: string;
      tableName?: string;
      immediate?: boolean;
      enableUpsert?: boolean;
      upsertIdColumn?: string;
    } = {}
  ): Promise<void> {
    // Generate event ID for deduplication if not provided
    const eventId = eventData.eventId || uuidv4();
    
    // Skip if duplicate and dedup is enabled
    if (this.config.enableDedup && this.recentEventIds.has(eventId)) {
      console.log(`Duplicate event ${eventId} skipped`);
      return;
    }

    // Add event ID to recent set (with size limit)
    if (this.config.enableDedup) {
      this.recentEventIds.add(eventId);
      if (this.recentEventIds.size > 10000) {
        // Remove oldest entries (simple approximation)
        const toRemove = Array.from(this.recentEventIds).slice(0, 1000);
        toRemove.forEach(id => this.recentEventIds.delete(id));
      }
    }

    // Enrich event data with defaults
    const enrichedEvent: AnalyticsEvent = {
      ...eventData,
      id: eventId, // Ensure we have an id field for Snowflake
      eventId,
      timestamp: eventData.timestamp || new Date(),
    };

    // Determine target table
    const { schemaName, tableName } = this.resolveTarget(eventName, options);
    const tableKey = `${schemaName}.${tableName}`;

    // Insert immediately if requested or batching disabled
    if (options.immediate || !this.config.enableBatching) {
      await this.insertEvents(schemaName, tableName, [enrichedEvent], {
        enableUpsert: options.enableUpsert ?? this.config.batchOptions!.enableUpsert,
        upsertIdColumn: options.upsertIdColumn ?? this.config.batchOptions!.upsertIdColumn!,
      });
      return;
    }

    // Add to batch
    await this.addToBatch(tableKey, enrichedEvent, {
      enableUpsert: options.enableUpsert ?? this.config.batchOptions!.enableUpsert,
      upsertIdColumn: options.upsertIdColumn ?? this.config.batchOptions!.upsertIdColumn!,
    });
  }

  /**
   * Track multiple events at once
   */
  async trackBatch(
    events: Array<{
      eventName: string;
      eventData: AnalyticsEvent;
      schemaName?: string;
      tableName?: string;
      enableUpsert?: boolean;
      upsertIdColumn?: string;
    }>
  ): Promise<void> {
    const batches: Map<string, { events: AnalyticsEvent[]; options: any }> = new Map();

    for (const event of events) {
      const eventId = event.eventData.eventId || uuidv4();
      
      if (this.config.enableDedup && this.recentEventIds.has(eventId)) {
        continue;
      }

      const enrichedEvent: AnalyticsEvent = {
        ...event.eventData,
        id: eventId,
        eventId,
        timestamp: event.eventData.timestamp || new Date(),
      };

      const { schemaName, tableName } = this.resolveTarget(event.eventName, event);
      const tableKey = `${schemaName}.${tableName}`;

      if (!batches.has(tableKey)) {
        batches.set(tableKey, { 
          events: [], 
          options: {
            enableUpsert: event.enableUpsert ?? this.config.batchOptions!.enableUpsert,
            upsertIdColumn: event.upsertIdColumn ?? this.config.batchOptions!.upsertIdColumn!,
          }
        });
      }
      batches.get(tableKey)!.events.push(enrichedEvent);

      if (this.config.enableDedup) {
        this.recentEventIds.add(eventId);
      }
    }

    // Insert all batches
    const insertPromises = Array.from(batches.entries()).map(([tableKey, batchData]) => {
      const [schemaName, tableName] = tableKey.split('.');
      return this.insertEvents(schemaName, tableName, batchData.events, batchData.options);
    });

    await Promise.all(insertPromises);
  }

  /**
   * Flush all pending batches immediately
   */
  async flush(): Promise<void> {
    const flushPromises = Array.from(this.eventBatches.entries()).map(([tableKey, events]) => {
      const [schemaName, tableName] = tableKey.split('.');
      return this.insertEvents(schemaName, tableName, events, {
        enableUpsert: this.config.batchOptions!.enableUpsert,
        upsertIdColumn: this.config.batchOptions!.upsertIdColumn!,
      });
    });

    // Clear all batches and timers
    this.eventBatches.clear();
    this.batchTimers.forEach(timer => clearTimeout(timer));
    this.batchTimers.clear();

    await Promise.all(flushPromises);
  }

  /**
   * Convenience methods for common event types
   */
  
  async trackWorkoutCompleted(userId: string, workoutData: any): Promise<void> {
    await this.track('workout_completed', {
      userId,
      ...workoutData,
    }, {
      schemaName: this.snowflakeClient.getSchemas().fitness,
      tableName: 'workouts',
      enableUpsert: true,
      upsertIdColumn: 'id'
    });
  }

  async trackMealLogged(userId: string, mealData: any): Promise<void> {
    await this.track('meal_logged', {
      userId,
      ...mealData,
    }, {
      schemaName: this.snowflakeClient.getSchemas().nutrition,
      tableName: 'food_logs',
      enableUpsert: true,
      upsertIdColumn: 'id'
    });
  }

  async trackMeetingCompleted(userId: string, meetingData: any): Promise<void> {
    await this.track('meeting_completed', {
      userId,
      ...meetingData,
    }, {
      schemaName: this.snowflakeClient.getSchemas().meetings,
      tableName: 'meetings',
      enableUpsert: true,
      upsertIdColumn: 'id'
    });
  }

  async trackTransactionAdded(userId: string, transactionData: any): Promise<void> {
    await this.track('transaction_added', {
      userId,
      ...transactionData,
    }, {
      schemaName: this.snowflakeClient.getSchemas().budget,
      tableName: 'transactions',
      enableUpsert: true,
      upsertIdColumn: 'id'
    });
  }

  async trackLLMUsage(userId: string, llmData: any): Promise<void> {
    await this.track('llm_usage', {
      userId,
      ...llmData,
    }, {
      schemaName: this.snowflakeClient.getSchemas().crossApp,
      tableName: 'llm_usage',
      enableUpsert: true,
      upsertIdColumn: 'id'
    });
  }

  async trackFeatureUsage(userId: string, featureData: any): Promise<void> {
    await this.track('feature_usage', {
      userId,
      ...featureData,
    }, {
      schemaName: this.snowflakeClient.getSchemas().crossApp,
      tableName: 'feature_usage',
      enableUpsert: false // Append-only for feature usage
    });
  }

  async trackError(userId: string | null, errorData: any): Promise<void> {
    await this.track('error', {
      userId,
      ...errorData,
    }, {
      schemaName: this.snowflakeClient.getSchemas().crossApp,
      tableName: 'errors',
      enableUpsert: false // Append-only for errors
    });
  }

  async trackFunnelEvent(userId: string | null, funnelData: any): Promise<void> {
    await this.track('funnel_event', {
      userId,
      ...funnelData,
    }, {
      schemaName: this.snowflakeClient.getSchemas().crossApp,
      tableName: 'funnel_events',
      enableUpsert: false // Append-only for funnel events
    });
  }

  private resolveTarget(eventName: string, options: any): { schemaName: string; tableName: string } {
    if (options.schemaName && options.tableName) {
      return { schemaName: options.schemaName, tableName: options.tableName };
    }

    const schemas = this.snowflakeClient.getSchemas();
    
    // Default routing based on event name
    if (eventName.includes('workout') || eventName.includes('exercise')) {
      return { schemaName: schemas.fitness, tableName: 'workouts' };
    } else if (eventName.includes('meal') || eventName.includes('food') || eventName.includes('nutrition')) {
      return { schemaName: schemas.nutrition, tableName: 'food_logs' };
    } else if (eventName.includes('meeting') || eventName.includes('transcript')) {
      return { schemaName: schemas.meetings, tableName: 'meetings' };
    } else if (eventName.includes('transaction') || eventName.includes('budget') || eventName.includes('expense')) {
      return { schemaName: schemas.budget, tableName: 'transactions' };
    } else {
      return { schemaName: schemas.crossApp, tableName: 'feature_usage' };
    }
  }

  private async addToBatch(
    tableKey: string, 
    event: AnalyticsEvent, 
    options: { enableUpsert?: boolean; upsertIdColumn?: string }
  ): Promise<void> {
    if (!this.eventBatches.has(tableKey)) {
      this.eventBatches.set(tableKey, []);
    }

    const batch = this.eventBatches.get(tableKey)!;
    batch.push(event);

    const { maxBatchSize, maxWaitTimeMs } = this.config.batchOptions!;

    // Flush if batch size reached
    if (batch.length >= maxBatchSize!) {
      await this.flushBatch(tableKey, options);
      return;
    }

    // Set timer for batch flush if not already set
    if (!this.batchTimers.has(tableKey)) {
      const timer = setTimeout(() => {
        this.flushBatch(tableKey, options).catch(console.error);
      }, maxWaitTimeMs);
      this.batchTimers.set(tableKey, timer);
    }
  }

  private async flushBatch(
    tableKey: string, 
    options: { enableUpsert?: boolean; upsertIdColumn?: string }
  ): Promise<void> {
    const batch = this.eventBatches.get(tableKey);
    if (!batch || batch.length === 0) return;

    const [schemaName, tableName] = tableKey.split('.');
    
    // Clear batch and timer
    this.eventBatches.delete(tableKey);
    const timer = this.batchTimers.get(tableKey);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(tableKey);
    }

    await this.insertEvents(schemaName, tableName, batch, options);
  }

  private async insertEvents(
    schemaName: string, 
    tableName: string, 
    events: AnalyticsEvent[],
    options: { enableUpsert?: boolean; upsertIdColumn?: string }
  ): Promise<void> {
    if (events.length === 0) return;

    const { retryAttempts } = this.config.batchOptions!;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retryAttempts!; attempt++) {
      try {
        await this.snowflakeClient.batchInsert(schemaName, tableName, events, {
          upsert: options.enableUpsert,
          idColumn: options.upsertIdColumn
        });
        console.log(`Successfully inserted ${events.length} events to ${schemaName}.${tableName}`);
        return;
      } catch (error) {
        lastError = error as Error;
        console.warn(`Insert attempt ${attempt + 1} failed for ${schemaName}.${tableName}:`, error);
        
        if (attempt < retryAttempts! - 1) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    // If direct insert fails, try staging approach if enabled
    if (this.config.gcsStaging?.enabled) {
      console.log(`Falling back to GCS staging for ${schemaName}.${tableName}`);
      await this.stageEventsToGCS(schemaName, tableName, events);
      return;
    }

    console.error(`Failed to insert events after ${retryAttempts} attempts:`, lastError);
    throw lastError;
  }

  private async stageEventsToGCS(schemaName: string, tableName: string, events: AnalyticsEvent[]): Promise<void> {
    const tableKey = `${schemaName}.${tableName}`;
    
    // Add to staging buffer for potential Snowpipe processing
    this.stagingBuffer.set(tableKey, {
      events,
      retryCount: 0,
      lastAttempt: new Date()
    });

    // Log for external processing (Cloud Function could pick this up)
    console.log(`Staged ${events.length} events for ${tableKey} - implement GCS staging as needed`);
    
    // Note: Full GCS staging implementation would require:
    // 1. Writing JSON files to GCS bucket with partitioning (date/app)
    // 2. Snowpipe configuration to auto-ingest from external stage
    // 3. Error handling and retry logic for failed files
    
    // For now, we log the failure - in production you'd implement full staging
    throw new Error(`Direct insert failed and GCS staging not fully implemented for ${tableKey}`);
  }

  /**
   * Get staging buffer status (for monitoring/debugging)
   */
  getStagingStatus(): Map<string, StagingData> {
    return new Map(this.stagingBuffer);
  }

  /**
   * Clear staging buffer
   */
  clearStagingBuffer(): void {
    this.stagingBuffer.clear();
  }
}

export default EventPublisher;