-- Overview Analytics Queries for Command Center
-- DAU/WAU/MAU, retention cohorts, revenue by app

-- Daily Active Users across all apps
WITH daily_activity AS (
  SELECT 
    DATE(created_at) as activity_date,
    user_id,
    'fitness' as app_name
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  
  UNION ALL
  
  SELECT 
    DATE(log_date) as activity_date,
    user_id,
    'nutrition' as app_name
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
  WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  
  UNION ALL
  
  SELECT 
    DATE(actual_start_time) as activity_date,
    user_id,
    'meetings' as app_name
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
  WHERE DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  
  UNION ALL
  
  SELECT 
    transaction_date as activity_date,
    user_id,
    'budget' as app_name
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
  WHERE transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
),

dau_summary AS (
  SELECT 
    activity_date,
    app_name,
    COUNT(DISTINCT user_id) as daily_active_users
  FROM daily_activity
  GROUP BY activity_date, app_name
),

overall_dau AS (
  SELECT 
    activity_date,
    COUNT(DISTINCT user_id) as total_daily_active_users
  FROM daily_activity
  GROUP BY activity_date
)

SELECT 
  d.activity_date,
  d.app_name,
  d.daily_active_users,
  o.total_daily_active_users,
  -- 7-day average
  AVG(d.daily_active_users) OVER (
    PARTITION BY d.app_name 
    ORDER BY d.activity_date 
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) as dau_7day_avg,
  -- Week over week growth
  LAG(d.daily_active_users, 7) OVER (
    PARTITION BY d.app_name 
    ORDER BY d.activity_date
  ) as dau_7days_ago,
  SAFE_DIVIDE(
    d.daily_active_users - LAG(d.daily_active_users, 7) OVER (
      PARTITION BY d.app_name ORDER BY d.activity_date
    ),
    LAG(d.daily_active_users, 7) OVER (
      PARTITION BY d.app_name ORDER BY d.activity_date
    )
  ) * 100 as wow_growth_pct
FROM dau_summary d
JOIN overall_dau o ON d.activity_date = o.activity_date
ORDER BY d.activity_date DESC, d.app_name;

-- Weekly Active Users
WITH weekly_activity AS (
  SELECT 
    DATE_TRUNC(activity_date, WEEK(MONDAY)) as week_start,
    app_name,
    user_id
  FROM (
    SELECT 
      DATE(created_at) as activity_date,
      user_id,
      'fitness' as app_name
    FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
    WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
    
    UNION ALL
    
    SELECT 
      DATE(log_date) as activity_date,
      user_id,
      'nutrition' as app_name
    FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
    WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
    
    UNION ALL
    
    SELECT 
      DATE(actual_start_time) as activity_date,
      user_id,
      'meetings' as app_name
    FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
    WHERE DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
    
    UNION ALL
    
    SELECT 
      transaction_date as activity_date,
      user_id,
      'budget' as app_name
    FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
    WHERE transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  )
)

SELECT 
  week_start,
  app_name,
  COUNT(DISTINCT user_id) as weekly_active_users,
  -- Month over month growth
  LAG(COUNT(DISTINCT user_id), 4) OVER (
    PARTITION BY app_name ORDER BY week_start
  ) as wau_4weeks_ago,
  SAFE_DIVIDE(
    COUNT(DISTINCT user_id) - LAG(COUNT(DISTINCT user_id), 4) OVER (
      PARTITION BY app_name ORDER BY week_start
    ),
    LAG(COUNT(DISTINCT user_id), 4) OVER (
      PARTITION BY app_name ORDER BY week_start
    )
  ) * 100 as mom_growth_pct
FROM weekly_activity
GROUP BY week_start, app_name
ORDER BY week_start DESC, app_name;

-- Monthly Active Users
WITH monthly_activity AS (
  SELECT 
    DATE_TRUNC(activity_date, MONTH) as month_start,
    app_name,
    user_id
  FROM (
    SELECT 
      DATE(created_at) as activity_date,
      user_id,
      'fitness' as app_name
    FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
    WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY)
    
    UNION ALL
    
    SELECT 
      DATE(log_date) as activity_date,
      user_id,
      'nutrition' as app_name
    FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
    WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY)
    
    UNION ALL
    
    SELECT 
      DATE(actual_start_time) as activity_date,
      user_id,
      'meetings' as app_name
    FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
    WHERE DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY)
    
    UNION ALL
    
    SELECT 
      transaction_date as activity_date,
      user_id,
      'budget' as app_name
    FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
    WHERE transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY)
  )
)

SELECT 
  month_start,
  app_name,
  COUNT(DISTINCT user_id) as monthly_active_users,
  -- Year over year growth
  LAG(COUNT(DISTINCT user_id), 12) OVER (
    PARTITION BY app_name ORDER BY month_start
  ) as mau_12months_ago,
  SAFE_DIVIDE(
    COUNT(DISTINCT user_id) - LAG(COUNT(DISTINCT user_id), 12) OVER (
      PARTITION BY app_name ORDER BY month_start
    ),
    LAG(COUNT(DISTINCT user_id), 12) OVER (
      PARTITION BY app_name ORDER BY month_start
    )
  ) * 100 as yoy_growth_pct
FROM monthly_activity
GROUP BY month_start, app_name
ORDER BY month_start DESC, app_name;

-- User Retention Cohorts
WITH user_first_activity AS (
  SELECT 
    user_id,
    MIN(activity_date) as first_activity_date,
    DATE_TRUNC(MIN(activity_date), MONTH) as cohort_month
  FROM (
    SELECT user_id, DATE(created_at) as activity_date FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.users`
    WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  )
  GROUP BY user_id
),

monthly_activity_cohort AS (
  SELECT DISTINCT
    user_id,
    DATE_TRUNC(activity_date, MONTH) as activity_month
  FROM (
    SELECT user_id, DATE(created_at) as activity_date FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
    UNION ALL
    SELECT user_id, log_date as activity_date FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
    UNION ALL  
    SELECT user_id, DATE(actual_start_time) as activity_date FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
    UNION ALL
    SELECT user_id, transaction_date as activity_date FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
  )
  WHERE activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
),

cohort_data AS (
  SELECT 
    f.cohort_month,
    ma.activity_month,
    DATE_DIFF(ma.activity_month, f.cohort_month, MONTH) as period_number,
    COUNT(DISTINCT f.user_id) as cohort_size,
    COUNT(DISTINCT ma.user_id) as active_users
  FROM user_first_activity f
  LEFT JOIN monthly_activity_cohort ma ON f.user_id = ma.user_id
  WHERE ma.activity_month >= f.cohort_month
  GROUP BY f.cohort_month, ma.activity_month, period_number
)

SELECT 
  cohort_month,
  period_number,
  MAX(cohort_size) as cohort_size,
  active_users,
  SAFE_DIVIDE(active_users, MAX(cohort_size)) * 100 as retention_rate
FROM cohort_data
GROUP BY cohort_month, period_number, active_users
ORDER BY cohort_month DESC, period_number;

-- Revenue by App (from subscriptions)
WITH subscription_revenue AS (
  SELECT 
    DATE_TRUNC(current_period_start, MONTH) as revenue_month,
    app,
    SUM(plan_price_monthly * 
      CASE billing_cycle 
        WHEN 'yearly' THEN 12 
        ELSE 1 
      END
    ) as monthly_recurring_revenue,
    COUNT(DISTINCT user_id) as paying_users,
    AVG(plan_price_monthly * 
      CASE billing_cycle 
        WHEN 'yearly' THEN 12 
        ELSE 1 
      END
    ) as arpu
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.subscriptions`,
  UNNEST(apps_included) as app
  WHERE status IN ('active', 'trial')
    AND current_period_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  GROUP BY revenue_month, app
)

SELECT 
  revenue_month,
  app,
  monthly_recurring_revenue,
  paying_users,
  arpu,
  -- Growth metrics
  LAG(monthly_recurring_revenue, 1) OVER (
    PARTITION BY app ORDER BY revenue_month
  ) as prev_month_mrr,
  SAFE_DIVIDE(
    monthly_recurring_revenue - LAG(monthly_recurring_revenue, 1) OVER (
      PARTITION BY app ORDER BY revenue_month
    ),
    LAG(monthly_recurring_revenue, 1) OVER (
      PARTITION BY app ORDER BY revenue_month
    )
  ) * 100 as mrr_growth_pct
FROM subscription_revenue
ORDER BY revenue_month DESC, app;