import * as admin from 'firebase-admin';
import { SupportTicket, CreateTicketRequest, TicketStatus } from './ticket-model';
import { triageTicket } from './ai-triage';

const COLLECTION = 'support_tickets';

function getDb() {
  return admin.firestore();
}

export async function createTicket(request: CreateTicketRequest): Promise<SupportTicket> {
  const db = getDb();
  const triage = await triageTicket(request.message, request.appId).catch(() => null);

  const ticket: Omit<SupportTicket, 'id'> = {
    userId: request.userId,
    appId: request.appId,
    category: request.category || triage?.category || 'question',
    priority: triage?.priority || 'medium',
    status: 'open' as TicketStatus,
    message: request.message,
    metadata: request.metadata || {},
    aiSuggestedCategory: triage?.category,
    aiSuggestedPriority: triage?.priority,
    aiSuggestedResponse: triage?.suggestedResponse,
    duplicateOf: triage?.duplicateOf,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const docRef = await db.collection(COLLECTION).add(ticket);
  return { id: docRef.id, ...ticket };
}

export async function getTickets(filters?: { userId?: string; appId?: string; status?: TicketStatus }): Promise<SupportTicket[]> {
  const db = getDb();
  let query: admin.firestore.Query = db.collection(COLLECTION);

  if (filters?.userId) query = query.where('userId', '==', filters.userId);
  if (filters?.appId) query = query.where('appId', '==', filters.appId);
  if (filters?.status) query = query.where('status', '==', filters.status);

  query = query.orderBy('createdAt', 'desc').limit(100);
  const snapshot = await query.get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SupportTicket));
}

export async function updateTicket(ticketId: string, updates: Partial<SupportTicket>): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(ticketId).update({
    ...updates,
    updatedAt: new Date(),
  });
}
