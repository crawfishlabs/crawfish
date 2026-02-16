import { EventPublisher } from '../event-publisher';
const analytics = new EventPublisher();

export async function onMeetingAnalyzed(userId: string, meeting: any, cost: number) {
  await analytics.track('meeting_analyzed', {
    userId,
    meetingId: meeting.id,
    meetingType: meeting.meetingType,
    durationMinutes: meeting.durationMinutes,
    attendeeCount: meeting.attendeeEmails.length,
    actionItemCount: meeting.summary?.actionItems?.length || 0,
  });
  await analytics.track('llm_call', {
    userId, app: 'meetings', taskType: 'meeting_analysis', model: 'claude-opus-4', costUsd: cost,
  });
}
