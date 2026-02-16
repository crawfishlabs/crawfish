-- User Health Score — composite engagement score across apps
SELECT
  user_id,
  COUNT(DISTINCT app) AS apps_used,
  COUNT(DISTINCT event_date) AS active_days_30d,
  DIV0(COUNT(DISTINCT event_date), 30) AS engagement_rate,
  MAX(event_date) AS last_active,
  DATEDIFF(day, MAX(event_date), CURRENT_DATE()) AS days_since_active,
  CASE
    WHEN DATEDIFF(day, MAX(event_date), CURRENT_DATE()) <= 1 THEN 'active'
    WHEN DATEDIFF(day, MAX(event_date), CURRENT_DATE()) <= 7 THEN 'engaged'
    WHEN DATEDIFF(day, MAX(event_date), CURRENT_DATE()) <= 30 THEN 'at_risk'
    ELSE 'churned'
  END AS health_status
FROM CLAW_ANALYTICS.CROSS_APP.FEATURE_USAGE
WHERE event_date >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY user_id
