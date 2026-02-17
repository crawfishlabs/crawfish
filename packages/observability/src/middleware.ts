import { Request, Response, NextFunction } from 'express';
import { startTrace, endTrace, recordLLMCall } from './performance';

/**
 * Express middleware that auto-tracks request latency.
 */
export function performanceMiddleware(appId: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const trace = startTrace('api_latency', {
      app: appId,
      method: req.method,
      path: req.path,
    });

    const originalEnd = res.end;
    res.end = function (...args: any[]) {
      endTrace(trace, res.statusCode < 400, res.statusCode >= 400 ? `HTTP ${res.statusCode}` : undefined)
        .catch(console.error);
      return originalEnd.apply(res, args);
    } as any;

    next();
  };
}

/**
 * Wrapper to track LLM latency for AI service calls.
 */
export async function trackLLMCall<T>(
  appId: string,
  model: string,
  fn: () => Promise<{ result: T; inputTokens: number; outputTokens: number }>
): Promise<T> {
  const start = Date.now();
  try {
    const { result, inputTokens, outputTokens } = await fn();
    const duration = Date.now() - start;
    await recordLLMCall(model, inputTokens, outputTokens, duration, appId, true).catch(console.error);
    return result;
  } catch (error: any) {
    const duration = Date.now() - start;
    await recordLLMCall(model, 0, 0, duration, appId, false, error.message).catch(console.error);
    throw error;
  }
}
