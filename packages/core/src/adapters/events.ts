/**
 * @claw/core — Event Bus Adapter
 *
 * Abstracts event emission and subscription.
 * Implementations: FirestoreEventBus (triggers), HttpEventBus (Crawfish Cloud),
 *                  RedisEventBus, KafkaEventBus, etc.
 */

export type CrawfishEventType =
  | 'feedback'
  | 'error'
  | 'experiment'
  | 'sentiment'
  | 'metric'
  | 'guardrail'
  | 'identify'
  | 'track';

export interface CrawfishEvent {
  /** Unique event ID (generated if not provided). */
  id?: string;

  /** Event type. */
  type: CrawfishEventType;

  /** When the event occurred. */
  timestamp: Date;

  /** User who triggered the event. */
  userId?: string;

  /** Account/organization the user belongs to. */
  accountId?: string;

  /** Application that generated the event. */
  appId?: string;

  /** Event-specific payload. */
  data: Record<string, unknown>;

  /** Additional context (SDK version, device info, etc.). */
  metadata?: Record<string, unknown>;
}

export type EventHandler = (event: CrawfishEvent) => Promise<void>;

export interface CrawfishEventBus {
  /** Emit an event to the bus. */
  emit(event: CrawfishEvent): Promise<void>;

  /** Emit multiple events in a batch. */
  emitBatch?(events: CrawfishEvent[]): Promise<void>;

  /** Subscribe to events of a given type. */
  on(eventType: CrawfishEventType | '*', handler: EventHandler): void;

  /** Remove a subscription. */
  off?(eventType: CrawfishEventType | '*', handler: EventHandler): void;
}
