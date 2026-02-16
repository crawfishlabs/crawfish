// Snowflake table schemas for Budget app

export const budgetSchemas = {
  transactions: `
    CREATE TABLE IF NOT EXISTS transactions (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      account_id VARCHAR(255) NOT NULL,
      category_id VARCHAR(255),
      budget_id VARCHAR(255),
      transaction_date DATE NOT NULL,
      posted_date DATE,
      amount NUMBER(12,2) NOT NULL, -- positive for income, negative for expenses
      original_amount NUMBER(12,2), -- before any splits
      currency VARCHAR(3),
      description VARCHAR(1000),
      merchant_name VARCHAR(255),
      transaction_type VARCHAR(20), -- debit, credit, transfer, fee
      payment_method VARCHAR(20), -- card, cash, check, online, auto_pay
      location VARCHAR(255),
      is_recurring BOOLEAN,
      recurring_frequency VARCHAR(20), -- weekly, monthly, quarterly, yearly
      is_split BOOLEAN,
      parent_transaction_id VARCHAR(255),
      tags VARIANT, -- JSON array of tags
      notes TEXT,
      receipt_url VARCHAR(1000),
      is_business_expense BOOLEAN,
      tax_deductible BOOLEAN,
      external_transaction_id VARCHAR(255), -- Bank/Plaid ID
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (budget_id) REFERENCES budgets(id)
    )
    CLUSTER BY (user_id, transaction_date, account_id)
    CHANGE_TRACKING = TRUE
    COMMENT = 'All financial transactions and associated metadata'
  `,

  budgets: `
    CREATE TABLE IF NOT EXISTS budgets (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      category_id VARCHAR(255),
      budget_type VARCHAR(30), -- monthly, yearly, weekly, project_based
      budget_amount NUMBER(12,2) NOT NULL,
      spent_amount NUMBER(12,2),
      remaining_amount NUMBER(12,2),
      period_start_date DATE NOT NULL,
      period_end_date DATE NOT NULL,
      rollover_unused BOOLEAN,
      alert_percentage NUMBER(5,2), -- alert when X% of budget is spent
      status VARCHAR(20), -- active, paused, completed, over_budget
      priority VARCHAR(10), -- low, medium, high
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
    CLUSTER BY (user_id, status, period_start_date)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Budget allocations and spending limits'
  `,

  categories: `
    CREATE TABLE IF NOT EXISTS categories (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      parent_category_id VARCHAR(255),
      category_type VARCHAR(20), -- income, expense, transfer
      icon VARCHAR(50),
      color VARCHAR(20),
      is_essential BOOLEAN,
      is_active BOOLEAN DEFAULT TRUE,
      sort_order NUMBER(38,0),
      keywords VARIANT, -- JSON array for auto-categorization
      merchant_patterns VARIANT, -- JSON array of regex patterns for auto-categorization
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (parent_category_id) REFERENCES categories(id)
    )
    CLUSTER BY (user_id, category_type, is_active)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Transaction categories and classification rules'
  `,

  accounts: `
    CREATE TABLE IF NOT EXISTS accounts (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      account_type VARCHAR(20), -- checking, savings, credit, investment, loan
      institution_name VARCHAR(255),
      account_number_masked VARCHAR(50),
      current_balance NUMBER(15,2),
      available_balance NUMBER(15,2),
      credit_limit NUMBER(15,2),
      interest_rate NUMBER(5,4),
      currency VARCHAR(3),
      is_active BOOLEAN DEFAULT TRUE,
      is_primary BOOLEAN DEFAULT FALSE,
      sync_enabled BOOLEAN DEFAULT TRUE,
      last_synced_at TIMESTAMP_TZ,
      external_account_id VARCHAR(255), -- Plaid account ID
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, account_type, is_active)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Financial accounts and bank connections'
  `,

  goals: `
    CREATE TABLE IF NOT EXISTS goals (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      goal_type VARCHAR(30), -- savings, debt_payoff, expense_reduction, income_increase
      target_amount NUMBER(15,2) NOT NULL,
      current_amount NUMBER(15,2),
      monthly_contribution NUMBER(12,2),
      target_date DATE,
      priority VARCHAR(10), -- low, medium, high
      status VARCHAR(20), -- active, paused, completed, cancelled
      progress_percentage NUMBER(5,2),
      related_account_id VARCHAR(255),
      related_category_id VARCHAR(255),
      automation_rule VARIANT, -- JSON object of automation settings
      celebration_milestone NUMBER(15,2),
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (related_account_id) REFERENCES accounts(id),
      FOREIGN KEY (related_category_id) REFERENCES categories(id)
    )
    CLUSTER BY (user_id, status, goal_type)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Financial goals and progress tracking'
  `,

  coaching_sessions: `
    CREATE TABLE IF NOT EXISTS coaching_sessions (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      coach_id VARCHAR(255),
      session_date TIMESTAMP_TZ NOT NULL,
      session_type VARCHAR(50), -- budget_review, goal_setting, debt_strategy, investment_advice
      duration_minutes NUMBER(38,0),
      topics_discussed VARIANT, -- JSON array of topics
      budget_adjustments VARIANT, -- JSON array of adjustments
      goal_updates VARIANT, -- JSON array of goal updates
      action_items VARIANT, -- JSON array of action items
      spending_insights VARIANT, -- JSON array of insights
      recommended_changes VARIANT, -- JSON array of recommendations
      financial_health_score NUMBER(5,2), -- 0-100
      debt_to_income_ratio NUMBER(5,4),
      savings_rate NUMBER(5,4),
      notes TEXT,
      satisfaction_score NUMBER(2,0), -- 1-10
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, DATE(session_date))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Financial coaching sessions and advice'
  `
};

export default budgetSchemas;