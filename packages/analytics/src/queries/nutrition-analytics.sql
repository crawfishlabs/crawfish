-- Nutrition analytics: calorie compliance, macro balance, logging patterns

-- Daily compliance (last 30 days)
SELECT
  user_id,
  DATE_TRUNC('day', logged_at) AS day,
  SUM(calories) AS total_calories,
  SUM(protein_g) AS total_protein,
  SUM(carbs_g) AS total_carbs,
  SUM(fat_g) AS total_fat,
  COUNT(*) AS log_count
FROM CLAW_ANALYTICS.NUTRITION.FOOD_LOGS
WHERE logged_at >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY user_id, day
ORDER BY day;

-- Logging method breakdown
SELECT
  method,
  COUNT(*) AS count,
  AVG(confidence) AS avg_confidence
FROM CLAW_ANALYTICS.NUTRITION.FOOD_LOGS
WHERE logged_at >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY method
ORDER BY count DESC;

-- Water intake trends
SELECT
  user_id,
  DATE_TRUNC('day', logged_at) AS day,
  SUM(amount_ml) AS total_ml,
  target_ml,
  DIV0(SUM(amount_ml), target_ml) AS compliance
FROM CLAW_ANALYTICS.NUTRITION.WATER_INTAKE
WHERE logged_at >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY user_id, day, target_ml;
