import { describe, it, expect } from 'vitest';
import { buildInboxQuestion } from './inbox-question-schema.js';

describe('buildInboxQuestion', () => {
  it('returns {} for a plain payload with no options', () => {
    expect(buildInboxQuestion({})).toEqual({});
    expect(buildInboxQuestion({ options: [] })).toEqual({});
    expect(buildInboxQuestion({ questions: [] })).toEqual({});
  });

  it('host-assigns sequential A/B/C letters for a single question', () => {
    const built = buildInboxQuestion({ options: ['Rewrite', 'Patch', 'Skip'] });
    expect(built.question?.options).toEqual([
      { id: 'A', label: 'Rewrite' },
      { id: 'B', label: 'Patch' },
      { id: 'C', label: 'Skip' }
    ]);
    expect(built.questions).toBeUndefined();
  });

  it('omits allowOther / multiSelect when falsy, keeps them when true', () => {
    const on = buildInboxQuestion({ options: ['a'], allowOther: true, multiSelect: true });
    expect(on.question?.allowOther).toBe(true);
    expect(on.question?.multiSelect).toBe(true);
    const off = buildInboxQuestion({ options: ['a'], allowOther: false, multiSelect: false });
    expect(off.question?.allowOther).toBeUndefined();
    expect(off.question?.multiSelect).toBeUndefined();
  });

  it('builds a multi-question payload with per-question letters restarting at A', () => {
    const built = buildInboxQuestion({
      questions: [
        { prompt: 'Which db?', options: ['Postgres', 'SQLite'] },
        { prompt: 'Deploy?', options: ['Docker', 'Bare', 'Serverless'] }
      ]
    });
    expect(built.question).toBeUndefined();
    expect(built.questions?.[0].options.map((o) => o.id)).toEqual(['A', 'B']);
    expect(built.questions?.[1].options.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    expect(built.questions?.[0].prompt).toBe('Which db?');
  });

  it('prefers `questions` over `options` when both are present', () => {
    const built = buildInboxQuestion({
      options: ['ignored'],
      questions: [{ prompt: 'p', options: ['x'] }]
    });
    expect(built.questions).toHaveLength(1);
    expect(built.question).toBeUndefined();
  });

  describe('blocking', () => {
    it('defaults non-blocking (blocking omitted) for a single question', () => {
      const built = buildInboxQuestion({ options: ['a'] });
      expect(built.question?.blocking).toBeUndefined();
    });

    it('honors defaultBlocking=true (inbox_ask stance) when unspecified', () => {
      const built = buildInboxQuestion({ options: ['a'] }, true);
      expect(built.question?.blocking).toBe(true);
    });

    it('per-question explicit blocking wins over the tool default', () => {
      // Agent marks a soft follow-up on an otherwise-blocking tool.
      const soft = buildInboxQuestion({ options: ['a'], blocking: false }, true);
      expect(soft.question?.blocking).toBeUndefined();
      // Agent escalates on an otherwise-soft tool.
      const hard = buildInboxQuestion({ options: ['a'], blocking: true }, false);
      expect(hard.question?.blocking).toBe(true);
    });

    it('applies defaultBlocking to every question in multi-question mode', () => {
      const built = buildInboxQuestion(
        {
          questions: [
            { prompt: 'p1', options: ['x'] },
            { prompt: 'p2', options: ['y'], blocking: false }
          ]
        },
        true
      );
      expect(built.questions?.[0].blocking).toBe(true);
      expect(built.questions?.[1].blocking).toBeUndefined();
    });

    it('persists only the resolved true, never a false flag', () => {
      const built = buildInboxQuestion({ options: ['a'], blocking: false });
      expect('blocking' in (built.question ?? {})).toBe(true);
      expect(built.question?.blocking).toBeUndefined();
    });
  });
});
