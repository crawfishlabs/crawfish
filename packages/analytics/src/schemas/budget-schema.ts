// BigQuery table schemas for Budget app

export const budgetSchemas = {
  transactions: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'account_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'category_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'budget_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'transaction_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'posted_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'amount', type: 'FLOAT', mode: 'REQUIRED' }, // positive for income, negative for expenses
    { name: 'original_amount', type: 'FLOAT', mode: 'NULLABLE' }, // before any splits
    { name: 'currency', type: 'STRING', mode: 'NULLABLE' },
    { name: 'description', type: 'STRING', mode: 'NULLABLE' },
    { name: 'merchant_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'transaction_type', type: 'STRING', mode: 'NULLABLE' }, // debit, credit, transfer, fee
    { name: 'payment_method', type: 'STRING', mode: 'NULLABLE' }, // card, cash, check, online, auto_pay
    { name: 'location', type: 'STRING', mode: 'NULLABLE' },
    { name: 'is_recurring', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'recurring_frequency', type: 'STRING', mode: 'NULLABLE' }, // weekly, monthly, quarterly, yearly
    { name: 'is_split', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'parent_transaction_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'receipt_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'is_business_expense', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'tax_deductible', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'external_transaction_id', type: 'STRING', mode: 'NULLABLE' }, // Bank/Plaid ID
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  budgets: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'category_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'budget_type', type: 'STRING', mode: 'NULLABLE' }, // monthly, yearly, weekly, project_based
    { name: 'budget_amount', type: 'FLOAT', mode: 'REQUIRED' },
    { name: 'spent_amount', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'remaining_amount', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'period_start_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'period_end_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'rollover_unused', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'alert_percentage', type: 'FLOAT', mode: 'NULLABLE' }, // alert when X% of budget is spent
    { name: 'status', type: 'STRING', mode: 'NULLABLE' }, // active, paused, completed, over_budget
    { name: 'priority', type: 'STRING', mode: 'NULLABLE' }, // low, medium, high
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  categories: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'parent_category_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'category_type', type: 'STRING', mode: 'NULLABLE' }, // income, expense, transfer
    { name: 'icon', type: 'STRING', mode: 'NULLABLE' },
    { name: 'color', type: 'STRING', mode: 'NULLABLE' },
    { name: 'is_essential', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'is_active', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'sort_order', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'keywords', type: 'STRING', mode: 'REPEATED' }, // for auto-categorization
    { name: 'merchant_patterns', type: 'STRING', mode: 'REPEATED' }, // regex patterns for auto-categorization
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  accounts: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'account_type', type: 'STRING', mode: 'NULLABLE' }, // checking, savings, credit, investment, loan
    { name: 'institution_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'account_number_masked', type: 'STRING', mode: 'NULLABLE' },
    { name: 'current_balance', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'available_balance', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'credit_limit', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'interest_rate', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'currency', type: 'STRING', mode: 'NULLABLE' },
    { name: 'is_active', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'is_primary', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'sync_enabled', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'last_synced_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'external_account_id', type: 'STRING', mode: 'NULLABLE' }, // Plaid account ID
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  goals: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'description', type: 'STRING', mode: 'NULLABLE' },
    { name: 'goal_type', type: 'STRING', mode: 'NULLABLE' }, // savings, debt_payoff, expense_reduction, income_increase
    { name: 'target_amount', type: 'FLOAT', mode: 'REQUIRED' },
    { name: 'current_amount', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'monthly_contribution', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'target_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'priority', type: 'STRING', mode: 'NULLABLE' }, // low, medium, high
    { name: 'status', type: 'STRING', mode: 'NULLABLE' }, // active, paused, completed, cancelled
    { name: 'progress_percentage', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'related_account_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'related_category_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'automation_rule', type: 'STRING', mode: 'NULLABLE' }, // JSON string of automation settings
    { name: 'celebration_milestone', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  coaching_sessions: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'coach_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_date', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'session_type', type: 'STRING', mode: 'NULLABLE' }, // budget_review, goal_setting, debt_strategy, investment_advice
    { name: 'duration_minutes', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'topics_discussed', type: 'STRING', mode: 'REPEATED' },
    { name: 'budget_adjustments', type: 'STRING', mode: 'REPEATED' },
    { name: 'goal_updates', type: 'STRING', mode: 'REPEATED' },
    { name: 'action_items', type: 'STRING', mode: 'REPEATED' },
    { name: 'spending_insights', type: 'STRING', mode: 'REPEATED' },
    { name: 'recommended_changes', type: 'STRING', mode: 'REPEATED' },
    { name: 'financial_health_score', type: 'FLOAT', mode: 'NULLABLE' }, // 0-100
    { name: 'debt_to_income_ratio', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'savings_rate', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'satisfaction_score', type: 'INTEGER', mode: 'NULLABLE' }, // 1-10
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ]
};

export default budgetSchemas;