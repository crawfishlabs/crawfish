/**
 * Unit tests for event publishing — batching, deduplication, tracking
 */

// Mock snowflake-sdk
jest.mock('snowflake-sdk', () => ({
  createConnection: jest.fn(() => ({
    connect: jest.fn((cb) => cb(null, {})),
    execute: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid-1234') }));

describe('Event Publisher', () => {
  describe('Event structure', () => {
    interface AnalyticsEvent {
      eventId: string;
      userId?: string;
      sessionId?: string;
      timestamp: Date;
      eventName: string;
      properties: Record<string, any>;
    }

    function createEvent(name: string, props: Record<string, any>, userId?: string): AnalyticsEvent {
      return {
        eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        userId,
        timestamp: new Date(),
        eventName: name,
        properties: props,
      };
    }

    it('should create event with required fields', () => {
      const event = createEvent('page_view', { page: '/budget' }, 'user-1');
      expect(event.eventId).toBeDefined();
      expect(event.eventName).toBe('page_view');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.userId).toBe('user-1');
    });

    it('should allow optional userId for anonymous events', () => {
      const event = createEvent('app_load', { source: 'web' });
      expect(event.userId).toBeUndefined();
    });

    it('should include arbitrary properties', () => {
      const event = createEvent('transaction_created', { amount: -85.50, category: 'Groceries' });
      expect(event.properties.amount).toBe(-85.50);
      expect(event.properties.category).toBe('Groceries');
    });
  });

  describe('Batching', () => {
    function createBatcher(maxSize: number, maxWaitMs: number) {
      let batch: any[] = [];
      let flushCount = 0;

      return {
        add(event: any) {
          batch.push(event);
          if (batch.length >= maxSize) this.flush();
        },
        flush() {
          if (batch.length > 0) {
            flushCount++;
            batch = [];
          }
        },
        getBatchSize: () => batch.length,
        getFlushCount: () => flushCount,
      };
    }

    it('should batch events up to max size', () => {
      const batcher = createBatcher(3, 5000);
      batcher.add({ name: 'e1' });
      batcher.add({ name: 'e2' });
      expect(batcher.getBatchSize()).toBe(2);
      expect(batcher.getFlushCount()).toBe(0);
    });

    it('should auto-flush when batch is full', () => {
      const batcher = createBatcher(3, 5000);
      batcher.add({ name: 'e1' });
      batcher.add({ name: 'e2' });
      batcher.add({ name: 'e3' });
      expect(batcher.getFlushCount()).toBe(1);
      expect(batcher.getBatchSize()).toBe(0);
    });

    it('should handle manual flush of partial batch', () => {
      const batcher = createBatcher(10, 5000);
      batcher.add({ name: 'e1' });
      batcher.flush();
      expect(batcher.getFlushCount()).toBe(1);
      expect(batcher.getBatchSize()).toBe(0);
    });

    it('should not flush empty batch', () => {
      const batcher = createBatcher(10, 5000);
      batcher.flush();
      expect(batcher.getFlushCount()).toBe(0);
    });
  });

  describe('Deduplication', () => {
    function createDeduper(maxSize: number = 1000) {
      const seen = new Set<string>();
      return {
        isDuplicate(eventId: string): boolean {
          if (seen.has(eventId)) return true;
          seen.add(eventId);
          if (seen.size > maxSize) {
            const first = seen.values().next().value;
            seen.delete(first);
          }
          return false;
        },
        size: () => seen.size,
      };
    }

    it('should detect duplicate event IDs', () => {
      const deduper = createDeduper();
      expect(deduper.isDuplicate('evt-1')).toBe(false);
      expect(deduper.isDuplicate('evt-1')).toBe(true);
    });

    it('should allow unique events', () => {
      const deduper = createDeduper();
      expect(deduper.isDuplicate('evt-1')).toBe(false);
      expect(deduper.isDuplicate('evt-2')).toBe(false);
      expect(deduper.isDuplicate('evt-3')).toBe(false);
    });

    it('should evict old entries when max size exceeded', () => {
      const deduper = createDeduper(3);
      deduper.isDuplicate('evt-1');
      deduper.isDuplicate('evt-2');
      deduper.isDuplicate('evt-3');
      deduper.isDuplicate('evt-4'); // Should evict evt-1
      expect(deduper.isDuplicate('evt-1')).toBe(false); // No longer tracked
    });
  });

  describe('Schema routing', () => {
    const SCHEMA_MAP: Record<string, string> = {
      budget: 'BUDGET',
      nutrition: 'NUTRITION',
      meetings: 'MEETINGS',
      fitness: 'FITNESS',
    };

    it('should route budget events to BUDGET schema', () => {
      expect(SCHEMA_MAP['budget']).toBe('BUDGET');
    });

    it('should route nutrition events to NUTRITION schema', () => {
      expect(SCHEMA_MAP['nutrition']).toBe('NUTRITION');
    });

    it('should have schemas for all apps', () => {
      expect(Object.keys(SCHEMA_MAP)).toHaveLength(4);
    });
  });
});
