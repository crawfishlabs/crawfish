// Snowflake table schemas for Nutrition app

export const nutritionSchemas = {
  food_logs: `
    CREATE TABLE IF NOT EXISTS food_logs (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      meal_id VARCHAR(255),
      food_item_id VARCHAR(255) NOT NULL,
      log_date DATE NOT NULL,
      log_time TIME,
      meal_type VARCHAR(20), -- breakfast, lunch, dinner, snack
      quantity NUMBER(8,2) NOT NULL,
      unit VARCHAR(20) NOT NULL, -- grams, oz, cups, etc.
      calories NUMBER(8,2),
      protein_grams NUMBER(8,2),
      carbs_grams NUMBER(8,2),
      fat_grams NUMBER(8,2),
      fiber_grams NUMBER(8,2),
      sugar_grams NUMBER(8,2),
      sodium_mg NUMBER(8,2),
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, log_date)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Individual food intake logs'
  `,

  meals: `
    CREATE TABLE IF NOT EXISTS meals (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(500) NOT NULL,
      meal_type VARCHAR(20),
      recipe_id VARCHAR(255),
      meal_date DATE NOT NULL,
      meal_time TIME,
      total_calories NUMBER(8,2),
      total_protein_grams NUMBER(8,2),
      total_carbs_grams NUMBER(8,2),
      total_fat_grams NUMBER(8,2),
      satisfaction_score NUMBER(2,0), -- 1-10
      prep_time_minutes NUMBER(38,0),
      photo_url VARCHAR(1000),
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, meal_date)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Complete meals and their nutritional summaries'
  `,

  water_intake: `
    CREATE TABLE IF NOT EXISTS water_intake (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      log_date DATE NOT NULL,
      log_time TIME,
      amount_ml NUMBER(8,2) NOT NULL,
      beverage_type VARCHAR(50), -- water, tea, coffee, etc.
      temperature VARCHAR(20), -- cold, room_temp, hot
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, log_date)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Daily water and beverage intake tracking'
  `,

  daily_summaries: `
    CREATE TABLE IF NOT EXISTS daily_summaries (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      summary_date DATE NOT NULL,
      total_calories NUMBER(8,2),
      calories_goal NUMBER(8,2),
      total_protein_grams NUMBER(8,2),
      protein_goal_grams NUMBER(8,2),
      total_carbs_grams NUMBER(8,2),
      carbs_goal_grams NUMBER(8,2),
      total_fat_grams NUMBER(8,2),
      fat_goal_grams NUMBER(8,2),
      total_water_ml NUMBER(8,2),
      water_goal_ml NUMBER(8,2),
      meals_logged NUMBER(38,0),
      calories_adherence_percentage NUMBER(5,2),
      macro_adherence_score NUMBER(3,2), -- 0-1 score
      energy_level NUMBER(2,0), -- 1-10
      hunger_level NUMBER(2,0), -- 1-10
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      UNIQUE (user_id, summary_date)
    )
    CLUSTER BY (user_id, summary_date)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Daily nutrition summary and goal adherence tracking'
  `,

  coaching_sessions: `
    CREATE TABLE IF NOT EXISTS coaching_sessions (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      coach_id VARCHAR(255),
      session_date TIMESTAMP_TZ NOT NULL,
      session_type VARCHAR(50), -- meal_planning, macro_adjustment, habit_building
      duration_minutes NUMBER(38,0),
      topics_discussed VARIANT, -- JSON array of topics
      meal_plan_changes VARIANT, -- JSON array of changes
      macro_adjustments VARIANT, -- JSON object of changes
      action_items VARIANT, -- JSON array of action items
      notes TEXT,
      satisfaction_score NUMBER(2,0), -- 1-10
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, DATE(session_date))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Nutrition coaching sessions and meal planning'
  `
};

export default nutritionSchemas;