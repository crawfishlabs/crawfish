import { BigQuery } from '@google-cloud/bigquery';
import { v4 as uuidv4 } from 'uuid';
import BigQueryClient from './bigquery-config';

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
}

export interface PublisherConfig {
  enableBatching?: boolean;
  batchOptions?: BatchInsertOptions;
  enableDedup?: boolean;
  defaultInsertOptions?: any;
}

class EventPublisher {
  private bqClient: BigQueryClient;
  private config: PublisherConfig;
  private eventBatches: Map<string, AnalyticsEvent[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private recentEventIds: Set<string> = new Set();

  constructor(bqClient: BigQueryClient, config: PublisherConfig = {}) {
    this.bqClient = bqClient;
    this.config = {
      enableBatching: config.enableBatching ?? true,
      enableDedup: config.enableDedup ?? true,
      batchOptions: {
        maxBatchSize: 100,
        maxWaitTimeMs: 5000,
        retryAttempts: 3,
        ...config.batchOptions,
      },
      defaultInsertOptions: {
        ignoreUnknownValues: true,
        skipInvalidRows: false,
        ...config.defaultInsertOptions,
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
      datasetName?: string;
      tableName?: string;
      immediate?: boolean;
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
      eventId,
      timestamp: eventData.timestamp || new Date(),
    };

    // Determine target table
    const { datasetName, tableName } = this.resolveTarget(eventName, options);
    const tableKey = `${datasetName}.${tableName}`;

    // Insert immediately if requested or batching disabled
    if (options.immediate || !this.config.enableBatching) {
      await this.insertEvents(datasetName, tableName, [enrichedEvent]);
      return;
    }

    // Add to batch
    await this.addToBatch(tableKey, enrichedEvent);
  }

  /**
   * Track multiple events at once
   */
  async trackBatch(
    events: Array<{
      eventName: string;
      eventData: AnalyticsEvent;
      datasetName?: string;
      tableName?: string;
    }>
  ): Promise<void> {
    const batches: Map<string, AnalyticsEvent[]> = new Map();

    for (const event of events) {
      const eventId = event.eventData.eventId || uuidv4();
      
      if (this.config.enableDedup && this.recentEventIds.has(eventId)) {
        continue;
      }

      const enrichedEvent: AnalyticsEvent = {
        ...event.eventData,
        eventId,
        timestamp: event.eventData.timestamp || new Date(),
      };

      const { datasetName, tableName } = this.resolveTarget(event.eventName, event);
      const tableKey = `${datasetName}.${tableName}`;

      if (!batches.has(tableKey)) {
        batches.set(tableKey, []);
      }
      batches.get(tableKey)!.push(enrichedEvent);

      if (this.config.enableDedup) {
        this.recentEventIds.add(eventId);
      }
    }

    // Insert all batches
    const insertPromises = Array.from(batches.entries()).map(([tableKey, batchEvents]) => {
      const [datasetName, tableName] = tableKey.split('.');
      return this.insertEvents(datasetName, tableName, batchEvents);
    });

    await Promise.all(insertPromises);
  }

  /**
   * Flush all pending batches immediately
   */
  async flush(): Promise<void> {
    const flushPromises = Array.from(this.eventBatches.entries()).map(([tableKey, events]) => {
      const [datasetName, tableName] = tableKey.split('.');
      return this.insertEvents(datasetName, tableName, events);
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
      datasetName: this.bqClient.getDatasets().fitness,
      tableName: 'workouts'
    });
  }

  async trackMealLogged(userId: string, mealData: any): Promise<void> {
    await this.track('meal_logged', {
      userId,
      ...mealData,
    }, {
      datasetName: this.bqClient.getDatasets().nutrition,
      tableName: 'food_logs'
    });
  }

  async trackMeetingCompleted(userId: string, meetingData: any): Promise<void> {
    await this.track('meeting_completed', {
      userId,
      ...meetingData,
    }, {
      datasetName: this.bqClient.getDatasets().meetings,
      tableName: 'meetings'
    });
  }

  async trackTransactionAdded(userId: string, transactionData: any): Promise<void> {
    await this.track('transaction_added', {
      userId,
      ...transactionData,
    }, {
      datasetName: this.bqClient.getDatasets().budget,
      tableName: 'transactions'
    });
  }

  async trackLLMUsage(userId: string, llmData: any): Promise<void> {
    await this.track('llm_usage', {
      userId,
      ...llmData,
    }, {
      datasetName: this.bqClient.getDatasets().crossApp,
      tableName: 'llm_usage'
    });
  }

  async trackFeatureUsage(userId: string, featureData: any): Promise<void> {
    await this.track('feature_usage', {
      userId,
      ...featureData,
    }, {
      datasetName: this.bqClient.getDatasets().crossApp,
      tableName: 'feature_usage'
    });
  }

  async trackError(userId: string | null, errorData: any): Promise<void> {
    await this.track('error', {
      userId,
      ...errorData,
    }, {
      datasetName: this.bqClient.getDatasets().crossApp,
      tableName: 'errors'
    });
  }

  async trackFunnelEvent(userId: string | null, funnelData: any): Promise<void> {
    await this.track('funnel_event', {
      userId,
      ...funnelData,
    }, {
      datasetName: this.bqClient.getDatasets().crossApp,
      tableName: 'funnel_events'
    });
  }

  private resolveTarget(eventName: string, options: any): { datasetName: string; tableName: string } {
    if (options.datasetName && options.tableName) {
      return { datasetName: options.datasetName, tableName: options.tableName };
    }

    const datasets = this.bqClient.getDatasets();
    
    // Default routing based on event name
    if (eventName.includes('workout') || eventName.includes('exercise')) {
      return { datasetName: datasets.fitness, tableName: 'workouts' };
    } else if (eventName.includes('meal') || eventName.includes('food') || eventName.includes('nutrition')) {
      return { datasetName: datasets.nutrition, tableName: 'food_logs' };
    } else if (eventName.includes('meeting') || eventName.includes('transcript')) {
      return { datasetName: datasets.meetings, tableName: 'meetings' };
    } else if (eventName.includes('transaction') || eventName.includes('budget') || eventName.includes('expense')) {
      return { datasetName: datasets.budget, tableName: 'transactions' };
    } else {
      return { datasetName: datasets.crossApp, tableName: 'feature_usage' };
    }
  }

  private async addToBatch(tableKey: string, event: AnalyticsEvent): Promise<void> {
    if (!this.eventBatches.has(tableKey)) {
      this.eventBatches.set(tableKey, []);
    }

    const batch = this.eventBatches.get(tableKey)!;
    batch.push(event);

    const { maxBatchSize, maxWaitTimeMs } = this.config.batchOptions!;

    // Flush if batch size reached
    if (batch.length >= maxBatchSize!) {
      await this.flushBatch(tableKey);
      return;
    }

    // Set timer for batch flush if not already set
    if (!this.batchTimers.has(tableKey)) {
      const timer = setTimeout(() => {
        this.flushBatch(tableKey).catch(console.error);
      }, maxWaitTimeMs);
      this.batchTimers.set(tableKey, timer);
    }
  }

  private async flushBatch(tableKey: string): Promise<void> {
    const batch = this.eventBatches.get(tableKey);
    if (!batch || batch.length === 0) return;

    const [datasetName, tableName] = tableKey.split('.');
    
    // Clear batch and timer
    this.eventBatches.delete(tableKey);
    const timer = this.batchTimers.get(tableKey);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(tableKey);
    }

    await this.insertEvents(datasetName, tableName, batch);
  }

  private async insertEvents(datasetName: string, tableName: string, events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;

    const { retryAttempts } = this.config.batchOptions!;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retryAttempts!; attempt++) {
      try {
        await this.bqClient.streamInsert(datasetName, tableName, events, this.config.defaultInsertOptions);
        console.log(`Successfully inserted ${events.length} events to ${datasetName}.${tableName}`);
        return;
      } catch (error) {
        lastError = error as Error;
        console.warn(`Insert attempt ${attempt + 1} failed for ${datasetName}.${tableName}:`, error);
        
        if (attempt < retryAttempts! - 1) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    console.error(`Failed to insert events after ${retryAttempts} attempts:`, lastError);
    throw lastError;
  }
}

export default EventPublisher;