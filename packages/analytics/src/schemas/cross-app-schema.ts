// BigQuery table schemas for Cross-App data

export const crossAppSchemas = {
  users: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'email', type: 'STRING', mode: 'REQUIRED' },
    { name: 'display_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'first_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'last_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'avatar_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'phone_number', type: 'STRING', mode: 'NULLABLE' },
    { name: 'timezone', type: 'STRING', mode: 'NULLABLE' },
    { name: 'locale', type: 'STRING', mode: 'NULLABLE' },
    { name: 'date_of_birth', type: 'DATE', mode: 'NULLABLE' },
    { name: 'gender', type: 'STRING', mode: 'NULLABLE' },
    { name: 'signup_source', type: 'STRING', mode: 'NULLABLE' }, // organic, referral, ad_campaign, etc.
    { name: 'referral_code', type: 'STRING', mode: 'NULLABLE' },
    { name: 'referred_by_user_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'apps_enabled', type: 'STRING', mode: 'REPEATED' }, // fitness, nutrition, meetings, budget
    { name: 'onboarding_completed_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'last_active_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'email_verified', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'phone_verified', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'account_status', type: 'STRING', mode: 'NULLABLE' }, // active, suspended, deactivated
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  subscriptions: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'stripe_subscription_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'stripe_customer_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'plan_name', type: 'STRING', mode: 'NULLABLE' }, // free, basic, pro, enterprise
    { name: 'plan_price_monthly', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'billing_cycle', type: 'STRING', mode: 'NULLABLE' }, // monthly, yearly
    { name: 'status', type: 'STRING', mode: 'NULLABLE' }, // trial, active, past_due, cancelled, expired
    { name: 'trial_start_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'trial_end_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'current_period_start', type: 'DATE', mode: 'NULLABLE' },
    { name: 'current_period_end', type: 'DATE', mode: 'NULLABLE' },
    { name: 'cancel_at_period_end', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'cancelled_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'cancellation_reason', type: 'STRING', mode: 'NULLABLE' },
    { name: 'apps_included', type: 'STRING', mode: 'REPEATED' },
    { name: 'feature_limits', type: 'STRING', mode: 'NULLABLE' }, // JSON string of limits
    { name: 'payment_method_type', type: 'STRING', mode: 'NULLABLE' }, // card, bank_transfer, paypal
    { name: 'discount_applied', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'coupon_code', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  llm_usage: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'app_name', type: 'STRING', mode: 'REQUIRED' }, // fitness, nutrition, meetings, budget
    { name: 'task_type', type: 'STRING', mode: 'REQUIRED' }, // workout_generation, meal_planning, transcript_analysis, etc.
    { name: 'model_name', type: 'STRING', mode: 'REQUIRED' }, // claude-3-sonnet, gpt-4, etc.
    { name: 'provider', type: 'STRING', mode: 'REQUIRED' }, // anthropic, openai, google
    { name: 'prompt_tokens', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'completion_tokens', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'total_tokens', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'cost_cents', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'latency_ms', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'success', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'error_message', type: 'STRING', mode: 'NULLABLE' },
    { name: 'request_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'prompt_hash', type: 'STRING', mode: 'NULLABLE' }, // for deduplication analysis
    { name: 'context_type', type: 'STRING', mode: 'NULLABLE' }, // coaching, analysis, generation, conversation
    { name: 'input_length', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'output_length', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  feature_usage: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'app_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'feature_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'action', type: 'STRING', mode: 'REQUIRED' }, // view, create, edit, delete, export, etc.
    { name: 'session_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'entity_type', type: 'STRING', mode: 'NULLABLE' }, // workout, meal, meeting, transaction, etc.
    { name: 'entity_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'metadata', type: 'STRING', mode: 'NULLABLE' }, // JSON string of additional context
    { name: 'duration_seconds', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'success', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'error_message', type: 'STRING', mode: 'NULLABLE' },
    { name: 'user_agent', type: 'STRING', mode: 'NULLABLE' },
    { name: 'ip_address', type: 'STRING', mode: 'NULLABLE' },
    { name: 'platform', type: 'STRING', mode: 'NULLABLE' }, // web, ios, android
    { name: 'version', type: 'STRING', mode: 'NULLABLE' }, // app version
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  errors: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'app_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'error_type', type: 'STRING', mode: 'REQUIRED' }, // client_error, server_error, validation_error
    { name: 'error_code', type: 'STRING', mode: 'NULLABLE' },
    { name: 'error_message', type: 'STRING', mode: 'NULLABLE' },
    { name: 'stack_trace', type: 'STRING', mode: 'NULLABLE' },
    { name: 'request_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'http_method', type: 'STRING', mode: 'NULLABLE' },
    { name: 'http_status_code', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'user_agent', type: 'STRING', mode: 'NULLABLE' },
    { name: 'ip_address', type: 'STRING', mode: 'NULLABLE' },
    { name: 'platform', type: 'STRING', mode: 'NULLABLE' },
    { name: 'version', type: 'STRING', mode: 'NULLABLE' },
    { name: 'environment', type: 'STRING', mode: 'NULLABLE' }, // production, staging, development
    { name: 'severity', type: 'STRING', mode: 'NULLABLE' }, // low, medium, high, critical
    { name: 'resolved', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'resolved_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  funnel_events: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'anonymous_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'app_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'event_name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'funnel_stage', type: 'STRING', mode: 'NULLABLE' }, // awareness, interest, consideration, purchase, retention
    { name: 'page_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'referrer_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'utm_source', type: 'STRING', mode: 'NULLABLE' },
    { name: 'utm_medium', type: 'STRING', mode: 'NULLABLE' },
    { name: 'utm_campaign', type: 'STRING', mode: 'NULLABLE' },
    { name: 'utm_term', type: 'STRING', mode: 'NULLABLE' },
    { name: 'utm_content', type: 'STRING', mode: 'NULLABLE' },
    { name: 'event_properties', type: 'STRING', mode: 'NULLABLE' }, // JSON string
    { name: 'user_agent', type: 'STRING', mode: 'NULLABLE' },
    { name: 'ip_address', type: 'STRING', mode: 'NULLABLE' },
    { name: 'country', type: 'STRING', mode: 'NULLABLE' },
    { name: 'region', type: 'STRING', mode: 'NULLABLE' },
    { name: 'city', type: 'STRING', mode: 'NULLABLE' },
    { name: 'platform', type: 'STRING', mode: 'NULLABLE' },
    { name: 'device_type', type: 'STRING', mode: 'NULLABLE' }, // desktop, mobile, tablet
    { name: 'browser', type: 'STRING', mode: 'NULLABLE' },
    { name: 'os', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ]
};

export default crossAppSchemas;