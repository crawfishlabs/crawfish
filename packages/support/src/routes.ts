import { Router, Request, Response } from 'express';
import { createTicket, getTickets, updateTicket } from './feedback';
import { CreateTicketRequest } from './ticket-model';
import { searchKnowledgeBase, getArticle, rateArticle } from './knowledge-base';
import { addMessage, getTicketHistory, getTicketsByUser, getTicketStats, rateTicket } from './ticket-history';
import { generateAutoResponse } from './auto-responder';
import { evaluateEscalation, escalateTicket, getEscalationQueue } from './escalation';

const router = Router();

// --- Ticket CRUD ---

router.post('/support/ticket', async (req: Request, res: Response) => {
  try {
    const { userId, appId, message, category, metadata } = req.body;
    if (!userId || !appId || !message) {
      return res.status(400).json({ error: 'missing_fields', message: 'userId, appId, and message are required' });
    }
    const ticket = await createTicket({ userId, appId, message, category, metadata } as CreateTicketRequest);

    // Generate auto-response and add it as first AI message
    try {
      const auto = await generateAutoResponse(ticket);
      if (auto.message) {
        await addMessage(ticket.id, auto.message, 'ai');
      }
      if (auto.shouldAutoResolve) {
        await updateTicket(ticket.id, { status: 'resolved' as any });
      }
    } catch (_) { /* auto-response is best-effort */ }

    res.status(201).json(ticket);
  } catch (error: any) {
    console.error('Create ticket error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

router.get('/support/tickets', async (req: Request, res: Response) => {
  try {
    const { userId, appId, status, page, limit } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 100);

    let tickets;
    if (userId) {
      tickets = await getTicketsByUser(userId as string);
    } else {
      tickets = await getTickets({
        userId: userId as string,
        appId: appId as string,
        status: status as any,
      });
    }

    // Simple pagination
    const start = (pageNum - 1) * limitNum;
    const paginated = tickets.slice(start, start + limitNum);

    res.json({
      tickets: paginated,
      total: tickets.length,
      page: pageNum,
      totalPages: Math.ceil(tickets.length / limitNum),
    });
  } catch (error: any) {
    console.error('Get tickets error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

router.get('/support/tickets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tickets = await getTickets({});
    const ticket = tickets.find(t => t.id === id);
    if (!ticket) return res.status(404).json({ error: 'not_found' });

    const history = await getTicketHistory(id);
    res.json({ ticket, history });
  } catch (error: any) {
    console.error('Get ticket error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

router.put('/support/tickets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await updateTicket(id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Update ticket error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

// --- Ticket Messages ---

router.post('/support/tickets/:id/messages', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { message, sender } = req.body;
    if (!message) return res.status(400).json({ error: 'missing_message' });

    const msg = await addMessage(id, message, sender || 'user');

    // Check if escalation is needed after new message
    try {
      const tickets = await getTickets({});
      const ticket = tickets.find(t => t.id === id);
      if (ticket) {
        const result = await evaluateEscalation(ticket);
        if (result.shouldEscalate) {
          await escalateTicket(id, result.reason);
        }
      }
    } catch (_) { /* escalation check is best-effort */ }

    res.status(201).json(msg);
  } catch (error: any) {
    console.error('Add message error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

// --- Satisfaction Rating ---

router.post('/support/tickets/:id/rate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, rating } = req.body;
    if (!userId || !rating) return res.status(400).json({ error: 'missing_fields' });

    await rateTicket(id, userId, rating);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Rate ticket error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

// --- Knowledge Base ---

router.get('/support/kb/search', async (req: Request, res: Response) => {
  try {
    const { q, app } = req.query;
    if (!q) return res.status(400).json({ error: 'missing_query' });

    const articles = await searchKnowledgeBase(q as string, (app as string) || '*');
    res.json({ articles });
  } catch (error: any) {
    console.error('KB search error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

router.get('/support/kb/articles/:id', async (req: Request, res: Response) => {
  try {
    const article = await getArticle(req.params.id);
    if (!article) return res.status(404).json({ error: 'not_found' });
    res.json(article);
  } catch (error: any) {
    console.error('Get article error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

router.post('/support/kb/articles/:id/rate', async (req: Request, res: Response) => {
  try {
    const { helpful } = req.body;
    await rateArticle(req.params.id, helpful === true);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Rate article error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

// --- Escalation Queue (admin) ---

router.get('/support/escalation-queue', async (_req: Request, res: Response) => {
  try {
    const queue = await getEscalationQueue();
    res.json({ tickets: queue });
  } catch (error: any) {
    console.error('Escalation queue error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

// --- Stats (admin) ---

router.get('/support/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getTicketStats();
    res.json(stats);
  } catch (error: any) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

export default router;
