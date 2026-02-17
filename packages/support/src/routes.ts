import { Router, Request, Response } from 'express';
import { createTicket, getTickets, updateTicket } from './feedback';
import { CreateTicketRequest } from './ticket-model';

const router = Router();

router.post('/support/ticket', async (req: Request, res: Response) => {
  try {
    const { userId, appId, message, category, metadata } = req.body;

    if (!userId || !appId || !message) {
      return res.status(400).json({ error: 'missing_fields', message: 'userId, appId, and message are required' });
    }

    const ticket = await createTicket({ userId, appId, message, category, metadata } as CreateTicketRequest);
    res.status(201).json(ticket);
  } catch (error: any) {
    console.error('Create ticket error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

router.get('/support/tickets', async (req: Request, res: Response) => {
  try {
    const { userId, appId, status } = req.query;
    const tickets = await getTickets({
      userId: userId as string,
      appId: appId as string,
      status: status as any,
    });
    res.json(tickets);
  } catch (error: any) {
    console.error('Get tickets error:', error);
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

export default router;
