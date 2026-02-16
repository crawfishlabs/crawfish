import { EventPublisher } from '../event-publisher';
const analytics = new EventPublisher();

export async function onTransactionSynced(userId: string, count: number) {
  await analytics.track('transactions_synced', {
    userId, count, source: 'stripe_financial_connections',
  });
}

export async function onBudgetCoaching(userId: string, cost: number) {
  await analytics.track('llm_call', {
    userId, app: 'budget', taskType: 'budget_coaching', model: 'claude-sonnet-4', costUsd: cost,
  });
}
