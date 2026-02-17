import { TicketCategory, TicketPriority } from './ticket-model';

interface TriageResult {
  category: TicketCategory;
  priority: TicketPriority;
  suggestedResponse?: string;
  duplicateOf?: string;
}

const CATEGORY_KEYWORDS: Record<TicketCategory, RegExp[]> = {
  bug: [/crash/i, /error/i, /broken/i, /not working/i, /bug/i, /glitch/i, /freeze/i],
  feature: [/feature/i, /request/i, /would be nice/i, /add support/i, /wish/i, /please add/i],
  question: [/how do/i, /can I/i, /where is/i, /help/i, /\?$/],
  complaint: [/terrible/i, /worst/i, /waste/i, /refund/i, /cancel/i, /unsubscribe/i],
};

const PRIORITY_SIGNALS: Record<TicketPriority, RegExp[]> = {
  urgent: [/crash/i, /data loss/i, /can't log in/i, /security/i, /payment/i],
  high: [/broken/i, /not working/i, /blocker/i, /can't use/i],
  medium: [/bug/i, /issue/i, /problem/i],
  low: [/feature/i, /suggestion/i, /minor/i, /cosmetic/i],
};

function classifyCategory(message: string): TicketCategory {
  for (const [category, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    if (patterns.some(p => p.test(message))) return category as TicketCategory;
  }
  return 'question';
}

function classifyPriority(message: string): TicketPriority {
  for (const [priority, patterns] of Object.entries(PRIORITY_SIGNALS)) {
    if (patterns.some(p => p.test(message))) return priority as TicketPriority;
  }
  return 'medium';
}

export async function triageTicket(message: string, appId: string): Promise<TriageResult> {
  // Rule-based triage (fast, no LLM cost). Upgrade to LLM for complex cases.
  const category = classifyCategory(message);
  const priority = classifyPriority(message);

  const suggestedResponse = generateSuggestedResponse(category, message);

  return { category, priority, suggestedResponse };
}

function generateSuggestedResponse(category: TicketCategory, message: string): string {
  switch (category) {
    case 'bug':
      return "Thanks for reporting this issue. We're looking into it and will follow up with a fix. Could you share your device model and app version?";
    case 'feature':
      return "Thanks for the suggestion! We've logged this as a feature request and will consider it for a future update.";
    case 'complaint':
      return "We're sorry to hear about your experience. We take this feedback seriously and will work to improve.";
    default:
      return "Thanks for reaching out! We'll get back to you shortly.";
  }
}
