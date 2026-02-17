import * as admin from 'firebase-admin';
import { FeatureFlag } from './models';
import { DEFAULT_FLAG_MAP } from './default-flags';

interface CacheEntry {
  value: any;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
let allFlagsCache: { flags: Record<string, any>; fetchedAt: number } | null = null;

/** Cache TTL in milliseconds (default 5 minutes) */
let cacheTTLMs = 5 * 60 * 1000;

export function setCacheTTL(ms: number): void {
  cacheTTLMs = ms;
}

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < cacheTTLMs;
}

/**
 * Get a single feature flag value with caching.
 */
export async function getFeatureFlag<T = any>(key: string, defaultValue: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && isFresh(cached.fetchedAt)) {
    return cached.value as T;
  }

  try {
    const rc = admin.remoteConfig();
    const template = await rc.getTemplate();
    const param = template.parameters?.[key];
    if (param?.defaultValue && 'value' in param.defaultValue) {
      const raw = param.defaultValue.value;
      const parsed = tryParse(raw, defaultValue);
      cache.set(key, { value: parsed, fetchedAt: Date.now() });
      return parsed as T;
    }
  } catch {
    // Fall through to default
  }

  const fallback = DEFAULT_FLAG_MAP[key] ?? defaultValue;
  cache.set(key, { value: fallback, fetchedAt: Date.now() });
  return fallback as T;
}

/**
 * Get all active flags (cached).
 */
export async function getAllFlags(): Promise<Record<string, any>> {
  if (allFlagsCache && isFresh(allFlagsCache.fetchedAt)) {
    return allFlagsCache.flags;
  }

  const flags: Record<string, any> = { ...DEFAULT_FLAG_MAP };

  try {
    const rc = admin.remoteConfig();
    const template = await rc.getTemplate();
    for (const [key, param] of Object.entries(template.parameters || {})) {
      if (param?.defaultValue && 'value' in param.defaultValue) {
        flags[key] = tryParse(param.defaultValue.value, flags[key]);
      }
    }
  } catch {
    // Use defaults only
  }

  allFlagsCache = { flags, fetchedAt: Date.now() };
  return flags;
}

/**
 * Check if a feature is enabled, with optional user-level override.
 */
export async function isFeatureEnabled(key: string, userId?: string): Promise<boolean> {
  if (userId) {
    try {
      const db = admin.firestore();
      const overrideDoc = await db.collection('feature_overrides').doc(userId).get();
      if (overrideDoc.exists) {
        const overrides = overrideDoc.data();
        if (overrides && key in overrides) {
          return !!overrides[key];
        }
      }
    } catch {
      // Fall through to global flag
    }
  }

  return getFeatureFlag(key, DEFAULT_FLAG_MAP[key] ?? false);
}

/** Clear the in-memory cache */
export function clearCache(): void {
  cache.clear();
  allFlagsCache = null;
}

function tryParse(raw: any, fallback: any): any {
  if (typeof raw !== 'string') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;
  try { return JSON.parse(raw); } catch { return raw; }
}
