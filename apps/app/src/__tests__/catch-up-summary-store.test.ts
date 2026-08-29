import { describe, it, expect, beforeEach } from 'vitest';
import { useCatchUpSummary, useData } from '../store.js';
import type { CatchUpSummaryResult } from '@zana-ai/zcc-domain/product';

/**
 * Tests for the useCatchUpSummary Zustand slice — stores catch-up summaries
 * keyed by sessionId, with apply/clear/clearProject ops. Mirrors useIdleTriage
 * and useOverseerActivity siblings.
 */

describe('useCatchUpSummary', () => {
  const makeResult = (sessionId: string, over: Partial<CatchUpSummaryResult> = {}): CatchUpSummaryResult => ({
    sessionId,
    projectId: 'p1',
    ok: true,
    text: '**Summary**\n\n- Did the thing',
    trigger: 'idle',
    ms: 10,
    generatedAt: 1000,
    ...over
  });

  beforeEach(() => {
    // Reset both stores to a clean slate before each test.
    useCatchUpSummary.setState({ bySession: {} });
    useData.setState({ terminals: {} });
  });

  describe('apply', () => {
    it('stores a result keyed by sessionId', () => {
      const result = makeResult('s1');
      useCatchUpSummary.getState().apply(result);
      expect(useCatchUpSummary.getState().bySession['s1']).toEqual(result);
    });

    it('overwrites an existing result for the same sessionId', () => {
      const first = makeResult('s1', { text: 'First summary' });
      const second = makeResult('s1', { text: 'Second summary' });
      useCatchUpSummary.getState().apply(first);
      useCatchUpSummary.getState().apply(second);
      expect(useCatchUpSummary.getState().bySession['s1']).toEqual(second);
    });

    it('skips a no-op re-apply (same text + trigger) so subscribers do not churn', () => {
      const result = makeResult('s1');
      useCatchUpSummary.getState().apply(result);
      const stateBefore = useCatchUpSummary.getState();
      useCatchUpSummary.getState().apply(result);
      const stateAfter = useCatchUpSummary.getState();
      // Same reference — no state mutation
      expect(stateBefore).toBe(stateAfter);
    });

    it('does apply when text differs (even if other fields match)', () => {
      const first = makeResult('s1', { text: 'First' });
      const second = makeResult('s1', { text: 'Second' });
      useCatchUpSummary.getState().apply(first);
      const stateBefore = useCatchUpSummary.getState();
      useCatchUpSummary.getState().apply(second);
      const stateAfter = useCatchUpSummary.getState();
      expect(stateBefore).not.toBe(stateAfter);
      expect(stateAfter.bySession['s1'].text).toBe('Second');
    });

    it('does apply when trigger differs (even if text matches)', () => {
      const first = makeResult('s1', { trigger: 'idle' });
      const second = makeResult('s1', { trigger: 'blocked' });
      useCatchUpSummary.getState().apply(first);
      const stateBefore = useCatchUpSummary.getState();
      useCatchUpSummary.getState().apply(second);
      const stateAfter = useCatchUpSummary.getState();
      expect(stateBefore).not.toBe(stateAfter);
      expect(stateAfter.bySession['s1'].trigger).toBe('blocked');
    });

    it('stores multiple sessions independently', () => {
      useCatchUpSummary.getState().apply(makeResult('s1'));
      useCatchUpSummary.getState().apply(makeResult('s2'));
      expect(Object.keys(useCatchUpSummary.getState().bySession)).toEqual(['s1', 's2']);
    });
  });

  describe('clear', () => {
    it('removes a single session by id', () => {
      useCatchUpSummary.getState().apply(makeResult('s1'));
      useCatchUpSummary.getState().apply(makeResult('s2'));
      useCatchUpSummary.getState().clear('s1');
      expect(useCatchUpSummary.getState().bySession).toEqual({ s2: makeResult('s2') });
    });

    it('is a no-op when the session does not exist', () => {
      useCatchUpSummary.getState().apply(makeResult('s1'));
      const before = useCatchUpSummary.getState();
      useCatchUpSummary.getState().clear('unknown');
      const after = useCatchUpSummary.getState();
      // No mutation
      expect(before).toBe(after);
    });

    it('leaves bySession empty when clearing the last session', () => {
      useCatchUpSummary.getState().apply(makeResult('s1'));
      useCatchUpSummary.getState().clear('s1');
      expect(useCatchUpSummary.getState().bySession).toEqual({});
    });
  });

  describe('clearProject', () => {
    it('removes all summaries for sessions in the given project (mirrors useIdleTriage)', () => {
      // Fixture: useData.terminals holds the project→sessions membership.
      useData.setState({
        terminals: {
          p1: [
            { id: 's1', projectId: 'p1', profile: 'claude', cwd: '/proj', status: 'running' } as any,
            { id: 's2', projectId: 'p1', profile: 'claude', cwd: '/proj', status: 'running' } as any
          ],
          p2: [{ id: 's3', projectId: 'p2', profile: 'claude', cwd: '/proj', status: 'running' } as any]
        }
      });
      // Store summaries for all three sessions.
      useCatchUpSummary.getState().apply(makeResult('s1', { projectId: 'p1' }));
      useCatchUpSummary.getState().apply(makeResult('s2', { projectId: 'p1' }));
      useCatchUpSummary.getState().apply(makeResult('s3', { projectId: 'p2' }));

      // Clear project p1 → removes s1 and s2, leaves s3.
      useCatchUpSummary.getState().clearProject('p1');

      const remaining = useCatchUpSummary.getState().bySession;
      expect(Object.keys(remaining)).toEqual(['s3']);
      expect(remaining['s3'].sessionId).toBe('s3');
    });

    it('is a no-op when the project has no terminals', () => {
      useCatchUpSummary.getState().apply(makeResult('s1'));
      const before = useCatchUpSummary.getState();
      useCatchUpSummary.getState().clearProject('unknown');
      const after = useCatchUpSummary.getState();
      expect(before).toBe(after);
    });

    it('is a no-op when none of the project\'s sessions have summaries', () => {
      useData.setState({
        terminals: {
          p1: [{ id: 's1', projectId: 'p1', profile: 'claude', cwd: '/proj', status: 'running' } as any]
        }
      });
      // No summary stored for s1.
      const before = useCatchUpSummary.getState();
      useCatchUpSummary.getState().clearProject('p1');
      const after = useCatchUpSummary.getState();
      expect(before).toBe(after);
    });

    it('only clears summaries that exist (partial membership)', () => {
      useData.setState({
        terminals: {
          p1: [
            { id: 's1', projectId: 'p1', profile: 'claude', cwd: '/proj', status: 'running' } as any,
            { id: 's2', projectId: 'p1', profile: 'claude', cwd: '/proj', status: 'running' } as any
          ]
        }
      });
      // Only s1 has a summary; s2 does not.
      useCatchUpSummary.getState().apply(makeResult('s1'));

      useCatchUpSummary.getState().clearProject('p1');

      expect(useCatchUpSummary.getState().bySession).toEqual({});
    });
  });
});
