import { describe, expect, it } from 'vitest';
import {
  FALLBACK_BODIES,
  PUSH_BODY_MAX_LENGTH,
  PUSH_TITLE_MAX_LENGTH,
  buildPushPreview,
  describePendingInteraction,
  notificationPreviewText,
  sanitizeInlineText,
  threadDisplayTitle,
  truncate
} from './previews.js';

describe('truncate', () => {
  it('leaves short text alone and ends long text with one ellipsis within the cap', () => {
    expect(truncate('short', 10)).toBe('short');
    const cut = truncate('a'.repeat(50), 10);
    expect(cut).toBe(`${'a'.repeat(9)}…`);
    expect(cut.length).toBe(10);
  });

  it('does not leave trailing whitespace before the ellipsis', () => {
    expect(truncate('hello world again', 7)).toBe('hello…');
  });

  it('never splits a surrogate pair', () => {
    const cut = truncate('😀😀😀😀😀', 4);
    expect(cut).toBe('😀…');
    expect([...cut].every((char) => char.length >= 1)).toBe(true);
    expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

describe('sanitizeInlineText', () => {
  it('strips control characters, ANSI escapes and bidi overrides and collapses whitespace', () => {
    expect(sanitizeInlineText('a\u0007b\u001b[31mred\u001b[0m\t\n  c\u202ed\u200be')).toBe('abred cde');
  });

  it('redacts credentials and opaque tokens', () => {
    // Built at runtime so secret scanning doesn't read the fixtures as real Stripe keys.
    const stripeKey = (prefix: string) => `${prefix}_${'A'.repeat(24)}`;
    const samples = [
      'token=abc123def',
      'Authorization: Bearer abc.def.ghi',
      'password: hunter2',
      'use sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA now',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz',
      'xoxb-123456789012-abcdefghijkl',
      'AKIAABCDEFGHIJKLMNOP',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      'clone https://user:pa55word@example.com/repo.git',
      '-----BEGIN RSA PRIVATE KEY----- MIIEow',
      'blob 0123456789abcdef0123456789abcdef0123456789abcdef',
      '{"api_key": "hunter2"}',
      "{'password':'hunter2'}",
      `STRIPE ${stripeKey('sk_live')}`,
      stripeKey('pk_test'),
      stripeKey('rk_live')
    ];
    for (const sample of samples) {
      const out = sanitizeInlineText(sample);
      expect(out, sample).toContain('[redacted]');
      expect(out, sample).not.toMatch(/hunter2|abc123def|pa55word|AAAAAAAA|abcdefghijklmnopqrstuvwxyz0123456789|0123456789abcdef0123/);
    }
  });

  it('keeps ordinary prose and short identifiers untouched', () => {
    const text = 'Updated src/app.ts and fixed the token refresh bug in 3 places.';
    expect(sanitizeInlineText(text)).toBe(text);
  });
});

describe('notificationPreviewText', () => {
  it('returns the first paragraph with markdown stripped', () => {
    const markdown = [
      '## Summary',
      '',
      'I fixed the **flaky** test in [`a.test.ts`](https://example.com/a) and ~~removed~~ the retry.',
      '',
      'Second paragraph that must not appear.'
    ].join('\n');
    expect(notificationPreviewText(markdown)).toBe('I fixed the flaky test in a.test.ts and removed the retry.');
  });

  it('skips code fences entirely, including a leading one', () => {
    expect(notificationPreviewText('```ts\nconst SECRET = 1;\n```\n\nAll done.')).toBe('All done.');
    expect(notificationPreviewText('Done:\n```\nfile contents\n```\nmore')).toBe('Done:');
    expect(notificationPreviewText('~~~\nonly code\n~~~')).toBe('');
  });

  it('drops list, quote and rule markers and stops at a thematic break', () => {
    expect(notificationPreviewText('- first item\n- second item')).toBe('first item second item');
    expect(notificationPreviewText('> quoted advice\n\nrest')).toBe('quoted advice');
    expect(notificationPreviewText('1. do this\n---\nignored')).toBe('do this');
  });

  it('redacts secrets that appear in the excerpt', () => {
    const out = notificationPreviewText('I set `API_KEY=sk-live-abcdefghijklmnopqrstuvwxyz` in the env file.');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(out).toContain('[redacted]');
  });

  it('returns an empty string for blank or non-text input', () => {
    expect(notificationPreviewText('')).toBe('');
    expect(notificationPreviewText('   \n\n  ')).toBe('');
  });
});

describe('threadDisplayTitle', () => {
  it('prefers the trimmed title and falls back to a short id label', () => {
    expect(threadDisplayTitle({ id: 'thr_abcdefghij', title: '  Fix the build  ' })).toBe('Fix the build');
    expect(threadDisplayTitle({ id: 'thr_abcdefghij', title: null })).toBe('Thread thr_abcd');
    expect(threadDisplayTitle({ id: 'thr_abcdefghij', title: '   ' })).toBe('Thread thr_abcd');
  });
});

describe('describePendingInteraction', () => {
  const json = (payload: unknown) => JSON.stringify(payload);

  it('uses the first line of the first question', () => {
    expect(
      describePendingInteraction(
        json({ kind: 'user_question', questions: [{ id: 'q', prompt: '  Which database?\nPostgres or SQLite', allowFreeText: true, multiSelect: false }] })
      )
    ).toBe('Which database?');
  });

  it('names only the program of a command approval, never its arguments', () => {
    const body = describePendingInteraction(
      json({ kind: 'approval', subject: { kind: 'command', command: 'pnpm test --token=abc123 /secret/dir' } })
    );
    expect(body).toBe('Approve command: pnpm');
    expect(body).not.toContain('abc123');
    expect(body).not.toContain('/secret');
  });

  it('falls back to a generic line when the command does not start with a plain program name', () => {
    expect(describePendingInteraction(json({ kind: 'approval', subject: { kind: 'command', command: 'API_KEY=hunter2 curl x' } }))).toBe(
      'Approve a command'
    );
    expect(describePendingInteraction(json({ kind: 'approval', subject: { kind: 'command', command: '/usr/local/bin/tool --x' } }))).toBe(
      'Approve command: tool'
    );
  });

  it('describes file changes, permission grants, plans and tools without paths or bodies', () => {
    expect(describePendingInteraction(json({ kind: 'approval', subject: { kind: 'file_change', writeScope: '/home/me/.ssh' } }))).toBe(
      'Approve file changes'
    );
    expect(describePendingInteraction(json({ kind: 'approval', subject: { kind: 'permission_grant', toolName: 'Bash' } }))).toBe(
      'Grant permissions to Bash'
    );
    expect(describePendingInteraction(json({ kind: 'approval', subject: { kind: 'permission_grant', toolName: null } }))).toBe(
      'Grant additional permissions'
    );
    expect(describePendingInteraction(json({ kind: 'approval', subject: { kind: 'plan', plan: 'SECRET PLAN BODY' } }))).toBe(
      'Review the plan before the agent continues'
    );
    expect(describePendingInteraction(json({ kind: 'approval', subject: { kind: 'tool_use', tool: 'mcp__github__create_issue' } }))).toBe(
      'Approve tool: mcp__github__create_issue'
    );
  });

  it('uses the title of a plugin-defined request', () => {
    expect(describePendingInteraction(json({ kind: 'acme/review', title: 'Review the draft', data: { secret: 1 } }))).toBe(
      'Review the draft'
    );
  });

  it('falls back for malformed or unknown payloads', () => {
    expect(describePendingInteraction('not json')).toBe(FALLBACK_BODIES['pending-interaction']);
    expect(describePendingInteraction('null')).toBe(FALLBACK_BODIES['pending-interaction']);
    expect(describePendingInteraction(json({ kind: 'approval', subject: { kind: 'martian' } }))).toBe(
      FALLBACK_BODIES['pending-interaction']
    );
    expect(describePendingInteraction(json({ kind: 'user_question', questions: [] }))).toBe(FALLBACK_BODIES['pending-interaction']);
  });
});

describe('buildPushPreview', () => {
  const thread = { id: 'thr_0123456789', title: 'Fix the flaky build' };

  it('titles with the thread title and bodies with the question for a pending interaction', () => {
    expect(
      buildPushPreview('pending-interaction', thread, {
        pendingPayload: JSON.stringify({ kind: 'user_question', questions: [{ id: 'q', prompt: 'Ship it?', allowFreeText: true, multiSelect: false }] })
      })
    ).toEqual({ title: 'Fix the flaky build', body: 'Ship it?' });
  });

  it('uses the last reply for a finished turn', () => {
    expect(buildPushPreview('turn-finished', thread, { lastReply: '**Done.** Tests pass.\n\nDetails follow.' })).toEqual({
      title: 'Fix the flaky build',
      body: 'Done. Tests pass.'
    });
  });

  it('never includes error detail for a failed thread', () => {
    expect(buildPushPreview('thread-error', thread, { lastReply: 'stack trace /Users/me/secret.ts' })).toEqual({
      title: 'Fix the flaky build',
      body: FALLBACK_BODIES['thread-error']
    });
  });

  it('falls back to the generic body when there is nothing readable', () => {
    expect(buildPushPreview('turn-finished', thread, { lastReply: '```\ncode only\n```' }).body).toBe(FALLBACK_BODIES['turn-finished']);
    expect(buildPushPreview('turn-finished', thread, {}).body).toBe(FALLBACK_BODIES['turn-finished']);
    expect(buildPushPreview('pending-interaction', thread, {}).body).toBe(FALLBACK_BODIES['pending-interaction']);
  });

  it('caps the title and the body', () => {
    const preview = buildPushPreview('turn-finished', { id: 'x'.repeat(12), title: 't'.repeat(300) }, { lastReply: 'w'.repeat(600) });
    expect(preview.title.length).toBeLessThanOrEqual(PUSH_TITLE_MAX_LENGTH);
    expect(preview.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX_LENGTH);
    expect(preview.title.endsWith('…')).toBe(true);
    expect(preview.body.endsWith('…')).toBe(true);
  });

  it('sanitizes the thread title', () => {
    const preview = buildPushPreview('turn-finished', { id: 'thr_0123456789', title: 'token=abc123\u0007 deploy' }, { lastReply: 'ok' });
    expect(preview.title).not.toContain('abc123');
    expect(preview.title).not.toContain('\u0007');
  });
});
