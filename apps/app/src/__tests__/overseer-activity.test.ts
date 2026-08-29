import { describe, it, expect, beforeEach } from 'vitest';
import type { OverseerActivity } from '@zana-ai/zcc-domain/product';
import { useOverseerActivity } from '../store.js';

/**
 * The `useOverseerActivity` slice is the renderer half of the Overseer→Attention
 * surface: it holds the per-session auto-approval rollup main pushes, keyed by
 * session id, and backs the card badge. These pin its contract: apply stores by
 * session, a no-op re-apply (identical counts) keeps the SAME object ref so
 * stable-ref selectors don't churn (the render-storm guard it shares with
 * useIdleTriage), and clear scrubs a session on tab close.
 */

const activity = (over: Partial<OverseerActivity> = {}): OverseerActivity => ({
  sessionId: 's1',
  autoApproved: 1,
  wouldApprove: 0,
  askedBack: 0,
  lastTier: 'allow-list',
  lastReason: 'read-only',
  lastAt: 1,
  ...over
});

beforeEach(() => {
  useOverseerActivity.setState({ byId: {} });
});

describe('useOverseerActivity', () => {
  it('stores activity keyed by session id', () => {
    useOverseerActivity.getState().apply(activity({ sessionId: 'a', autoApproved: 3 }));
    useOverseerActivity.getState().apply(activity({ sessionId: 'b', autoApproved: 7 }));
    const { byId } = useOverseerActivity.getState();
    expect(byId.a.autoApproved).toBe(3);
    expect(byId.b.autoApproved).toBe(7);
  });

  it('skips a no-op re-apply (identical counts keep the same ref)', () => {
    useOverseerActivity.getState().apply(activity({ autoApproved: 2 }));
    const first = useOverseerActivity.getState().byId.s1;
    // Same counts, different last* — still a no-op (the badge only shows counts).
    useOverseerActivity.getState().apply(activity({ autoApproved: 2, lastReason: 'other' }));
    expect(useOverseerActivity.getState().byId.s1).toBe(first);
  });

  it('replaces when a count changes', () => {
    useOverseerActivity.getState().apply(activity({ autoApproved: 2 }));
    const first = useOverseerActivity.getState().byId.s1;
    useOverseerActivity.getState().apply(activity({ autoApproved: 3 }));
    expect(useOverseerActivity.getState().byId.s1).not.toBe(first);
    expect(useOverseerActivity.getState().byId.s1.autoApproved).toBe(3);
  });

  it('clears one session, leaving others', () => {
    useOverseerActivity.getState().apply(activity({ sessionId: 'a' }));
    useOverseerActivity.getState().apply(activity({ sessionId: 'b' }));
    useOverseerActivity.getState().clear('a');
    const { byId } = useOverseerActivity.getState();
    expect(byId.a).toBeUndefined();
    expect(byId.b).toBeDefined();
  });
});
