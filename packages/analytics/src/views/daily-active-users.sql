-- Daily Active Users — union across all 4 apps
SELECT event_date, app, COUNT(DISTINCT user_id) AS dau
FROM CLAW_ANALYTICS.CROSS_APP.FEATURE_USAGE
WHERE event_date >= DATEADD(day, -90, CURRENT_DATE())
GROUP BY event_date, app
ORDER BY event_date DESC, app
