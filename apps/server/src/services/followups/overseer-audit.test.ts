import { describe, it, expect } from 'vitest';
import { OverseerAuditRing, DEFAULT_AUDIT_CAP } from './overseer-audit.js';
import type { OverseerAuditEntry } from '@zana-ai/zcc-domain/product';

/**
 * The audit ring is the bounded trail of Overseer decisions that backs both the
 * dry-run review pane (`recent`) and the per-session card badge (`rollup`).
 * These pin: the hard retention cap (oldest-first eviction — Rule 5), the
 * newest-first `recent` order, the dryRun computed≠verdict accounting, and that
 * `clear` scrubs a session on tab close.
 */

let seq = 0;
const entry = (over: Partial<OverseerAuditEntry> = {}): OverseerAuditEntry => ({
  sessionId: 's1',
  projectId: 'p1',
  toolName: 'Read',
  tier: 'allow-list',
  computed: 'allow',
  verdict: 'allow',
  reason: 'read-only',
  at: ++seq,
  ...over
});

describe('OverseerAuditRing — retention', () => {
  it('caps at the configured size, evicting oldest-first', () => {
    const ring = new OverseerAuditRing(3);
    for (let i = 0; i < 5; i++) ring.record(entry({ toolName: `t${i}`, at: i }));
    expect(ring.size()).toBe(3);
    // Newest-first: the last three recorded (t2, t3, t4) survive; t0/t1 evicted.
    expect(ring.recent().map((e) => e.toolName)).toEqual(['t4', 't3', 't2']);
  });

  it('defaults to DEFAULT_AUDIT_CAP', () => {
    const ring = new OverseerAuditRing();
    for (let i = 0; i < DEFAULT_AUDIT_CAP + 10; i++) ring.record(entry({ at: i }));
    expect(ring.size()).toBe(DEFAULT_AUDIT_CAP);
  });
});

describe('OverseerAuditRing — recent', () => {
  it('returns newest-first and honors the limit', () => {
    const ring = new OverseerAuditRing();
    ring.record(entry({ toolName: 'a' }));
    ring.record(entry({ toolName: 'b' }));
    ring.record(entry({ toolName: 'c' }));
    expect(ring.recent(2).map((e) => e.toolName)).toEqual(['c', 'b']);
  });

  it('is empty before any decision', () => {
    expect(new OverseerAuditRing().recent()).toEqual([]);
  });
});

describe('OverseerAuditRing — rollup', () => {
  it('counts real auto-approvals (verdict allow)', () => {
    const ring = new OverseerAuditRing();
    ring.record(entry({ verdict: 'allow', computed: 'allow' }));
    ring.record(entry({ verdict: 'allow', computed: 'allow' }));
    const r = ring.rollup('s1')!;
    expect(r.autoApproved).toBe(2);
    expect(r.wouldApprove).toBe(0);
    expect(r.askedBack).toBe(0);
  });

  it('in dryRun counts computed-allow/verdict-ask as wouldApprove, not autoApproved', () => {
    const ring = new OverseerAuditRing();
    ring.record(entry({ computed: 'allow', verdict: 'ask' })); // dryRun "would"
    ring.record(entry({ computed: 'ask', verdict: 'ask' })); // genuine ask-back
    const r = ring.rollup('s1')!;
    expect(r.autoApproved).toBe(0);
    expect(r.wouldApprove).toBe(1);
    expect(r.askedBack).toBe(1);
  });

  it('mirrors the newest decision into last*', () => {
    const ring = new OverseerAuditRing();
    ring.record(entry({ tier: 'allow-list', reason: 'first', at: 1 }));
    ring.record(entry({ tier: 'llm', reason: 'latest', at: 2 }));
    const r = ring.rollup('s1')!;
    expect(r.lastTier).toBe('llm');
    expect(r.lastReason).toBe('latest');
    expect(r.lastAt).toBe(2);
  });

  it('scopes counts per session', () => {
    const ring = new OverseerAuditRing();
    ring.record(entry({ sessionId: 's1', verdict: 'allow' }));
    ring.record(entry({ sessionId: 's2', verdict: 'ask', computed: 'ask' }));
    expect(ring.rollup('s1')!.autoApproved).toBe(1);
    expect(ring.rollup('s2')!.askedBack).toBe(1);
  });

  it('returns null for a session with no entries', () => {
    expect(new OverseerAuditRing().rollup('nobody')).toBeNull();
  });
});

describe('OverseerAuditRing — clear', () => {
  it('drops only the named session', () => {
    const ring = new OverseerAuditRing();
    ring.record(entry({ sessionId: 's1' }));
    ring.record(entry({ sessionId: 's2' }));
    ring.clear('s1');
    expect(ring.rollup('s1')).toBeNull();
    expect(ring.rollup('s2')).not.toBeNull();
    expect(ring.size()).toBe(1);
  });
});
