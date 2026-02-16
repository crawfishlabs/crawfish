import { BigQuery, Dataset, Table } from '@google-cloud/bigquery';

export interface BigQueryConfig {
  projectId: string;
  datasetPrefix: string;
  location: string;
}

export class BigQueryClient {
  private client: BigQuery;
  private config: BigQueryConfig;

  constructor(config?: Partial<BigQueryConfig>) {
    this.config = {
      projectId: config?.projectId || process.env.GOOGLE_CLOUD_PROJECT || '',
      datasetPrefix: config?.datasetPrefix || process.env.BIGQUERY_DATASET_PREFIX || 'claw',
      location: config?.location || process.env.BIGQUERY_LOCATION || 'US'
    };

    if (!this.config.projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required');
    }

    this.client = new BigQuery({
      projectId: this.config.projectId,
      location: this.config.location,
    });
  }

  getClient(): BigQuery {
    return this.client;
  }

  getConfig(): BigQueryConfig {
    return this.config;
  }

  // Dataset definitions for all Claw apps
  getDatasets() {
    const { datasetPrefix } = this.config;
    return {
      fitness: `${datasetPrefix}_fitness`,
      nutrition: `${datasetPrefix}_nutrition`, 
      meetings: `${datasetPrefix}_meetings`,
      budget: `${datasetPrefix}_budget`,
      crossApp: `${datasetPrefix}_cross_app`,
    };
  }

  async getDataset(datasetName: string): Promise<Dataset> {
    return this.client.dataset(datasetName);
  }

  async getTable(datasetName: string, tableName: string): Promise<Table> {
    const dataset = await this.getDataset(datasetName);
    return dataset.table(tableName);
  }

  async createDatasetIfNotExists(datasetName: string, options?: any): Promise<Dataset> {
    const dataset = this.client.dataset(datasetName);
    const [exists] = await dataset.exists();
    
    if (!exists) {
      const [createdDataset] = await this.client.createDataset(datasetName, {
        location: this.config.location,
        ...options,
      });
      console.log(`Dataset ${datasetName} created.`);
      return createdDataset;
    }
    
    return dataset;
  }

  async createTableIfNotExists(
    datasetName: string, 
    tableName: string, 
    schema: any[], 
    options?: any
  ): Promise<Table> {
    const dataset = await this.getDataset(datasetName);
    const table = dataset.table(tableName);
    const [exists] = await table.exists();
    
    if (!exists) {
      const [createdTable] = await dataset.createTable(tableName, {
        schema,
        ...options,
      });
      console.log(`Table ${datasetName}.${tableName} created.`);
      return createdTable;
    }
    
    return table;
  }

  async query(sqlQuery: string, options?: any): Promise<any[]> {
    const [rows] = await this.client.query({
      query: sqlQuery,
      location: this.config.location,
      ...options,
    });
    return rows;
  }

  async streamInsert(
    datasetName: string, 
    tableName: string, 
    rows: any[], 
    options?: any
  ): Promise<void> {
    const table = await this.getTable(datasetName, tableName);
    await table.insert(rows, options);
  }

  async createView(
    datasetName: string,
    viewName: string,
    query: string
  ): Promise<Table> {
    const dataset = await this.getDataset(datasetName);
    const [view] = await dataset.createTable(viewName, {
      view: { query, useLegacySql: false },
    });
    console.log(`View ${datasetName}.${viewName} created.`);
    return view;
  }
}

export default BigQueryClient;