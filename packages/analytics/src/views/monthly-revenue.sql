-- Monthly Revenue view - Stripe data aggregated across all apps
-- This view provides comprehensive revenue analytics with cohort, churn, and growth metrics

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.monthly_revenue` AS

WITH subscription_periods AS (
  SELECT 
    id as subscription_id,
    user_id,
    stripe_subscription_id,
    plan_name,
    plan_price_monthly,
    billing_cycle,
    status,
    apps_included,
    
    -- Normalize to monthly pricing
    CASE 
      WHEN billing_cycle = 'yearly' THEN plan_price_monthly * 12
      ELSE plan_price_monthly 
    END as plan_price_normalized,
    
    current_period_start,
    current_period_end,
    trial_start_date,
    trial_end_date,
    cancelled_at,
    created_at,
    updated_at,
    
    -- Determine revenue recognition periods
    DATE_TRUNC(current_period_start, MONTH) as revenue_month,
    
    -- Customer lifecycle stage
    CASE 
      WHEN status = 'trial' THEN 'trial'
      WHEN status = 'active' AND current_period_start <= CURRENT_DATE() THEN 'active'
      WHEN status = 'past_due' THEN 'past_due'
      WHEN status IN ('cancelled', 'expired') THEN 'churned'
      ELSE 'other'
    END as lifecycle_stage
    
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.subscriptions`
  WHERE current_period_start IS NOT NULL
    AND current_period_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY) -- 2 years of data
),

-- Monthly recurring revenue by app
app_revenue AS (
  SELECT 
    sp.revenue_month,
    app,
    sp.plan_name,
    sp.billing_cycle,
    sp.lifecycle_stage,
    
    COUNT(DISTINCT sp.user_id) as subscribers,
    COUNT(DISTINCT sp.subscription_id) as subscriptions,
    
    -- Revenue calculations
    SUM(
      CASE 
        WHEN sp.billing_cycle = 'yearly' THEN sp.plan_price_monthly
        ELSE sp.plan_price_monthly 
      END
    ) as monthly_recurring_revenue,
    
    SUM(
      CASE 
        WHEN sp.billing_cycle = 'yearly' THEN sp.plan_price_monthly * 12
        ELSE sp.plan_price_monthly 
      END
    ) as annual_contract_value,
    
    AVG(
      CASE 
        WHEN sp.billing_cycle = 'yearly' THEN sp.plan_price_monthly
        ELSE sp.plan_price_monthly 
      END
    ) as arpu,
    
    -- New subscribers this month
    COUNT(DISTINCT CASE 
      WHEN DATE_TRUNC(sp.created_at, MONTH) = sp.revenue_month 
      THEN sp.user_id 
    END) as new_subscribers,
    
    -- Churned subscribers this month
    COUNT(DISTINCT CASE 
      WHEN DATE_TRUNC(sp.cancelled_at, MONTH) = sp.revenue_month 
      THEN sp.user_id 
    END) as churned_subscribers
    
  FROM subscription_periods sp,
  UNNEST(sp.apps_included) as app
  WHERE sp.lifecycle_stage IN ('trial', 'active', 'past_due')
  GROUP BY 
    sp.revenue_month, 
    app, 
    sp.plan_name, 
    sp.billing_cycle,
    sp.lifecycle_stage
),

-- Overall monthly metrics
monthly_totals AS (
  SELECT 
    revenue_month,
    SUM(monthly_recurring_revenue) as total_mrr,
    SUM(annual_contract_value) as total_acv,
    SUM(subscribers) as total_subscribers,
    SUM(new_subscribers) as total_new_subscribers,
    SUM(churned_subscribers) as total_churned_subscribers,
    AVG(arpu) as avg_arpu,
    COUNT(DISTINCT app) as apps_with_revenue
  FROM app_revenue
  GROUP BY revenue_month
),

-- Growth calculations
growth_metrics AS (
  SELECT 
    mt.*,
    
    -- MRR growth
    LAG(mt.total_mrr, 1) OVER (ORDER BY mt.revenue_month) as prev_month_mrr,
    mt.total_mrr - LAG(mt.total_mrr, 1) OVER (ORDER BY mt.revenue_month) as mrr_growth_absolute,
    
    SAFE_DIVIDE(
      mt.total_mrr - LAG(mt.total_mrr, 1) OVER (ORDER BY mt.revenue_month),
      LAG(mt.total_mrr, 1) OVER (ORDER BY mt.revenue_month)
    ) * 100 as mrr_growth_pct,
    
    -- Year-over-year growth
    LAG(mt.total_mrr, 12) OVER (ORDER BY mt.revenue_month) as same_month_last_year_mrr,
    
    SAFE_DIVIDE(
      mt.total_mrr - LAG(mt.total_mrr, 12) OVER (ORDER BY mt.revenue_month),
      LAG(mt.total_mrr, 12) OVER (ORDER BY mt.revenue_month)
    ) * 100 as yoy_growth_pct,
    
    -- Net subscriber change
    mt.total_new_subscribers - mt.total_churned_subscribers as net_new_subscribers,
    
    -- Churn rate
    LAG(mt.total_subscribers, 1) OVER (ORDER BY mt.revenue_month) as prev_month_subscribers,
    
    SAFE_DIVIDE(
      mt.total_churned_subscribers,
      LAG(mt.total_subscribers, 1) OVER (ORDER BY mt.revenue_month)
    ) * 100 as monthly_churn_rate,
    
    -- Customer lifetime value estimates
    SAFE_DIVIDE(mt.avg_arpu, 
      SAFE_DIVIDE(
        mt.total_churned_subscribers,
        LAG(mt.total_subscribers, 1) OVER (ORDER BY mt.revenue_month)
      )
    ) as estimated_ltv
    
  FROM monthly_totals mt
),

-- Plan mix analysis
plan_performance AS (
  SELECT 
    revenue_month,
    plan_name,
    SUM(monthly_recurring_revenue) as plan_mrr,
    SUM(subscribers) as plan_subscribers,
    AVG(arpu) as plan_arpu,
    
    -- Plan penetration
    SAFE_DIVIDE(
      SUM(subscribers),
      SUM(SUM(subscribers)) OVER (PARTITION BY revenue_month)
    ) * 100 as plan_penetration_pct
    
  FROM app_revenue
  GROUP BY revenue_month, plan_name
),

-- Geographic and cohort analysis (if data available)
cohort_revenue AS (
  SELECT 
    sp.revenue_month,
    DATE_TRUNC(u.created_at, MONTH) as signup_cohort,
    
    COUNT(DISTINCT sp.user_id) as cohort_subscribers,
    SUM(sp.plan_price_monthly) as cohort_mrr,
    
    -- Months since signup
    DATE_DIFF(sp.revenue_month, DATE_TRUNC(u.created_at, MONTH), MONTH) as months_since_signup
    
  FROM subscription_periods sp
  JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.users` u ON sp.user_id = u.id
  WHERE sp.lifecycle_stage IN ('trial', 'active', 'past_due')
  GROUP BY sp.revenue_month, signup_cohort
)

-- Main query combining all revenue metrics
SELECT 
  ar.revenue_month,
  ar.app,
  ar.plan_name,
  ar.billing_cycle,
  ar.lifecycle_stage,
  
  -- Core metrics
  ar.monthly_recurring_revenue,
  ar.annual_contract_value,
  ar.subscribers,
  ar.subscriptions,
  ar.arpu,
  ar.new_subscribers,
  ar.churned_subscribers,
  
  -- Growth metrics from totals
  gm.total_mrr,
  gm.total_acv,
  gm.total_subscribers,
  gm.mrr_growth_absolute,
  gm.mrr_growth_pct,
  gm.yoy_growth_pct,
  gm.net_new_subscribers,
  gm.monthly_churn_rate,
  gm.estimated_ltv,
  
  -- Plan performance
  pp.plan_mrr,
  pp.plan_penetration_pct,
  
  -- Calculated metrics
  SAFE_DIVIDE(ar.monthly_recurring_revenue, ar.subscribers) as app_arpu,
  
  -- App revenue share
  SAFE_DIVIDE(ar.monthly_recurring_revenue, gm.total_mrr) * 100 as app_revenue_share_pct,
  
  -- Subscriber share
  SAFE_DIVIDE(ar.subscribers, gm.total_subscribers) * 100 as app_subscriber_share_pct,
  
  -- Cohort insights (average months since signup for current subscribers)
  (
    SELECT AVG(cr.months_since_signup)
    FROM cohort_revenue cr
    WHERE cr.revenue_month = ar.revenue_month
  ) as avg_subscriber_tenure_months,
  
  -- Seasonal indicators
  EXTRACT(MONTH FROM ar.revenue_month) as month,
  EXTRACT(QUARTER FROM ar.revenue_month) as quarter,
  FORMAT_DATE('%B', ar.revenue_month) as month_name,
  
  CURRENT_TIMESTAMP() as view_created_at

FROM app_revenue ar
JOIN growth_metrics gm ON ar.revenue_month = gm.revenue_month
LEFT JOIN plan_performance pp ON ar.revenue_month = pp.revenue_month 
  AND ar.plan_name = pp.plan_name

ORDER BY ar.revenue_month DESC, ar.app, ar.plan_name;