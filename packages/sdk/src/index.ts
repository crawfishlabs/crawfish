/**
 * @crawfish/sdk — Public SDK for Crawfish platform
 *
 * Thin HTTP client. Zero dependencies. Works in Node.js, browsers, and edge runtimes.
 *
 * Usage:
 *   import { Crawfish } from '@crawfish/sdk';
 *   const crawfish = new Crawfish({ appId: 'app_xxx', apiKey: 'ck_xxx' });
 *   crawfish.track('checkout', { amount: 49.99 });
 */

export interface CrawfishConfig {
  appId: string;
  apiKey: string;
  /** Override the default API endpoint. */
  endpoint?: string;
  /** Flush events in batches (default: true). */
  batching?: boolean;
  /** Batch flush interval in ms (default: 5000). */
  flushIntervalMs?: number;
  /** Max events per batch (default: 10). */
  batchSize?: number;
}

export interface UserTraits {
  email?: string;
  name?: string;
  plan?: string;
  [key: string]: unknown;
}

export interface FeedbackPayload {
  rating?: number;
  comment?: string;
  category?: string;
  screen?: string;
  [key: string]: unknown;
}

interface QueuedEvent {
  type: string;
  timestamp: string;
  userId?: string;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class Crawfish {
  private config: Required<Pick<CrawfishConfig, 'appId' | 'apiKey' | 'endpoint' | 'batchSize' | 'flushIntervalMs'>> & { batching: boolean };
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private userId?: string;
  private userTraits?: UserTraits;

  constructor(config: CrawfishConfig) {
    this.config = {
      appId: config.appId,
      apiKey: config.apiKey,
      endpoint: config.endpoint ?? 'https://api.crawfish.dev/v1',
      batching: config.batching ?? true,
      flushIntervalMs: config.flushIntervalMs ?? 5000,
      batchSize: config.batchSize ?? 10,
    };

    if (this.config.batching) {
      this.timer = setInterval(() => this.flush(), this.config.flushIntervalMs);
    }
  }

  /** Identify the current user. */
  identify(userId: string, traits?: UserTraits): void {
    this.userId = userId;
    this.userTraits = traits;
    this.enqueue('identify', { userId, traits: traits ?? {} });
  }

  /** Track a custom event. */
  track(event: string, properties?: Record<string, unknown>): void {
    this.enqueue('track', { event, properties: properties ?? {} });
  }

  /** Submit user feedback. */
  feedback(payload: FeedbackPayload): void {
    this.enqueue('feedback', payload);
  }

  /** Get experiment variant for the current user. */
  async experiment(experimentKey: string): Promise<string> {
    const params = new URLSearchParams({
      key: experimentKey,
      ...(this.userId && { user: this.userId }),
    });

    const res = await this.request('GET', `/flags?${params}`);
    const data = await res.json();
    return data.value ?? 'control';
  }

  /** Get a feature flag value. */
  async getFlag<T = unknown>(key: string): Promise<T> {
    const params = new URLSearchParams({
      key,
      ...(this.userId && { user: this.userId }),
    });

    const res = await this.request('GET', `/flags?${params}`);
    const data = await res.json();
    return data.value as T;
  }

  /** Flush all queued events immediately. */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const events = this.queue.splice(0, this.config.batchSize);

    await this.request('POST', '/events', {
      appId: this.config.appId,
      events,
    });
  }

  /** Stop the SDK and flush remaining events. */
  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private enqueue(type: string, data: Record<string, unknown>): void {
    this.queue.push({
      type,
      timestamp: new Date().toISOString(),
      userId: this.userId,
      data,
      metadata: this.userTraits ? { traits: this.userTraits } : undefined,
    });

    if (!this.config.batching) {
      this.flush().catch(() => {});
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.config.endpoint}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Crawfish-App': this.config.appId,
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      throw new Error(`Crawfish API error: ${res.status} ${res.statusText}`);
    }

    return res;
  }
}

export default Crawfish;
