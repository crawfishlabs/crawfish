/**
 * Firestore-based implementation of CrawfishEventBus.
 *
 * Events are written to a Firestore collection. Cloud Functions triggers
 * handle subscription dispatch. For local development, in-memory handlers
 * are also supported.
 */
import * as admin from 'firebase-admin';
import { v4 as uuid } from 'uuid';
import type { CrawfishEventBus, CrawfishEvent, CrawfishEventType, EventHandler } from '@claw/core';

export class FirestoreEventBus implements CrawfishEventBus {
  private db: admin.firestore.Firestore;
  private handlers: Map<string, EventHandler[]> = new Map();
  private collectionName: string;

  constructor(app?: admin.app.App, collectionName = 'crawfish_events') {
    this.db = (app ?? admin.app()).firestore();
    this.collectionName = collectionName;
  }

  async emit(event: CrawfishEvent): Promise<void> {
    const id = event.id ?? uuid();
    const doc = {
      ...event,
      id,
      timestamp: admin.firestore.Timestamp.fromDate(event.timestamp),
    };
    await this.db.collection(this.collectionName).doc(id).set(doc);

    // Also dispatch to in-memory handlers (for local/testing)
    await this.dispatch(event);
  }

  async emitBatch(events: CrawfishEvent[]): Promise<void> {
    const batch = this.db.batch();
    for (const event of events) {
      const id = event.id ?? uuid();
      const ref = this.db.collection(this.collectionName).doc(id);
      batch.set(ref, {
        ...event,
        id,
        timestamp: admin.firestore.Timestamp.fromDate(event.timestamp),
      });
    }
    await batch.commit();

    for (const event of events) {
      await this.dispatch(event);
    }
  }

  on(eventType: CrawfishEventType | '*', handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  off(eventType: CrawfishEventType | '*', handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    this.handlers.set(eventType, existing.filter((h) => h !== handler));
  }

  private async dispatch(event: CrawfishEvent): Promise<void> {
    const typeHandlers = this.handlers.get(event.type) ?? [];
    const wildcardHandlers = this.handlers.get('*') ?? [];
    const all = [...typeHandlers, ...wildcardHandlers];
    await Promise.all(all.map((h) => h(event)));
  }
}
