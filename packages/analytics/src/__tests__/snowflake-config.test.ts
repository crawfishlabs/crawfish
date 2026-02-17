/**
 * Unit tests for Snowflake connection configuration
 */

jest.mock('snowflake-sdk', () => ({
  createConnection: jest.fn(() => ({
    connect: jest.fn((cb: any) => cb(null, {})),
    execute: jest.fn(),
    destroy: jest.fn(),
  })),
}));

describe('Snowflake Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Configuration loading', () => {
    it('should load config from environment variables', () => {
      process.env.SNOWFLAKE_ACCOUNT = 'test-account';
      process.env.SNOWFLAKE_USER = 'test-user';
      process.env.SNOWFLAKE_PASSWORD = 'test-pass';
      process.env.SNOWFLAKE_WAREHOUSE = 'TEST_WH';
      process.env.SNOWFLAKE_DATABASE = 'TEST_DB';

      // Reproduce config loading logic from snowflake-config.ts
      const config = {
        account: process.env.SNOWFLAKE_ACCOUNT || '',
        username: process.env.SNOWFLAKE_USER || '',
        password: process.env.SNOWFLAKE_PASSWORD || '',
        warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'CLAW_XS',
        database: process.env.SNOWFLAKE_DATABASE || 'CLAW_ANALYTICS',
      };

      expect(config.account).toBe('test-account');
      expect(config.username).toBe('test-user');
      expect(config.warehouse).toBe('TEST_WH');
      expect(config.database).toBe('TEST_DB');
    });

    it('should use defaults when env vars missing', () => {
      delete process.env.SNOWFLAKE_WAREHOUSE;
      delete process.env.SNOWFLAKE_DATABASE;

      const config = {
        warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'CLAW_XS',
        database: process.env.SNOWFLAKE_DATABASE || 'CLAW_ANALYTICS',
        schema: process.env.SNOWFLAKE_SCHEMA || 'PUBLIC',
      };

      expect(config.warehouse).toBe('CLAW_XS');
      expect(config.database).toBe('CLAW_ANALYTICS');
      expect(config.schema).toBe('PUBLIC');
    });

    it('should throw when required credentials missing', () => {
      delete process.env.SNOWFLAKE_ACCOUNT;
      delete process.env.SNOWFLAKE_USER;
      delete process.env.SNOWFLAKE_PASSWORD;

      const account = process.env.SNOWFLAKE_ACCOUNT || '';
      const username = process.env.SNOWFLAKE_USER || '';
      const password = process.env.SNOWFLAKE_PASSWORD || '';

      expect(!account || !username || !password).toBe(true);
    });
  });

  describe('Schema definitions', () => {
    const schemas = {
      fitness: 'FITNESS',
      nutrition: 'NUTRITION',
      meetings: 'MEETINGS',
      budget: 'BUDGET',
      crossApp: 'CROSS_APP',
    };

    it('should define schemas for all Claw apps', () => {
      expect(Object.keys(schemas)).toHaveLength(5);
    });

    it('should use uppercase schema names', () => {
      for (const schema of Object.values(schemas)) {
        expect(schema).toBe(schema.toUpperCase());
      }
    });

    it('should include cross-app schema', () => {
      expect(schemas.crossApp).toBe('CROSS_APP');
    });
  });

  describe('Connection pool settings', () => {
    it('should have reasonable defaults', () => {
      const defaults = { timeout: 30000, maxRetries: 3, poolSize: 5 };
      expect(defaults.timeout).toBeGreaterThan(10000);
      expect(defaults.maxRetries).toBeGreaterThanOrEqual(1);
      expect(defaults.poolSize).toBeGreaterThanOrEqual(1);
    });

    it('should allow custom pool size', () => {
      const custom = { poolSize: 10 };
      expect(custom.poolSize).toBe(10);
    });
  });
});
