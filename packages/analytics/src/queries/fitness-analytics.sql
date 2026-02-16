-- Fitness analytics: workout frequency, volume trends, PR progression

-- Workout frequency by user (last 30 days)
SELECT
  user_id,
  COUNT(*) AS workouts,
  AVG(duration_minutes) AS avg_duration,
  SUM(total_volume) AS total_volume,
  COUNT(DISTINCT DATE_TRUNC('week', created_at)) AS active_weeks
FROM CLAW_ANALYTICS.FITNESS.WORKOUTS
WHERE created_at >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY user_id;

-- Volume progression by week
SELECT
  DATE_TRUNC('week', created_at) AS week,
  user_id,
  SUM(total_volume) AS weekly_volume,
  COUNT(*) AS workout_count,
  AVG(duration_minutes) AS avg_duration
FROM CLAW_ANALYTICS.FITNESS.WORKOUTS
WHERE created_at >= DATEADD(day, -90, CURRENT_DATE())
GROUP BY week, user_id
ORDER BY week;

-- Personal records
SELECT
  user_id,
  exercise_name,
  MAX(weight) AS max_weight,
  MAX(estimated_1rm) AS best_1rm,
  MAX(total_volume) AS best_volume
FROM CLAW_ANALYTICS.FITNESS.SETS
WHERE created_at >= DATEADD(day, -90, CURRENT_DATE())
GROUP BY user_id, exercise_name
ORDER BY best_1rm DESC;
