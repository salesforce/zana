import { describe, it, expect } from 'vitest';
import { inboxQuestions, hasBlockingQuestion, isThreadPendingInboxClone, type InboxEntry } from './inbox.js';

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

describe('isThreadPendingInboxClone', () => {
  it('matches leftover pending-interaction dedupe keys', () => {
    expect(isThreadPendingInboxClone({ dedupeKey: 'pending-interaction:pint_1' })).toBe(true);
    expect(isThreadPendingInboxClone({ dedupeKey: 'inbox-ask:q1' })).toBe(false);
  });

  it('matches the Open-thread-only clone shape even without a prefix', () => {
    expect(isThreadPendingInboxClone({
      question: {
        options: [{ id: 'A', label: 'Open thread' }],
        blocking: true
      }
    })).toBe(true);
  });

  it('leaves real inbox_ask questions alone', () => {
    expect(isThreadPendingInboxClone({
      subject: 'Ready to ship?',
      question: {
        options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'Not yet' }],
        blocking: true
      }
    })).toBe(false);
  });
});
