import * as admin from 'firebase-admin';
import { SupportTicket, TicketPriority } from './ticket-model';

export interface EscalationResult {
  shouldEscalate: boolean;
  reason: string;
  priority: 'normal' | 'high' | 'immediate';
}

export interface EscalatedTicket extends SupportTicket {
  escalationReason: string;
  escalatedAt: Date;
  assignedTo?: string;
}

const COLLECTION = 'support_tickets';

function getDb() {
  return admin.firestore();
}

/**
 * Rules engine to evaluate whether a ticket should be escalated.
 */
export async function evaluateEscalation(ticket: SupportTicket): Promise<EscalationResult> {
  // Rule 1: Critical/urgent priority → immediate escalation
  if (ticket.priority === 'urgent') {
    return { shouldEscalate: true, reason: 'Critical priority ticket', priority: 'immediate' };
  }

  // Rule 2: Payment/billing issues → always escalate
  if (/refund|charge|payment|billing|subscription|cancel/i.test(ticket.message)) {
    return { shouldEscalate: true, reason: 'Payment/billing issue detected', priority: 'high' };
  }

  // Rule 3: Negative sentiment → escalate
  if (detectNegativeSentiment(ticket.message)) {
    return { shouldEscalate: true, reason: 'Negative sentiment detected', priority: 'high' };
  }

  // Rule 4: Check conversation length (3+ back-and-forth)
  const messageCount = await getMessageCount(ticket.id);
  if (messageCount >= 6) { // 3 back-and-forth = 6 messages
    return { shouldEscalate: true, reason: 'Extended conversation (3+ exchanges)', priority: 'normal' };
  }

  // Rule 5: No response in 24h
  const hoursSinceUpdate = (Date.now() - new Date(ticket.updatedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceUpdate > 24 && ticket.status === 'open') {
    return { shouldEscalate: true, reason: 'No response in 24 hours', priority: 'high' };
  }

  return { shouldEscalate: false, reason: '', priority: 'normal' };
}

/**
 * Escalate a ticket — update status, record reason, optionally assign.
 */
export async function escalateTicket(ticketId: string, reason: string, assignTo?: string): Promise<void> {
  const db = getDb();
  const updates: Record<string, any> = {
    status: 'escalated',
    escalationReason: reason,
    escalatedAt: new Date(),
    updatedAt: new Date(),
  };
  if (assignTo) updates.assignedTo = assignTo;

  await db.collection(COLLECTION).doc(ticketId).update(updates);

  // Also record in escalation audit log
  await db.collection('escalation_log').add({
    ticketId,
    reason,
    assignedTo: assignTo || null,
    timestamp: new Date(),
  });
}

/**
 * Get all escalated tickets sorted by priority.
 */
export async function getEscalationQueue(): Promise<EscalatedTicket[]> {
  const db = getDb();
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

  const snapshot = await db.collection(COLLECTION)
    .where('status', '==', 'escalated')
    .orderBy('escalatedAt', 'desc')
    .limit(100)
    .get();

  const tickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as EscalatedTicket));
  tickets.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

  return tickets;
}

/**
 * Simple negative sentiment detection using keyword heuristics.
 */
function detectNegativeSentiment(message: string): boolean {
  const negativePatterns = [
    /terrible|awful|worst|horrible|disgusting/i,
    /scam|fraud|steal|rip.?off/i,
    /furious|angry|pissed|livid/i,
    /lawsuit|legal|attorney|lawyer/i,
    /never.*(use|buy|recommend)/i,
    /waste of (time|money)/i,
    /unacceptable/i,
  ];
  return negativePatterns.some(p => p.test(message));
}

async function getMessageCount(ticketId: string): Promise<number> {
  const db = getDb();
  const snapshot = await db.collection('ticket_messages')
    .where('ticketId', '==', ticketId)
    .get();
  return snapshot.size;
}
