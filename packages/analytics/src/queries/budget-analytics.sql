-- Budget analytics: spending trends, budget adherence, savings rate

-- Spending by category (last 30 days)
SELECT
  category,
  COUNT(*) AS transaction_count,
  SUM(amount) AS total_spent,
  AVG(amount) AS avg_transaction
FROM CLAW_ANALYTICS.BUDGET.TRANSACTIONS
WHERE created_at >= DATEADD(day, -30, CURRENT_DATE())
  AND is_expense = TRUE
GROUP BY category
ORDER BY total_spent DESC;

-- Budget adherence by category
SELECT
  b.category,
  b.budgeted_amount,
  COALESCE(t.actual_spent, 0) AS actual_spent,
  b.budgeted_amount - COALESCE(t.actual_spent, 0) AS remaining,
  DIV0(COALESCE(t.actual_spent, 0), b.budgeted_amount) AS utilization
FROM CLAW_ANALYTICS.BUDGET.BUDGETS b
LEFT JOIN (
  SELECT category, SUM(amount) AS actual_spent
  FROM CLAW_ANALYTICS.BUDGET.TRANSACTIONS
  WHERE is_expense = TRUE
    AND created_at >= DATE_TRUNC('month', CURRENT_DATE())
  GROUP BY category
) t ON b.category = t.category
WHERE b.period = DATE_TRUNC('month', CURRENT_DATE())
ORDER BY utilization DESC;

-- Daily spending trend
SELECT
  DATE_TRUNC('day', created_at) AS day,
  SUM(CASE WHEN is_expense THEN amount ELSE 0 END) AS spent,
  SUM(CASE WHEN NOT is_expense THEN amount ELSE 0 END) AS income,
  COUNT(*) AS transactions
FROM CLAW_ANALYTICS.BUDGET.TRANSACTIONS
WHERE created_at >= DATEADD(day, -90, CURRENT_DATE())
GROUP BY day
ORDER BY day;

-- Savings rate by month
SELECT
  DATE_TRUNC('month', created_at) AS month,
  SUM(CASE WHEN NOT is_expense THEN amount ELSE 0 END) AS income,
  SUM(CASE WHEN is_expense THEN amount ELSE 0 END) AS expenses,
  DIV0(
    SUM(CASE WHEN NOT is_expense THEN amount ELSE 0 END) - SUM(CASE WHEN is_expense THEN amount ELSE 0 END),
    NULLIF(SUM(CASE WHEN NOT is_expense THEN amount ELSE 0 END), 0)
  ) AS savings_rate
FROM CLAW_ANALYTICS.BUDGET.TRANSACTIONS
WHERE created_at >= DATEADD(month, -12, CURRENT_DATE())
GROUP BY month
ORDER BY month;
