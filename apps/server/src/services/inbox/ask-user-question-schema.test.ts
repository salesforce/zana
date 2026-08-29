import { describe, it, expect } from 'vitest';
import { mapAskUserQuestion } from './ask-user-question-schema.js';
import { MAX_OPTIONS, MAX_QUESTIONS } from './inbox-question-schema.js';

describe('mapAskUserQuestion', () => {
  it('renames question -> prompt and host-assigns A/B/C letters', () => {
    const out = mapAskUserQuestion({
      questions: [
        {
          question: 'Which database should we use?',
          options: [{ label: 'Postgres' }, { label: 'SQLite' }, { label: 'MySQL' }]
        }
      ]
    });
    expect(out).toHaveLength(1);
    expect(out[0].prompt).toBe('Which database should we use?');
    expect(out[0].options).toEqual([
      { id: 'A', label: 'Postgres' },
      { id: 'B', label: 'SQLite' },
      { id: 'C', label: 'MySQL' }
    ]);
  });

  it('folds the header into the prompt as a bold lead-in', () => {
    const out = mapAskUserQuestion({
      questions: [
        { header: 'Storage', question: 'Which database?', options: [{ label: 'Postgres' }] }
      ]
    });
    expect(out[0].prompt).toBe('**Storage**\n\nWhich database?');
  });

  it('uses the header alone as the prompt when the question text is missing', () => {
    const out = mapAskUserQuestion({
      questions: [{ header: 'Just a header', options: [{ label: 'OK' }] } as never]
    });
    expect(out[0].prompt).toBe('Just a header');
  });

  it('folds an option description into its label (label — description)', () => {
    const out = mapAskUserQuestion({
      questions: [
        {
          question: 'Pick one',
          options: [{ label: 'Postgres', description: 'relational' }, { label: 'Redis' }]
        }
      ]
    });
    expect(out[0].options).toEqual([
      { id: 'A', label: 'Postgres — relational' },
      { id: 'B', label: 'Redis' }
    ]);
  });

  it('passes multiSelect through only when true, omits it otherwise', () => {
    const on = mapAskUserQuestion({
      questions: [{ question: 'Pick many', multiSelect: true, options: [{ label: 'a' }] }]
    });
    expect(on[0].multiSelect).toBe(true);

    const off = mapAskUserQuestion({
      questions: [{ question: 'Pick one', multiSelect: false, options: [{ label: 'a' }] }]
    });
    expect(off[0].multiSelect).toBeUndefined();

    const absent = mapAskUserQuestion({
      questions: [{ question: 'Pick one', options: [{ label: 'a' }] }]
    });
    expect(absent[0].multiSelect).toBeUndefined();
  });

  it('assigns per-question letters restarting at A across multiple questions', () => {
    const out = mapAskUserQuestion({
      questions: [
        { question: 'Q1', options: [{ label: 'a' }, { label: 'b' }] },
        { question: 'Q2', options: [{ label: 'c' }, { label: 'd' }, { label: 'e' }] }
      ]
    });
    expect(out).toHaveLength(2);
    expect(out[0].options.map((o) => o.id)).toEqual(['A', 'B']);
    expect(out[1].options.map((o) => o.id)).toEqual(['A', 'B', 'C']);
  });

  it('clamps the question count to MAX_QUESTIONS', () => {
    const out = mapAskUserQuestion({
      questions: Array.from({ length: MAX_QUESTIONS + 5 }, (_, i) => ({
        question: `Q${i}`,
        options: [{ label: 'a' }]
      }))
    });
    expect(out).toHaveLength(MAX_QUESTIONS);
  });

  it('clamps per-question options to MAX_OPTIONS', () => {
    const out = mapAskUserQuestion({
      questions: [
        {
          question: 'Too many',
          options: Array.from({ length: MAX_OPTIONS + 5 }, (_, i) => ({ label: `opt${i}` }))
        }
      ]
    });
    expect(out[0].options).toHaveLength(MAX_OPTIONS);
  });

  describe('defensive behavior (never throws)', () => {
    it('returns [] for absent / empty / non-object payloads', () => {
      expect(mapAskUserQuestion(null)).toEqual([]);
      expect(mapAskUserQuestion(undefined)).toEqual([]);
      expect(mapAskUserQuestion({})).toEqual([]);
      expect(mapAskUserQuestion({ questions: [] })).toEqual([]);
      expect(mapAskUserQuestion({ questions: undefined })).toEqual([]);
    });

    it('returns [] when questions is not an array', () => {
      expect(mapAskUserQuestion({ questions: 'nope' } as never)).toEqual([]);
      expect(mapAskUserQuestion({ questions: 42 } as never)).toEqual([]);
    });

    it('drops questions with no usable prompt or no valid options', () => {
      const out = mapAskUserQuestion({
        questions: [
          { question: '   ', options: [{ label: 'a' }] }, // whitespace-only prompt
          { question: 'q', options: [] }, // no options
          { question: 'q', options: undefined } as never, // options missing
          { question: 'q', options: [{ label: '' }, { label: '  ' }] }, // all blank labels
          { question: 'keep', options: [{ label: 'a' }] }
        ]
      });
      expect(out).toHaveLength(1);
      expect(out[0].prompt).toBe('keep');
    });

    it('filters blank option labels but keeps the valid ones', () => {
      const out = mapAskUserQuestion({
        questions: [
          { question: 'Q', options: [{ label: 'keep' }, { label: '' }, { label: 'also' }] }
        ]
      });
      expect(out[0].options).toEqual([
        { id: 'A', label: 'keep' },
        { id: 'B', label: 'also' }
      ]);
    });

    it('never throws on garbage input and always returns an array', () => {
      const garbage: unknown[] = [
        'a string',
        42,
        true,
        [],
        { questions: [null, undefined, 42, 'x'] },
        { questions: [{ options: [{ label: 'a' }] }] }, // no question/header
        { questions: [{ question: 5, options: 'bad' }] },
        { questions: [null] }
      ];
      for (const g of garbage) {
        expect(() => mapAskUserQuestion(g as never)).not.toThrow();
        expect(Array.isArray(mapAskUserQuestion(g as never))).toBe(true);
      }
      expect(mapAskUserQuestion({ questions: [null] } as never)).toEqual([]);
    });
  });
});
