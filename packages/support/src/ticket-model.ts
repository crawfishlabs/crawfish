export type TicketCategory = 'bug' | 'feature' | 'question' | 'complaint';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed';

export interface TicketMetadata {
  device?: string;
  os?: string;
  appVersion?: string;
  locale?: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  appId: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  message: string;
  metadata: TicketMetadata;
  aiSuggestedCategory?: TicketCategory;
  aiSuggestedPriority?: TicketPriority;
  aiSuggestedResponse?: string;
  duplicateOf?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTicketRequest {
  userId: string;
  appId: string;
  message: string;
  category?: TicketCategory;
  metadata?: TicketMetadata;
}
