/**
 * Firestore-backed implementation of CrawfishFlags.
 *
 * Flags stored as documents in a Firestore collection.
 * Suitable for Crawfish's own flag management. For external providers
 * (LaunchDarkly, Statsig), use the dedicated adapters instead.
 */
import * as admin from 'firebase-admin';
import type { CrawfishFlags, FlagContext, FlagEvaluation, FlagRule } from '@claw/core';

interface FlagDocument {
  key: string;
  defaultValue: unknown;
  rules?: FlagRule[];
  enabled: boolean;
}

export class FirestoreFlagProvider implements CrawfishFlags {
  private db: admin.firestore.Firestore;
  private collectionName: string;

  constructor(app?: admin.app.App, collectionName = 'crawfish_flags') {
    this.db = (app ?? admin.app()).firestore();
    this.collectionName = collectionName;
  }

  async getFlag<T = unknown>(key: string, context?: FlagContext): Promise<FlagEvaluation<T>> {
    const doc = await this.db.collection(this.collectionName).doc(key).get();

    if (!doc.exists) {
      return { key, value: undefined as T, reason: 'default' };
    }

    const flag = doc.data() as FlagDocument;

    if (!flag.enabled) {
      return { key, value: flag.defaultValue as T, reason: 'default' };
    }

    // Simple rule evaluation — match first rule that applies
    if (flag.rules && context) {
      for (const rule of flag.rules) {
        const ctxValue = (context as Record<string, unknown>)[rule.attribute]
          ?? context.custom?.[rule.attribute];

        if (this.evaluateRule(rule, ctxValue)) {
          return { key, value: rule.value as T, reason: 'rule' };
        }
      }
    }

    return { key, value: flag.defaultValue as T, reason: 'default' };
  }

  async getAllFlags(context?: FlagContext): Promise<Record<string, FlagEvaluation>> {
    const snapshot = await this.db.collection(this.collectionName).get();
    const results: Record<string, FlagEvaluation> = {};

    for (const doc of snapshot.docs) {
      const evaluation = await this.getFlag(doc.id, context);
      results[doc.id] = evaluation;
    }

    return results;
  }

  async setFlag(key: string, value: unknown, rules?: FlagRule[]): Promise<void> {
    const data: FlagDocument = { key, defaultValue: value, enabled: true, rules };
    await this.db.collection(this.collectionName).doc(key).set(data, { merge: true });
  }

  private evaluateRule(rule: FlagRule, ctxValue: unknown): boolean {
    switch (rule.operator) {
      case 'eq': return ctxValue === rule.value;
      case 'neq': return ctxValue !== rule.value;
      case 'in': return Array.isArray(rule.value) && rule.value.includes(ctxValue);
      case 'not_in': return Array.isArray(rule.value) && !rule.value.includes(ctxValue);
      case 'contains': return typeof ctxValue === 'string' && ctxValue.includes(String(rule.value));
      case 'gt': return Number(ctxValue) > Number(rule.value);
      case 'lt': return Number(ctxValue) < Number(rule.value);
      default: return false;
    }
  }
}
