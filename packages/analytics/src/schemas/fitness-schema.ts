// BigQuery table schemas for Fitness app

export const fitnessSchemas = {
  workouts: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'program_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'template_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'started_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'completed_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'duration_minutes', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'total_volume', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'total_reps', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'workout_type', type: 'STRING', mode: 'NULLABLE' }, // strength, cardio, flexibility
    { name: 'intensity', type: 'STRING', mode: 'NULLABLE' }, // low, moderate, high
    { name: 'location', type: 'STRING', mode: 'NULLABLE' }, // gym, home, outdoor
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  exercises: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'category', type: 'STRING', mode: 'NULLABLE' }, // chest, back, legs, etc.
    { name: 'muscle_groups', type: 'STRING', mode: 'REPEATED' },
    { name: 'equipment_needed', type: 'STRING', mode: 'REPEATED' },
    { name: 'difficulty_level', type: 'STRING', mode: 'NULLABLE' }, // beginner, intermediate, advanced
    { name: 'instructions', type: 'STRING', mode: 'NULLABLE' },
    { name: 'video_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'image_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'is_compound', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  sets: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'workout_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'exercise_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'set_number', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'reps', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'weight_lbs', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'distance_miles', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'duration_seconds', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'rest_seconds', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'rpe', type: 'INTEGER', mode: 'NULLABLE' }, // Rate of Perceived Exertion (1-10)
    { name: 'is_warmup', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'is_failure', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  body_measurements: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'measurement_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'weight_lbs', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'body_fat_percentage', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'muscle_mass_lbs', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'chest_inches', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'waist_inches', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'hips_inches', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'bicep_inches', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'thigh_inches', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'neck_inches', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  progress_photos: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'photo_date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'photo_url', type: 'STRING', mode: 'REQUIRED' },
    { name: 'photo_type', type: 'STRING', mode: 'NULLABLE' }, // front, back, side
    { name: 'body_part', type: 'STRING', mode: 'NULLABLE' }, // full_body, upper_body, etc.
    { name: 'lighting_conditions', type: 'STRING', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'is_public', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  coaching_sessions: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'coach_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_date', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'session_type', type: 'STRING', mode: 'NULLABLE' }, // program_review, form_check, goal_setting
    { name: 'duration_minutes', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'topics_discussed', type: 'STRING', mode: 'REPEATED' },
    { name: 'action_items', type: 'STRING', mode: 'REPEATED' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'satisfaction_score', type: 'INTEGER', mode: 'NULLABLE' }, // 1-10
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ]
};

export default fitnessSchemas;