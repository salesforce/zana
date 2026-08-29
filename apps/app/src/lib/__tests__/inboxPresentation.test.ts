import { describe, it, expect } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import {
  inboxIntent,
  inboxContextLine,
  inboxPrimaryTitle
} from '../inboxPresentation.js';

function entry(overrides: Partial<InboxEntry>): InboxEntry {
  return {
    id: 'e1',
    ts: 1_700_000_000_000,
    projectId: 'p',
    ...overrides
  } as InboxEntry;
}

describe('inboxIntent', () => {
  it('prefers the explicit author-set intent', () => {
    expect(inboxIntent(entry({ intent: 'Ship the migration', origin: { title: 'Nightly run' } as InboxEntry['origin'] }))).toBe(
      'Ship the migration'
    );
  });

  it('falls back to the session/origin title when intent is absent', () => {
    expect(inboxIntent(entry({ origin: { title: 'Nightly run' } as InboxEntry['origin'] }))).toBe('Nightly run');
  });

  it('trims whitespace and treats a blank intent as absent', () => {
    expect(inboxIntent(entry({ intent: '  Deploy  ' }))).toBe('Deploy');
    expect(inboxIntent(entry({ intent: '   ', origin: { title: 'T' } as InboxEntry['origin'] }))).toBe('T');
  });

  it('returns empty string when neither intent nor origin title exists', () => {
    expect(inboxIntent(entry({ comments: 'hi' }))).toBe('');
  });
});

describe('inboxContextLine', () => {
  it('shows the intent when it differs from the title', () => {
    const e = entry({ subject: 'Rewrite auth', intent: 'Unblock the login route' });
    expect(inboxPrimaryTitle(e)).toBe('Rewrite auth');
    expect(inboxContextLine(e)).toBe('Unblock the login route');
  });

  it('suppresses context that merely echoes the title (origin-title fallback)', () => {
    // No subject, no intent → title falls back to origin.title, and so does the
    // context; showing it would duplicate the heading, so it's suppressed.
    const e = entry({ origin: { title: 'Nightly run' } as InboxEntry['origin'], comments: 'done' });
    expect(inboxPrimaryTitle(e)).toBe('Nightly run');
    expect(inboxContextLine(e)).toBe('');
  });

  it('returns empty when there is no context at all', () => {
    expect(inboxContextLine(entry({ comments: 'hi' }))).toBe('');
  });
});
