import { describe, it, expect } from 'vitest';
import { inboxQuestions, hasBlockingQuestion, type InboxEntry } from '../types.js';

const opt = { id: 'A', label: 'Yes' };

describe('inboxQuestions', () => {
  it('returns [] when the entry carries no question', () => {
    expect(inboxQuestions({})).toEqual([]);
  });

  it('wraps a lone `question`', () => {
    expect(inboxQuestions({ question: { options: [opt] } })).toHaveLength(1);
  });

  it('prefers `questions` over `question` when both are set', () => {
    const qs = inboxQuestions({
      question: { options: [opt] },
      questions: [{ options: [opt] }, { options: [opt] }]
    });
    expect(qs).toHaveLength(2);
  });
});

describe('hasBlockingQuestion', () => {
  it('is false with no questions', () => {
    expect(hasBlockingQuestion({})).toBe(false);
  });

  it('is false for a non-blocking (soft) question', () => {
    expect(hasBlockingQuestion({ question: { options: [opt] } })).toBe(false);
    expect(hasBlockingQuestion({ question: { options: [opt], blocking: false } })).toBe(false);
  });

  it('is true for a single blocking question', () => {
    expect(hasBlockingQuestion({ question: { options: [opt], blocking: true } })).toBe(true);
  });

  it('is true when ANY question in a multi-form is blocking', () => {
    const entry: Pick<InboxEntry, 'questions'> = {
      questions: [{ options: [opt] }, { options: [opt], blocking: true }]
    };
    expect(hasBlockingQuestion(entry)).toBe(true);
  });

  it('is false when every question in a multi-form is non-blocking', () => {
    expect(
      hasBlockingQuestion({ questions: [{ options: [opt] }, { options: [opt], blocking: false }] })
    ).toBe(false);
  });
});
