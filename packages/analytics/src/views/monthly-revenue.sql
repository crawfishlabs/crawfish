-- Monthly Revenue — Stripe subscription data aggregated
SELECT
  DATE_TRUNC('month', created_at) AS month,
  app,
  COUNT(DISTINCT user_id) AS subscribers,
  SUM(amount_usd) AS mrr,
  COUNT(DISTINCT CASE WHEN status = 'trialing' THEN user_id END) AS trialing,
  COUNT(DISTINCT CASE WHEN status = 'active' THEN user_id END) AS active,
  COUNT(DISTINCT CASE WHEN status = 'cancelled' THEN user_id END) AS churned
FROM CLAW_ANALYTICS.CROSS_APP.SUBSCRIPTIONS
GROUP BY month, app
ORDER BY month DESC, app
