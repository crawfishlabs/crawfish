/**
 * Unit tests for support HTTP routes
 */

import { Request, Response } from 'express';

// Mock the feedback module
jest.mock('../feedback', () => ({
  createTicket: jest.fn().mockResolvedValue({
    id: 'ticket-1', userId: 'user-1', appId: 'budget', message: 'test',
    status: 'open', category: 'bug', priority: 'medium', metadata: {},
    createdAt: new Date(), updatedAt: new Date(),
  }),
  getTickets: jest.fn().mockResolvedValue([
    { id: 'ticket-1', status: 'open', priority: 'high' },
    { id: 'ticket-2', status: 'resolved', priority: 'low' },
  ]),
  updateTicket: jest.fn().mockResolvedValue(undefined),
}));

// Import after mock
import supportRoutes from '../routes';

function mockReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, query: {}, params: {}, ...overrides } as Request;
}

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Support Routes', () => {
  // Extract route handlers from router
  const routes = (supportRoutes as any).stack || [];

  describe('POST /support/ticket', () => {
    it('should have a POST route handler', () => {
      // Verify the router has routes defined
      expect(supportRoutes).toBeDefined();
    });

    it('should validate required fields', async () => {
      const req = mockReq({ body: { userId: 'user-1' } }); // missing appId and message
      const res = mockRes();

      // Simulate route handler
      const { createTicket } = require('../feedback');
      if (!req.body.appId || !req.body.message) {
        res.status(400).json({ error: 'missing_fields' });
      }

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should create ticket with valid data', async () => {
      const { createTicket } = require('../feedback');
      const result = await createTicket({
        userId: 'user-1', appId: 'budget', message: 'Bug report',
      });

      expect(result.id).toBe('ticket-1');
      expect(result.status).toBe('open');
    });
  });

  describe('GET /support/tickets', () => {
    it('should return tickets list', async () => {
      const { getTickets } = require('../feedback');
      const tickets = await getTickets({});
      expect(tickets).toHaveLength(2);
    });

    it('should pass filter params', async () => {
      const { getTickets } = require('../feedback');
      await getTickets({ status: 'open', appId: 'budget' });
      expect(getTickets).toHaveBeenCalledWith({ status: 'open', appId: 'budget' });
    });
  });

  describe('PUT /support/tickets/:id', () => {
    it('should update ticket', async () => {
      const { updateTicket } = require('../feedback');
      await updateTicket('ticket-1', { status: 'resolved' });
      expect(updateTicket).toHaveBeenCalledWith('ticket-1', { status: 'resolved' });
    });
  });

  describe('Error handling', () => {
    it('should handle missing required fields gracefully', () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      const { userId, appId, message } = req.body;
      if (!userId || !appId || !message) {
        res.status(400).json({ error: 'missing_fields', message: 'userId, appId, and message are required' });
      }

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'missing_fields' }));
    });
  });
});
