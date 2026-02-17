import * as admin from 'firebase-admin';
import { SupportTicket, TicketStatus } from './ticket-model';

export interface TicketMessage {
  id: string;
  ticketId: string;
  message: string;
  sender: 'user' | 'ai' | 'support';
  timestamp: Date;
}

export interface TicketStats {
  openCount: number;
  inProgressCount: number;
  resolvedCount: number;
  avgResolutionTimeHours: number;
  avgSatisfactionScore: number;
  totalTickets: number;
}

const TICKETS = 'support_tickets';
const MESSAGES = 'ticket_messages';
const AUDIT = 'ticket_audit_log';

function getDb() {
  return admin.firestore();
}

/**
 * Append a message to a ticket conversation.
 */
export async function addMessage(
  ticketId: string,
  message: string,
  sender: 'user' | 'ai' | 'support'
): Promise<TicketMessage> {
  const db = getDb();
  const data = {
    ticketId,
    message,
    sender,
    timestamp: new Date(),
  };
  const ref = await db.collection(MESSAGES).add(data);

  // Update ticket's updatedAt
  await db.collection(TICKETS).doc(ticketId).update({ updatedAt: new Date() });

  return { id: ref.id, ...data };
}

/**
 * Get the full conversation thread for a ticket.
 */
export async function getTicketHistory(ticketId: string): Promise<TicketMessage[]> {
  const db = getDb();
  const snapshot = await db.collection(MESSAGES)
    .where('ticketId', '==', ticketId)
    .orderBy('timestamp', 'asc')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TicketMessage));
}

/**
 * Update ticket status with an audit trail entry.
 */
export async function updateStatus(ticketId: string, status: TicketStatus, updatedBy?: string): Promise<void> {
  const db = getDb();
  const ticketRef = db.collection(TICKETS).doc(ticketId);
  const doc = await ticketRef.get();
  const previousStatus = doc.data()?.status;

  await ticketRef.update({ status, updatedAt: new Date() });

  // Audit trail
  await db.collection(AUDIT).add({
    ticketId,
    action: 'status_change',
    previousValue: previousStatus,
    newValue: status,
    updatedBy: updatedBy || 'system',
    timestamp: new Date(),
  });
}

/**
 * Get all tickets for a user, ordered by most recent.
 */
export async function getTicketsByUser(userId: string): Promise<SupportTicket[]> {
  const db = getDb();
  const snapshot = await db.collection(TICKETS)
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SupportTicket));
}

/**
 * Get aggregate ticket stats for the dashboard.
 */
export async function getTicketStats(): Promise<TicketStats> {
  const db = getDb();

  // Count by status
  const [openSnap, inProgressSnap, resolvedSnap] = await Promise.all([
    db.collection(TICKETS).where('status', '==', 'open').get(),
    db.collection(TICKETS).where('status', '==', 'in-progress').get(),
    db.collection(TICKETS).where('status', '==', 'resolved').get(),
  ]);

  // Calculate avg resolution time from resolved tickets
  let totalResolutionMs = 0;
  let resolvedWithTime = 0;
  resolvedSnap.docs.forEach(doc => {
    const data = doc.data();
    if (data.createdAt && data.updatedAt) {
      const created = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
      const updated = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
      totalResolutionMs += updated.getTime() - created.getTime();
      resolvedWithTime++;
    }
  });

  // Get satisfaction ratings
  const ratingsSnap = await db.collection('ticket_ratings')
    .orderBy('timestamp', 'desc')
    .limit(500)
    .get();
  const ratings = ratingsSnap.docs.map(d => d.data().rating as number).filter(r => r >= 1 && r <= 5);
  const avgSatisfaction = ratings.length > 0
    ? ratings.reduce((s, r) => s + r, 0) / ratings.length
    : 0;

  return {
    openCount: openSnap.size,
    inProgressCount: inProgressSnap.size,
    resolvedCount: resolvedSnap.size,
    avgResolutionTimeHours: resolvedWithTime > 0
      ? totalResolutionMs / resolvedWithTime / (1000 * 60 * 60)
      : 0,
    avgSatisfactionScore: Math.round(avgSatisfaction * 10) / 10,
    totalTickets: openSnap.size + inProgressSnap.size + resolvedSnap.size,
  };
}

/**
 * Rate a ticket interaction (1-5).
 */
export async function rateTicket(ticketId: string, userId: string, rating: number): Promise<void> {
  const db = getDb();
  if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5');

  await db.collection('ticket_ratings').add({
    ticketId,
    userId,
    rating,
    timestamp: new Date(),
  });
}
