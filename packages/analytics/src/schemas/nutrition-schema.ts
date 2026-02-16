// BigQuery table schemas for Nutrition app

export const nutritionSchemas = {
  food_logs: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'meal_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'food_item_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'log_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'log_time', type: 'TIME', mode: 'NULLABLE' },
    { name: 'meal_type', type: 'STRING', mode: 'NULLABLE' }, // breakfast, lunch, dinner, snack
    { name: 'quantity', type: 'FLOAT', mode: 'REQUIRED' },
    { name: 'unit', type: 'STRING', mode: 'REQUIRED' }, // grams, oz, cups, etc.
    { name: 'calories', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'protein_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'carbs_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'fat_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'fiber_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'sugar_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'sodium_mg', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  meals: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'meal_type', type: 'STRING', mode: 'NULLABLE' },
    { name: 'recipe_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'meal_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'meal_time', type: 'TIME', mode: 'NULLABLE' },
    { name: 'total_calories', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'total_protein_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'total_carbs_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'total_fat_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'satisfaction_score', type: 'INTEGER', mode: 'NULLABLE' }, // 1-10
    { name: 'prep_time_minutes', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'photo_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  water_intake: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'log_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'log_time', type: 'TIME', mode: 'NULLABLE' },
    { name: 'amount_ml', type: 'FLOAT', mode: 'REQUIRED' },
    { name: 'beverage_type', type: 'STRING', mode: 'NULLABLE' }, // water, tea, coffee, etc.
    { name: 'temperature', type: 'STRING', mode: 'NULLABLE' }, // cold, room_temp, hot
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  daily_summaries: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'summary_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'total_calories', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'calories_goal', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'total_protein_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'protein_goal_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'total_carbs_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'carbs_goal_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'total_fat_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'fat_goal_grams', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'total_water_ml', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'water_goal_ml', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'meals_logged', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'calories_adherence_percentage', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'macro_adherence_score', type: 'FLOAT', mode: 'NULLABLE' }, // 0-1 score
    { name: 'energy_level', type: 'INTEGER', mode: 'NULLABLE' }, // 1-10
    { name: 'hunger_level', type: 'INTEGER', mode: 'NULLABLE' }, // 1-10
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  coaching_sessions: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'coach_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_date', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'session_type', type: 'STRING', mode: 'NULLABLE' }, // meal_planning, macro_adjustment, habit_building
    { name: 'duration_minutes', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'topics_discussed', type: 'STRING', mode: 'REPEATED' },
    { name: 'meal_plan_changes', type: 'STRING', mode: 'REPEATED' },
    { name: 'macro_adjustments', type: 'STRING', mode: 'NULLABLE' }, // JSON string of changes
    { name: 'action_items', type: 'STRING', mode: 'REPEATED' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'satisfaction_score', type: 'INTEGER', mode: 'NULLABLE' }, // 1-10
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ]
};

export default nutritionSchemas;