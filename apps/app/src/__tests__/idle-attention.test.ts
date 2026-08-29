import { describe, it, expect } from 'vitest';
import type { IdleResolution } from '@zana-ai/zcc-domain/product';
import { idleSurfacesToNeedsYou, type IdleAttentionSensitivity } from '../components/AgentBoard.js';

/**
 * idleSurfacesToNeedsYou is the pure renderer-side half of the "Need Attention"
 * idle-triage feature (Gap 2 + Gap 3): verdict + confidence + sensitivity →
 * does this idle agent jump to the "Needs you" lane? These pin the full mapping
 * table from the brainstorm — all three sensitivity levels × all four verdicts,
 * plus the confidence boundary that only `low` consults (0.69 below, 0.70 on).
 * Changing the table without updating these is the regression we're guarding.
 */

const VERDICTS: IdleResolution[] = ['awaiting-reply', 'done', 'paused', 'unknown'];

// Expected surfacing per (sensitivity → verdict), at "ordinary" confidence
// (0.9 — above the low bar so the level distinction, not the threshold, is what
// these rows isolate). The confidence boundary gets its own block below.
const TABLE: Record<IdleAttentionSensitivity, Record<IdleResolution, boolean>> = {
  high: { 'awaiting-reply': true, done: false, paused: true, unknown: true },
  medium: { 'awaiting-reply': true, done: false, paused: false, unknown: false },
  low: { 'awaiting-reply': true, done: false, paused: false, unknown: false }
};

describe('idleSurfacesToNeedsYou', () => {
  for (const sensitivity of Object.keys(TABLE) as IdleAttentionSensitivity[]) {
    describe(`sensitivity=${sensitivity}`, () => {
      for (const verdict of VERDICTS) {
        const expected = TABLE[sensitivity][verdict];
        it(`${verdict} → ${expected ? 'surfaces' : 'stays idle'}`, () => {
          expect(idleSurfacesToNeedsYou(verdict, 0.9, sensitivity)).toBe(expected);
        });
      }
    });
  }

  // `done` never surfaces here regardless of confidence (it gets the
  // bottom-sorted "Ready to close" badge in the Idle lane instead).
  it('never surfaces `done` at any sensitivity or confidence', () => {
    for (const sensitivity of ['high', 'medium', 'low'] as IdleAttentionSensitivity[]) {
      for (const confidence of [0, 0.69, 0.7, 1]) {
        expect(idleSurfacesToNeedsYou('done', confidence, sensitivity)).toBe(false);
      }
    }
  });

  describe('low: confidence boundary on awaiting-reply', () => {
    it('0.69 stays idle (below the 0.7 bar)', () => {
      expect(idleSurfacesToNeedsYou('awaiting-reply', 0.69, 'low')).toBe(false);
    });
    it('0.70 surfaces (meets the bar, inclusive)', () => {
      expect(idleSurfacesToNeedsYou('awaiting-reply', 0.7, 'low')).toBe(true);
    });
  });

  // medium/high ignore confidence for awaiting-reply (any confidence surfaces) —
  // so a 0.69 question that `low` suppresses still surfaces at medium/high.
  it('medium/high surface awaiting-reply regardless of confidence', () => {
    expect(idleSurfacesToNeedsYou('awaiting-reply', 0.1, 'medium')).toBe(true);
    expect(idleSurfacesToNeedsYou('awaiting-reply', 0.1, 'high')).toBe(true);
  });
});
