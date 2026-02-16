-- LLM Cost by Task view - Cost per model per task per app
-- This view provides detailed cost analysis for LLM usage across all applications and use cases

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.llm_cost_by_task` AS

WITH usage_metrics AS (
  SELECT 
    DATE(created_at) as usage_date,
    DATE_TRUNC(DATE(created_at), WEEK(MONDAY)) as usage_week,
    DATE_TRUNC(DATE(created_at), MONTH) as usage_month,
    
    user_id,
    app_name,
    task_type,
    model_name,
    provider,
    context_type,
    
    -- Token and cost metrics
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cost_cents / 100.0 as cost_usd,
    
    -- Performance metrics
    latency_ms,
    success,
    error_message,
    
    -- Input/output size
    input_length,
    output_length,
    
    created_at
    
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_cross_app.llm_usage`
  WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
    AND total_tokens > 0 -- Filter out invalid entries
),

-- Daily cost aggregation by task
daily_task_costs AS (
  SELECT 
    usage_date,
    app_name,
    task_type,
    model_name,
    provider,
    context_type,
    
    -- Volume metrics
    COUNT(*) as total_requests,
    COUNT(CASE WHEN success THEN 1 END) as successful_requests,
    COUNT(DISTINCT user_id) as unique_users,
    
    -- Token usage
    SUM(prompt_tokens) as total_prompt_tokens,
    SUM(completion_tokens) as total_completion_tokens,
    SUM(total_tokens) as total_tokens,
    AVG(total_tokens) as avg_tokens_per_request,
    
    -- Cost analysis
    SUM(cost_usd) as total_cost_usd,
    AVG(cost_usd) as avg_cost_per_request,
    SAFE_DIVIDE(SUM(cost_usd), SUM(total_tokens)) * 1000 as cost_per_1k_tokens,
    
    -- Performance metrics
    AVG(latency_ms) as avg_latency_ms,
    APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)] as median_latency_ms,
    APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)] as p95_latency_ms,
    
    -- Quality metrics
    SAFE_DIVIDE(COUNT(CASE WHEN success THEN 1 END), COUNT(*)) * 100 as success_rate_pct,
    
    -- Input/output analysis
    AVG(input_length) as avg_input_length,
    AVG(output_length) as avg_output_length,
    
    -- Cost efficiency
    SAFE_DIVIDE(SUM(cost_usd), COUNT(DISTINCT user_id)) as cost_per_user,
    SAFE_DIVIDE(SUM(cost_usd), COUNT(CASE WHEN success THEN 1 END)) as cost_per_successful_request
    
  FROM usage_metrics
  GROUP BY 
    usage_date, 
    app_name, 
    task_type, 
    model_name, 
    provider, 
    context_type
),

-- Weekly trends
weekly_task_costs AS (
  SELECT 
    usage_week,
    app_name,
    task_type,
    
    SUM(total_cost_usd) as weekly_cost_usd,
    SUM(total_requests) as weekly_requests,
    SUM(unique_users) as weekly_unique_users,
    AVG(avg_cost_per_request) as avg_cost_per_request,
    AVG(success_rate_pct) as avg_success_rate
    
  FROM daily_task_costs
  GROUP BY usage_week, app_name, task_type
),

-- Monthly aggregation for trend analysis
monthly_task_costs AS (
  SELECT 
    usage_month,
    app_name,
    task_type,
    model_name,
    provider,
    
    SUM(total_cost_usd) as monthly_cost_usd,
    SUM(total_requests) as monthly_requests,
    SUM(total_tokens) as monthly_tokens,
    AVG(avg_cost_per_request) as avg_cost_per_request,
    AVG(cost_per_1k_tokens) as avg_cost_per_1k_tokens,
    AVG(success_rate_pct) as avg_success_rate,
    
    -- Month-over-month growth
    LAG(SUM(total_cost_usd), 1) OVER (
      PARTITION BY app_name, task_type, model_name, provider 
      ORDER BY usage_month
    ) as prev_month_cost,
    
    SAFE_DIVIDE(
      SUM(total_cost_usd) - LAG(SUM(total_cost_usd), 1) OVER (
        PARTITION BY app_name, task_type, model_name, provider 
        ORDER BY usage_month
      ),
      LAG(SUM(total_cost_usd), 1) OVER (
        PARTITION BY app_name, task_type, model_name, provider 
        ORDER BY usage_month
      )
    ) * 100 as mom_cost_growth_pct
    
  FROM daily_task_costs
  GROUP BY 
    usage_month, 
    app_name, 
    task_type, 
    model_name, 
    provider
),

-- Task efficiency rankings
task_efficiency AS (
  SELECT 
    app_name,
    task_type,
    
    SUM(total_cost_usd) as total_cost_last_30d,
    SUM(total_requests) as total_requests_last_30d,
    AVG(avg_cost_per_request) as avg_cost_per_request,
    AVG(success_rate_pct) as avg_success_rate,
    AVG(cost_per_1k_tokens) as avg_cost_per_1k_tokens,
    
    -- Efficiency score (lower is better: cost per successful request)
    SAFE_DIVIDE(SUM(total_cost_usd), SUM(successful_requests)) as efficiency_score,
    
    -- Rank by cost efficiency within each app
    ROW_NUMBER() OVER (
      PARTITION BY app_name 
      ORDER BY SAFE_DIVIDE(SUM(total_cost_usd), SUM(successful_requests))
    ) as efficiency_rank_in_app,
    
    -- Rank by total cost (highest first)
    ROW_NUMBER() OVER (
      PARTITION BY app_name 
      ORDER BY SUM(total_cost_usd) DESC
    ) as cost_rank_in_app
    
  FROM daily_task_costs
  WHERE usage_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY app_name, task_type
),

-- Model comparison for each task
model_comparison AS (
  SELECT 
    app_name,
    task_type,
    model_name,
    provider,
    
    SUM(total_cost_usd) as model_cost_last_30d,
    AVG(avg_cost_per_request) as model_avg_cost_per_request,
    AVG(cost_per_1k_tokens) as model_cost_per_1k_tokens,
    AVG(avg_latency_ms) as model_avg_latency,
    AVG(success_rate_pct) as model_success_rate,
    
    -- Compare to other models for same task
    AVG(AVG(cost_per_1k_tokens)) OVER (
      PARTITION BY app_name, task_type
    ) as avg_cost_per_1k_tokens_for_task,
    
    -- Cost competitiveness (how much cheaper/expensive vs average)
    SAFE_DIVIDE(
      AVG(cost_per_1k_tokens) - AVG(AVG(cost_per_1k_tokens)) OVER (
        PARTITION BY app_name, task_type
      ),
      AVG(AVG(cost_per_1k_tokens)) OVER (
        PARTITION BY app_name, task_type
      )
    ) * 100 as cost_vs_avg_pct
    
  FROM daily_task_costs
  WHERE usage_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY app_name, task_type, model_name, provider
)

-- Main query combining all cost analysis
SELECT 
  dtc.usage_date,
  dtc.app_name,
  dtc.task_type,
  dtc.model_name,
  dtc.provider,
  dtc.context_type,
  
  -- Core metrics
  dtc.total_requests,
  dtc.successful_requests,
  dtc.unique_users,
  dtc.total_cost_usd,
  dtc.total_tokens,
  dtc.total_prompt_tokens,
  dtc.total_completion_tokens,
  
  -- Efficiency metrics
  dtc.avg_cost_per_request,
  dtc.cost_per_1k_tokens,
  dtc.cost_per_user,
  dtc.cost_per_successful_request,
  
  -- Performance metrics
  dtc.avg_latency_ms,
  dtc.median_latency_ms,
  dtc.p95_latency_ms,
  dtc.success_rate_pct,
  
  -- Size metrics
  dtc.avg_tokens_per_request,
  dtc.avg_input_length,
  dtc.avg_output_length,
  
  -- Task efficiency rankings
  te.efficiency_score,
  te.efficiency_rank_in_app,
  te.cost_rank_in_app,
  te.total_cost_last_30d as task_cost_last_30d,
  
  -- Model comparison
  mc.model_cost_per_1k_tokens,
  mc.avg_cost_per_1k_tokens_for_task,
  mc.cost_vs_avg_pct as model_cost_vs_avg_pct,
  mc.model_avg_latency,
  mc.model_success_rate,
  
  -- Monthly trends (most recent month)
  mtc.monthly_cost_usd,
  mtc.mom_cost_growth_pct,
  
  -- Weekly context
  wtc.weekly_cost_usd,
  
  -- Calculated insights
  CASE 
    WHEN te.efficiency_rank_in_app <= 3 THEN 'high_efficiency'
    WHEN te.efficiency_rank_in_app <= 6 THEN 'medium_efficiency'  
    ELSE 'low_efficiency'
  END as efficiency_tier,
  
  CASE 
    WHEN mc.cost_vs_avg_pct <= -20 THEN 'cost_leader'
    WHEN mc.cost_vs_avg_pct <= 20 THEN 'cost_competitive'
    ELSE 'cost_premium'
  END as model_cost_tier,
  
  -- Anomaly detection
  CASE 
    WHEN dtc.total_cost_usd > AVG(dtc.total_cost_usd) OVER (
      PARTITION BY dtc.app_name, dtc.task_type 
      ORDER BY dtc.usage_date 
      ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING
    ) * 2 THEN true
    ELSE false
  END as cost_anomaly_detected,
  
  CURRENT_TIMESTAMP() as view_created_at

FROM daily_task_costs dtc
LEFT JOIN weekly_task_costs wtc ON dtc.usage_date BETWEEN wtc.usage_week 
  AND DATE_ADD(wtc.usage_week, INTERVAL 6 DAY)
  AND dtc.app_name = wtc.app_name 
  AND dtc.task_type = wtc.task_type
LEFT JOIN monthly_task_costs mtc ON DATE_TRUNC(dtc.usage_date, MONTH) = mtc.usage_month
  AND dtc.app_name = mtc.app_name
  AND dtc.task_type = mtc.task_type 
  AND dtc.model_name = mtc.model_name
  AND dtc.provider = mtc.provider
LEFT JOIN task_efficiency te ON dtc.app_name = te.app_name 
  AND dtc.task_type = te.task_type
LEFT JOIN model_comparison mc ON dtc.app_name = mc.app_name 
  AND dtc.task_type = mc.task_type
  AND dtc.model_name = mc.model_name
  AND dtc.provider = mc.provider

ORDER BY dtc.usage_date DESC, dtc.total_cost_usd DESC;