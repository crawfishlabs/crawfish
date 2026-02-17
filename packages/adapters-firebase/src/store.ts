/**
 * Firebase Firestore implementation of CrawfishStore.
 */
import * as admin from 'firebase-admin';
import type { CrawfishStore, DocumentSnapshot, QueryOptions } from '@claw/core';

export class FirestoreStore implements CrawfishStore {
  private db: admin.firestore.Firestore;

  constructor(app?: admin.app.App) {
    this.db = (app ?? admin.app()).firestore();
  }

  async get<T = Record<string, unknown>>(collection: string, id: string): Promise<DocumentSnapshot<T> | null> {
    const doc = await this.db.collection(collection).doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, data: doc.data() as T, exists: true };
  }

  async set(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.db.collection(collection).doc(id).set(data);
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.db.collection(collection).doc(id).update(data);
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.db.collection(collection).doc(id).delete();
  }

  async query<T = Record<string, unknown>>(collection: string, options: QueryOptions): Promise<DocumentSnapshot<T>[]> {
    let ref: admin.firestore.Query = this.db.collection(collection);

    if (options.filters) {
      for (const filter of options.filters) {
        ref = ref.where(filter.field, filter.operator as admin.firestore.WhereFilterOp, filter.value);
      }
    }

    if (options.orderBy) {
      ref = ref.orderBy(options.orderBy.field, options.orderBy.direction);
    }

    if (options.offset) {
      ref = ref.offset(options.offset);
    }

    if (options.limit) {
      ref = ref.limit(options.limit);
    }

    const snapshot = await ref.get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as T,
      exists: true,
    }));
  }
}
