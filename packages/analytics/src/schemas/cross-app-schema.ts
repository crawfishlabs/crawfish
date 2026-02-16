// Snowflake table schemas for Cross-App data

export const crossAppSchemas = {
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      display_name VARCHAR(255),
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      avatar_url VARCHAR(1000),
      phone_number VARCHAR(50),
      timezone VARCHAR(50),
      locale VARCHAR(10),
      date_of_birth DATE,
      gender VARCHAR(20),
      signup_source VARCHAR(50), -- organic, referral, ad_campaign, etc.
      referral_code VARCHAR(50),
      referred_by_user_id VARCHAR(255),
      apps_enabled VARIANT, -- JSON array: fitness, nutrition, meetings, budget
      onboarding_completed_at TIMESTAMP_TZ,
      last_active_at TIMESTAMP_TZ,
      email_verified BOOLEAN DEFAULT FALSE,
      phone_verified BOOLEAN DEFAULT FALSE,
      account_status VARCHAR(20) DEFAULT 'active', -- active, suspended, deactivated
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (referred_by_user_id) REFERENCES users(id)
    )
    CLUSTER BY (account_status, DATE(created_at))
    CHANGE_TRACKING = TRUE
    COMMENT = 'User profiles and account information across all apps'
  `,

  subscriptions: `
    CREATE TABLE IF NOT EXISTS subscriptions (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      stripe_subscription_id VARCHAR(255) UNIQUE,
      stripe_customer_id VARCHAR(255),
      plan_name VARCHAR(50), -- free, basic, pro, enterprise
      plan_price_monthly NUMBER(8,2),
      billing_cycle VARCHAR(20), -- monthly, yearly
      status VARCHAR(20), -- trial, active, past_due, cancelled, expired
      trial_start_date DATE,
      trial_end_date DATE,
      current_period_start DATE,
      current_period_end DATE,
      cancel_at_period_end BOOLEAN DEFAULT FALSE,
      cancelled_at TIMESTAMP_TZ,
      cancellation_reason VARCHAR(255),
      apps_included VARIANT, -- JSON array of included apps
      feature_limits VARIANT, -- JSON object of feature limits
      payment_method_type VARCHAR(30), -- card, bank_transfer, paypal
      discount_applied NUMBER(5,2),
      coupon_code VARCHAR(50),
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
    CLUSTER BY (status, plan_name, DATE(current_period_end))
    CHANGE_TRACKING = TRUE
    COMMENT = 'User subscription and billing information'
  `,

  llm_usage: `
    CREATE TABLE IF NOT EXISTS llm_usage (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      app_name VARCHAR(20) NOT NULL, -- fitness, nutrition, meetings, budget
      task_type VARCHAR(50) NOT NULL, -- workout_generation, meal_planning, transcript_analysis, etc.
      model_name VARCHAR(50) NOT NULL, -- claude-3-sonnet, gpt-4, etc.
      provider VARCHAR(20) NOT NULL, -- anthropic, openai, google
      prompt_tokens NUMBER(38,0),
      completion_tokens NUMBER(38,0),
      total_tokens NUMBER(38,0),
      cost_cents NUMBER(8,2),
      latency_ms NUMBER(38,0),
      success BOOLEAN,
      error_message TEXT,
      request_id VARCHAR(255),
      session_id VARCHAR(255),
      prompt_hash VARCHAR(64), -- for deduplication analysis
      context_type VARCHAR(30), -- coaching, analysis, generation, conversation
      input_length NUMBER(38,0),
      output_length NUMBER(38,0),
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
    CLUSTER BY (app_name, DATE(created_at), user_id)
    CHANGE_TRACKING = TRUE
    COMMENT = 'LLM API usage tracking and cost monitoring'
  `,

  feature_usage: `
    CREATE TABLE IF NOT EXISTS feature_usage (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      app_name VARCHAR(20) NOT NULL,
      feature_name VARCHAR(100) NOT NULL,
      action VARCHAR(50) NOT NULL, -- view, create, edit, delete, export, etc.
      session_id VARCHAR(255),
      entity_type VARCHAR(50), -- workout, meal, meeting, transaction, etc.
      entity_id VARCHAR(255),
      metadata VARIANT, -- JSON object of additional context
      duration_seconds NUMBER(38,0),
      success BOOLEAN,
      error_message TEXT,
      user_agent TEXT,
      ip_address VARCHAR(45),
      platform VARCHAR(20), -- web, ios, android
      version VARCHAR(20), -- app version
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
    CLUSTER BY (app_name, DATE(created_at), user_id)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Feature usage tracking and user behavior analytics'
  `,

  errors: `
    CREATE TABLE IF NOT EXISTS errors (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255),
      app_name VARCHAR(20) NOT NULL,
      error_type VARCHAR(30) NOT NULL, -- client_error, server_error, validation_error
      error_code VARCHAR(50),
      error_message TEXT,
      stack_trace TEXT,
      request_id VARCHAR(255),
      session_id VARCHAR(255),
      url VARCHAR(2000),
      http_method VARCHAR(10),
      http_status_code NUMBER(3,0),
      user_agent TEXT,
      ip_address VARCHAR(45),
      platform VARCHAR(20),
      version VARCHAR(20),
      environment VARCHAR(20), -- production, staging, development
      severity VARCHAR(20), -- low, medium, high, critical
      resolved BOOLEAN DEFAULT FALSE,
      resolved_at TIMESTAMP_TZ,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
    CLUSTER BY (app_name, severity, DATE(created_at))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Application error tracking and monitoring'
  `,

  funnel_events: `
    CREATE TABLE IF NOT EXISTS funnel_events (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255),
      session_id VARCHAR(255) NOT NULL,
      anonymous_id VARCHAR(255),
      app_name VARCHAR(20) NOT NULL,
      event_name VARCHAR(100) NOT NULL,
      funnel_stage VARCHAR(30), -- awareness, interest, consideration, purchase, retention
      page_url VARCHAR(2000),
      referrer_url VARCHAR(2000),
      utm_source VARCHAR(100),
      utm_medium VARCHAR(100),
      utm_campaign VARCHAR(100),
      utm_term VARCHAR(100),
      utm_content VARCHAR(100),
      event_properties VARIANT, -- JSON object
      user_agent TEXT,
      ip_address VARCHAR(45),
      country VARCHAR(100),
      region VARCHAR(100),
      city VARCHAR(100),
      platform VARCHAR(20),
      device_type VARCHAR(20), -- desktop, mobile, tablet
      browser VARCHAR(50),
      os VARCHAR(50),
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
    CLUSTER BY (app_name, DATE(created_at), funnel_stage)
    CHANGE_TRACKING = TRUE
    COMMENT = 'User funnel events and conversion tracking'
  `
};

export default crossAppSchemas;