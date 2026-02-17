import { triageTicket } from '../ai-triage';

describe('AI Triage', () => {
  it('should classify bug reports', async () => {
    const result = await triageTicket('The app crashes when I try to scan a receipt', 'claw-budget');
    expect(result.category).toBe('bug');
    expect(result.priority).toBe('urgent');
  });

  it('should classify feature requests', async () => {
    const result = await triageTicket('It would be nice to have dark mode support', 'claw-fitness');
    expect(result.category).toBe('feature');
    expect(result.priority).toBe('low');
  });

  it('should classify questions', async () => {
    const result = await triageTicket('How do I export my data?', 'claw-nutrition');
    expect(result.category).toBe('question');
  });

  it('should provide suggested responses', async () => {
    const result = await triageTicket('Bug: app freezes on launch', 'claw-meetings');
    expect(result.suggestedResponse).toBeTruthy();
    expect(result.suggestedResponse!.length).toBeGreaterThan(10);
  });
});
