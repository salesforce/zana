import { describe, expect, it } from 'vitest';
import { applyHunks } from '../../lib/line-diff.js';
import { ProposalSession, proposalLabel } from './proposal.js';

const mk = (proposed: string) => new ProposalSession({ proposalId: 'p1', proposed, summary: 's', actor: 'Agent' });

describe('ProposalSession', () => {
  it('lays out deletes and adds', () => {
    const s = mk('a\nB\nc\nd\nnew');
    s.refresh('a\nb\nc\nd');
    expect(s.layout()).toEqual([
      { index: 0, deleteRange: { startLine: 2, endLine: 2 }, zoneAfterLine: 2, addLines: ['B'], widgetLine: 2 },
      { index: 1, deleteRange: undefined, zoneAfterLine: 4, addLines: ['new'], widgetLine: 5 }
    ].map(row => expect.objectContaining(row)));
    expect(s.resolved).toBe(false);
  });
  it('tracks accepted/rejected and the outcome', () => {
    const s = mk('a\nB\nc\nd\nnew');
    s.refresh('a\nb\nc\nd');
    expect(s.rejectHunk(99)).toBe(false);
    expect(s.rejectHunk(0)).toBe(true);
    s.noteAccepted(1);
    // after the host applied hunk 1 the current text contains it; the rejected hunk stays hidden
    s.refresh('a\nb\nc\nd\nnew');
    expect(s.resolved).toBe(true);
    expect(s.outcome()).toEqual({ outcome: 'partial', acceptedHunks: 1, rejectedHunks: 1 });
  });
  it('reject all / accept all outcomes and identical proposals', () => {
    const r = mk('x');
    r.refresh('y');
    expect(r.rejectAll()).toBe(1);
    expect(r.outcome()).toEqual({ outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 1 });
    const a = mk('x');
    a.refresh('y');
    a.noteAccepted(a.hunks.length);
    a.refresh('x');
    expect(a.outcome().outcome).toBe('accepted');
    const none = mk('same');
    none.refresh('same');
    expect(none.resolved).toBe(true);
    expect(none.outcome()).toEqual({ outcome: 'accepted', acceptedHunks: 0, rejectedHunks: 0 });
  });
  it('re-derives hunks after a foreign edit and keeps rejects rejected', () => {
    const s = mk('a\nB\nc\nD');
    s.refresh('a\nb\nc\nd');
    s.rejectHunk(0);
    s.refresh('zero\na\nb\nc\nd');
    expect(s.hunks).toHaveLength(2);
    expect(s.hunks.every(h => h.newLines[0] !== 'B')).toBe(true);
    expect(applyHunks('a\nb\nc\nd', s.hunks, new Set())).toBe('a\nb\nc\nd');
  });
  it('falls back to a whole-file hunk for oversized diffs', () => {
    const big = Array.from({ length: 1600 }, (_, i) => `l${i}`).join('\n');
    const s = mk(big.replace(/l/g, 'm'));
    s.refresh(big);
    expect(s.hunks).toHaveLength(1);
    expect(s.hunks[0]!.oldLines).toHaveLength(1600);
  });
  it('labels', () => {
    expect(proposalLabel(1)).toBe('1 change');
    expect(proposalLabel(3)).toBe('3 changes');
  });
});
