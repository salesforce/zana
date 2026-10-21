import { describe, it, expect } from 'vitest';
import type { InboxQuestion } from '@zana-ai/zcc-domain/product';
import { answerFor, buildReply, emptyQState, splitRecommended } from './inbox-answer.js';

const q = (over: Partial<InboxQuestion> = {}): InboxQuestion =>
  ({ prompt: 'Pick', options: [{ id: 'A', label: 'Left' }, { id: 'B', label: 'Right' }], ...over }) as InboxQuestion;

describe('answerFor', () => {
  it('radio: the chosen label, or Other when active', () => {
    expect(answerFor(q(), { ...emptyQState(), selected: new Set(['B']) })).toBe('Right');
    expect(answerFor(q(), { selected: new Set(['B']), otherText: ' mine ', otherActive: true })).toBe('mine');
    expect(answerFor(q(), emptyQState())).toBe('');
  });

  it('multi: joins choices and Other', () => {
    expect(answerFor(q({ multiSelect: true }), { selected: new Set(['A', 'B']), otherText: 'up', otherActive: true })).toBe('Left, Right, up');
  });
});

describe('buildReply', () => {
  it('one question → raw answer; many → labelled blocks', () => {
    expect(buildReply([q()], ['Left'])).toBe('Left');
    expect(buildReply([q({ prompt: 'Side?' }), q({ prompt: 'Speed?' })], ['Left', 'Fast'])).toBe('Q1: Side?\nA: Left\n\nQ2: Speed?\nA: Fast');
  });
});

describe('splitRecommended', () => {
  it('detects the tag in both bracket styles', () => {
    expect(splitRecommended('Ship it (Recommended)')).toEqual({ label: 'Ship it', recommended: true });
    expect(splitRecommended('Ship it [recommended]')).toEqual({ label: 'Ship it', recommended: true });
    expect(splitRecommended('Recommended reading')).toEqual({ label: 'Recommended reading', recommended: false });
  });
});
