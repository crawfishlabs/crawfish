-- Daily Active Users view - Union across all 4 apps
-- This view provides a unified view of daily active users across fitness, nutrition, meetings, and budget apps

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.daily_active_users` AS

WITH app_activities AS (
  -- Fitness app activities
  SELECT 
    DATE(created_at) as activity_date,
    user_id,
    'fitness' as app_name,
    'workout_completed' as activity_type,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  
  UNION ALL
  
  SELECT 
    DATE(created_at) as activity_date,
    user_id,
    'fitness' as app_name,
    'exercise_logged' as activity_type,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.exercises`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  
  UNION ALL
  
  -- Nutrition app activities
  SELECT 
    log_date as activity_date,
    user_id,
    'nutrition' as app_name,
    'meal_logged' as activity_type,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
  WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  
  UNION ALL
  
  SELECT 
    DATE(created_at) as activity_date,
    user_id,
    'nutrition' as app_name,
    'meal_plan_created' as activity_type,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.meal_plans`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  
  UNION ALL
  
  -- Meetings app activities
  SELECT 
    DATE(actual_start_time) as activity_date,
    user_id,
    'meetings' as app_name,
    'meeting_completed' as activity_type,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
  WHERE DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  
  UNION ALL
  
  SELECT 
    DATE(created_at) as activity_date,
    user_id,
    'meetings' as app_name,
    'action_item_created' as activity_type,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.action_items`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  
  UNION ALL
  
  -- Budget app activities
  SELECT 
    transaction_date as activity_date,
    user_id,
    'budget' as app_name,
    'transaction_added' as activity_type,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
  WHERE transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  
  UNION ALL
  
  SELECT 
    DATE(created_at) as activity_date,
    user_id,
    'budget' as app_name,
    'budget_created' as activity_type,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.budgets`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
),

-- Aggregate by date and app
daily_app_users AS (
  SELECT 
    activity_date,
    app_name,
    COUNT(DISTINCT user_id) as daily_active_users,
    COUNT(*) as total_activities,
    ARRAY_AGG(DISTINCT activity_type) as activity_types
  FROM app_activities
  GROUP BY activity_date, app_name
),

-- Calculate overall DAU (users active in any app)
daily_total_users AS (
  SELECT 
    activity_date,
    COUNT(DISTINCT user_id) as total_daily_active_users,
    COUNT(*) as total_activities_all_apps,
    COUNT(DISTINCT app_name) as apps_with_activity
  FROM app_activities
  GROUP BY activity_date
),

-- Calculate user stickiness metrics
user_activity_frequency AS (
  SELECT 
    user_id,
    activity_date,
    COUNT(DISTINCT app_name) as apps_used_today,
    ARRAY_AGG(DISTINCT app_name) as apps_list
  FROM app_activities
  GROUP BY user_id, activity_date
),

daily_stickiness AS (
  SELECT 
    activity_date,
    AVG(apps_used_today) as avg_apps_per_user,
    COUNT(CASE WHEN apps_used_today >= 2 THEN 1 END) as multi_app_users,
    COUNT(DISTINCT user_id) as total_users
  FROM user_activity_frequency
  GROUP BY activity_date
)

-- Main query combining all metrics
SELECT 
  dau.activity_date,
  dau.app_name,
  dau.daily_active_users,
  dau.total_activities,
  dau.activity_types,
  
  -- Overall metrics
  dtu.total_daily_active_users,
  dtu.total_activities_all_apps,
  dtu.apps_with_activity,
  
  -- Stickiness metrics
  ds.avg_apps_per_user,
  ds.multi_app_users,
  SAFE_DIVIDE(ds.multi_app_users, ds.total_users) * 100 as multi_app_user_pct,
  
  -- Growth calculations
  LAG(dau.daily_active_users, 1) OVER (
    PARTITION BY dau.app_name 
    ORDER BY dau.activity_date
  ) as prev_day_users,
  
  LAG(dau.daily_active_users, 7) OVER (
    PARTITION BY dau.app_name 
    ORDER BY dau.activity_date
  ) as same_day_last_week,
  
  -- Week-over-week growth
  SAFE_DIVIDE(
    dau.daily_active_users - LAG(dau.daily_active_users, 7) OVER (
      PARTITION BY dau.app_name ORDER BY dau.activity_date
    ),
    LAG(dau.daily_active_users, 7) OVER (
      PARTITION BY dau.app_name ORDER BY dau.activity_date
    )
  ) * 100 as wow_growth_pct,
  
  -- 7-day rolling average
  AVG(dau.daily_active_users) OVER (
    PARTITION BY dau.app_name 
    ORDER BY dau.activity_date 
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) as dau_7day_avg,
  
  -- 30-day rolling average
  AVG(dau.daily_active_users) OVER (
    PARTITION BY dau.app_name 
    ORDER BY dau.activity_date 
    ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
  ) as dau_30day_avg,
  
  -- Day of week pattern
  FORMAT_DATE('%A', dau.activity_date) as day_of_week,
  EXTRACT(DAYOFWEEK FROM dau.activity_date) as day_of_week_num,
  
  -- Seasonality indicators
  EXTRACT(MONTH FROM dau.activity_date) as month,
  EXTRACT(QUARTER FROM dau.activity_date) as quarter,
  
  CURRENT_TIMESTAMP() as view_created_at

FROM daily_app_users dau
JOIN daily_total_users dtu ON dau.activity_date = dtu.activity_date
JOIN daily_stickiness ds ON dau.activity_date = ds.activity_date

ORDER BY dau.activity_date DESC, dau.app_name;