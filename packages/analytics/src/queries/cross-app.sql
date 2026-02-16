-- Cross-App Analytics Queries
-- Cross-app usage correlation, LLM cost per user, feature adoption funnel

-- Cross-App Usage Correlation Analysis
WITH user_app_activity AS (
  SELECT 
    user_id,
    DATE_TRUNC(DATE(created_at), WEEK(MONDAY)) as week_start,
    'fitness' as app_name,
    COUNT(*) as activity_count
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
  GROUP BY user_id, week_start
  
  UNION ALL
  
  SELECT 
    user_id,
    DATE_TRUNC(log_date, WEEK(MONDAY)) as week_start,
    'nutrition' as app_name,
    COUNT(*) as activity_count
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
  WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
  GROUP BY user_id, week_start
  
  UNION ALL
  
  SELECT 
    user_id,
    DATE_TRUNC(DATE(actual_start_time), WEEK(MONDAY)) as week_start,
    'meetings' as app_name,
    COUNT(*) as activity_count
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
  WHERE DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
  GROUP BY user_id, week_start
  
  UNION ALL
  
  SELECT 
    user_id,
    DATE_TRUNC(transaction_date, WEEK(MONDAY)) as week_start,
    'budget' as app_name,
    COUNT(*) as activity_count
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
  WHERE transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
  GROUP BY user_id, week_start
),

user_weekly_matrix AS (
  SELECT 
    user_id,
    week_start,
    SUM(CASE WHEN app_name = 'fitness' THEN activity_count ELSE 0 END) as fitness_activity,
    SUM(CASE WHEN app_name = 'nutrition' THEN activity_count ELSE 0 END) as nutrition_activity,
    SUM(CASE WHEN app_name = 'meetings' THEN activity_count ELSE 0 END) as meetings_activity,
    SUM(CASE WHEN app_name = 'budget' THEN activity_count ELSE 0 END) as budget_activity,
    -- Binary indicators for correlation analysis
    CASE WHEN SUM(CASE WHEN app_name = 'fitness' THEN activity_count ELSE 0 END) > 0 THEN 1 ELSE 0 END as used_fitness,
    CASE WHEN SUM(CASE WHEN app_name = 'nutrition' THEN activity_count ELSE 0 END) > 0 THEN 1 ELSE 0 END as used_nutrition,
    CASE WHEN SUM(CASE WHEN app_name = 'meetings' THEN activity_count ELSE 0 END) > 0 THEN 1 ELSE 0 END as used_meetings,
    CASE WHEN SUM(CASE WHEN app_name = 'budget' THEN activity_count ELSE 0 END) > 0 THEN 1 ELSE 0 END as used_budget
  FROM user_app_activity
  GROUP BY user_id, week_start
),

correlation_stats AS (
  SELECT 
    week_start,
    COUNT(*) as total_user_weeks,
    -- Single app usage
    SUM(used_fitness) as fitness_users,
    SUM(used_nutrition) as nutrition_users,
    SUM(used_meetings) as meetings_users,
    SUM(used_budget) as budget_users,
    -- Cross-app correlations
    SUM(used_fitness * used_nutrition) as fitness_nutrition_overlap,
    SUM(used_fitness * used_meetings) as fitness_meetings_overlap,
    SUM(used_fitness * used_budget) as fitness_budget_overlap,
    SUM(used_nutrition * used_meetings) as nutrition_meetings_overlap,
    SUM(used_nutrition * used_budget) as nutrition_budget_overlap,
    SUM(used_meetings * used_budget) as meetings_budget_overlap,
    -- Three-app combinations
    SUM(used_fitness * used_nutrition * used_meetings) as fitness_nutrition_meetings,
    SUM(used_fitness * used_nutrition * used_budget) as fitness_nutrition_budget,
    SUM(used_fitness * used_meetings * used_budget) as fitness_meetings_budget,
    SUM(used_nutrition * used_meetings * used_budget) as nutrition_meetings_budget,
    -- All four apps
    SUM(used_fitness * used_nutrition * used_meetings * used_budget) as all_four_apps,
    -- Activity intensity correlations
    AVG(fitness_activity) as avg_fitness_activity,
    AVG(nutrition_activity) as avg_nutrition_activity,
    AVG(meetings_activity) as avg_meetings_activity,
    AVG(budget_activity) as avg_budget_activity
  FROM user_weekly_matrix
  GROUP BY week_start
)

SELECT 
  week_start,
  total_user_weeks,
  -- Single app adoption rates
  SAFE_DIVIDE(fitness_users, total_user_weeks) * 100 as fitness_adoption_pct,
  SAFE_DIVIDE(nutrition_users, total_user_weeks) * 100 as nutrition_adoption_pct,
  SAFE_DIVIDE(meetings_users, total_user_weeks) * 100 as meetings_adoption_pct,
  SAFE_DIVIDE(budget_users, total_user_weeks) * 100 as budget_adoption_pct,
  -- Cross-app correlation rates
  SAFE_DIVIDE(fitness_nutrition_overlap, fitness_users) * 100 as fitness_to_nutrition_pct,
  SAFE_DIVIDE(nutrition_meetings_overlap, nutrition_users) * 100 as nutrition_to_meetings_pct,
  SAFE_DIVIDE(meetings_budget_overlap, meetings_users) * 100 as meetings_to_budget_pct,
  -- Multi-app usage
  SAFE_DIVIDE(all_four_apps, total_user_weeks) * 100 as all_apps_usage_pct,
  SAFE_DIVIDE(fitness_nutrition_meetings + fitness_nutrition_budget + fitness_meetings_budget + nutrition_meetings_budget, total_user_weeks) * 100 as three_plus_apps_pct,
  -- Activity intensity
  ROUND(avg_fitness_activity, 1) as avg_fitness_actions,
  ROUND(avg_nutrition_activity, 1) as avg_nutrition_actions,
  ROUND(avg_meetings_activity, 1) as avg_meetings_actions,
  ROUND(avg_budget_activity, 1) as avg_budget_actions
FROM correlation_stats
ORDER BY week_start DESC;

-- LLM Cost Analysis Per User and Task Type
WITH llm_costs AS (
  SELECT 
    user_id,
    app_name,
    task_type,
    model_name,
    provider,
    DATE_TRUNC(DATE(created_at), WEEK(MONDAY)) as week_start,
    SUM(cost_cents) / 100 as total_cost_dollars,
    SUM(prompt_tokens) as total_prompt_tokens,
    SUM(completion_tokens) as total_completion_tokens,
    SUM(total_tokens) as total_tokens,
    COUNT(*) as total_requests,
    AVG(latency_ms) as avg_latency_ms,
    COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
    COUNT(CASE WHEN success = false THEN 1 END) as failed_requests
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.llm_usage`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND cost_cents > 0
  GROUP BY user_id, app_name, task_type, model_name, provider, week_start
),

weekly_cost_summary AS (
  SELECT 
    week_start,
    app_name,
    task_type,
    model_name,
    provider,
    COUNT(DISTINCT user_id) as unique_users,
    SUM(total_cost_dollars) as weekly_cost,
    SUM(total_tokens) as weekly_tokens,
    SUM(total_requests) as weekly_requests,
    AVG(avg_latency_ms) as avg_latency,
    SUM(successful_requests) as successful_requests,
    SUM(failed_requests) as failed_requests,
    AVG(total_cost_dollars) as avg_cost_per_user,
    SAFE_DIVIDE(SUM(total_cost_dollars), SUM(total_tokens)) * 1000 as cost_per_1k_tokens
  FROM llm_costs
  GROUP BY week_start, app_name, task_type, model_name, provider
),

cost_by_app AS (
  SELECT 
    week_start,
    app_name,
    SUM(weekly_cost) as app_weekly_cost,
    COUNT(DISTINCT user_id) as app_users,
    SUM(weekly_tokens) as app_weekly_tokens,
    SUM(weekly_requests) as app_weekly_requests,
    AVG(avg_cost_per_user) as avg_cost_per_user_per_app
  FROM llm_costs
  GROUP BY week_start, app_name
)

SELECT 
  wcs.week_start,
  wcs.app_name,
  wcs.task_type,
  wcs.model_name,
  wcs.provider,
  wcs.unique_users,
  ROUND(wcs.weekly_cost, 2) as weekly_cost_usd,
  wcs.weekly_tokens,
  wcs.weekly_requests,
  ROUND(wcs.avg_latency, 0) as avg_latency_ms,
  SAFE_DIVIDE(wcs.successful_requests, wcs.weekly_requests) * 100 as success_rate_pct,
  ROUND(wcs.avg_cost_per_user, 3) as avg_cost_per_user,
  ROUND(wcs.cost_per_1k_tokens, 4) as cost_per_1k_tokens,
  -- Share of app costs
  SAFE_DIVIDE(wcs.weekly_cost, cba.app_weekly_cost) * 100 as pct_of_app_cost,
  -- Efficiency metrics
  SAFE_DIVIDE(wcs.weekly_tokens, wcs.weekly_requests) as avg_tokens_per_request,
  SAFE_DIVIDE(wcs.weekly_cost, wcs.weekly_requests) as avg_cost_per_request
FROM weekly_cost_summary wcs
JOIN cost_by_app cba ON wcs.week_start = cba.week_start AND wcs.app_name = cba.app_name
ORDER BY wcs.week_start DESC, wcs.weekly_cost DESC;

-- Feature Adoption Funnel Analysis
WITH feature_events AS (
  SELECT 
    user_id,
    app_name,
    feature_name,
    action,
    DATE(created_at) as event_date,
    session_id,
    success,
    ROW_NUMBER() OVER (PARTITION BY user_id, app_name, feature_name ORDER BY created_at) as feature_interaction_sequence
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.feature_usage`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
),

feature_funnel_steps AS (
  SELECT 
    app_name,
    feature_name,
    user_id,
    -- Define funnel steps
    MAX(CASE WHEN action = 'view' THEN 1 ELSE 0 END) as viewed,
    MAX(CASE WHEN action IN ('create', 'start') THEN 1 ELSE 0 END) as started,
    MAX(CASE WHEN action IN ('edit', 'update') THEN 1 ELSE 0 END) as engaged,
    MAX(CASE WHEN action IN ('complete', 'finish', 'save') THEN 1 ELSE 0 END) as completed,
    -- First and last interaction dates
    MIN(event_date) as first_interaction,
    MAX(event_date) as last_interaction,
    COUNT(*) as total_interactions,
    AVG(CASE WHEN success = true THEN 1.0 ELSE 0.0 END) as success_rate
  FROM feature_events
  GROUP BY app_name, feature_name, user_id
),

funnel_metrics AS (
  SELECT 
    app_name,
    feature_name,
    COUNT(DISTINCT user_id) as total_users,
    SUM(viewed) as users_viewed,
    SUM(started) as users_started,
    SUM(engaged) as users_engaged,
    SUM(completed) as users_completed,
    AVG(total_interactions) as avg_interactions_per_user,
    AVG(success_rate) as avg_success_rate,
    AVG(DATE_DIFF(last_interaction, first_interaction, DAY)) as avg_engagement_span_days
  FROM feature_funnel_steps
  GROUP BY app_name, feature_name
  HAVING COUNT(DISTINCT user_id) >= 10 -- Only features with sufficient usage
),

funnel_conversion_rates AS (
  SELECT 
    app_name,
    feature_name,
    total_users,
    users_viewed,
    users_started,
    users_engaged,
    users_completed,
    -- Conversion rates
    SAFE_DIVIDE(users_started, users_viewed) * 100 as view_to_start_pct,
    SAFE_DIVIDE(users_engaged, users_started) * 100 as start_to_engage_pct,
    SAFE_DIVIDE(users_completed, users_engaged) * 100 as engage_to_complete_pct,
    SAFE_DIVIDE(users_completed, users_viewed) * 100 as overall_conversion_pct,
    -- Other metrics
    avg_interactions_per_user,
    avg_success_rate * 100 as success_rate_pct,
    avg_engagement_span_days
  FROM funnel_metrics
)

SELECT 
  app_name,
  feature_name,
  total_users,
  users_viewed,
  users_started,
  users_engaged,
  users_completed,
  ROUND(view_to_start_pct, 1) as view_to_start_conversion_pct,
  ROUND(start_to_engage_pct, 1) as start_to_engage_conversion_pct,
  ROUND(engage_to_complete_pct, 1) as engage_to_complete_conversion_pct,
  ROUND(overall_conversion_pct, 1) as end_to_end_conversion_pct,
  ROUND(avg_interactions_per_user, 1) as avg_interactions_per_user,
  ROUND(success_rate_pct, 1) as technical_success_rate_pct,
  ROUND(avg_engagement_span_days, 1) as avg_days_from_first_to_last_use,
  -- Feature adoption score (composite metric)
  ROUND(
    (overall_conversion_pct * 0.4) + 
    (success_rate_pct * 0.3) + 
    (LEAST(avg_interactions_per_user * 10, 100) * 0.3), 
    1
  ) as feature_adoption_score
FROM funnel_conversion_rates
ORDER BY app_name, feature_adoption_score DESC;

-- User Engagement Segmentation Across Apps
WITH user_app_engagement AS (
  SELECT 
    user_id,
    'fitness' as app_name,
    COUNT(*) as monthly_actions,
    COUNT(DISTINCT DATE(created_at)) as active_days,
    DATE_DIFF(CURRENT_DATE(), MAX(DATE(created_at)), DAY) as days_since_last_activity
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY user_id
  
  UNION ALL
  
  SELECT 
    user_id,
    'nutrition' as app_name,
    COUNT(*) as monthly_actions,
    COUNT(DISTINCT log_date) as active_days,
    DATE_DIFF(CURRENT_DATE(), MAX(log_date), DAY) as days_since_last_activity
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_nutrition.food_logs`
  WHERE log_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY user_id
  
  UNION ALL
  
  SELECT 
    user_id,
    'meetings' as app_name,
    COUNT(*) as monthly_actions,
    COUNT(DISTINCT DATE(actual_start_time)) as active_days,
    DATE_DIFF(CURRENT_DATE(), MAX(DATE(actual_start_time)), DAY) as days_since_last_activity
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
  WHERE DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY user_id
  
  UNION ALL
  
  SELECT 
    user_id,
    'budget' as app_name,
    COUNT(*) as monthly_actions,
    COUNT(DISTINCT transaction_date) as active_days,
    DATE_DIFF(CURRENT_DATE(), MAX(transaction_date), DAY) as days_since_last_activity
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
  WHERE transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY user_id
),

user_engagement_matrix AS (
  SELECT 
    user_id,
    COUNT(DISTINCT app_name) as apps_used,
    SUM(monthly_actions) as total_monthly_actions,
    AVG(active_days) as avg_active_days_per_app,
    MIN(days_since_last_activity) as days_since_any_activity,
    -- App-specific metrics
    SUM(CASE WHEN app_name = 'fitness' THEN monthly_actions ELSE 0 END) as fitness_actions,
    SUM(CASE WHEN app_name = 'nutrition' THEN monthly_actions ELSE 0 END) as nutrition_actions,
    SUM(CASE WHEN app_name = 'meetings' THEN monthly_actions ELSE 0 END) as meetings_actions,
    SUM(CASE WHEN app_name = 'budget' THEN monthly_actions ELSE 0 END) as budget_actions
  FROM user_app_engagement
  GROUP BY user_id
),

engagement_segments AS (
  SELECT 
    user_id,
    apps_used,
    total_monthly_actions,
    avg_active_days_per_app,
    days_since_any_activity,
    -- Create engagement segments
    CASE 
      WHEN apps_used >= 3 AND total_monthly_actions >= 20 AND avg_active_days_per_app >= 10 THEN 'Power User'
      WHEN apps_used >= 2 AND total_monthly_actions >= 10 AND avg_active_days_per_app >= 5 THEN 'Engaged User'
      WHEN apps_used >= 1 AND total_monthly_actions >= 5 AND days_since_any_activity <= 7 THEN 'Regular User'
      WHEN apps_used >= 1 AND days_since_any_activity <= 14 THEN 'Casual User'
      WHEN days_since_any_activity <= 30 THEN 'At Risk'
      ELSE 'Dormant'
    END as engagement_segment,
    -- App preference
    CASE 
      WHEN fitness_actions >= GREATEST(nutrition_actions, meetings_actions, budget_actions) THEN 'Fitness Focused'
      WHEN nutrition_actions >= GREATEST(fitness_actions, meetings_actions, budget_actions) THEN 'Nutrition Focused'
      WHEN meetings_actions >= GREATEST(fitness_actions, nutrition_actions, budget_actions) THEN 'Meetings Focused'
      WHEN budget_actions >= GREATEST(fitness_actions, nutrition_actions, meetings_actions) THEN 'Budget Focused'
      ELSE 'Balanced'
    END as primary_app_preference
  FROM user_engagement_matrix
)

SELECT 
  engagement_segment,
  primary_app_preference,
  COUNT(*) as user_count,
  AVG(apps_used) as avg_apps_per_user,
  AVG(total_monthly_actions) as avg_monthly_actions,
  AVG(avg_active_days_per_app) as avg_active_days,
  AVG(days_since_any_activity) as avg_days_since_activity,
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ()) * 100 as pct_of_user_base,
  -- Distribution within segment
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER (PARTITION BY engagement_segment)) * 100 as pct_within_segment
FROM engagement_segments
GROUP BY engagement_segment, primary_app_preference
ORDER BY 
  CASE engagement_segment
    WHEN 'Power User' THEN 1
    WHEN 'Engaged User' THEN 2
    WHEN 'Regular User' THEN 3
    WHEN 'Casual User' THEN 4
    WHEN 'At Risk' THEN 5
    WHEN 'Dormant' THEN 6
  END,
  user_count DESC;