export { createTicket, getTickets, updateTicket } from './feedback';
export { triageTicket } from './ai-triage';
export { SupportTicket, CreateTicketRequest, TicketCategory, TicketPriority, TicketStatus, TicketMetadata } from './ticket-model';
export { default as supportRoutes } from './routes';

// Knowledge Base
export { searchKnowledgeBase, getArticle, suggestArticles, rateArticle, upsertArticle, deleteArticle, KBArticle } from './knowledge-base';

// Auto-responder
export { generateAutoResponse, shouldAutoResolve, getResponseTemplate, AutoResponse } from './auto-responder';

// Escalation
export { evaluateEscalation, escalateTicket, getEscalationQueue, EscalationResult, EscalatedTicket } from './escalation';

// Ticket History
export { addMessage, getTicketHistory, updateStatus, getTicketsByUser, getTicketStats, rateTicket, TicketMessage, TicketStats } from './ticket-history';
