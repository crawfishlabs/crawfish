-- Meetings Analytics Queries  
-- Meeting hours, leadership score trends, action item completion rates, speaking ratio trends

-- Meeting Volume and Time Analysis
WITH meeting_metrics AS (
  SELECT 
    user_id,
    DATE(actual_start_time) as meeting_date,
    meeting_type,
    duration_minutes,
    COUNT(*) OVER (PARTITION BY user_id, DATE(actual_start_time)) as meetings_per_day,
    SUM(duration_minutes) OVER (PARTITION BY user_id, DATE(actual_start_time)) as total_minutes_per_day
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
  WHERE actual_start_time IS NOT NULL
    AND actual_end_time IS NOT NULL
    AND duration_minutes > 0
    AND DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
),

weekly_meeting_stats AS (
  SELECT 
    DATE_TRUNC(meeting_date, WEEK(MONDAY)) as week_start,
    user_id,
    meeting_type,
    COUNT(*) as weekly_meetings,
    SUM(duration_minutes) as weekly_minutes,
    AVG(duration_minutes) as avg_meeting_duration,
    COUNT(DISTINCT meeting_date) as meeting_days_per_week
  FROM meeting_metrics
  GROUP BY week_start, user_id, meeting_type
),

overall_weekly_stats AS (
  SELECT 
    week_start,
    COUNT(DISTINCT user_id) as active_users,
    SUM(weekly_meetings) as total_meetings,
    SUM(weekly_minutes) as total_minutes,
    AVG(weekly_meetings) as avg_meetings_per_user,
    AVG(weekly_minutes) as avg_minutes_per_user,
    AVG(avg_meeting_duration) as avg_meeting_duration,
    AVG(meeting_days_per_week) as avg_meeting_days_per_week
  FROM weekly_meeting_stats
  GROUP BY week_start
)

SELECT 
  week_start,
  active_users,
  total_meetings,
  ROUND(total_minutes / 60, 1) as total_hours,
  avg_meetings_per_user,
  ROUND(avg_minutes_per_user / 60, 1) as avg_hours_per_user,
  ROUND(avg_meeting_duration, 1) as avg_duration_minutes,
  avg_meeting_days_per_week,
  -- Week over week growth
  LAG(total_meetings, 1) OVER (ORDER BY week_start) as prev_week_meetings,
  SAFE_DIVIDE(
    total_meetings - LAG(total_meetings, 1) OVER (ORDER BY week_start),
    LAG(total_meetings, 1) OVER (ORDER BY week_start)
  ) * 100 as meetings_wow_growth_pct
FROM overall_weekly_stats
ORDER BY week_start DESC;

-- Meeting Type Distribution and Trends
WITH meeting_type_analysis AS (
  SELECT 
    DATE_TRUNC(DATE(actual_start_time), MONTH) as month,
    meeting_type,
    COUNT(*) as meeting_count,
    AVG(duration_minutes) as avg_duration,
    COUNT(DISTINCT user_id) as unique_organizers,
    SUM(duration_minutes) as total_minutes
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings`
  WHERE actual_start_time IS NOT NULL
    AND DATE(actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
    AND meeting_type IS NOT NULL
  GROUP BY month, meeting_type
)

SELECT 
  month,
  meeting_type,
  meeting_count,
  ROUND(avg_duration, 1) as avg_duration_minutes,
  unique_organizers,
  ROUND(total_minutes / 60, 1) as total_hours,
  SAFE_DIVIDE(meeting_count, SUM(meeting_count) OVER (PARTITION BY month)) * 100 as pct_of_monthly_meetings,
  SAFE_DIVIDE(total_minutes, SUM(total_minutes) OVER (PARTITION BY month)) * 100 as pct_of_monthly_time
FROM meeting_type_analysis
ORDER BY month DESC, meeting_count DESC;

-- Leadership Scores and Speaking Patterns
WITH leadership_trends AS (
  SELECT 
    DATE_TRUNC(DATE(m.actual_start_time), WEEK(MONDAY)) as week_start,
    ls.participant_id as user_id,
    COUNT(*) as meetings_participated,
    AVG(ls.speaking_percentage) as avg_speaking_pct,
    AVG(ls.leadership_score) as avg_leadership_score,
    AVG(ls.engagement_score) as avg_engagement_score,
    AVG(ls.sentiment_score) as avg_sentiment_score,
    SUM(ls.questions_asked) as total_questions_asked,
    SUM(ls.questions_answered) as total_questions_answered,
    SUM(ls.action_items_assigned) as total_action_items_assigned,
    SUM(ls.interruptions_made) as total_interruptions_made,
    SUM(ls.interruptions_received) as total_interruptions_received
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings` m
  JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.leadership_scores` ls ON m.id = ls.meeting_id
  WHERE DATE(m.actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND m.actual_start_time IS NOT NULL
  GROUP BY week_start, ls.participant_id
  HAVING COUNT(*) >= 2 -- At least 2 meetings per week for meaningful analysis
),

leadership_distribution AS (
  SELECT 
    week_start,
    COUNT(*) as active_participants,
    AVG(avg_speaking_pct) as overall_avg_speaking_pct,
    AVG(avg_leadership_score) as overall_avg_leadership_score,
    AVG(avg_engagement_score) as overall_avg_engagement_score,
    AVG(avg_sentiment_score) as overall_avg_sentiment_score,
    -- Speaking distribution
    COUNT(CASE WHEN avg_speaking_pct >= 40 THEN user_id END) as dominant_speakers,
    COUNT(CASE WHEN avg_speaking_pct <= 15 THEN user_id END) as quiet_participants,
    COUNT(CASE WHEN avg_speaking_pct BETWEEN 20 AND 35 THEN user_id END) as balanced_speakers,
    -- Leadership categories
    COUNT(CASE WHEN avg_leadership_score >= 7 THEN user_id END) as high_leadership,
    COUNT(CASE WHEN avg_leadership_score BETWEEN 4 AND 6.9 THEN user_id END) as medium_leadership,
    COUNT(CASE WHEN avg_leadership_score < 4 THEN user_id END) as low_leadership
  FROM leadership_trends
  GROUP BY week_start
)

SELECT 
  week_start,
  active_participants,
  ROUND(overall_avg_speaking_pct, 1) as avg_speaking_percentage,
  ROUND(overall_avg_leadership_score, 2) as avg_leadership_score,
  ROUND(overall_avg_engagement_score, 2) as avg_engagement_score,
  ROUND(overall_avg_sentiment_score, 2) as avg_sentiment_score,
  dominant_speakers,
  quiet_participants,
  balanced_speakers,
  SAFE_DIVIDE(dominant_speakers, active_participants) * 100 as pct_dominant_speakers,
  SAFE_DIVIDE(quiet_participants, active_participants) * 100 as pct_quiet_participants,
  high_leadership,
  medium_leadership,
  low_leadership,
  SAFE_DIVIDE(high_leadership, active_participants) * 100 as pct_high_leadership
FROM leadership_distribution
ORDER BY week_start DESC;

-- Action Item Analysis and Completion Rates
WITH action_item_metrics AS (
  SELECT 
    ai.assignee_id,
    ai.meeting_id,
    DATE(m.actual_start_time) as meeting_date,
    ai.created_at,
    ai.due_date,
    ai.completion_date,
    ai.status,
    ai.priority,
    -- Calculate completion time
    CASE 
      WHEN ai.completion_date IS NOT NULL AND ai.due_date IS NOT NULL 
      THEN DATE_DIFF(ai.completion_date, ai.due_date, DAY)
      ELSE NULL
    END as days_from_due_date,
    -- Categorize completion status
    CASE 
      WHEN ai.status = 'completed' AND ai.completion_date <= ai.due_date THEN 'On Time'
      WHEN ai.status = 'completed' AND ai.completion_date > ai.due_date THEN 'Late'
      WHEN ai.status IN ('open', 'in_progress') AND CURRENT_DATE() > ai.due_date THEN 'Overdue'
      WHEN ai.status IN ('open', 'in_progress') AND CURRENT_DATE() <= ai.due_date THEN 'In Progress'
      WHEN ai.status = 'cancelled' THEN 'Cancelled'
      ELSE 'Other'
    END as completion_category
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.action_items` ai
  JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings` m ON ai.meeting_id = m.id
  WHERE DATE(m.actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
),

weekly_action_items AS (
  SELECT 
    DATE_TRUNC(meeting_date, WEEK(MONDAY)) as week_start,
    COUNT(*) as total_action_items,
    COUNT(DISTINCT assignee_id) as unique_assignees,
    COUNT(CASE WHEN completion_category = 'On Time' THEN 1 END) as completed_on_time,
    COUNT(CASE WHEN completion_category = 'Late' THEN 1 END) as completed_late,
    COUNT(CASE WHEN completion_category = 'Overdue' THEN 1 END) as overdue_items,
    COUNT(CASE WHEN completion_category = 'In Progress' THEN 1 END) as in_progress_items,
    COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority_items,
    COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_items,
    AVG(CASE WHEN days_from_due_date IS NOT NULL THEN days_from_due_date END) as avg_days_from_due_date
  FROM action_item_metrics
  WHERE completion_category NOT IN ('Cancelled', 'Other')
  GROUP BY week_start
),

completion_rates AS (
  SELECT 
    week_start,
    total_action_items,
    unique_assignees,
    completed_on_time,
    completed_late,
    overdue_items,
    in_progress_items,
    high_priority_items,
    urgent_items,
    avg_days_from_due_date,
    -- Calculate completion rates
    SAFE_DIVIDE(completed_on_time, total_action_items) * 100 as on_time_completion_rate,
    SAFE_DIVIDE(completed_on_time + completed_late, total_action_items) * 100 as overall_completion_rate,
    SAFE_DIVIDE(overdue_items, total_action_items) * 100 as overdue_rate,
    SAFE_DIVIDE(high_priority_items + urgent_items, total_action_items) * 100 as high_priority_rate
  FROM weekly_action_items
)

SELECT 
  week_start,
  total_action_items,
  unique_assignees,
  ROUND(total_action_items / unique_assignees, 1) as avg_items_per_assignee,
  completed_on_time,
  completed_late,
  overdue_items,
  ROUND(on_time_completion_rate, 1) as on_time_completion_pct,
  ROUND(overall_completion_rate, 1) as total_completion_pct,
  ROUND(overdue_rate, 1) as overdue_pct,
  ROUND(high_priority_rate, 1) as high_priority_pct,
  ROUND(avg_days_from_due_date, 1) as avg_days_variance_from_due_date
FROM completion_rates
ORDER BY week_start DESC;

-- Meeting Productivity and Outcome Analysis
WITH meeting_outcomes AS (
  SELECT 
    m.id,
    m.user_id,
    DATE(m.actual_start_time) as meeting_date,
    m.meeting_type,
    m.duration_minutes,
    -- Count related items
    COUNT(DISTINCT ai.id) as action_items_generated,
    COUNT(DISTINCT a.participant_id) as attendee_count,
    AVG(a.attendance_percentage) as avg_attendance_pct,
    AVG(ls.engagement_score) as avg_engagement_score,
    AVG(ls.leadership_score) as avg_leadership_score,
    -- Productivity indicators
    SAFE_DIVIDE(COUNT(DISTINCT ai.id), m.duration_minutes) * 60 as action_items_per_hour,
    CASE 
      WHEN m.outcome IS NOT NULL AND LENGTH(m.outcome) > 50 THEN 1 
      ELSE 0 
    END as has_documented_outcome,
    CASE 
      WHEN ARRAY_LENGTH(m.next_steps) > 0 THEN 1 
      ELSE 0 
    END as has_next_steps
  FROM `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.meetings` m
  LEFT JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.action_items` ai ON m.id = ai.meeting_id
  LEFT JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.attendees` a ON m.id = a.meeting_id
  LEFT JOIN `{{PROJECT_ID}}.{{DATASET_PREFIX}}_meetings.leadership_scores` ls ON m.id = ls.meeting_id
  WHERE DATE(m.actual_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND m.actual_start_time IS NOT NULL
  GROUP BY m.id, m.user_id, meeting_date, m.meeting_type, m.duration_minutes, m.outcome, m.next_steps
),

productivity_metrics AS (
  SELECT 
    DATE_TRUNC(meeting_date, WEEK(MONDAY)) as week_start,
    meeting_type,
    COUNT(*) as meeting_count,
    AVG(duration_minutes) as avg_duration,
    AVG(action_items_generated) as avg_action_items,
    AVG(attendee_count) as avg_attendees,
    AVG(avg_attendance_pct) as avg_attendance_percentage,
    AVG(avg_engagement_score) as avg_engagement,
    AVG(action_items_per_hour) as avg_action_items_per_hour,
    SUM(has_documented_outcome) as meetings_with_outcomes,
    SUM(has_next_steps) as meetings_with_next_steps,
    -- Productivity score (0-100)
    (
      AVG(avg_engagement_score) * 10 +
      LEAST(AVG(action_items_per_hour) * 10, 30) +
      AVG(avg_attendance_pct) +
      (SUM(has_documented_outcome) / COUNT(*)) * 20 +
      (SUM(has_next_steps) / COUNT(*)) * 20
    ) as productivity_score
  FROM meeting_outcomes
  GROUP BY week_start, meeting_type
)

SELECT 
  week_start,
  meeting_type,
  meeting_count,
  ROUND(avg_duration, 1) as avg_duration_minutes,
  ROUND(avg_action_items, 1) as avg_action_items_generated,
  ROUND(avg_attendees, 1) as avg_attendee_count,
  ROUND(avg_attendance_percentage, 1) as avg_attendance_pct,
  ROUND(avg_engagement, 2) as avg_engagement_score,
  ROUND(avg_action_items_per_hour, 2) as action_items_per_hour,
  meetings_with_outcomes,
  meetings_with_next_steps,
  SAFE_DIVIDE(meetings_with_outcomes, meeting_count) * 100 as pct_with_documented_outcomes,
  SAFE_DIVIDE(meetings_with_next_steps, meeting_count) * 100 as pct_with_next_steps,
  ROUND(productivity_score, 1) as productivity_score
FROM productivity_metrics
ORDER BY week_start DESC, productivity_score DESC;