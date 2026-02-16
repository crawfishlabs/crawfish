import snowflake, { Connection, SnowflakeError } from 'snowflake-sdk';

export interface SnowflakeConfig {
  account: string;
  username: string;
  password: string;
  warehouse: string;
  database: string;
  role?: string;
  schema?: string;
  timeout?: number;
  maxRetries?: number;
  poolSize?: number;
}

export class SnowflakeClient {
  private config: SnowflakeConfig;
  private connectionPool: Connection[] = [];
  private currentConnection: Connection | null = null;

  constructor(config?: Partial<SnowflakeConfig>) {
    this.config = {
      account: config?.account || process.env.SNOWFLAKE_ACCOUNT || '',
      username: config?.username || process.env.SNOWFLAKE_USER || '',
      password: config?.password || process.env.SNOWFLAKE_PASSWORD || '',
      warehouse: config?.warehouse || process.env.SNOWFLAKE_WAREHOUSE || 'CLAW_XS',
      database: config?.database || process.env.SNOWFLAKE_DATABASE || 'CLAW_ANALYTICS',
      role: config?.role || process.env.SNOWFLAKE_ROLE,
      schema: config?.schema || 'PUBLIC',
      timeout: config?.timeout || 30000,
      maxRetries: config?.maxRetries || 3,
      poolSize: config?.poolSize || 5,
    };

    if (!this.config.account || !this.config.username || !this.config.password) {
      throw new Error('SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, and SNOWFLAKE_PASSWORD environment variables are required');
    }
  }

  getConfig(): SnowflakeConfig {
    return this.config;
  }

  // Schema definitions for all Claw apps
  getSchemas() {
    return {
      fitness: 'FITNESS',
      nutrition: 'NUTRITION',
      meetings: 'MEETINGS',
      budget: 'BUDGET',
      crossApp: 'CROSS_APP',
    };
  }

  private async createConnection(): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const connection = snowflake.createConnection({
        account: this.config.account,
        username: this.config.username,
        password: this.config.password,
        warehouse: this.config.warehouse,
        database: this.config.database,
        role: this.config.role,
        schema: this.config.schema,
        timeout: this.config.timeout,
      });

      connection.connect((err, conn) => {
        if (err) {
          reject(new Error(`Failed to connect to Snowflake: ${err.message}`));
        } else {
          resolve(conn);
        }
      });
    });
  }

  private async getConnection(): Promise<Connection> {
    if (this.connectionPool.length > 0) {
      return this.connectionPool.pop()!;
    }

    if (!this.currentConnection) {
      this.currentConnection = await this.createConnection();
    }

    return this.currentConnection;
  }

  private releaseConnection(connection: Connection): void {
    if (this.connectionPool.length < this.config.poolSize!) {
      this.connectionPool.push(connection);
    } else {
      connection.destroy(() => {});
    }
  }

  async query(sqlQuery: string, binds?: any[]): Promise<any[]> {
    let retries = 0;
    const maxRetries = this.config.maxRetries!;

    while (retries <= maxRetries) {
      let connection: Connection | null = null;
      
      try {
        connection = await this.getConnection();
        
        return new Promise((resolve, reject) => {
          connection!.execute({
            sqlText: sqlQuery,
            binds,
            complete: (err, stmt, rows) => {
              if (err) {
                reject(new Error(`Query failed: ${err.message}`));
              } else {
                resolve(rows || []);
              }
            },
          });
        });
      } catch (error) {
        retries++;
        console.warn(`Query attempt ${retries} failed:`, (error as Error).message);
        
        if (retries > maxRetries) {
          throw error;
        }
        
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
      } finally {
        if (connection) {
          this.releaseConnection(connection);
        }
      }
    }

    throw new Error(`Query failed after ${maxRetries} retries`);
  }

  async executeStatement(sqlQuery: string, binds?: any[]): Promise<void> {
    const connection = await this.getConnection();
    
    try {
      return new Promise((resolve, reject) => {
        connection.execute({
          sqlText: sqlQuery,
          binds,
          complete: (err) => {
            if (err) {
              reject(new Error(`Statement execution failed: ${err.message}`));
            } else {
              resolve();
            }
          },
        });
      });
    } finally {
      this.releaseConnection(connection);
    }
  }

  async createSchemaIfNotExists(schemaName: string): Promise<void> {
    const createSchemaSQL = `
      CREATE SCHEMA IF NOT EXISTS ${this.config.database}.${schemaName}
      COMMENT = 'Schema for ${schemaName.toLowerCase()} analytics data'
    `;
    
    await this.executeStatement(createSchemaSQL);
    console.log(`Schema ${schemaName} created or already exists.`);
  }

  async createTableIfNotExists(
    schemaName: string,
    tableName: string,
    createTableSQL: string
  ): Promise<void> {
    const fullTableName = `${this.config.database}.${schemaName}.${tableName}`;
    
    // Replace IF NOT EXISTS pattern in the SQL if needed
    const finalSQL = createTableSQL.replace(
      /CREATE TABLE ([^(]+)/i,
      `CREATE TABLE IF NOT EXISTS ${fullTableName}`
    );
    
    await this.executeStatement(finalSQL);
    console.log(`Table ${fullTableName} created or already exists.`);
  }

  async createViewIfNotExists(
    schemaName: string,
    viewName: string,
    viewSQL: string
  ): Promise<void> {
    const fullViewName = `${this.config.database}.${schemaName}.${viewName}`;
    
    const createViewSQL = `
      CREATE OR REPLACE VIEW ${fullViewName} AS
      ${viewSQL}
    `;
    
    await this.executeStatement(createViewSQL);
    console.log(`View ${fullViewName} created or replaced.`);
  }

  async batchInsert(
    schemaName: string,
    tableName: string,
    rows: any[],
    options?: { upsert?: boolean; idColumn?: string }
  ): Promise<void> {
    if (rows.length === 0) return;

    const fullTableName = `${this.config.database}.${schemaName}.${tableName}`;
    
    if (options?.upsert && options.idColumn) {
      // Use MERGE for idempotent upserts
      const columns = Object.keys(rows[0]);
      const valuesList = rows.map(row => 
        `(${columns.map(col => `'${String(row[col]).replace(/'/g, "''")}'`).join(', ')})`
      ).join(', ');
      
      const mergeSQL = `
        MERGE INTO ${fullTableName} AS target
        USING (VALUES ${valuesList}) AS source(${columns.join(', ')})
        ON target.${options.idColumn} = source.${options.idColumn}
        WHEN MATCHED THEN UPDATE SET
          ${columns.filter(col => col !== options.idColumn).map(col => `${col} = source.${col}`).join(', ')}
        WHEN NOT MATCHED THEN INSERT
          (${columns.join(', ')})
        VALUES
          (${columns.map(col => `source.${col}`).join(', ')})
      `;
      
      await this.executeStatement(mergeSQL);
    } else {
      // Simple INSERT for append-only scenarios
      const columns = Object.keys(rows[0]);
      const valuesList = rows.map(row => 
        `(${columns.map(col => `'${String(row[col]).replace(/'/g, "''")}'`).join(', ')})`
      ).join(', ');
      
      const insertSQL = `
        INSERT INTO ${fullTableName} (${columns.join(', ')})
        VALUES ${valuesList}
      `;
      
      await this.executeStatement(insertSQL);
    }
  }

  async createWarehouse(): Promise<void> {
    const createWarehouseSQL = `
      CREATE WAREHOUSE IF NOT EXISTS ${this.config.warehouse}
      WITH
        WAREHOUSE_SIZE = 'X-SMALL'
        AUTO_SUSPEND = 60
        AUTO_RESUME = TRUE
        INITIALLY_SUSPENDED = TRUE
      COMMENT = 'X-Small warehouse for Claw analytics workloads'
    `;
    
    await this.executeStatement(createWarehouseSQL);
    console.log(`Warehouse ${this.config.warehouse} created or already exists.`);
  }

  async close(): Promise<void> {
    // Close all pooled connections
    for (const connection of this.connectionPool) {
      connection.destroy(() => {});
    }
    this.connectionPool = [];

    // Close current connection
    if (this.currentConnection) {
      this.currentConnection.destroy(() => {});
      this.currentConnection = null;
    }
  }
}

export default SnowflakeClient;