// Snowflake table schemas for Fitness app

export const fitnessSchemas = {
  workouts: `
    CREATE TABLE IF NOT EXISTS workouts (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(500),
      program_id VARCHAR(255),
      template_id VARCHAR(255),
      started_at TIMESTAMP_TZ,
      completed_at TIMESTAMP_TZ,
      duration_minutes NUMBER(38,0),
      total_volume NUMBER(10,2),
      total_reps NUMBER(38,0),
      notes TEXT,
      workout_type VARCHAR(50), -- strength, cardio, flexibility
      intensity VARCHAR(20), -- low, moderate, high
      location VARCHAR(100), -- gym, home, outdoor
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, DATE(created_at))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Fitness workout sessions and metadata'
  `,

  exercises: `
    CREATE TABLE IF NOT EXISTS exercises (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      name VARCHAR(500) NOT NULL,
      category VARCHAR(100), -- chest, back, legs, etc.
      muscle_groups VARIANT, -- JSON array of muscle groups
      equipment_needed VARIANT, -- JSON array of equipment
      difficulty_level VARCHAR(20), -- beginner, intermediate, advanced
      instructions TEXT,
      video_url VARCHAR(1000),
      image_url VARCHAR(1000),
      is_compound BOOLEAN,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (category, difficulty_level)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Exercise catalog and metadata'
  `,

  sets: `
    CREATE TABLE IF NOT EXISTS sets (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      workout_id VARCHAR(255) NOT NULL,
      exercise_id VARCHAR(255) NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      set_number NUMBER(38,0) NOT NULL,
      reps NUMBER(38,0),
      weight_lbs NUMBER(8,2),
      distance_miles NUMBER(8,2),
      duration_seconds NUMBER(38,0),
      rest_seconds NUMBER(38,0),
      rpe NUMBER(2,0), -- Rate of Perceived Exertion (1-10)
      is_warmup BOOLEAN,
      is_failure BOOLEAN,
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (workout_id) REFERENCES workouts(id),
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    )
    CLUSTER BY (user_id, workout_id, DATE(created_at))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Individual exercise sets within workouts'
  `,

  body_measurements: `
    CREATE TABLE IF NOT EXISTS body_measurements (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      measurement_date DATE NOT NULL,
      weight_lbs NUMBER(6,2),
      body_fat_percentage NUMBER(5,2),
      muscle_mass_lbs NUMBER(6,2),
      chest_inches NUMBER(5,2),
      waist_inches NUMBER(5,2),
      hips_inches NUMBER(5,2),
      bicep_inches NUMBER(5,2),
      thigh_inches NUMBER(5,2),
      neck_inches NUMBER(5,2),
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, measurement_date)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Body measurement tracking for progress monitoring'
  `,

  progress_photos: `
    CREATE TABLE IF NOT EXISTS progress_photos (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      photo_date DATE NOT NULL,
      photo_url VARCHAR(1000) NOT NULL,
      photo_type VARCHAR(20), -- front, back, side
      body_part VARCHAR(50), -- full_body, upper_body, etc.
      lighting_conditions VARCHAR(100),
      notes TEXT,
      is_public BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, photo_date)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Progress photos for visual tracking'
  `,

  coaching_sessions: `
    CREATE TABLE IF NOT EXISTS coaching_sessions (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      coach_id VARCHAR(255),
      session_date TIMESTAMP_TZ NOT NULL,
      session_type VARCHAR(50), -- program_review, form_check, goal_setting
      duration_minutes NUMBER(38,0),
      topics_discussed VARIANT, -- JSON array of topics
      action_items VARIANT, -- JSON array of action items
      notes TEXT,
      satisfaction_score NUMBER(2,0), -- 1-10
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, DATE(session_date))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Coaching sessions and feedback'
  `
};

export default fitnessSchemas;