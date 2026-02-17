import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

export interface ErrorReport {
  id: string;
  message: string;
  stack?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  appId: string;
  userId?: string;
  endpoint?: string;
  timestamp: Date;
  metadata: Record<string, any>;
  hash: string;
  incidentId?: string;
}

const ERRORS_COLLECTION = 'errors';
const INCIDENTS_COLLECTION = 'incidents';

function getDb() {
  return admin.firestore();
}

function hashError(message: string, stack?: string): string {
  const input = `${message}:${(stack || '').split('\n').slice(0, 3).join('')}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Report a structured error to Firestore with deduplication.
 */
export async function reportError(error: Error, context?: Record<string, any>): Promise<ErrorReport> {
  const db = getDb();
  const hash = hashError(error.message, error.stack);

  const report: ErrorReport = {
    id: uuidv4(),
    message: error.message,
    stack: error.stack,
    severity: (context?.severity as any) || 'medium',
    appId: context?.appId || 'unknown',
    userId: context?.userId,
    endpoint: context?.endpoint,
    timestamp: new Date(),
    metadata: context || {},
    hash,
  };

  await db.collection(ERRORS_COLLECTION).doc(report.id).set(report);

  // Check for incident threshold: same error hash > 10x in 5 min
  await checkIncidentThreshold(db, hash, report);

  return report;
}

/**
 * Capture an exception with explicit severity.
 */
export async function captureException(
  error: Error,
  severity: 'low' | 'medium' | 'high' | 'critical',
  context?: Record<string, any>
): Promise<ErrorReport> {
  return reportError(error, { ...context, severity });
}

/**
 * Check if the same error is occurring frequently enough to be an incident.
 */
async function checkIncidentThreshold(
  db: admin.firestore.Firestore,
  hash: string,
  latestReport: ErrorReport
): Promise<void> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const snapshot = await db.collection(ERRORS_COLLECTION)
    .where('hash', '==', hash)
    .where('timestamp', '>=', fiveMinAgo)
    .get();

  if (snapshot.size >= 10) {
    // Check if incident already exists for this hash
    const existingIncident = await db.collection(INCIDENTS_COLLECTION)
      .where('errorHash', '==', hash)
      .where('status', '==', 'open')
      .limit(1)
      .get();

    if (existingIncident.empty) {
      const incidentId = uuidv4();
      await db.collection(INCIDENTS_COLLECTION).doc(incidentId).set({
        id: incidentId,
        errorHash: hash,
        errorMessage: latestReport.message,
        appId: latestReport.appId,
        occurrences: snapshot.size,
        severity: 'critical',
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.error(`[INCIDENT] ${latestReport.message} — ${snapshot.size} occurrences in 5 min`);
    } else {
      // Update occurrence count
      const incidentDoc = existingIncident.docs[0];
      await incidentDoc.ref.update({
        occurrences: snapshot.size,
        updatedAt: new Date(),
      });
    }
  }
}

/**
 * Express error-handling middleware.
 */
export function errorReportingMiddleware(appId: string) {
  return async (err: Error, req: any, res: any, next: any) => {
    await reportError(err, {
      appId,
      endpoint: `${req.method} ${req.path}`,
      userId: req.user?.uid,
      severity: res.statusCode >= 500 ? 'high' : 'medium',
    }).catch(console.error);
    next(err);
  };
}
