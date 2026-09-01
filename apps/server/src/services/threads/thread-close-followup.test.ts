import { describe, expect, it } from 'vitest';
import { lastAssistantPreview, canCloseThreadWithFollowup } from './thread-close-followup.js';

describe('lastAssistantPreview', () => {
  it('returns the newest assistant preview', () => {
    expect(
      lastAssistantPreview([
        { role: 'user', preview: 'do the thing' },
        { role: 'assistant', preview: 'first pass' },
        { role: 'user', preview: 'keep going' },
        { role: 'assistant', preview: 'shipped the page. tests still missing.' }
      ])
    ).toBe('shipped the page. tests still missing.');
  });

  it('skips blank assistant rows and returns empty when none exist', () => {
    expect(
      lastAssistantPreview([
        { role: 'user', preview: 'hello' },
        { role: 'assistant', preview: '  ' }
      ])
    ).toBe('');
    expect(lastAssistantPreview([{ role: 'user', preview: 'hello' }])).toBe('');
  });
});

describe('canCloseThreadWithFollowup', () => {
  it('allows live threads and rejects already-archived ones', () => {
    expect(canCloseThreadWithFollowup({ archivedAt: null })).toBe(true);
    expect(canCloseThreadWithFollowup({})).toBe(true);
    expect(canCloseThreadWithFollowup({ archivedAt: 1 })).toBe(false);
  });
});
