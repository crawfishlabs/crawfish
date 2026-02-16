-- LLM Cost by Task — cost per model per task per app
SELECT
  DATE_TRUNC('day', created_at) AS day,
  app,
  model,
  task_type,
  COUNT(*) AS calls,
  SUM(cost_usd) AS total_cost,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens
FROM CLAW_ANALYTICS.CROSS_APP.LLM_USAGE
WHERE created_at >= DATEADD(day, -90, CURRENT_DATE())
GROUP BY day, app, model, task_type
ORDER BY day DESC, total_cost DESC
