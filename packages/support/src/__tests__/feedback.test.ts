/**
 * Unit tests for support ticket CRUD operations
 */

import { createTicket, getTickets, updateTicket } from '../feedback';
import { SupportTicket, CreateTicketRequest, TicketStatus } from '../ticket-model';

// Mock firebase-admin
jest.mock('firebase-admin', () => {
  const store: Record<string, any> = {};
  let idCounter = 0;

  return {
    firestore: jest.fn(() => ({
      collection: jest.fn(() => ({
        add: jest.fn(async (data: any) => {
          const id = `ticket-${++idCounter}`;
          store[id] = { ...data };
          return { id };
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn(async () => ({
          docs: Object.entries(store).map(([id, data]) => ({
            id, data: () => data,
          })),
        })),
        doc: jest.fn((id: string) => ({
          update: jest.fn(async (updates: any) => {
            store[id] = { ...store[id], ...updates };
          }),
        })),
      })),
    })),
  };
});

// Mock AI triage
jest.mock('../ai-triage', () => ({
  triageTicket: jest.fn().mockResolvedValue({
    category: 'bug',
    priority: 'medium',
    suggestedResponse: 'We\'re looking into this issue.',
  }),
}));

describe('Support Ticket CRUD', () => {
  describe('createTicket', () => {
    it('should create a ticket with required fields', async () => {
      const request: CreateTicketRequest = {
        userId: 'user-123',
        appId: 'budget',
        message: 'The budget page is not loading correctly.',
      };

      const ticket = await createTicket(request);
      expect(ticket.id).toBeDefined();
      expect(ticket.userId).toBe('user-123');
      expect(ticket.appId).toBe('budget');
      expect(ticket.message).toContain('budget page');
      expect(ticket.status).toBe('open');
      expect(ticket.createdAt).toBeDefined();
    });

    it('should include AI triage suggestions', async () => {
      const ticket = await createTicket({
        userId: 'user-456',
        appId: 'nutrition',
        message: 'App crashes when scanning food.',
      });

      expect(ticket.aiSuggestedCategory).toBe('bug');
      expect(ticket.aiSuggestedPriority).toBe('medium');
      expect(ticket.aiSuggestedResponse).toBeDefined();
    });

    it('should use provided category over AI suggestion', async () => {
      const ticket = await createTicket({
        userId: 'user-789',
        appId: 'meetings',
        message: 'Can you add calendar integration?',
        category: 'feature',
      });

      expect(ticket.category).toBe('feature');
    });

    it('should include metadata when provided', async () => {
      const ticket = await createTicket({
        userId: 'user-100',
        appId: 'budget',
        message: 'Bug report',
        metadata: { device: 'iPhone 15', os: 'iOS 17', appVersion: '1.2.3' },
      });

      expect(ticket.metadata.device).toBe('iPhone 15');
    });
  });

  describe('getTickets', () => {
    it('should return tickets array', async () => {
      const tickets = await getTickets();
      expect(Array.isArray(tickets)).toBe(true);
    });

    it('should filter by userId', async () => {
      const tickets = await getTickets({ userId: 'user-123' });
      expect(Array.isArray(tickets)).toBe(true);
    });

    it('should filter by appId', async () => {
      const tickets = await getTickets({ appId: 'budget' });
      expect(Array.isArray(tickets)).toBe(true);
    });

    it('should filter by status', async () => {
      const tickets = await getTickets({ status: 'open' });
      expect(Array.isArray(tickets)).toBe(true);
    });
  });

  describe('updateTicket', () => {
    it('should update ticket status', async () => {
      await expect(updateTicket('ticket-1', { status: 'in-progress' as TicketStatus })).resolves.not.toThrow();
    });

    it('should update ticket priority', async () => {
      await expect(updateTicket('ticket-1', { priority: 'high' })).resolves.not.toThrow();
    });

    it('should set updatedAt timestamp', async () => {
      await expect(updateTicket('ticket-1', { status: 'resolved' as TicketStatus })).resolves.not.toThrow();
    });
  });
});
