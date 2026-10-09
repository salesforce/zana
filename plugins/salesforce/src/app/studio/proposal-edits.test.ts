import { expect, it } from 'vitest';
import { applyProposalEdits } from './proposal-edits.js';

const source = ['one', 'two', 'three', 'four'].join('\n');

it('replaces, deletes and expands line ranges regardless of edit order', () => {
  expect(applyProposalEdits(source, [{ startLine: 2, endLine: 2, text: 'TWO' }])).toBe('one\nTWO\nthree\nfour');
  expect(applyProposalEdits(source, [{ startLine: 2, endLine: 3, text: '' }])).toBe('one\nfour');
  expect(applyProposalEdits(source, [{ startLine: 1, endLine: 1, text: 'a\nb' }, { startLine: 4, endLine: 4, text: 'last' }])).toBe('a\nb\ntwo\nthree\nlast');
  expect(applyProposalEdits(source, [])).toBe(source);
});

it('rejects out-of-range and overlapping edits', () => {
  expect(() => applyProposalEdits(source, [{ startLine: 0, endLine: 1, text: 'x' }])).toThrow(/outside the file/);
  expect(() => applyProposalEdits(source, [{ startLine: 3, endLine: 2, text: 'x' }])).toThrow(/outside the file/);
  expect(() => applyProposalEdits(source, [{ startLine: 4, endLine: 9, text: 'x' }])).toThrow(/outside the file/);
  expect(() => applyProposalEdits(source, [{ startLine: 1, endLine: 2, text: 'x' }, { startLine: 2, endLine: 3, text: 'y' }])).toThrow(/overlap/);
});
