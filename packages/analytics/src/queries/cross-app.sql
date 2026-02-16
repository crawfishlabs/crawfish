-- Cross-app analytics: LLM costs, feature adoption, multi-app users

-- LLM cost by app and model (last 30 days)
SELECT
  app,
  model,
  task_type,
  COUNT(*) AS calls,
  SUM(cost_usd) AS total_cost,
  AVG(cost_usd) AS avg_cost,
  SUM(input_tokens + output_tokens) AS total_tokens
FROM CLAW_ANALYTICS.CROSS_APP.LLM_USAGE
WHERE created_at >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY app, model, task_type
ORDER BY total_cost DESC;

-- Multi-app users (using more than one Claw app)
SELECT
  user_id,
  ARRAY_AGG(DISTINCT app) AS apps,
  COUNT(DISTINCT app) AS app_count
FROM CLAW_ANALYTICS.CROSS_APP.FEATURE_USAGE
WHERE event_date >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY user_id
HAVING app_count > 1
ORDER BY app_count DESC;

-- Feature adoption funnel
SELECT
  app,
  feature_name,
  COUNT(DISTINCT user_id) AS users,
  COUNT(*) AS usage_count,
  AVG(DATEDIFF(day, first_use, CURRENT_DATE())) AS avg_days_since_first_use
FROM (
  SELECT app, feature_name, user_id,
    MIN(event_date) AS first_use
  FROM CLAW_ANALYTICS.CROSS_APP.FEATURE_USAGE
  GROUP BY app, feature_name, user_id
)
GROUP BY app, feature_name
ORDER BY users DESC;
