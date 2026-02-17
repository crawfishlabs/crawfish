import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  comparison: 'gt' | 'lt' | 'gte' | 'lte';
  windowMinutes: number;
  action: 'log' | 'email' | 'webhook';
  webhookUrl?: string;
  emailTo?: string;
  enabled: boolean;
  appId?: string;
}

export interface FiredAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  metric: string;
  actualValue: number;
  threshold: number;
  action: string;
  timestamp: Date;
}

const RULES_COLLECTION = 'alert_rules';
const FIRED_COLLECTION = 'fired_alerts';

function getDb() {
  return admin.firestore();
}

/**
 * Create or update an alert rule.
 */
export async function createAlert(rule: Omit<AlertRule, 'id'> & { id?: string }): Promise<AlertRule> {
  const db = getDb();
  const id = rule.id || uuidv4();
  const full: AlertRule = { ...rule, id };
  await db.collection(RULES_COLLECTION).doc(id).set(full);
  return full;
}

/**
 * Seed built-in alert rules (idempotent).
 */
export async function seedBuiltInRules(): Promise<void> {
  const builtIn: Omit<AlertRule, 'id'>[] = [
    {
      name: 'High Error Rate',
      metric: 'error_rate',
      threshold: 5,
      comparison: 'gt',
      windowMinutes: 5,
      action: 'log',
      enabled: true,
    },
    {
      name: 'Latency p95 > 2s',
      metric: 'api_latency_p95',
      threshold: 2000,
      comparison: 'gt',
      windowMinutes: 10,
      action: 'log',
      enabled: true,
    },
    {
      name: 'LLM Daily Cost Spike',
      metric: 'llm_daily_cost',
      threshold: 50,
      comparison: 'gt',
      windowMinutes: 1440,
      action: 'log',
      enabled: true,
    },
  ];

  for (const rule of builtIn) {
    const db = getDb();
    const existing = await db.collection(RULES_COLLECTION)
      .where('name', '==', rule.name)
      .limit(1)
      .get();
    if (existing.empty) {
      await createAlert(rule);
    }
  }
}

/**
 * Evaluate all enabled alert rules and fire actions for any that are triggered.
 */
export async function evaluateAlerts(): Promise<FiredAlert[]> {
  const db = getDb();
  const rulesSnap = await db.collection(RULES_COLLECTION)
    .where('enabled', '==', true)
    .get();

  const fired: FiredAlert[] = [];

  for (const doc of rulesSnap.docs) {
    const rule = doc.data() as AlertRule;
    const value = await getMetricValue(rule.metric, rule.windowMinutes, rule.appId);
    if (value === null) continue;

    const triggered =
      (rule.comparison === 'gt' && value > rule.threshold) ||
      (rule.comparison === 'gte' && value >= rule.threshold) ||
      (rule.comparison === 'lt' && value < rule.threshold) ||
      (rule.comparison === 'lte' && value <= rule.threshold);

    if (triggered) {
      const alert: FiredAlert = {
        id: uuidv4(),
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        actualValue: value,
        threshold: rule.threshold,
        action: rule.action,
        timestamp: new Date(),
      };

      await db.collection(FIRED_COLLECTION).doc(alert.id).set(alert);
      await executeAction(rule, alert);
      fired.push(alert);
    }
  }

  return fired;
}

async function getMetricValue(metric: string, windowMinutes: number, appId?: string): Promise<number | null> {
  const db = getDb();
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  if (metric === 'error_rate') {
    const errSnap = await db.collection('errors')
      .where('timestamp', '>=', since)
      .get();
    // Error rate as percentage (errors per 100 requests — approximation)
    return errSnap.size;
  }

  if (metric === 'api_latency_p95') {
    let query: admin.firestore.Query = db.collection('_performance_metrics')
      .where('name', '==', 'api_latency')
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(since));
    if (appId) query = query.where('app', '==', appId);
    const snap = await query.get();
    const values = snap.docs.map(d => d.data().value as number).sort((a, b) => a - b);
    if (values.length === 0) return null;
    return values[Math.ceil(values.length * 0.95) - 1];
  }

  if (metric === 'llm_daily_cost') {
    const today = new Date().toISOString().split('T')[0];
    const doc = await db.collection('daily_summaries').doc(today).get();
    return doc.exists ? (doc.data()?.totalCost || 0) : 0;
  }

  return null;
}

async function executeAction(rule: AlertRule, alert: FiredAlert): Promise<void> {
  switch (rule.action) {
    case 'log':
      console.warn(`[ALERT] ${rule.name}: ${alert.metric}=${alert.actualValue} (threshold: ${rule.threshold})`);
      break;
    case 'webhook':
      if (rule.webhookUrl) {
        await fetch(rule.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(alert),
        }).catch(e => console.error('Webhook failed:', e));
      }
      break;
    case 'email':
      console.log(`[ALERT EMAIL] To: ${rule.emailTo} — ${rule.name}`);
      // TODO: integrate with email provider
      break;
  }
}
