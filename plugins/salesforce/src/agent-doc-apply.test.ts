import { describe, expect, it } from 'vitest';
import { applyProposalText, proposalEditsError } from '../lib/agent-doc-apply.js';
import { applyProposalEdits } from './app/studio/proposal-edits.js';

const SHA = 'a'.repeat(64);
const edits = (list: Array<[number, number, string]>) => ({ path: 'a.agent', expectedSha256: SHA, summary: 's', edits: list.map(([startLine, endLine, text]) => ({ startLine, endLine, text })) });

describe('applyProposalText', () => {
  it('replaces the whole text with content', () => {
    expect(applyProposalText('old', { path: 'a.agent', expectedSha256: SHA, summary: 's', content: 'new\n' })).toBe('new\n');
    expect(applyProposalText('old', { path: 'a.agent', expectedSha256: SHA, summary: 's', content: '' })).toBe('');
  });
  it('returns the text unchanged without edits', () => {
    expect(applyProposalText('a\nb', { path: 'a.agent', expectedSha256: SHA, summary: 's', edits: [] })).toBe('a\nb');
  });
  it('replaces an inclusive 1-based range', () => {
    expect(applyProposalText('a\nb\nc\nd', edits([[2, 3, 'X\nY\nZ']]))).toBe('a\nX\nY\nZ\nd');
  });
  it('deletes with empty text and, like the editor, keeps a trailing newline of an edit as an empty line', () => {
    expect(applyProposalText('a\nb\nc', edits([[2, 2, 'X\n']]))).toBe('a\nX\n\nc');
    expect(applyProposalText('a\nb\nc', edits([[2, 2, '']]))).toBe('a\nc');
  });
  it('inserts before startLine when endLine = startLine - 1', () => {
    expect(applyProposalText('a\nb', edits([[2, 1, 'X']]))).toBe('a\nX\nb');
    expect(applyProposalText('a\nb', edits([[1, 0, 'X']]))).toBe('X\na\nb');
  });
  it('applies several edits bottom-up against the original line numbers', () => {
    expect(applyProposalText('1\n2\n3\n4\n5', edits([[1, 1, 'one\nuno'], [4, 4, ''], [3, 2, 'ins']]))).toBe('one\nuno\n2\nins\n3\n5');
  });
  it('orders edits on the same line deterministically', () => {
    expect(applyProposalText('a\nb', edits([[2, 1, 'X'], [2, 1, 'Y']]))).toBe('a\nX\nY\nb');
  });
  it('keeps a trailing newline and appends before it', () => {
    expect(applyProposalText('a\nb\n', edits([[2, 2, 'B']]))).toBe('a\nB\n');
    expect(applyProposalText('a\nb\n', edits([[3, 2, 'c']]))).toBe('a\nb\nc\n');
    expect(applyProposalText('a\nb', edits([[3, 2, 'c']]))).toBe('a\nb\nc');
  });
  it('preserves CRLF line endings', () => {
    expect(applyProposalText('a\r\nb\r\nc\r\n', edits([[2, 2, 'X\nY']]))).toBe('a\r\nX\r\nY\r\nc\r\n');
    expect(applyProposalText('a\r\nb', edits([[1, 1, 'X\r\nY']]))).toBe('X\r\nY\r\nb');
  });
  it('clamps ranges outside the text', () => {
    expect(applyProposalText('a\nb', edits([[2, 99, 'X']]))).toBe('a\nX');
    expect(applyProposalText('a\nb', edits([[99, 98, 'X']]))).toBe('a\nb\nX');
    expect(applyProposalText('', edits([[1, 0, 'X']]))).toBe('X\n');
  });
});

describe('parity with the editor (applyProposalEdits)', () => {
  const source = 'one\ntwo\nthree\nfour\n';
  const cases: Array<[number, number, string][]> = [
    [[2, 2, 'TWO']], [[2, 3, '']], [[1, 1, 'a\nb'], [4, 4, 'last']], [[2, 2, 'X\n']], [[5, 5, 'tail']], [[1, 4, 'x\ny\n']]
  ];
  it.each(cases.map((list, i) => [i, list] as const))('case %i yields the editor text', (_i, list) => {
    const list2 = list.map(([startLine, endLine, text]) => ({ startLine, endLine, text }));
    expect(applyProposalText(source, edits(list))).toBe(applyProposalEdits(source, list2));
  });
});

describe('proposalEditsError', () => {
  const edit = (startLine: number, endLine: number) => ({ startLine, endLine, text: 'x' });
  it('accepts what the editor accepts', () => {
    expect(proposalEditsError('a\nb\nc\n', [edit(1, 1), edit(4, 4)])).toBeNull();
    expect(proposalEditsError('a\r\nb', [edit(2, 2)])).toBeNull();
    expect(proposalEditsError('a', undefined)).toBeNull();
  });
  it('refuses what the editor refuses, with its message', () => {
    for (const [text, edits] of [['a\nb', [edit(1, 3)]], ['a\nb', [edit(2, 1)]], ['a', [edit(0, 1)]], ['a', [edit(1.5, 2)]]] as const) {
      const error = proposalEditsError(text, [...edits]);
      expect(error).toMatch(/outside the file/);
      expect(() => applyProposalEdits(text, [...edits])).toThrow(error!);
    }
    expect(proposalEditsError('a\nb\nc', [edit(1, 2), edit(2, 3)])).toBe('Proposed edits overlap.');
    expect(() => applyProposalEdits('a\nb\nc', [edit(1, 2), edit(2, 3)])).toThrow('Proposed edits overlap.');
  });
});
