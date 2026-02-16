-- User Health Score view - Composite engagement score across all apps
-- This view calculates a comprehensive user health score based on activity, retention, and value metrics

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.user_health_score` AS

WITH user_activity AS (
  -- Collect all user activities across apps
  SELECT 
    user_id,
    'fitness' as app_name,
    DATE(created_at) as activity_date,
    created_at,
    'workout' as activity_type
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  
  UNION ALL
  
  SELECT 
    user_id,
    'nutrition' as app_name,
    log_date as activity_date,
    created_at,
    'meal_log' as activity_type
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
  WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  
  UNION ALL
  
  SELECT 
    user_id,
    'meetings' as app_name,
    DATE(actual_start_time) as activity_date,
    created_at,
    'meeting' as activity_type
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
  WHERE DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  
  UNION ALL
  
  SELECT 
    user_id,
    'budget' as app_name,
    transaction_date as activity_date,
    created_at,
    'transaction' as activity_type
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
  WHERE transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
),

-- Feature usage from cross-app tracking
feature_activity AS (
  SELECT 
    user_id,
    app_name,
    DATE(created_at) as activity_date,
    feature_name,
    action,
    duration_seconds,
    success,
    created_at
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.feature_usage`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
),

-- User subscription information
user_subscriptions AS (
  SELECT 
    user_id,
    plan_name,
    status,
    apps_included,
    plan_price_monthly,
    billing_cycle,
    current_period_start,
    current_period_end,
    created_at as subscription_start
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.subscriptions`
  WHERE status IN ('active', 'trial', 'past_due')
),

-- Calculate engagement metrics per user
user_engagement AS (
  SELECT 
    ua.user_id,
    
    -- Activity frequency (last 30 days)
    COUNT(DISTINCT CASE 
      WHEN ua.activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) 
      THEN ua.activity_date 
    END) as active_days_last_7d,
    
    COUNT(DISTINCT CASE 
      WHEN ua.activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) 
      THEN ua.activity_date 
    END) as active_days_last_30d,
    
    -- App diversity
    COUNT(DISTINCT ua.app_name) as apps_used,
    ARRAY_AGG(DISTINCT ua.app_name) as apps_list,
    
    -- Activity volume
    COUNT(*) as total_activities_90d,
    COUNT(CASE 
      WHEN ua.activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) 
      THEN 1 
    END) as activities_last_30d,
    
    -- Recency
    MAX(ua.activity_date) as last_activity_date,
    DATE_DIFF(CURRENT_DATE(), MAX(ua.activity_date), DAY) as days_since_last_activity,
    
    -- Consistency
    COUNT(DISTINCT DATE_TRUNC(ua.activity_date, WEEK(MONDAY))) as active_weeks_90d,
    
    -- Lifecycle stage
    MIN(ua.activity_date) as first_activity_date,
    DATE_DIFF(CURRENT_DATE(), MIN(ua.activity_date), DAY) as days_since_first_activity
    
  FROM user_activity ua
  GROUP BY ua.user_id
),

-- Feature engagement depth
user_feature_engagement AS (
  SELECT 
    fa.user_id,
    
    -- Feature breadth
    COUNT(DISTINCT fa.feature_name) as unique_features_used,
    COUNT(DISTINCT CONCAT(fa.app_name, '_', fa.feature_name)) as unique_app_features_used,
    
    -- Feature depth (successful interactions)
    COUNT(CASE WHEN fa.success THEN 1 END) as successful_feature_uses,
    SAFE_DIVIDE(
      COUNT(CASE WHEN fa.success THEN 1 END), 
      COUNT(*)
    ) * 100 as feature_success_rate,
    
    -- Session quality
    AVG(CASE WHEN fa.duration_seconds > 0 THEN fa.duration_seconds END) as avg_session_duration,
    APPROX_QUANTILES(
      CASE WHEN fa.duration_seconds > 0 THEN fa.duration_seconds END, 
      100
    )[OFFSET(50)] as median_session_duration,
    
    -- Advanced feature adoption
    COUNT(DISTINCT CASE 
      WHEN fa.feature_name IN ('ai_coach', 'smart_recommendations', 'analytics_dashboard', 'export_data')
      THEN fa.feature_name
    END) as advanced_features_used,
    
    -- Recent engagement
    COUNT(CASE 
      WHEN fa.activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) 
      THEN 1 
    END) as feature_uses_last_7d
    
  FROM feature_activity fa
  GROUP BY fa.user_id
),

-- Value metrics (subscription and payment behavior)
user_value AS (
  SELECT 
    us.user_id,
    us.plan_name,
    us.status as subscription_status,
    us.apps_included,
    
    -- Value indicators
    CASE 
      WHEN us.plan_name = 'free' THEN 0
      WHEN us.plan_name = 'basic' THEN 1
      WHEN us.plan_name = 'pro' THEN 2
      WHEN us.plan_name = 'enterprise' THEN 3
      ELSE 0
    END as plan_tier,
    
    us.plan_price_monthly,
    
    CASE 
      WHEN us.billing_cycle = 'yearly' THEN us.plan_price_monthly * 12
      ELSE us.plan_price_monthly
    END as annual_value,
    
    -- Subscription tenure
    DATE_DIFF(CURRENT_DATE(), us.subscription_start, DAY) as subscription_age_days,
    
    -- Multi-app subscriber
    ARRAY_LENGTH(us.apps_included) as subscribed_apps_count,
    
    CASE 
      WHEN ARRAY_LENGTH(us.apps_included) >= 3 THEN true
      ELSE false
    END as is_multi_app_subscriber
    
  FROM user_subscriptions us
),

-- Calculate composite health score
user_health_components AS (
  SELECT 
    u.id as user_id,
    u.email,
    u.created_at as user_created_at,
    u.last_active_at,
    
    -- Engagement components (0-100 scale each)
    COALESCE(ue.active_days_last_7d, 0) as active_days_last_7d,
    COALESCE(ue.active_days_last_30d, 0) as active_days_last_30d,
    COALESCE(ue.apps_used, 0) as apps_used,
    COALESCE(ue.activities_last_30d, 0) as activities_last_30d,
    COALESCE(ue.days_since_last_activity, 999) as days_since_last_activity,
    
    -- Normalize engagement scores (0-100)
    LEAST(COALESCE(ue.active_days_last_7d, 0) * 100 / 7, 100) as frequency_score,
    LEAST(COALESCE(ue.apps_used, 0) * 100 / 4, 100) as diversity_score,
    GREATEST(100 - LEAST(COALESCE(ue.days_since_last_activity, 999), 30) * 100 / 30, 0) as recency_score,
    
    -- Feature engagement scores
    COALESCE(ufe.unique_features_used, 0) as unique_features_used,
    COALESCE(ufe.feature_success_rate, 0) as feature_success_rate,
    COALESCE(ufe.advanced_features_used, 0) as advanced_features_used,
    
    LEAST(COALESCE(ufe.unique_features_used, 0) * 10, 100) as feature_breadth_score,
    COALESCE(ufe.feature_success_rate, 0) as feature_quality_score,
    LEAST(COALESCE(ufe.advanced_features_used, 0) * 25, 100) as feature_sophistication_score,
    
    -- Value scores  
    COALESCE(uv.plan_tier, 0) as plan_tier,
    COALESCE(uv.subscribed_apps_count, 0) as subscribed_apps_count,
    COALESCE(uv.subscription_age_days, 0) as subscription_age_days,
    
    COALESCE(uv.plan_tier, 0) * 25 as monetization_score,
    CASE 
      WHEN COALESCE(uv.is_multi_app_subscriber, false) THEN 100
      WHEN COALESCE(uv.subscribed_apps_count, 0) >= 2 THEN 75
      WHEN COALESCE(uv.subscribed_apps_count, 0) >= 1 THEN 50
      ELSE 0
    END as commitment_score,
    
    -- Tenure and lifecycle
    DATE_DIFF(CURRENT_DATE(), u.created_at, DAY) as user_age_days,
    LEAST(DATE_DIFF(CURRENT_DATE(), u.created_at, DAY) / 90 * 100, 100) as tenure_score,
    
    -- Additional context
    COALESCE(ue.apps_list, []) as apps_used_list,
    COALESCE(uv.subscription_status, 'none') as subscription_status,
    COALESCE(ufe.avg_session_duration, 0) as avg_session_duration,
    
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.users` u
  LEFT JOIN user_engagement ue ON u.id = ue.user_id
  LEFT JOIN user_feature_engagement ufe ON u.id = ufe.user_id  
  LEFT JOIN user_value uv ON u.id = uv.user_id
  WHERE DATE(u.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY) -- Focus on users from last year
)

-- Final health score calculation
SELECT 
  user_id,
  email,
  user_created_at,
  last_active_at,
  
  -- Raw metrics
  active_days_last_7d,
  active_days_last_30d,
  apps_used,
  activities_last_30d,
  days_since_last_activity,
  unique_features_used,
  feature_success_rate,
  advanced_features_used,
  plan_tier,
  subscribed_apps_count,
  subscription_status,
  user_age_days,
  avg_session_duration,
  apps_used_list,
  
  -- Component scores (0-100 each)
  frequency_score,
  diversity_score,
  recency_score,
  feature_breadth_score,
  feature_quality_score,
  feature_sophistication_score,
  monetization_score,
  commitment_score,
  tenure_score,
  
  -- Weighted composite health score (0-100)
  ROUND(
    (frequency_score * 0.20) +          -- 20% - How often they're active
    (diversity_score * 0.15) +          -- 15% - How many apps they use
    (recency_score * 0.15) +            -- 15% - How recently they were active
    (feature_breadth_score * 0.10) +    -- 10% - Feature exploration
    (feature_quality_score * 0.10) +    -- 10% - Success with features
    (feature_sophistication_score * 0.05) + -- 5% - Advanced feature adoption
    (monetization_score * 0.15) +       -- 15% - Payment/plan level
    (commitment_score * 0.10)           -- 10% - Multi-app engagement
    -- Note: tenure_score not included in composite to avoid bias against new users
  , 2) as health_score,
  
  -- Health categories
  CASE 
    WHEN ROUND(
      (frequency_score * 0.20) + (diversity_score * 0.15) + (recency_score * 0.15) +
      (feature_breadth_score * 0.10) + (feature_quality_score * 0.10) + 
      (feature_sophistication_score * 0.05) + (monetization_score * 0.15) + (commitment_score * 0.10)
    , 2) >= 80 THEN 'champion'
    WHEN ROUND(
      (frequency_score * 0.20) + (diversity_score * 0.15) + (recency_score * 0.15) +
      (feature_breadth_score * 0.10) + (feature_quality_score * 0.10) + 
      (feature_sophistication_score * 0.05) + (monetization_score * 0.15) + (commitment_score * 0.10)
    , 2) >= 60 THEN 'healthy'
    WHEN ROUND(
      (frequency_score * 0.20) + (diversity_score * 0.15) + (recency_score * 0.15) +
      (feature_breadth_score * 0.10) + (feature_quality_score * 0.10) + 
      (feature_sophistication_score * 0.05) + (monetization_score * 0.15) + (commitment_score * 0.10)
    , 2) >= 40 THEN 'at_risk'
    ELSE 'dormant'
  END as health_category,
  
  -- Risk indicators
  CASE 
    WHEN days_since_last_activity >= 14 THEN true
    ELSE false
  END as churn_risk_high,
  
  CASE 
    WHEN days_since_last_activity >= 7 AND days_since_last_activity < 14 THEN true
    ELSE false
  END as churn_risk_medium,
  
  -- Growth opportunity flags
  CASE 
    WHEN apps_used = 1 AND subscription_status = 'active' THEN true
    ELSE false
  END as upsell_opportunity,
  
  CASE 
    WHEN subscription_status = 'none' AND 
         frequency_score >= 50 AND 
         feature_breadth_score >= 50 THEN true
    ELSE false
  END as conversion_opportunity,
  
  -- Lifecycle stage
  CASE 
    WHEN user_age_days <= 7 THEN 'new'
    WHEN user_age_days <= 30 THEN 'onboarding'
    WHEN user_age_days <= 90 THEN 'established'
    ELSE 'mature'
  END as lifecycle_stage,
  
  CURRENT_TIMESTAMP() as view_created_at

FROM user_health_components

ORDER BY health_score DESC, user_created_at DESC;