/**
 * Example: How ClawFitness Cloud Functions integrate with analytics
 */
import { EventPublisher } from '../event-publisher';

const analytics = new EventPublisher();

// After a workout is completed
export async function onWorkoutCompleted(userId: string, workout: any) {
  await analytics.track('workout_completed', {
    userId,
    workoutId: workout.id,
    durationMinutes: workout.durationMinutes,
    exerciseCount: workout.exercises.length,
    totalVolume: workout.totalVolume,
    programDay: workout.programDay,
  });
}

// After AI coaching response
export async function onCoachingResponse(userId: string, cost: number, model: string) {
  await analytics.track('llm_call', {
    userId,
    app: 'fitness',
    taskType: 'fitness_coaching',
    model,
    costUsd: cost,
  });
}
