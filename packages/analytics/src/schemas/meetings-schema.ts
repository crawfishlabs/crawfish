// Snowflake table schemas for Meetings app

export const meetingsSchemas = {
  meetings: `
    CREATE TABLE IF NOT EXISTS meetings (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL, -- meeting organizer/owner
      title VARCHAR(1000) NOT NULL,
      description TEXT,
      meeting_type VARCHAR(50), -- one_on_one, team, all_hands, client, etc.
      meeting_source VARCHAR(50), -- granola_import, manual_entry, calendar_sync
      external_meeting_id VARCHAR(255), -- Granola ID, Google Meet ID, etc.
      scheduled_start_time TIMESTAMP_TZ,
      scheduled_end_time TIMESTAMP_TZ,
      actual_start_time TIMESTAMP_TZ,
      actual_end_time TIMESTAMP_TZ,
      duration_minutes NUMBER(38,0),
      location VARCHAR(200), -- zoom, in_person, teams, etc.
      meeting_url VARCHAR(1000),
      status VARCHAR(20), -- scheduled, in_progress, completed, cancelled
      recording_url VARCHAR(1000),
      agenda TEXT,
      outcome TEXT,
      next_steps VARIANT, -- JSON array of next steps
      tags VARIANT, -- JSON array of tags
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, DATE(scheduled_start_time))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Meeting metadata and scheduling information'
  `,

  transcripts: `
    CREATE TABLE IF NOT EXISTS transcripts (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      meeting_id VARCHAR(255) NOT NULL,
      transcript_text TEXT,
      transcript_json VARIANT, -- structured transcript with timestamps, speakers
      language VARCHAR(10),
      confidence_score NUMBER(3,2),
      word_count NUMBER(38,0),
      processing_duration_seconds NUMBER(38,0),
      transcript_source VARCHAR(50), -- granola, otter, manual
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id)
    )
    CLUSTER BY (meeting_id, created_at)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Meeting transcripts and speech-to-text data'
  `,

  action_items: `
    CREATE TABLE IF NOT EXISTS action_items (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      meeting_id VARCHAR(255) NOT NULL,
      assignee_id VARCHAR(255) NOT NULL,
      assigner_id VARCHAR(255),
      title VARCHAR(500) NOT NULL,
      description TEXT,
      priority VARCHAR(20), -- low, medium, high, urgent
      due_date DATE,
      status VARCHAR(20), -- open, in_progress, completed, cancelled
      completion_date DATE,
      tags VARIANT, -- JSON array of tags
      estimated_hours NUMBER(5,2),
      actual_hours NUMBER(5,2),
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id)
    )
    CLUSTER BY (assignee_id, due_date, status)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Action items and tasks generated from meetings'
  `,

  leadership_scores: `
    CREATE TABLE IF NOT EXISTS leadership_scores (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      meeting_id VARCHAR(255) NOT NULL,
      participant_id VARCHAR(255) NOT NULL,
      speaking_time_seconds NUMBER(38,0),
      speaking_percentage NUMBER(5,2),
      interruptions_made NUMBER(38,0),
      interruptions_received NUMBER(38,0),
      questions_asked NUMBER(38,0),
      questions_answered NUMBER(38,0),
      action_items_assigned NUMBER(38,0),
      action_items_received NUMBER(38,0),
      engagement_score NUMBER(3,1), -- 0-10
      leadership_score NUMBER(3,1), -- 0-10
      sentiment_score NUMBER(3,2), -- -1 to 1
      key_topics_mentioned VARIANT, -- JSON array of topics
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id),
      UNIQUE (meeting_id, participant_id)
    )
    CLUSTER BY (participant_id, DATE(created_at))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Leadership and engagement analytics for meeting participants'
  `,

  attendees: `
    CREATE TABLE IF NOT EXISTS attendees (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      meeting_id VARCHAR(255) NOT NULL,
      user_id VARCHAR(255),
      email VARCHAR(255),
      name VARCHAR(255),
      role VARCHAR(50), -- organizer, presenter, participant
      join_time TIMESTAMP_TZ,
      leave_time TIMESTAMP_TZ,
      attendance_duration_minutes NUMBER(38,0),
      attendance_percentage NUMBER(5,2),
      is_required BOOLEAN,
      attendance_status VARCHAR(20), -- attended, no_show, partial
      department VARCHAR(100),
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id)
    )
    CLUSTER BY (meeting_id, attendance_status)
    CHANGE_TRACKING = TRUE
    COMMENT = 'Meeting attendee information and attendance tracking'
  `,

  initiatives: `
    CREATE TABLE IF NOT EXISTS initiatives (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL, -- initiative owner
      name VARCHAR(500) NOT NULL,
      description TEXT,
      status VARCHAR(20), -- planning, active, on_hold, completed, cancelled
      priority VARCHAR(20), -- low, medium, high, critical
      start_date DATE,
      target_completion_date DATE,
      actual_completion_date DATE,
      budget NUMBER(12,2),
      team_members VARIANT, -- JSON array of team member IDs
      related_meeting_ids VARIANT, -- JSON array of meeting IDs
      tags VARIANT, -- JSON array of tags
      success_metrics VARIANT, -- JSON array of success metrics
      progress_percentage NUMBER(5,2),
      notes TEXT,
      created_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP_TZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    CLUSTER BY (user_id, status, DATE(start_date))
    CHANGE_TRACKING = TRUE
    COMMENT = 'Strategic initiatives and projects tracked across meetings'
  `
};

export default meetingsSchemas;