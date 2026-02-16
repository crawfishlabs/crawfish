-- Budget Analytics Queries
-- Spending by category trends, budget adherence, savings rate, net worth

-- Spending by Category Trends
WITH monthly_spending AS (
  SELECT 
    t.user_id,
    DATE_TRUNC(t.transaction_date, MONTH) as month,
    c.name as category_name,
    c.category_type,
    c.is_essential,
    SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as total_expenses,
    SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) as total_income,
    COUNT(CASE WHEN t.amount < 0 THEN 1 END) as expense_transactions,
    COUNT(CASE WHEN t.amount > 0 THEN 1 END) as income_transactions,
    AVG(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE NULL END) as avg_expense_amount
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions` t
  JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.categories` c ON t.category_id = c.id
  WHERE t.transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
    AND c.category_type IN ('expense', 'income')
  GROUP BY t.user_id, month, c.name, c.category_type, c.is_essential
),

category_trends AS (
  SELECT 
    month,
    category_name,
    category_type,
    is_essential,
    COUNT(DISTINCT user_id) as users_in_category,
    SUM(total_expenses) as total_category_expenses,
    SUM(total_income) as total_category_income,
    AVG(total_expenses) as avg_user_expenses,
    SUM(expense_transactions) as total_expense_transactions,
    AVG(avg_expense_amount) as avg_transaction_size
  FROM monthly_spending
  GROUP BY month, category_name, category_type, is_essential
),

monthly_totals AS (
  SELECT 
    month,
    SUM(total_category_expenses) as monthly_total_expenses,
    SUM(total_category_income) as monthly_total_income
  FROM category_trends
  GROUP BY month
)

SELECT 
  ct.month,
  ct.category_name,
  ct.category_type,
  ct.is_essential,
  ct.users_in_category,
  ROUND(ct.total_category_expenses, 2) as total_expenses,
  ROUND(ct.avg_user_expenses, 2) as avg_per_user,
  ROUND(ct.avg_transaction_size, 2) as avg_transaction_amount,
  ct.total_expense_transactions,
  -- Percentage of total spending
  SAFE_DIVIDE(ct.total_category_expenses, mt.monthly_total_expenses) * 100 as pct_of_total_spending,
  -- Month over month growth
  LAG(ct.total_category_expenses, 1) OVER (
    PARTITION BY ct.category_name ORDER BY ct.month
  ) as prev_month_expenses,
  SAFE_DIVIDE(
    ct.total_category_expenses - LAG(ct.total_category_expenses, 1) OVER (
      PARTITION BY ct.category_name ORDER BY ct.month
    ),
    LAG(ct.total_category_expenses, 1) OVER (
      PARTITION BY ct.category_name ORDER BY ct.month
    )
  ) * 100 as mom_growth_pct
FROM category_trends ct
JOIN monthly_totals mt ON ct.month = mt.month
WHERE ct.category_type = 'expense'
ORDER BY ct.month DESC, ct.total_category_expenses DESC;

-- Budget Adherence Analysis
WITH budget_performance AS (
  SELECT 
    b.user_id,
    b.id as budget_id,
    b.name as budget_name,
    b.category_id,
    c.name as category_name,
    b.period_start_date,
    b.period_end_date,
    b.budget_amount,
    b.spent_amount,
    b.remaining_amount,
    b.status,
    -- Calculate actual spending from transactions
    COALESCE(
      (SELECT SUM(ABS(amount))
       FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions` t
       WHERE t.user_id = b.user_id
         AND t.category_id = b.category_id
         AND t.transaction_date BETWEEN b.period_start_date AND b.period_end_date
         AND t.amount < 0
      ), 0
    ) as actual_spent,
    -- Calculate adherence metrics
    SAFE_DIVIDE(b.spent_amount, b.budget_amount) * 100 as budget_utilization_pct,
    CASE 
      WHEN b.spent_amount <= b.budget_amount THEN 'Within Budget'
      WHEN b.spent_amount <= b.budget_amount * 1.1 THEN 'Slightly Over (≤10%)'
      WHEN b.spent_amount <= b.budget_amount * 1.25 THEN 'Over Budget (10-25%)'
      ELSE 'Significantly Over (>25%)'
    END as adherence_category,
    -- Days into budget period
    DATE_DIFF(CURRENT_DATE(), b.period_start_date, DAY) as days_into_period,
    DATE_DIFF(b.period_end_date, b.period_start_date, DAY) as total_period_days,
    SAFE_DIVIDE(
      DATE_DIFF(CURRENT_DATE(), b.period_start_date, DAY),
      DATE_DIFF(b.period_end_date, b.period_start_date, DAY)
    ) as period_progress_pct
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.budgets` b
  LEFT JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.categories` c ON b.category_id = c.id
  WHERE b.period_end_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND b.status = 'active'
),

adherence_summary AS (
  SELECT 
    DATE_TRUNC(period_start_date, MONTH) as budget_month,
    adherence_category,
    COUNT(*) as budget_count,
    COUNT(DISTINCT user_id) as unique_users,
    AVG(budget_utilization_pct) as avg_utilization_pct,
    AVG(budget_amount) as avg_budget_amount,
    AVG(spent_amount) as avg_spent_amount,
    SUM(budget_amount) as total_budgeted,
    SUM(spent_amount) as total_spent
  FROM budget_performance
  GROUP BY budget_month, adherence_category
),

monthly_adherence AS (
  SELECT 
    budget_month,
    SUM(budget_count) as total_budgets,
    SUM(unique_users) as total_budget_users,
    SUM(total_budgeted) as monthly_total_budgeted,
    SUM(total_spent) as monthly_total_spent
  FROM adherence_summary
  GROUP BY budget_month
)

SELECT 
  assum.budget_month,
  assum.adherence_category,
  assum.budget_count,
  assum.unique_users,
  ROUND(assum.avg_utilization_pct, 1) as avg_utilization_percentage,
  ROUND(assum.avg_budget_amount, 2) as avg_budget_amount,
  ROUND(assum.avg_spent_amount, 2) as avg_spent_amount,
  SAFE_DIVIDE(assum.budget_count, ma.total_budgets) * 100 as pct_of_budgets,
  SAFE_DIVIDE(assum.total_budgeted, ma.monthly_total_budgeted) * 100 as pct_of_total_budgeted,
  SAFE_DIVIDE(assum.total_spent, ma.monthly_total_spent) * 100 as pct_of_total_spent
FROM adherence_summary assum
JOIN monthly_adherence ma ON assum.budget_month = ma.budget_month
ORDER BY assum.budget_month DESC, assum.budget_count DESC;

-- Savings Rate and Financial Health Analysis
WITH monthly_finances AS (
  SELECT 
    user_id,
    DATE_TRUNC(transaction_date, MONTH) as month,
    SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as monthly_income,
    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as monthly_expenses,
    SUM(amount) as net_cash_flow,
    COUNT(CASE WHEN amount > 0 THEN 1 END) as income_transactions,
    COUNT(CASE WHEN amount < 0 THEN 1 END) as expense_transactions
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.transactions`
  WHERE transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  GROUP BY user_id, month
  HAVING SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) > 0 -- Only users with income
),

savings_metrics AS (
  SELECT 
    user_id,
    month,
    monthly_income,
    monthly_expenses,
    net_cash_flow,
    -- Calculate savings rate
    SAFE_DIVIDE(net_cash_flow, monthly_income) * 100 as savings_rate_pct,
    -- Categorize savings performance
    CASE 
      WHEN SAFE_DIVIDE(net_cash_flow, monthly_income) >= 0.20 THEN 'Excellent (≥20%)'
      WHEN SAFE_DIVIDE(net_cash_flow, monthly_income) >= 0.10 THEN 'Good (10-19%)'
      WHEN SAFE_DIVIDE(net_cash_flow, monthly_income) >= 0.05 THEN 'Fair (5-9%)'
      WHEN SAFE_DIVIDE(net_cash_flow, monthly_income) >= 0 THEN 'Minimal (0-4%)'
      ELSE 'Negative (Overspending)'
    END as savings_category,
    -- Calculate expense ratios
    SAFE_DIVIDE(monthly_expenses, monthly_income) as expense_to_income_ratio
  FROM monthly_finances
),

savings_distribution AS (
  SELECT 
    month,
    savings_category,
    COUNT(*) as user_count,
    AVG(savings_rate_pct) as avg_savings_rate,
    AVG(monthly_income) as avg_monthly_income,
    AVG(monthly_expenses) as avg_monthly_expenses,
    AVG(expense_to_income_ratio) as avg_expense_ratio
  FROM savings_metrics
  GROUP BY month, savings_category
),

overall_monthly_stats AS (
  SELECT 
    month,
    COUNT(DISTINCT user_id) as total_users,
    AVG(savings_rate_pct) as overall_avg_savings_rate,
    AVG(monthly_income) as overall_avg_income,
    AVG(monthly_expenses) as overall_avg_expenses
  FROM savings_metrics
  GROUP BY month
)

SELECT 
  sd.month,
  sd.savings_category,
  sd.user_count,
  SAFE_DIVIDE(sd.user_count, oms.total_users) * 100 as pct_of_users,
  ROUND(sd.avg_savings_rate, 1) as avg_savings_rate_pct,
  ROUND(sd.avg_monthly_income, 2) as avg_income,
  ROUND(sd.avg_monthly_expenses, 2) as avg_expenses,
  ROUND(sd.avg_expense_ratio * 100, 1) as avg_expense_ratio_pct,
  ROUND(oms.overall_avg_savings_rate, 1) as overall_savings_rate_pct
FROM savings_distribution sd
JOIN overall_monthly_stats oms ON sd.month = oms.month
ORDER BY sd.month DESC, sd.avg_savings_rate DESC;

-- Net Worth and Account Balance Trends
WITH account_balances AS (
  SELECT 
    user_id,
    account_type,
    institution_name,
    current_balance,
    credit_limit,
    -- Categorize account types for net worth calculation
    CASE 
      WHEN account_type IN ('checking', 'savings') THEN 'liquid_assets'
      WHEN account_type = 'investment' THEN 'investment_assets'
      WHEN account_type = 'credit' THEN 'credit_debt'
      WHEN account_type = 'loan' THEN 'loan_debt'
      ELSE 'other'
    END as balance_category,
    -- Calculate effective balance (positive for assets, negative for debts)
    CASE 
      WHEN account_type IN ('checking', 'savings', 'investment') THEN current_balance
      WHEN account_type IN ('credit', 'loan') THEN -ABS(current_balance)
      ELSE current_balance
    END as net_balance,
    last_synced_at,
    is_active
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.accounts`
  WHERE is_active = true
    AND current_balance IS NOT NULL
),

user_net_worth AS (
  SELECT 
    user_id,
    SUM(CASE WHEN balance_category = 'liquid_assets' THEN current_balance ELSE 0 END) as liquid_assets,
    SUM(CASE WHEN balance_category = 'investment_assets' THEN current_balance ELSE 0 END) as investment_assets,
    SUM(CASE WHEN balance_category = 'credit_debt' THEN ABS(current_balance) ELSE 0 END) as credit_debt,
    SUM(CASE WHEN balance_category = 'loan_debt' THEN ABS(current_balance) ELSE 0 END) as loan_debt,
    SUM(net_balance) as net_worth,
    SUM(CASE WHEN balance_category IN ('liquid_assets', 'investment_assets') THEN current_balance ELSE 0 END) as total_assets,
    SUM(CASE WHEN balance_category IN ('credit_debt', 'loan_debt') THEN ABS(current_balance) ELSE 0 END) as total_debt,
    COUNT(*) as total_accounts,
    COUNT(CASE WHEN balance_category = 'liquid_assets' THEN 1 END) as liquid_accounts,
    COUNT(CASE WHEN balance_category IN ('credit_debt', 'loan_debt') THEN 1 END) as debt_accounts
  FROM account_balances
  GROUP BY user_id
  HAVING SUM(ABS(current_balance)) > 100 -- Filter out test accounts
),

net_worth_distribution AS (
  SELECT 
    CASE 
      WHEN net_worth >= 100000 THEN '$100K+'
      WHEN net_worth >= 50000 THEN '$50K-$99K'
      WHEN net_worth >= 25000 THEN '$25K-$49K'
      WHEN net_worth >= 10000 THEN '$10K-$24K'
      WHEN net_worth >= 0 THEN '$0-$9K'
      WHEN net_worth >= -10000 THEN '-$10K to $0'
      WHEN net_worth >= -25000 THEN '-$25K to -$10K'
      ELSE 'Below -$25K'
    END as net_worth_bracket,
    COUNT(*) as user_count,
    AVG(net_worth) as avg_net_worth,
    AVG(total_assets) as avg_total_assets,
    AVG(total_debt) as avg_total_debt,
    AVG(liquid_assets) as avg_liquid_assets,
    AVG(credit_debt) as avg_credit_debt,
    AVG(SAFE_DIVIDE(total_debt, total_assets)) as avg_debt_to_asset_ratio,
    AVG(total_accounts) as avg_accounts_per_user
  FROM user_net_worth
  GROUP BY net_worth_bracket
)

SELECT 
  net_worth_bracket,
  user_count,
  SAFE_DIVIDE(user_count, SUM(user_count) OVER ()) * 100 as pct_of_users,
  ROUND(avg_net_worth, 2) as avg_net_worth,
  ROUND(avg_total_assets, 2) as avg_assets,
  ROUND(avg_total_debt, 2) as avg_debt,
  ROUND(avg_liquid_assets, 2) as avg_liquid_assets,
  ROUND(avg_credit_debt, 2) as avg_credit_debt,
  ROUND(avg_debt_to_asset_ratio * 100, 1) as avg_debt_to_asset_ratio_pct,
  ROUND(avg_accounts_per_user, 1) as avg_accounts
FROM net_worth_distribution
ORDER BY avg_net_worth DESC;

-- Goal Progress and Achievement Analysis
WITH goal_progress AS (
  SELECT 
    user_id,
    name as goal_name,
    goal_type,
    target_amount,
    current_amount,
    monthly_contribution,
    target_date,
    priority,
    status,
    progress_percentage,
    -- Calculate time metrics
    DATE_DIFF(target_date, CURRENT_DATE(), DAY) as days_remaining,
    DATE_DIFF(target_date, created_at, DAY) as total_goal_days,
    DATE_DIFF(CURRENT_DATE(), created_at, DAY) as days_since_creation,
    -- Calculate required monthly contribution to meet goal
    CASE 
      WHEN target_date > CURRENT_DATE() THEN
        SAFE_DIVIDE(
          target_amount - COALESCE(current_amount, 0),
          DATE_DIFF(target_date, CURRENT_DATE(), MONTH)
        )
      ELSE NULL
    END as required_monthly_contribution,
    -- Goal achievement likelihood
    CASE 
      WHEN status = 'completed' THEN 'Completed'
      WHEN target_date <= CURRENT_DATE() AND status != 'completed' THEN 'Past Due'
      WHEN progress_percentage >= 90 THEN 'On Track (≥90%)'
      WHEN progress_percentage >= 70 THEN 'Good Progress (70-89%)'
      WHEN progress_percentage >= 40 THEN 'Some Progress (40-69%)'
      WHEN progress_percentage >= 10 THEN 'Slow Start (10-39%)'
      ELSE 'Just Started (<10%)'
    END as progress_category
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_budget.goals`
  WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
),

goal_summary AS (
  SELECT 
    goal_type,
    progress_category,
    COUNT(*) as goal_count,
    COUNT(DISTINCT user_id) as unique_users,
    AVG(target_amount) as avg_target_amount,
    AVG(current_amount) as avg_current_amount,
    AVG(progress_percentage) as avg_progress_pct,
    AVG(monthly_contribution) as avg_monthly_contribution,
    AVG(required_monthly_contribution) as avg_required_contribution,
    AVG(days_remaining) as avg_days_remaining
  FROM goal_progress
  GROUP BY goal_type, progress_category
)

SELECT 
  goal_type,
  progress_category,
  goal_count,
  unique_users,
  ROUND(avg_target_amount, 2) as avg_target,
  ROUND(avg_current_amount, 2) as avg_current,
  ROUND(avg_progress_pct, 1) as avg_progress_percentage,
  ROUND(avg_monthly_contribution, 2) as avg_contribution,
  ROUND(avg_required_contribution, 2) as avg_required_contribution,
  ROUND(avg_days_remaining, 0) as avg_days_to_target,
  -- Success indicators
  SAFE_DIVIDE(goal_count, SUM(goal_count) OVER (PARTITION BY goal_type)) * 100 as pct_of_goal_type
FROM goal_summary
ORDER BY goal_type, avg_progress_pct DESC;