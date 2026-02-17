/**
 * @claw/core — Database Store Adapter
 *
 * Abstracts all document/collection-based data access.
 * Implementations: FirestoreStore, PostgresStore, MongoStore, etc.
 */

export type WhereOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';

export interface QueryFilter {
  field: string;
  operator: WhereOperator;
  value: unknown;
}

export interface QueryOptions {
  filters?: QueryFilter[];
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export interface DocumentSnapshot<T = Record<string, unknown>> {
  id: string;
  data: T;
  exists: boolean;
}

export interface CrawfishStore {
  /** Retrieve a single document by collection and ID. */
  get<T = Record<string, unknown>>(collection: string, id: string): Promise<DocumentSnapshot<T> | null>;

  /** Create or overwrite a document. */
  set(collection: string, id: string, data: Record<string, unknown>): Promise<void>;

  /** Partially update a document (merge). */
  update(collection: string, id: string, data: Record<string, unknown>): Promise<void>;

  /** Delete a document. */
  delete(collection: string, id: string): Promise<void>;

  /** Query documents with filters, ordering, and pagination. */
  query<T = Record<string, unknown>>(collection: string, options: QueryOptions): Promise<DocumentSnapshot<T>[]>;
}
