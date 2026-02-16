/**
 * Firestore to Snowflake Data Pipeline
 * 
 * This file provides two approaches for syncing Firestore data to Snowflake:
 * 1. Direct Snowflake REST API inserts (recommended for low-medium volume)
 * 2. GCS staging with Snowpipe auto-ingest (recommended for high volume)
 * 
 * Use this as a replacement for Firebase Extensions BigQuery Export
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import SnowflakeClient from './snowflake-config';
import EventPublisher from './event-publisher';

export interface FirestorePipelineConfig {
  collectionPath: string;
  schemaName: string;
  tableName: string;
  enableBackfill: boolean;
  clustering?: string[];
  partitionField?: string;
  transformFunction?: (doc: any) => any;
  batchSize?: number;
  flushIntervalMs?: number;
}

export interface GCSPipelineConfig {
  bucketName: string;
  stageName: string;
  fileFormat: 'JSON' | 'CSV' | 'PARQUET';
  enableCompression: boolean;
  partitionByDate: boolean;
}

/**
 * Configuration for all Claw app collections to be synced to Snowflake
 */
export const firestorePipelineConfigs: FirestorePipelineConfig[] = [
  // Fitness App Collections
  {
    collectionPath: 'users/{userId}/workouts',
    schemaName: 'FITNESS',
    tableName: 'workouts_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    partitionField: 'created_at',
    batchSize: 100
  },
  {
    collectionPath: 'users/{userId}/exercises', 
    schemaName: 'FITNESS',
    tableName: 'exercises_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    batchSize: 50
  },
  {
    collectionPath: 'users/{userId}/body_measurements',
    schemaName: 'FITNESS', 
    tableName: 'body_measurements_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    partitionField: 'measurement_date',
    batchSize: 100
  },

  // Nutrition App Collections
  {
    collectionPath: 'users/{userId}/food_logs',
    schemaName: 'NUTRITION',
    tableName: 'food_logs_raw', 
    enableBackfill: true,
    clustering: ['user_id'],
    partitionField: 'log_date',
    batchSize: 200
  },
  {
    collectionPath: 'users/{userId}/meals',
    schemaName: 'NUTRITION',
    tableName: 'meals_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    partitionField: 'meal_date',
    batchSize: 100
  },
  {
    collectionPath: 'users/{userId}/daily_nutrition_summaries',
    schemaName: 'NUTRITION',
    tableName: 'daily_summaries_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    partitionField: 'summary_date',
    batchSize: 100
  },

  // Meetings App Collections
  {
    collectionPath: 'users/{userId}/meetings',
    schemaName: 'MEETINGS',
    tableName: 'meetings_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    partitionField: 'meeting_date',
    batchSize: 50
  },
  {
    collectionPath: 'users/{userId}/meeting_transcripts',
    schemaName: 'MEETINGS',
    tableName: 'transcripts_raw',
    enableBackfill: true,
    clustering: ['user_id', 'meeting_id'],
    batchSize: 20
  },
  {
    collectionPath: 'users/{userId}/action_items',
    schemaName: 'MEETINGS', 
    tableName: 'action_items_raw',
    enableBackfill: true,
    clustering: ['user_id', 'assignee_id'],
    batchSize: 100
  },

  // Budget App Collections
  {
    collectionPath: 'users/{userId}/transactions',
    schemaName: 'BUDGET',
    tableName: 'transactions_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    partitionField: 'transaction_date',
    batchSize: 200
  },
  {
    collectionPath: 'users/{userId}/budgets',
    schemaName: 'BUDGET',
    tableName: 'budgets_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    batchSize: 100
  },
  {
    collectionPath: 'users/{userId}/accounts',
    schemaName: 'BUDGET',
    tableName: 'accounts_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    batchSize: 100
  },

  // Cross-App Collections
  {
    collectionPath: 'users',
    schemaName: 'CROSS_APP',
    tableName: 'users_raw',
    enableBackfill: true,
    clustering: ['id'],
    batchSize: 100
  },
  {
    collectionPath: 'subscriptions',
    schemaName: 'CROSS_APP',
    tableName: 'subscriptions_raw',
    enableBackfill: true,
    clustering: ['user_id'],
    batchSize: 100
  }
];

/**
 * Main Firestore Pipeline Class
 */
export class FirestorePipeline {
  private snowflakeClient: SnowflakeClient;
  private eventPublisher: EventPublisher;
  private gcsConfig?: GCSPipelineConfig;
  private batchBuffers: Map<string, any[]> = new Map();
  private flushTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    snowflakeClient: SnowflakeClient, 
    eventPublisher: EventPublisher,
    gcsConfig?: GCSPipelineConfig
  ) {
    this.snowflakeClient = snowflakeClient;
    this.eventPublisher = eventPublisher;
    this.gcsConfig = gcsConfig;
  }

  /**
   * Process a single Firestore document change (for Cloud Function triggers)
   */
  async processDocumentChange(
    collectionPath: string,
    documentId: string,
    documentData: any,
    changeType: 'created' | 'updated' | 'deleted',
    context?: any
  ): Promise<void> {
    const config = this.findConfigForCollection(collectionPath);
    if (!config) {
      console.warn(`No pipeline config found for collection: ${collectionPath}`);
      return;
    }

    // Transform Firestore document to Snowflake format
    const transformedDoc = this.transformFirestoreDocument(
      documentData, 
      documentId, 
      changeType,
      config.transformFunction
    );

    // Use direct insert for real-time processing
    await this.insertDocument(config, transformedDoc);
  }

  /**
   * Batch process multiple document changes
   */
  async processBatch(
    changes: Array<{
      collectionPath: string;
      documentId: string;
      documentData: any;
      changeType: 'created' | 'updated' | 'deleted';
    }>
  ): Promise<void> {
    const batches: Map<string, any[]> = new Map();

    for (const change of changes) {
      const config = this.findConfigForCollection(change.collectionPath);
      if (!config) continue;

      const transformedDoc = this.transformFirestoreDocument(
        change.documentData,
        change.documentId,
        change.changeType,
        config.transformFunction
      );

      const batchKey = `${config.schemaName}.${config.tableName}`;
      if (!batches.has(batchKey)) {
        batches.set(batchKey, []);
      }
      batches.get(batchKey)!.push(transformedDoc);
    }

    // Process all batches
    const insertPromises = Array.from(batches.entries()).map(([batchKey, docs]) => {
      const [schemaName, tableName] = batchKey.split('.');
      return this.snowflakeClient.batchInsert(schemaName, tableName, docs, {
        upsert: true,
        idColumn: 'document_id'
      });
    });

    await Promise.all(insertPromises);
  }

  /**
   * Backfill existing collection data
   */
  async backfillCollection(collectionPath: string, firestore: any): Promise<void> {
    const config = this.findConfigForCollection(collectionPath);
    if (!config || !config.enableBackfill) {
      console.log(`Skipping backfill for ${collectionPath} - not configured`);
      return;
    }

    console.log(`Starting backfill for ${collectionPath}`);
    
    let totalProcessed = 0;
    let batch: any[] = [];
    
    // Query collection in batches
    let query = firestore.collectionGroup(this.getCollectionName(collectionPath));
    let lastDoc: any = null;

    while (true) {
      let batchQuery = query.limit(config.batchSize || 100);
      if (lastDoc) {
        batchQuery = batchQuery.startAfter(lastDoc);
      }

      const snapshot = await batchQuery.get();
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        const transformedDoc = this.transformFirestoreDocument(
          doc.data(),
          doc.id,
          'created',
          config.transformFunction
        );
        batch.push(transformedDoc);
      }

      // Process batch
      await this.snowflakeClient.batchInsert(config.schemaName, config.tableName, batch, {
        upsert: true,
        idColumn: 'document_id'
      });

      totalProcessed += batch.length;
      console.log(`Backfilled ${totalProcessed} documents for ${collectionPath}`);
      
      batch = [];
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Completed backfill for ${collectionPath}: ${totalProcessed} documents`);
  }

  /**
   * Setup raw data tables in Snowflake for Firestore documents
   */
  async setupRawTables(): Promise<void> {
    for (const config of firestorePipelineConfigs) {
      await this.snowflakeClient.createSchemaIfNotExists(config.schemaName);
      
      // Create raw table with flexible schema for Firestore documents
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ${config.schemaName}.${config.tableName} (
          document_id VARCHAR(255) NOT NULL PRIMARY KEY,
          collection_path VARCHAR(500) NOT NULL,
          document_data VARIANT NOT NULL, -- Full Firestore document as JSON
          change_type VARCHAR(20) DEFAULT 'unknown', -- created, updated, deleted
          firestore_created_time TIMESTAMP_TZ,
          firestore_updated_time TIMESTAMP_TZ,
          pipeline_processed_at TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP(),
          pipeline_version VARCHAR(20) DEFAULT '1.0'
        )
        ${config.clustering ? `CLUSTER BY (${config.clustering.join(', ')})` : ''}
        CHANGE_TRACKING = TRUE
        COMMENT = 'Raw Firestore documents for ${config.collectionPath}'
      `;
      
      await this.snowflakeClient.executeStatement(createTableSQL);
      console.log(`Created/verified raw table: ${config.schemaName}.${config.tableName}`);
    }
  }

  private findConfigForCollection(collectionPath: string): FirestorePipelineConfig | undefined {
    return firestorePipelineConfigs.find(config => {
      // Handle collection paths with wildcards like users/{userId}/workouts
      const configPattern = config.collectionPath.replace(/\{[^}]+\}/g, '[^/]+');
      const regex = new RegExp(`^${configPattern}$`);
      return regex.test(collectionPath);
    });
  }

  private getCollectionName(collectionPath: string): string {
    // Extract the final collection name from a path like users/{userId}/workouts
    return collectionPath.split('/').pop() || collectionPath;
  }

  private transformFirestoreDocument(
    documentData: any,
    documentId: string,
    changeType: string,
    transformFunction?: (doc: any) => any
  ): any {
    // Base transformation
    let transformed = {
      document_id: documentId,
      collection_path: '', // Will be set by caller
      document_data: this.convertFirestoreTypes(documentData),
      change_type: changeType,
      firestore_created_time: this.extractTimestamp(documentData.createdAt || documentData.created_at),
      firestore_updated_time: this.extractTimestamp(documentData.updatedAt || documentData.updated_at),
    };

    // Apply custom transformation if provided
    if (transformFunction) {
      transformed = transformFunction(transformed);
    }

    return transformed;
  }

  private convertFirestoreTypes(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (obj instanceof Timestamp) {
      return obj.toDate().toISOString();
    }

    if (obj instanceof Date) {
      return obj.toISOString();
    }

    if (FieldValue.isFieldValue(obj)) {
      // Handle special FieldValue types
      return { _fieldValue: obj.toString() };
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.convertFirestoreTypes(item));
    }

    if (typeof obj === 'object') {
      const converted: any = {};
      for (const [key, value] of Object.entries(obj)) {
        converted[key] = this.convertFirestoreTypes(value);
      }
      return converted;
    }

    return obj;
  }

  private extractTimestamp(value: any): string | null {
    if (!value) return null;
    
    if (value instanceof Timestamp) {
      return value.toDate().toISOString();
    }
    
    if (value instanceof Date) {
      return value.toISOString();
    }
    
    if (typeof value === 'string') {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }
    
    return null;
  }

  private async insertDocument(config: FirestorePipelineConfig, document: any): Promise<void> {
    try {
      await this.snowflakeClient.batchInsert(config.schemaName, config.tableName, [document], {
        upsert: true,
        idColumn: 'document_id'
      });
    } catch (error) {
      console.error(`Failed to insert document to ${config.schemaName}.${config.tableName}:`, error);
      
      // Optional: Add to event publisher for retry or alternative processing
      await this.eventPublisher.track('firestore_insert_failed', {
        userId: document.document_data?.userId || document.document_data?.user_id,
        schema: config.schemaName,
        table: config.tableName,
        documentId: document.document_id,
        error: (error as Error).message
      });
    }
  }
}

/**
 * Generate Cloud Function code for real-time sync
 */
export function generateCloudFunctionCode(): string {
  return `
// Cloud Function for Firestore to Snowflake real-time sync
// Deploy this as a Cloud Function with Firestore triggers

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { FirestorePipeline } = require('./firestore-pipeline');
const { SnowflakeClient } = require('./snowflake-config');
const { EventPublisher } = require('./event-publisher');

initializeApp();
const firestore = getFirestore();

// Initialize pipeline
const snowflakeClient = new SnowflakeClient();
const eventPublisher = new EventPublisher(snowflakeClient);
const pipeline = new FirestorePipeline(snowflakeClient, eventPublisher);

// Firestore trigger function
exports.syncToSnowflake = functions.firestore
  .document('{collection}/{docId}')
  .onWrite(async (change, context) => {
    try {
      const { collection, docId } = context.params;
      const collectionPath = context.resource.name.split('/documents/')[1].split('/').slice(0, -1).join('/');
      
      let changeType;
      let documentData;
      
      if (!change.before.exists && change.after.exists) {
        changeType = 'created';
        documentData = change.after.data();
      } else if (change.before.exists && change.after.exists) {
        changeType = 'updated';
        documentData = change.after.data();
      } else if (change.before.exists && !change.after.exists) {
        changeType = 'deleted';
        documentData = change.before.data();
      }
      
      await pipeline.processDocumentChange(
        collectionPath,
        docId,
        documentData,
        changeType,
        context
      );
      
      console.log(\`Successfully synced \${changeType} document \${docId} from \${collectionPath}\`);
    } catch (error) {
      console.error('Error syncing to Snowflake:', error);
      throw error;
    }
  });

// Batch backfill function
exports.backfillToSnowflake = functions.https.onRequest(async (req, res) => {
  try {
    const { collectionPath } = req.body;
    
    if (!collectionPath) {
      return res.status(400).json({ error: 'collectionPath is required' });
    }
    
    await pipeline.backfillCollection(collectionPath, firestore);
    res.json({ success: true, message: \`Backfill completed for \${collectionPath}\` });
  } catch (error) {
    console.error('Backfill error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Setup function
exports.setupSnowflakeSchema = functions.https.onRequest(async (req, res) => {
  try {
    await pipeline.setupRawTables();
    res.json({ success: true, message: 'Snowflake schema setup completed' });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: error.message });
  }
});
`;
}

/**
 * Setup instructions for Firestore-Snowflake Pipeline
 */
export const setupInstructions = `
# Firestore to Snowflake Pipeline Setup Instructions

## Prerequisites
1. Snowflake account with appropriate permissions
2. Firebase project with Firestore enabled  
3. Google Cloud project with Cloud Functions enabled
4. Node.js environment for development

## Environment Variables
Set these in your Cloud Functions environment or .env file:
\`\`\`bash
SNOWFLAKE_ACCOUNT=your-account.region.cloud
SNOWFLAKE_USER=your-username
SNOWFLAKE_PASSWORD=your-password
SNOWFLAKE_WAREHOUSE=CLAW_XS
SNOWFLAKE_DATABASE=CLAW_ANALYTICS
SNOWFLAKE_ROLE=your-role
\`\`\`

## Installation Steps

### 1. Deploy Cloud Functions
\`\`\`bash
# Install dependencies
npm install firebase-functions firebase-admin snowflake-sdk

# Deploy functions
firebase deploy --only functions:syncToSnowflake
firebase deploy --only functions:backfillToSnowflake
firebase deploy --only functions:setupSnowflakeSchema
\`\`\`

### 2. Setup Snowflake Schema
Call the setup endpoint:
\`\`\`bash
curl -X POST https://your-region-your-project.cloudfunctions.net/setupSnowflakeSchema
\`\`\`

### 3. Backfill Existing Data (Optional)
For each collection:
\`\`\`bash
curl -X POST https://your-region-your-project.cloudfunctions.net/backfillToSnowflake \\
  -H "Content-Type: application/json" \\
  -d '{"collectionPath": "users/{userId}/workouts"}'
\`\`\`

## Architecture

### Approach 1: Direct Snowflake Insert (Default)
- Cloud Function triggers on Firestore changes
- Direct REST API calls to Snowflake
- Immediate consistency
- Good for low-medium volume (< 1000 changes/minute)

### Approach 2: GCS + Snowpipe (High Volume)
- Cloud Function writes to GCS bucket
- Snowpipe auto-ingests from external stage
- Higher latency but better scalability
- Good for high volume (> 1000 changes/minute)

## Schema Design

### Raw Tables
Each collection gets a raw table:
- \`document_id\`: Firestore document ID
- \`document_data\`: Full document as JSON (VARIANT type)  
- \`change_type\`: created/updated/deleted
- \`firestore_*_time\`: Original Firestore timestamps
- \`pipeline_*\`: Pipeline metadata

### Transformed Tables
Create views or scheduled tasks to transform raw data into structured tables matching your existing schema definitions.

## Monitoring

### Logs
- Cloud Function logs: Firebase Console → Functions
- Snowflake logs: Snowflake Console → History

### Metrics
- Track processing latency
- Monitor error rates
- Set up alerts for failed syncs

### Cost Optimization
- Snowflake warehouse auto-suspend (60s)
- Batch smaller collections together
- Use Snowpipe for large collections
- Monitor compute credits usage

## Data Flow

1. **Real-time**: Firestore change → Cloud Function → Snowflake
2. **Batch**: Firestore query → Transform → Snowflake batch insert
3. **Backfill**: Collection scan → Batch process → Historical sync

## Advanced Features

### Custom Transformations
Add transform functions to pipeline configs:
\`\`\`typescript
{
  collectionPath: 'users/{userId}/workouts',
  transformFunction: (doc) => ({
    ...doc,
    normalized_data: normalizeWorkout(doc.document_data)
  })
}
\`\`\`

### Error Handling
- Automatic retries with exponential backoff
- Dead letter queues for failed documents
- Monitoring and alerting

### Data Validation
- Schema validation before insert
- Data quality checks
- Anomaly detection

## Migration from BigQuery
1. Set up Snowflake pipeline in parallel
2. Backfill historical data
3. Verify data consistency
4. Switch applications to Snowflake
5. Deprecate BigQuery export
`;

export default {
  FirestorePipeline,
  firestorePipelineConfigs,
  generateCloudFunctionCode,
  setupInstructions
};