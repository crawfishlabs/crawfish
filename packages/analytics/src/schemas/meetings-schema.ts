// BigQuery table schemas for Meetings app

export const meetingsSchemas = {
  meetings: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' }, // meeting organizer/owner
    { name: 'title', type: 'STRING', mode: 'REQUIRED' },
    { name: 'description', type: 'STRING', mode: 'NULLABLE' },
    { name: 'meeting_type', type: 'STRING', mode: 'NULLABLE' }, // one_on_one, team, all_hands, client, etc.
    { name: 'meeting_source', type: 'STRING', mode: 'NULLABLE' }, // granola_import, manual_entry, calendar_sync
    { name: 'external_meeting_id', type: 'STRING', mode: 'NULLABLE' }, // Granola ID, Google Meet ID, etc.
    { name: 'scheduled_start_time', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'scheduled_end_time', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'actual_start_time', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'actual_end_time', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'duration_minutes', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'location', type: 'STRING', mode: 'NULLABLE' }, // zoom, in_person, teams, etc.
    { name: 'meeting_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' }, // scheduled, in_progress, completed, cancelled
    { name: 'recording_url', type: 'STRING', mode: 'NULLABLE' },
    { name: 'agenda', type: 'STRING', mode: 'NULLABLE' },
    { name: 'outcome', type: 'STRING', mode: 'NULLABLE' },
    { name: 'next_steps', type: 'STRING', mode: 'REPEATED' },
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  transcripts: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'meeting_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'transcript_text', type: 'STRING', mode: 'NULLABLE' },
    { name: 'transcript_json', type: 'STRING', mode: 'NULLABLE' }, // structured transcript with timestamps, speakers
    { name: 'language', type: 'STRING', mode: 'NULLABLE' },
    { name: 'confidence_score', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'word_count', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'processing_duration_seconds', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'transcript_source', type: 'STRING', mode: 'NULLABLE' }, // granola, otter, manual
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  action_items: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'meeting_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'assignee_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'assigner_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'title', type: 'STRING', mode: 'REQUIRED' },
    { name: 'description', type: 'STRING', mode: 'NULLABLE' },
    { name: 'priority', type: 'STRING', mode: 'NULLABLE' }, // low, medium, high, urgent
    { name: 'due_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' }, // open, in_progress, completed, cancelled
    { name: 'completion_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    { name: 'estimated_hours', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'actual_hours', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  leadership_scores: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'meeting_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'participant_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'speaking_time_seconds', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'speaking_percentage', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'interruptions_made', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'interruptions_received', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'questions_asked', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'questions_answered', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'action_items_assigned', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'action_items_received', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'engagement_score', type: 'FLOAT', mode: 'NULLABLE' }, // 0-10
    { name: 'leadership_score', type: 'FLOAT', mode: 'NULLABLE' }, // 0-10
    { name: 'sentiment_score', type: 'FLOAT', mode: 'NULLABLE' }, // -1 to 1
    { name: 'key_topics_mentioned', type: 'STRING', mode: 'REPEATED' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  attendees: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'meeting_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'email', type: 'STRING', mode: 'NULLABLE' },
    { name: 'name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'role', type: 'STRING', mode: 'NULLABLE' }, // organizer, presenter, participant
    { name: 'join_time', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'leave_time', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'attendance_duration_minutes', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'attendance_percentage', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'is_required', type: 'BOOLEAN', mode: 'NULLABLE' },
    { name: 'attendance_status', type: 'STRING', mode: 'NULLABLE' }, // attended, no_show, partial
    { name: 'department', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ],

  initiatives: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'user_id', type: 'STRING', mode: 'REQUIRED' }, // initiative owner
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'description', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' }, // planning, active, on_hold, completed, cancelled
    { name: 'priority', type: 'STRING', mode: 'NULLABLE' }, // low, medium, high, critical
    { name: 'start_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'target_completion_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'actual_completion_date', type: 'DATE', mode: 'NULLABLE' },
    { name: 'budget', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'team_members', type: 'STRING', mode: 'REPEATED' },
    { name: 'related_meeting_ids', type: 'STRING', mode: 'REPEATED' },
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    { name: 'success_metrics', type: 'STRING', mode: 'REPEATED' },
    { name: 'progress_percentage', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' }
  ]
};

export default meetingsSchemas;