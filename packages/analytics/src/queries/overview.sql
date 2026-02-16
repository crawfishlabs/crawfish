-- Overview metrics for Command Center
-- DAU/WAU/MAU by app, revenue, key metrics

SELECT
  app,
  COUNT(DISTINCT CASE WHEN event_date = CURRENT_DATE() THEN user_id END) AS dau,
  COUNT(DISTINCT CASE WHEN event_date >= DATEADD(day, -7, CURRENT_DATE()) THEN user_id END) AS wau,
  COUNT(DISTINCT CASE WHEN event_date >= DATEADD(day, -30, CURRENT_DATE()) THEN user_id END) AS mau,
  DIV0(
    COUNT(DISTINCT CASE WHEN event_date >= DATEADD(day, -7, CURRENT_DATE()) THEN user_id END),
    COUNT(DISTINCT CASE WHEN event_date >= DATEADD(day, -30, CURRENT_DATE()) THEN user_id END)
  ) AS stickiness
FROM CLAW_ANALYTICS.CROSS_APP.FEATURE_USAGE
WHERE event_date >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY app
ORDER BY mau DESC;
