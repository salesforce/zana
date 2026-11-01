import { describe, expect, it } from 'vitest';
import { threadCloseFollowupConfirm, threadCloseFollowupToast } from './thread-close-followup.js';

describe('threadCloseFollowupConfirm', () => {
  it('says the agent wraps up first when the experiment is on, and keeps today\'s text when off', () => {
    expect(threadCloseFollowupConfirm('Build it', true)).toBe(
      'Close “Build it” with follow-up? The agent first saves what it learnt and tidies up, then closes with a summary in your inbox. If it asks you something, it stays open.'
    );
    expect(threadCloseFollowupConfirm('Build it', false)).toBe('Close “Build it” and file a follow-up if work is left?');
  });
});

describe('threadCloseFollowupToast', () => {
  it('names a thread kept open or wrapping up, and nothing for a thread closed now', () => {
    expect(threadCloseFollowupToast('Build it', { keptOpen: 'asks-you' })).toBe(
      '“Build it” is waiting on your answer, so it was left open (see your inbox).'
    );
    expect(threadCloseFollowupToast('Build it', { wrappingUp: true })).toBe('Wrapping up… “Build it” closes when it finishes.');
    expect(threadCloseFollowupToast('Build it', { keptOpen: 'asks-you', wrappingUp: true })).toContain('waiting on your answer');
    expect(threadCloseFollowupToast('Build it', {})).toBeNull();
    expect(threadCloseFollowupToast('Build it', null)).toBeNull();
    expect(threadCloseFollowupToast('Build it', undefined)).toBeNull();
  });
});
