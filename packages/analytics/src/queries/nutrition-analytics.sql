-- Nutrition Analytics Queries
-- Calorie compliance, macro balance, meal timing patterns

-- Calorie and Macro Compliance Analysis
WITH daily_nutrition AS (
  SELECT 
    user_id,
    summary_date,
    total_calories,
    calories_goal,
    total_protein_grams,
    protein_goal_grams,
    total_carbs_grams,
    carbs_goal_grams,
    total_fat_grams,
    fat_goal_grams,
    calories_adherence_percentage,
    macro_adherence_score,
    -- Calculate adherence for each macro
    SAFE_DIVIDE(total_protein_grams, protein_goal_grams) * 100 as protein_adherence_pct,
    SAFE_DIVIDE(total_carbs_grams, carbs_goal_grams) * 100 as carbs_adherence_pct,
    SAFE_DIVIDE(total_fat_grams, fat_goal_grams) * 100 as fat_adherence_pct,
    -- Categorize calorie adherence
    CASE 
      WHEN calories_adherence_percentage >= 90 AND calories_adherence_percentage <= 110 THEN 'On Target'
      WHEN calories_adherence_percentage < 90 THEN 'Under Target'
      WHEN calories_adherence_percentage > 110 THEN 'Over Target'
      ELSE 'No Goal Set'
    END as calorie_adherence_category
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.daily_summaries`
  WHERE summary_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND calories_goal > 0 -- Only users with goals set
),

weekly_compliance AS (
  SELECT 
    DATE_TRUNC(summary_date, WEEK(MONDAY)) as week_start,
    user_id,
    AVG(calories_adherence_percentage) as avg_calorie_adherence,
    AVG(protein_adherence_pct) as avg_protein_adherence,
    AVG(carbs_adherence_pct) as avg_carbs_adherence,
    AVG(fat_adherence_pct) as avg_fat_adherence,
    AVG(macro_adherence_score) * 100 as avg_macro_score,
    COUNT(*) as days_logged,
    COUNT(CASE WHEN calorie_adherence_category = 'On Target' THEN 1 END) as days_on_target
  FROM daily_nutrition
  GROUP BY week_start, user_id
  HAVING COUNT(*) >= 4 -- At least 4 days logged per week
)

SELECT 
  week_start,
  COUNT(DISTINCT user_id) as active_users,
  AVG(avg_calorie_adherence) as overall_calorie_adherence,
  AVG(avg_protein_adherence) as overall_protein_adherence,
  AVG(avg_carbs_adherence) as overall_carbs_adherence,
  AVG(avg_fat_adherence) as overall_fat_adherence,
  AVG(avg_macro_score) as overall_macro_score,
  AVG(days_logged) as avg_days_logged_per_week,
  AVG(SAFE_DIVIDE(days_on_target, days_logged)) * 100 as pct_days_on_target,
  -- Categorize users by adherence level
  COUNT(CASE WHEN avg_calorie_adherence >= 90 AND avg_calorie_adherence <= 110 THEN user_id END) as users_on_target,
  COUNT(CASE WHEN avg_calorie_adherence < 80 THEN user_id END) as users_struggling
FROM weekly_compliance
GROUP BY week_start
ORDER BY week_start DESC;

-- Meal Timing and Pattern Analysis
WITH meal_timing AS (
  SELECT 
    user_id,
    log_date,
    meal_type,
    log_time,
    calories,
    protein_grams,
    carbs_grams,
    fat_grams,
    -- Convert time to hour for analysis
    EXTRACT(HOUR FROM log_time) as meal_hour,
    -- Create time buckets
    CASE 
      WHEN EXTRACT(HOUR FROM log_time) BETWEEN 5 AND 10 THEN 'Breakfast'
      WHEN EXTRACT(HOUR FROM log_time) BETWEEN 11 AND 14 THEN 'Lunch'  
      WHEN EXTRACT(HOUR FROM log_time) BETWEEN 15 AND 17 THEN 'Afternoon Snack'
      WHEN EXTRACT(HOUR FROM log_time) BETWEEN 18 AND 21 THEN 'Dinner'
      WHEN EXTRACT(HOUR FROM log_time) BETWEEN 22 AND 24 OR EXTRACT(HOUR FROM log_time) BETWEEN 0 AND 4 THEN 'Late Night'
      ELSE 'Other'
    END as time_bucket
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
  WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND log_time IS NOT NULL
    AND calories > 0
),

meal_patterns AS (
  SELECT 
    time_bucket,
    meal_hour,
    COUNT(*) as total_logs,
    COUNT(DISTINCT user_id) as unique_users,
    AVG(calories) as avg_calories_per_log,
    SUM(calories) as total_calories,
    AVG(protein_grams) as avg_protein_per_log,
    AVG(carbs_grams) as avg_carbs_per_log,
    AVG(fat_grams) as avg_fat_per_log
  FROM meal_timing
  GROUP BY time_bucket, meal_hour
),

user_meal_consistency AS (
  SELECT 
    user_id,
    time_bucket,
    COUNT(DISTINCT log_date) as days_eaten_in_window,
    COUNT(*) as total_meals_in_window,
    AVG(calories) as avg_calories_in_window
  FROM meal_timing
  GROUP BY user_id, time_bucket
)

-- Overall meal timing patterns
SELECT 
  time_bucket,
  AVG(meal_hour) as avg_meal_hour,
  total_logs,
  unique_users,
  avg_calories_per_log,
  total_calories,
  SAFE_DIVIDE(total_calories, SUM(total_calories) OVER ()) * 100 as pct_of_total_calories,
  avg_protein_per_log,
  avg_carbs_per_log, 
  avg_fat_per_log
FROM meal_patterns
GROUP BY time_bucket, total_logs, unique_users, avg_calories_per_log, total_calories, avg_protein_per_log, avg_carbs_per_log, avg_fat_per_log
ORDER BY avg_meal_hour;

-- Macro Distribution Analysis
WITH macro_ratios AS (
  SELECT 
    user_id,
    summary_date,
    total_calories,
    total_protein_grams,
    total_carbs_grams,
    total_fat_grams,
    -- Calculate macro percentages (protein = 4cal/g, carbs = 4cal/g, fat = 9cal/g)
    SAFE_DIVIDE(total_protein_grams * 4, total_calories) * 100 as protein_pct,
    SAFE_DIVIDE(total_carbs_grams * 4, total_calories) * 100 as carbs_pct,
    SAFE_DIVIDE(total_fat_grams * 9, total_calories) * 100 as fat_pct
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.daily_summaries`
  WHERE summary_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND total_calories > 500 -- Filter out incomplete logging days
    AND total_calories < 5000 -- Filter out obvious errors
),

macro_distribution AS (
  SELECT 
    user_id,
    AVG(protein_pct) as avg_protein_pct,
    AVG(carbs_pct) as avg_carbs_pct,  
    AVG(fat_pct) as avg_fat_pct,
    STDDEV(protein_pct) as protein_consistency,
    STDDEV(carbs_pct) as carbs_consistency,
    STDDEV(fat_pct) as fat_consistency,
    COUNT(*) as days_tracked,
    -- Categorize macro split
    CASE 
      WHEN AVG(protein_pct) >= 25 AND AVG(carbs_pct) <= 35 THEN 'High Protein/Low Carb'
      WHEN AVG(protein_pct) >= 20 AND AVG(carbs_pct) >= 45 THEN 'Balanced'
      WHEN AVG(carbs_pct) >= 55 THEN 'High Carb'
      WHEN AVG(fat_pct) >= 35 THEN 'High Fat'
      ELSE 'Other'
    END as macro_profile
  FROM macro_ratios
  GROUP BY user_id
  HAVING COUNT(*) >= 14 -- At least 2 weeks of data
)

SELECT 
  macro_profile,
  COUNT(*) as user_count,
  AVG(avg_protein_pct) as typical_protein_pct,
  AVG(avg_carbs_pct) as typical_carbs_pct,
  AVG(avg_fat_pct) as typical_fat_pct,
  AVG(protein_consistency) as avg_protein_variance,
  AVG(carbs_consistency) as avg_carbs_variance,
  AVG(fat_consistency) as avg_fat_variance,
  AVG(days_tracked) as avg_days_tracked
FROM macro_distribution
GROUP BY macro_profile
ORDER BY user_count DESC;

-- Food Logging Consistency and Patterns
WITH logging_streaks AS (
  SELECT 
    user_id,
    summary_date,
    meals_logged,
    -- Identify gaps in logging
    DATE_DIFF(
      summary_date,
      LAG(summary_date) OVER (PARTITION BY user_id ORDER BY summary_date),
      DAY
    ) as days_since_last_log
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.daily_summaries`
  WHERE summary_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
    AND meals_logged > 0
),

user_logging_patterns AS (
  SELECT 
    user_id,
    COUNT(*) as total_logging_days,
    AVG(meals_logged) as avg_meals_per_day,
    MAX(meals_logged) as max_meals_per_day,
    AVG(CASE WHEN days_since_last_log <= 1 THEN 0 ELSE days_since_last_log END) as avg_gap_days,
    MAX(days_since_last_log) as longest_gap_days,
    COUNT(CASE WHEN days_since_last_log > 7 THEN 1 END) as gaps_over_week,
    -- Calculate longest streak
    COUNT(*) - COUNT(CASE WHEN days_since_last_log > 1 THEN 1 END) as estimated_longest_streak
  FROM logging_streaks
  WHERE days_since_last_log IS NOT NULL OR summary_date = (
    SELECT MIN(summary_date) FROM logging_streaks ls2 WHERE ls2.user_id = logging_streaks.user_id
  )
  GROUP BY user_id
  HAVING COUNT(*) >= 7 -- At least a week of data
),

consistency_segments AS (
  SELECT 
    user_id,
    total_logging_days,
    avg_meals_per_day,
    avg_gap_days,
    longest_gap_days,
    -- Categorize logging consistency
    CASE 
      WHEN total_logging_days >= 60 AND avg_gap_days <= 1.5 THEN 'Highly Consistent'
      WHEN total_logging_days >= 30 AND avg_gap_days <= 3 THEN 'Moderately Consistent'
      WHEN total_logging_days >= 14 AND avg_gap_days <= 7 THEN 'Inconsistent'
      ELSE 'Sporadic'
    END as consistency_level
  FROM user_logging_patterns
)

SELECT 
  consistency_level,
  COUNT(*) as user_count,
  AVG(total_logging_days) as avg_total_days,
  AVG(avg_meals_per_day) as avg_meals_logged_daily,
  AVG(avg_gap_days) as avg_days_between_logs,
  AVG(longest_gap_days) as avg_longest_gap,
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ()) * 100 as pct_of_users
FROM consistency_segments
GROUP BY consistency_level
ORDER BY AVG(total_logging_days) DESC;

-- Water Intake Analysis
WITH daily_water AS (
  SELECT 
    user_id,
    log_date,
    SUM(amount_ml) as total_water_ml,
    COUNT(*) as water_logs_per_day,
    MIN(log_time) as first_water_time,
    MAX(log_time) as last_water_time
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.water_intake`
  WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  GROUP BY user_id, log_date
),

water_with_goals AS (
  SELECT 
    dw.user_id,
    dw.log_date,
    dw.total_water_ml,
    dw.water_logs_per_day,
    ds.water_goal_ml,
    SAFE_DIVIDE(dw.total_water_ml, ds.water_goal_ml) * 100 as water_goal_adherence_pct,
    CASE 
      WHEN ds.water_goal_ml IS NULL THEN 'No Goal Set'
      WHEN dw.total_water_ml >= ds.water_goal_ml THEN 'Goal Met'
      WHEN dw.total_water_ml >= ds.water_goal_ml * 0.8 THEN 'Close to Goal'
      ELSE 'Below Goal'
    END as water_adherence_category
  FROM daily_water dw
  LEFT JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.daily_summaries` ds
    ON dw.user_id = ds.user_id AND dw.log_date = ds.summary_date
)

SELECT 
  DATE_TRUNC(log_date, WEEK(MONDAY)) as week_start,
  COUNT(DISTINCT user_id) as users_tracking_water,
  AVG(total_water_ml) as avg_daily_water_ml,
  AVG(water_logs_per_day) as avg_logs_per_day,
  AVG(water_goal_adherence_pct) as avg_goal_adherence_pct,
  COUNT(CASE WHEN water_adherence_category = 'Goal Met' THEN 1 END) as days_goal_met,
  COUNT(*) as total_tracking_days,
  SAFE_DIVIDE(
    COUNT(CASE WHEN water_adherence_category = 'Goal Met' THEN 1 END),
    COUNT(*)
  ) * 100 as pct_days_goal_met
FROM water_with_goals
WHERE water_goal_ml > 0 -- Only include users with water goals
GROUP BY week_start
ORDER BY week_start DESC;