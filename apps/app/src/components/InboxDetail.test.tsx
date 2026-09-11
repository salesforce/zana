import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('InboxDetail attention layout', () => {
  const source = readFileSync(new URL('./InboxDetail.tsx', import.meta.url), 'utf8');

  it('puts the answer surface above comments/docs when the entry is a question', () => {
    const early = source.indexOf('{questionFirst ? answerSurface : null}');
    const comments = source.indexOf('inbox-detail-comments');
    const late = source.indexOf('{questionFirst ? null : answerSurface}');
    const footer = source.indexOf('inbox-detail-footer');
    const related = source.indexOf('<RelatedNextSteps');
    expect(early).toBeGreaterThan(-1);
    expect(comments).toBeGreaterThan(early);
    expect(footer).toBeGreaterThan(comments);
    expect(late).toBeGreaterThan(footer);
    expect(related).toBeGreaterThan(late);
  });

  it('returns to the landing as Inbox, not Overview, and drops the debug project id', () => {
    expect(source).toContain('<span>Inbox</span>');
    expect(source).toContain('title="Back to inbox"');
    expect(source).not.toContain('<span>Overview</span>');
    expect(source).not.toContain('inbox-detail-meta-id');
    expect(source).not.toContain('InboxGuidance');
  });
});
