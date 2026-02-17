import * as admin from 'firebase-admin';
import { Router, Request, Response } from 'express';

export interface DependencyStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  dependencies: DependencyStatus[];
}

const startTime = Date.now();

/**
 * Quick health check — just confirms the service is running.
 */
export function healthCheck(): HealthStatus {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Date.now() - startTime,
    dependencies: [],
  };
}

/**
 * Deep health check — pings all dependencies and reports latency.
 */
export async function deepHealthCheck(): Promise<HealthStatus> {
  const deps: DependencyStatus[] = [];

  // Firestore
  deps.push(await checkFirestore());

  // Aggregate status
  const hasDown = deps.some(d => d.status === 'down');
  const hasDegraded = deps.some(d => d.status === 'degraded');

  return {
    status: hasDown ? 'down' : hasDegraded ? 'degraded' : 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Date.now() - startTime,
    dependencies: deps,
  };
}

async function checkFirestore(): Promise<DependencyStatus> {
  const start = Date.now();
  try {
    const db = admin.firestore();
    await db.collection('_health').doc('ping').set({ t: Date.now() });
    return { name: 'firestore', status: 'healthy', latencyMs: Date.now() - start };
  } catch (error: any) {
    return { name: 'firestore', status: 'down', latencyMs: Date.now() - start, error: error.message };
  }
}

/**
 * Express router with /health and /health/deep endpoints.
 */
export function healthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const status = healthCheck();
    res.json(status);
  });

  router.get('/health/deep', async (_req: Request, res: Response) => {
    const status = await deepHealthCheck();
    const httpCode = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;
    res.status(httpCode).json(status);
  });

  return router;
}
