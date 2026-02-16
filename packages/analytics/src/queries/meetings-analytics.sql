-- Meetings analytics: leadership trends, action items, speaking ratio

-- Leadership competency trends by month
SELECT
  DATE_TRUNC('month', m.created_at) AS month,
  ls.competency,
  AVG(ls.score) AS avg_score,
  COUNT(*) AS observations
FROM CLAW_ANALYTICS.MEETINGS.MEETINGS m
JOIN CLAW_ANALYTICS.MEETINGS.LEADERSHIP_SCORES ls ON m.id = ls.meeting_id
WHERE m.created_at >= DATEADD(month, -6, CURRENT_DATE())
GROUP BY month, ls.competency
ORDER BY month, ls.competency;

-- Action item completion rates
SELECT
  owner,
  COUNT(*) AS total,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
  DIV0(COUNT(CASE WHEN status = 'completed' THEN 1 END), COUNT(*)) AS completion_rate,
  AVG(DATEDIFF(day, created_at, COALESCE(completed_at, CURRENT_TIMESTAMP()))) AS avg_days_open
FROM CLAW_ANALYTICS.MEETINGS.ACTION_ITEMS
WHERE created_at >= DATEADD(month, -3, CURRENT_DATE())
GROUP BY owner
ORDER BY total DESC;

-- Meeting time by type
SELECT
  meeting_type,
  COUNT(*) AS meeting_count,
  SUM(duration_minutes) AS total_minutes,
  AVG(duration_minutes) AS avg_duration,
  AVG(speaking_ratio) AS avg_speaking_ratio
FROM CLAW_ANALYTICS.MEETINGS.MEETINGS
WHERE created_at >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY meeting_type
ORDER BY total_minutes DESC;

-- Speaking ratio trend
SELECT
  DATE_TRUNC('week', created_at) AS week,
  meeting_type,
  AVG(speaking_ratio) AS avg_speaking_ratio,
  COUNT(*) AS meetings
FROM CLAW_ANALYTICS.MEETINGS.MEETINGS
WHERE created_at >= DATEADD(month, -3, CURRENT_DATE())
  AND speaking_ratio IS NOT NULL
GROUP BY week, meeting_type
ORDER BY week;
