import { describe, it, expect } from 'vitest';
import type { FollowUp } from '@zana-ai/zcc-domain/product';
import {
  buildFollowUpAnswerPrompt,
  buildFollowUpPrompt,
  followUpAgentTitle
} from '../followUpPrompt.js';

function followUp(over: Partial<FollowUp>): FollowUp {
  return {
    id: 'fu-1',
    projectId: 'p1',
    title: 'Should I commit these changes?',
    kind: 'question',
    status: 'open',
    origin: { source: 'user' },
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    ...over
  };
}

describe('buildFollowUpPrompt', () => {
  it('includes the title, detail body, and a resolve instruction with the id', () => {
    const prompt = buildFollowUpPrompt(
      followUp({ id: 'abc-123', title: 'Bump version', detail: 'Update package.json to 1.0.0.' })
    );
    expect(prompt).toContain('## Bump version');
    expect(prompt).toContain('Update package.json to 1.0.0.');
    expect(prompt).toContain('followup_resolve');
    expect(prompt).toContain('abc-123');
  });

  it('frames decisions as a go/no-go', () => {
    const prompt = buildFollowUpPrompt(followUp({ kind: 'decision' }));
    expect(prompt).toContain('go/no-go decision');
  });

  it('omits the detail block when there is no detail', () => {
    const prompt = buildFollowUpPrompt(followUp({ detail: undefined }));
    // Header then the separator, no empty detail paragraph wedged between.
    expect(prompt).toContain('## Should I commit these changes?');
    expect(prompt).not.toMatch(/## .+\n\n\n/);
  });
});

describe('buildFollowUpAnswerPrompt', () => {
  it('carries the question, the detail, and the human answer, then asks to resolve', () => {
    const prompt = buildFollowUpAnswerPrompt(
      followUp({ id: 'xyz-9', title: 'Which auth?', detail: 'OAuth vs API key.' }),
      'Go with OAuth.'
    );
    expect(prompt).toContain('## Which auth?');
    expect(prompt).toContain('OAuth vs API key.');
    expect(prompt).toContain('## The human answered');
    expect(prompt).toContain('Go with OAuth.');
    expect(prompt).toContain('followup_resolve');
    expect(prompt).toContain('xyz-9');
  });

  it('trims the answer and still includes the resolve instruction without detail', () => {
    const prompt = buildFollowUpAnswerPrompt(followUp({ detail: undefined }), '  ship it  ');
    expect(prompt).toContain('## The human answered');
    expect(prompt).toContain('ship it');
    expect(prompt).not.toContain('  ship it  ');
  });
});

describe('followUpAgentTitle', () => {
  it('passes short titles through', () => {
    expect(followUpAgentTitle(followUp({ title: 'Short one' }))).toBe('Short one');
  });

  it('truncates long titles with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const title = followUpAgentTitle(followUp({ title: long }));
    expect(title.length).toBe(48);
    expect(title.endsWith('…')).toBe(true);
  });
});
