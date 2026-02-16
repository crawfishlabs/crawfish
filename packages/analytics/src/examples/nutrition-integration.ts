import { EventPublisher } from '../event-publisher';
const analytics = new EventPublisher();

export async function onFoodLogged(userId: string, entry: any) {
  await analytics.track('food_logged', {
    userId,
    method: entry.method, // 'photo', 'voice', 'barcode', 'manual', 'quick_add'
    calories: entry.calories,
    mealType: entry.mealType,
  });
}

export async function onMealScanned(userId: string, cost: number) {
  await analytics.track('llm_call', {
    userId, app: 'nutrition', taskType: 'meal_scan', model: 'gpt-4o', costUsd: cost,
  });
}
