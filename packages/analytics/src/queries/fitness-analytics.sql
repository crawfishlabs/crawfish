-- Fitness Analytics Queries
-- Workout frequency, volume trends, PR progression, program adherence

-- Workout Frequency Analysis
WITH weekly_workouts AS (
  SELECT 
    user_id,
    DATE_TRUNC(DATE(completed_at), WEEK(MONDAY)) as week_start,
    COUNT(*) as workouts_per_week,
    SUM(duration_minutes) as total_minutes_per_week,
    SUM(total_volume) as total_volume_per_week,
    SUM(total_reps) as total_reps_per_week,
    COUNT(DISTINCT workout_type) as workout_types_per_week
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
  WHERE completed_at IS NOT NULL
    AND DATE(completed_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
  GROUP BY user_id, week_start
),

user_workout_stats AS (
  SELECT 
    user_id,
    AVG(workouts_per_week) as avg_workouts_per_week,
    STDDEV(workouts_per_week) as stddev_workouts_per_week,
    AVG(total_minutes_per_week) as avg_minutes_per_week,
    AVG(total_volume_per_week) as avg_volume_per_week,
    COUNT(*) as weeks_tracked
  FROM weekly_workouts
  GROUP BY user_id
  HAVING COUNT(*) >= 4 -- At least 4 weeks of data
)

SELECT 
  -- Frequency distribution
  CASE 
    WHEN avg_workouts_per_week >= 6 THEN '6+ workouts/week'
    WHEN avg_workouts_per_week >= 4 THEN '4-5 workouts/week'
    WHEN avg_workouts_per_week >= 2 THEN '2-3 workouts/week'
    WHEN avg_workouts_per_week >= 1 THEN '1 workout/week'
    ELSE '<1 workout/week'
  END as frequency_bucket,
  COUNT(user_id) as user_count,
  AVG(avg_workouts_per_week) as avg_frequency,
  AVG(avg_minutes_per_week) as avg_minutes,
  AVG(avg_volume_per_week) as avg_volume
FROM user_workout_stats
GROUP BY frequency_bucket
ORDER BY AVG(avg_workouts_per_week) DESC;

-- Volume and Intensity Trends
WITH daily_metrics AS (
  SELECT 
    DATE(completed_at) as workout_date,
    user_id,
    COUNT(*) as workouts_per_day,
    SUM(total_volume) as daily_volume,
    SUM(total_reps) as daily_reps,
    SUM(duration_minutes) as daily_minutes,
    AVG(CASE WHEN intensity = 'high' THEN 1 ELSE 0 END) as high_intensity_pct,
    COUNT(DISTINCT workout_type) as workout_variety
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
  WHERE completed_at IS NOT NULL
    AND DATE(completed_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  GROUP BY workout_date, user_id
),

weekly_trends AS (
  SELECT 
    DATE_TRUNC(workout_date, WEEK(MONDAY)) as week_start,
    AVG(workouts_per_day) as avg_workouts_per_day,
    AVG(daily_volume) as avg_daily_volume,
    AVG(daily_reps) as avg_daily_reps,
    AVG(daily_minutes) as avg_daily_minutes,
    AVG(high_intensity_pct) as avg_high_intensity_pct,
    AVG(workout_variety) as avg_workout_variety,
    COUNT(DISTINCT user_id) as active_users
  FROM daily_metrics
  GROUP BY week_start
)

SELECT 
  week_start,
  avg_workouts_per_day,
  avg_daily_volume,
  avg_daily_reps,
  avg_daily_minutes,
  avg_high_intensity_pct * 100 as high_intensity_percentage,
  avg_workout_variety,
  active_users,
  -- Week over week growth
  LAG(avg_daily_volume, 1) OVER (ORDER BY week_start) as prev_week_volume,
  SAFE_DIVIDE(
    avg_daily_volume - LAG(avg_daily_volume, 1) OVER (ORDER BY week_start),
    LAG(avg_daily_volume, 1) OVER (ORDER BY week_start)
  ) * 100 as volume_wow_growth_pct
FROM weekly_trends
ORDER BY week_start DESC;

-- Personal Records (PR) Progression
WITH exercise_maxes AS (
  SELECT 
    user_id,
    exercise_id,
    DATE(w.completed_at) as workout_date,
    MAX(s.weight_lbs) as max_weight,
    MAX(s.reps) as max_reps,
    MAX(s.weight_lbs * s.reps) as max_volume_per_set
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts` w
  JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.sets` s ON w.id = s.workout_id
  WHERE w.completed_at IS NOT NULL
    AND s.weight_lbs > 0
    AND s.reps > 0
    AND DATE(w.completed_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  GROUP BY user_id, exercise_id, workout_date
),

personal_records AS (
  SELECT 
    user_id,
    exercise_id,
    workout_date,
    max_weight,
    max_reps,
    max_volume_per_set,
    -- Track if this is a new PR
    CASE WHEN max_weight > LAG(max_weight) OVER (
      PARTITION BY user_id, exercise_id ORDER BY workout_date
    ) THEN 1 ELSE 0 END as weight_pr,
    CASE WHEN max_reps > LAG(max_reps) OVER (
      PARTITION BY user_id, exercise_id ORDER BY workout_date
    ) THEN 1 ELSE 0 END as reps_pr,
    CASE WHEN max_volume_per_set > LAG(max_volume_per_set) OVER (
      PARTITION BY user_id, exercise_id ORDER BY workout_date
    ) THEN 1 ELSE 0 END as volume_pr
  FROM exercise_maxes
),

pr_summary AS (
  SELECT 
    DATE_TRUNC(workout_date, MONTH) as month,
    COUNT(*) as total_workouts,
    SUM(weight_pr) as weight_prs,
    SUM(reps_pr) as reps_prs,
    SUM(volume_pr) as volume_prs,
    COUNT(DISTINCT user_id) as users_with_activity,
    COUNT(DISTINCT CASE WHEN weight_pr = 1 THEN user_id END) as users_with_weight_prs
  FROM personal_records
  GROUP BY month
)

SELECT 
  month,
  weight_prs,
  reps_prs,
  volume_prs,
  users_with_activity,
  users_with_weight_prs,
  SAFE_DIVIDE(weight_prs, total_workouts) * 100 as weight_pr_rate_pct,
  SAFE_DIVIDE(users_with_weight_prs, users_with_activity) * 100 as users_with_prs_pct
FROM pr_summary
ORDER BY month DESC;

-- Program Adherence Analysis
WITH program_workouts AS (
  SELECT 
    user_id,
    program_id,
    template_id,
    DATE(completed_at) as completion_date,
    ROW_NUMBER() OVER (PARTITION BY user_id, program_id ORDER BY completed_at) as workout_sequence,
    COUNT(*) OVER (PARTITION BY user_id, program_id) as total_program_workouts
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts`
  WHERE program_id IS NOT NULL
    AND completed_at IS NOT NULL
    AND DATE(completed_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
),

program_gaps AS (
  SELECT 
    user_id,
    program_id,
    completion_date,
    LAG(completion_date) OVER (
      PARTITION BY user_id, program_id ORDER BY completion_date
    ) as prev_completion_date,
    DATE_DIFF(
      completion_date, 
      LAG(completion_date) OVER (
        PARTITION BY user_id, program_id ORDER BY completion_date
      ), 
      DAY
    ) as days_between_workouts
  FROM program_workouts
),

adherence_metrics AS (
  SELECT 
    user_id,
    program_id,
    total_program_workouts,
    AVG(days_between_workouts) as avg_days_between_workouts,
    STDDEV(days_between_workouts) as stddev_days_between,
    MAX(days_between_workouts) as max_gap_days,
    COUNT(CASE WHEN days_between_workouts > 7 THEN 1 END) as gaps_over_week,
    COUNT(CASE WHEN days_between_workouts <= 3 THEN 1 END) as consistent_streaks
  FROM program_gaps
  WHERE days_between_workouts IS NOT NULL
  GROUP BY user_id, program_id, total_program_workouts
)

SELECT 
  -- Adherence buckets
  CASE 
    WHEN avg_days_between_workouts <= 2 THEN 'Excellent (≤2 days)'
    WHEN avg_days_between_workouts <= 4 THEN 'Good (2-4 days)'
    WHEN avg_days_between_workouts <= 7 THEN 'Fair (4-7 days)'
    ELSE 'Poor (>7 days)'
  END as adherence_level,
  COUNT(*) as user_programs,
  AVG(total_program_workouts) as avg_workouts_completed,
  AVG(avg_days_between_workouts) as avg_rest_days,
  AVG(gaps_over_week) as avg_weekly_gaps,
  AVG(SAFE_DIVIDE(consistent_streaks, total_program_workouts)) * 100 as consistency_rate_pct
FROM adherence_metrics
GROUP BY adherence_level
ORDER BY AVG(avg_days_between_workouts);

-- Exercise Popularity and Effectiveness
WITH exercise_stats AS (
  SELECT 
    e.name as exercise_name,
    e.category,
    e.muscle_groups,
    COUNT(DISTINCT s.user_id) as users_performed,
    COUNT(*) as total_sets,
    AVG(s.weight_lbs) as avg_weight,
    AVG(s.reps) as avg_reps,
    AVG(s.weight_lbs * s.reps) as avg_volume_per_set,
    STDDEV(s.weight_lbs) as weight_progression_stddev,
    COUNT(DISTINCT s.workout_id) as workouts_included
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.exercises` e
  JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.sets` s ON e.id = s.exercise_id
  JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_fitness.workouts` w ON s.workout_id = w.id
  WHERE w.completed_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND s.weight_lbs > 0
    AND s.reps > 0
  GROUP BY e.name, e.category, e.muscle_groups
  HAVING users_performed >= 5 -- Only exercises performed by 5+ users
)

SELECT 
  exercise_name,
  category,
  users_performed,
  total_sets,
  avg_weight,
  avg_reps,
  avg_volume_per_set,
  weight_progression_stddev,
  workouts_included,
  -- Popularity score (normalized)
  PERCENT_RANK() OVER (ORDER BY users_performed) * 100 as popularity_percentile,
  -- Progression potential (higher stddev indicates more progression)
  CASE 
    WHEN weight_progression_stddev > 50 THEN 'High Progression'
    WHEN weight_progression_stddev > 20 THEN 'Medium Progression'
    ELSE 'Low Progression'
  END as progression_category
FROM exercise_stats
ORDER BY users_performed DESC, avg_volume_per_set DESC;