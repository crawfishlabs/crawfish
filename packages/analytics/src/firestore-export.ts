/**
 * Firebase Extensions BigQuery Export Configuration
 * 
 * This file contains configuration and setup instructions for the
 * Firebase Extensions BigQuery Export extension, which automatically
 * exports Firestore documents to BigQuery tables.
 * 
 * Extension: https://extensions.dev/extensions/firebase/firestore-bigquery-export
 */

export interface FirestoreExportConfig {
  collectionPath: string;
  datasetId: string;
  tableId: string;
  backfillEnabled: boolean;
  transformFunction?: string;
  clustering?: string[];
  partitioning?: {
    type: 'TIME_PARTITIONING' | 'RANGE_PARTITIONING';
    field: string;
  };
}

/**
 * Configuration for all Claw app collections to be exported to BigQuery
 */
export const firestoreExportConfigs: FirestoreExportConfig[] = [
  // Fitness App Collections
  {
    collectionPath: 'users/{userId}/workouts',
    datasetId: 'claw_fitness',
    tableId: 'workouts_firestore',
    backfillEnabled: true,
    clustering: ['user_id'],
    partitioning: {
      type: 'TIME_PARTITIONING',
      field: 'created_at'
    }
  },
  {
    collectionPath: 'users/{userId}/exercises', 
    datasetId: 'claw_fitness',
    tableId: 'exercises_firestore',
    backfillEnabled: true,
    clustering: ['user_id']
  },
  {
    collectionPath: 'users/{userId}/body_measurements',
    datasetId: 'claw_fitness', 
    tableId: 'body_measurements_firestore',
    backfillEnabled: true,
    clustering: ['user_id'],
    partitioning: {
      type: 'TIME_PARTITIONING',
      field: 'measurement_date'
    }
  },

  // Nutrition App Collections
  {
    collectionPath: 'users/{userId}/food_logs',
    datasetId: 'claw_nutrition',
    tableId: 'food_logs_firestore', 
    backfillEnabled: true,
    clustering: ['user_id'],
    partitioning: {
      type: 'TIME_PARTITIONING',
      field: 'log_date'
    }
  },
  {
    collectionPath: 'users/{userId}/meals',
    datasetId: 'claw_nutrition',
    tableId: 'meals_firestore',
    backfillEnabled: true,
    clustering: ['user_id'],
    partitioning: {
      type: 'TIME_PARTITIONING',
      field: 'meal_date'
    }
  },
  {
    collectionPath: 'users/{userId}/daily_nutrition_summaries',
    datasetId: 'claw_nutrition',
    tableId: 'daily_summaries_firestore',
    backfillEnabled: true,
    clustering: ['user_id'],
    partitioning: {
      type: 'TIME_PARTITIONING',
      field: 'summary_date'
    }
  },

  // Meetings App Collections
  {
    collectionPath: 'users/{userId}/meetings',
    datasetId: 'claw_meetings',
    tableId: 'meetings_firestore',
    backfillEnabled: true,
    clustering: ['user_id'],
    partitioning: {
      type: 'TIME_PARTITIONING',
      field: 'meeting_date'
    }
  },
  {
    collectionPath: 'users/{userId}/meeting_transcripts',
    datasetId: 'claw_meetings',
    tableId: 'transcripts_firestore',
    backfillEnabled: true,
    clustering: ['user_id', 'meeting_id']
  },
  {
    collectionPath: 'users/{userId}/action_items',
    datasetId: 'claw_meetings', 
    tableId: 'action_items_firestore',
    backfillEnabled: true,
    clustering: ['user_id', 'assignee_id']
  },

  // Budget App Collections
  {
    collectionPath: 'users/{userId}/transactions',
    datasetId: 'claw_budget',
    tableId: 'transactions_firestore',
    backfillEnabled: true,
    clustering: ['user_id'],
    partitioning: {
      type: 'TIME_PARTITIONING',
      field: 'transaction_date'
    }
  },
  {
    collectionPath: 'users/{userId}/budgets',
    datasetId: 'claw_budget',
    tableId: 'budgets_firestore',
    backfillEnabled: true,
    clustering: ['user_id']
  },
  {
    collectionPath: 'users/{userId}/accounts',
    datasetId: 'claw_budget',
    tableId: 'accounts_firestore',
    backfillEnabled: true,
    clustering: ['user_id']
  },

  // Cross-App Collections
  {
    collectionPath: 'users',
    datasetId: 'claw_cross_app',
    tableId: 'users_firestore',
    backfillEnabled: true,
    clustering: ['id']
  },
  {
    collectionPath: 'subscriptions',
    datasetId: 'claw_cross_app',
    tableId: 'subscriptions_firestore',
    backfillEnabled: true,
    clustering: ['user_id']
  }
];

/**
 * Generate Firebase Extension configuration for each collection
 */
export function generateExtensionConfigs(): string[] {
  return firestoreExportConfigs.map((config, index) => {
    const instanceId = `bq-export-${config.tableId.replace('_firestore', '')}-${index}`;
    
    return `
# Extension Instance: ${instanceId}
firebase ext:install firebase/firestore-bigquery-export \\
  --project=YOUR_PROJECT_ID \\
  --instance-id=${instanceId} \\
  --params='
    {
      "COLLECTION_PATH": "${config.collectionPath}",
      "DATASET_ID": "${config.datasetId}",
      "TABLE_ID": "${config.tableId}",
      "BACKFILL_EXISTING": ${config.backfillEnabled},
      "CLUSTERING": "${config.clustering?.join(',') || ''}",
      "TIME_PARTITIONING": ${config.partitioning ? `"${config.partitioning.field}"` : '""'},
      "BIGQUERY_DEFAULT_LOCATION": "US"
    }'
`;
  });
}

/**
 * Setup instructions for Firebase BigQuery Export
 */
export const setupInstructions = `
# Firebase BigQuery Export Setup Instructions

## Prerequisites
1. Enable BigQuery API in your GCP project
2. Install Firebase CLI: npm install -g firebase-tools
3. Login to Firebase: firebase login
4. Set your project: firebase use YOUR_PROJECT_ID

## Installation Steps

### Option 1: Install via Firebase Console (Recommended)
1. Go to https://console.firebase.google.com/project/YOUR_PROJECT_ID/extensions
2. Browse Extensions Catalog
3. Search for "Export Collections to BigQuery" 
4. Click Install
5. Configure each collection according to the configs below

### Option 2: Install via CLI
Run the following commands for each collection you want to export:

${generateExtensionConfigs().join('\n')}

## Post-Installation
1. The extension will create BigQuery datasets and tables automatically
2. Existing documents will be backfilled if BACKFILL_EXISTING is true
3. New document changes will be exported in real-time
4. Monitor the extension logs in Firebase Console

## Schema Mapping
Firestore documents are automatically converted to BigQuery format:
- Document ID → document_id (STRING)
- Document data → flattened columns
- Nested objects → JSON strings or RECORD types
- Arrays → REPEATED fields
- Timestamps → TIMESTAMP type
- GeoPoints → lat/lng FLOAT fields

## Cost Considerations
- BigQuery storage: $0.02/GB/month (first 10GB free)
- BigQuery compute: $5/TB processed (first 1TB/month free)
- Firebase Functions: Billed per execution (generous free tier)
- Firestore reads: Functions read documents on change (counts toward quota)

## Monitoring & Troubleshooting
1. Check extension logs: Firebase Console → Extensions → Instance → Logs
2. Verify BigQuery tables: GCP Console → BigQuery → Your datasets
3. Monitor export errors in Cloud Logging
4. Set up alerting for failed exports

## Advanced Configuration
For complex data transformations, you can:
1. Use the TRANSFORM_FUNCTION parameter to specify a Cloud Function
2. Create custom ETL pipelines using Cloud Functions or Cloud Run
3. Use BigQuery scheduled queries for data aggregation

## Notes
- Document deletes are not reflected in BigQuery (append-only)
- Use timestamp fields for point-in-time queries
- Consider data retention policies for cost optimization
- Large documents (>1MB) may cause export failures
`;

/**
 * Generate terraform configuration for infrastructure as code
 */
export function generateTerraformConfig(): string {
  return `
# Terraform configuration for BigQuery datasets and tables
# This creates the target datasets that Firebase Extensions will populate

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
  }
}

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "dataset_location" {
  description = "BigQuery dataset location"
  type        = string
  default     = "US"
}

# Create datasets
${Array.from(new Set(firestoreExportConfigs.map(c => c.datasetId))).map(datasetId => `
resource "google_bigquery_dataset" "${datasetId}" {
  dataset_id                  = "${datasetId}"
  project                     = var.project_id
  location                    = var.dataset_location
  description                 = "Dataset for ${datasetId.replace('claw_', '').replace('_', ' ')} app data from Firestore"
  default_table_expiration_ms = null
  
  labels = {
    app = "${datasetId.replace('claw_', '')}"
    source = "firestore"
  }
}
`).join('')}

# Outputs
${Array.from(new Set(firestoreExportConfigs.map(c => c.datasetId))).map(datasetId => `
output "${datasetId}_dataset_id" {
  value = google_bigquery_dataset.${datasetId}.dataset_id
}
`).join('')}
`;
}

export default {
  firestoreExportConfigs,
  generateExtensionConfigs,
  setupInstructions,
  generateTerraformConfig
};