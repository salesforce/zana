import { describe, it, expect } from 'vitest';
import {
  containsUgc,
  assertUgcFree,
  isUgcFree,
  aggregateUsage,
  MAX_IDENTIFIER_LEN,
  TOP_SESSIONS_MAX,
  type TelemetryEvent,
  type UsageSessionEvent,
  type UsageRollupEvent
} from './telemetry-events.js';

const session = (over: Partial<UsageSessionEvent> = {}): UsageSessionEvent => ({
  kind: 'usage.session',
  sessionId: 's1',
  projectId: 'p1',
  projectName: 'my-project',
  ...over
});

const rollup = (over: Partial<UsageRollupEvent> = {}): UsageRollupEvent => ({
  kind: 'usage.rollup',
  dimension: 'project',
  label: 'my-project',
  totalTokens: 1000,
  promptCount: 5,
  toolCalls: 20,
  mcpCalls: 3,
  sessionCount: 3,
  ...over
});

describe('containsUgc', () => {
  it('is false for every current variant — the union is UGC-free by design', () => {
    expect(containsUgc(session())).toBe(false);
    expect(containsUgc(rollup())).toBe(false);
  });

  // This is the load-bearing guarantee: if someone adds a variant to the union
  // without classifying it here, the `never` exhaustiveness check fails to
  // compile. And a variant that carried content would have to return `true`.
  it('returns false for a fully-populated session (all optional fields set)', () => {
    expect(
      containsUgc(
        session({
          persona: 'reviewer',
          model: 'claude-opus-4-8',
          totalTokens: 45_000,
          promptCount: 12,
          toolCalls: 88,
          mcpCalls: 7,
          durationMs: 60_000
        })
      )
    ).toBe(false);
  });
});

describe('assertUgcFree', () => {
  it('passes a well-formed session and returns it for chaining', () => {
    const e = session({ persona: 'p', model: 'm', totalTokens: 2, promptCount: 1, toolCalls: 4, mcpCalls: 1, durationMs: 3 });
    expect(assertUgcFree(e)).toBe(e);
  });

  it('passes a well-formed rollup', () => {
    const e = rollup();
    expect(assertUgcFree(e)).toBe(e);
  });

  it('rejects a smuggled extra key (a field not on the variant allowlist)', () => {
    // A caller that tacked a `firstPrompt` onto the object — exactly the leak we
    // refuse. Keys outside the allowlist throw regardless of their value.
    const leaky = { ...session(), firstPrompt: 'fix the login bug' } as unknown as TelemetryEvent;
    expect(() => assertUgcFree(leaky)).toThrow(/unexpected key "firstPrompt"/);
  });

  it('rejects an over-long string value (prose masquerading as an identifier)', () => {
    const prose = 'x'.repeat(MAX_IDENTIFIER_LEN + 1);
    expect(() => assertUgcFree(session({ projectName: prose }))).toThrow(/too long for an identifier/);
  });

  it('allows a string exactly at the length limit (boundary)', () => {
    const atLimit = 'x'.repeat(MAX_IDENTIFIER_LEN);
    expect(() => assertUgcFree(session({ projectName: atLimit }))).not.toThrow();
  });

  it('ignores numeric fields regardless of magnitude (only strings are length-checked)', () => {
    expect(() => assertUgcFree(session({ totalTokens: 1e12, toolCalls: 1e9, mcpCalls: 1e6, durationMs: 1e15 }))).not.toThrow();
  });
});

describe('isUgcFree (non-throwing predicate)', () => {
  it('mirrors assertUgcFree without throwing', () => {
    expect(isUgcFree(session())).toBe(true);
    const leaky = { ...session(), notes: 'secret' } as unknown as TelemetryEvent;
    expect(isUgcFree(leaky)).toBe(false);
  });
});

describe('aggregateUsage', () => {
  const s = (over: Partial<UsageSessionEvent>): UsageSessionEvent => session(over);

  it('sums totals, groups by project and model, and ranks top sessions by tokens', () => {
    const summary = aggregateUsage(
      [
        s({ sessionId: 'a', projectName: 'alpha', model: 'claude-opus-4-8', totalTokens: 1000, promptCount: 3, toolCalls: 10, mcpCalls: 2 }),
        s({ sessionId: 'b', projectName: 'alpha', model: 'claude-sonnet-4-5', totalTokens: 400, promptCount: 1, toolCalls: 4, mcpCalls: 0 }),
        s({ sessionId: 'c', projectName: 'beta', model: 'claude-opus-4-8', totalTokens: 600, promptCount: 2, toolCalls: 6, mcpCalls: 1 })
      ],
      1234
    );

    expect(summary.generatedAt).toBe(1234);
    expect(summary.sessionCount).toBe(3);
    expect(summary.totalTokens).toBe(2000);
    expect(summary.totalPromptCount).toBe(6);
    expect(summary.totalToolCalls).toBe(20);
    expect(summary.totalMcpCalls).toBe(3);

    // by project: alpha (1000+400=1400) before beta (600)
    expect(summary.byProject.map((b) => [b.label, b.totalTokens, b.toolCalls, b.sessionCount])).toEqual([
      ['alpha', 1400, 14, 2],
      ['beta', 600, 6, 1]
    ]);
    // by model: opus (1000+600=1600) before sonnet (400)
    expect(summary.byModel.map((b) => [b.label, b.totalTokens, b.mcpCalls, b.sessionCount])).toEqual([
      ['claude-opus-4-8', 1600, 3, 2],
      ['claude-sonnet-4-5', 400, 0, 1]
    ]);
    // top sessions: a (1000), c (600), b (400)
    expect(summary.topSessions.map((e) => e.sessionId)).toEqual(['a', 'c', 'b']);
  });

  it('treats missing counts as zero and a missing model as "unknown"', () => {
    const summary = aggregateUsage([s({ sessionId: 'x', projectName: 'p', totalTokens: undefined })], 0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalPromptCount).toBe(0);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.byModel[0]?.label).toBe('unknown');
  });

  it('caps topSessions at topN (privacy + UI leaderboard cap)', () => {
    const many = Array.from({ length: TOP_SESSIONS_MAX + 5 }, (_, i) =>
      s({ sessionId: `s${i}`, totalTokens: i }) // ascending tokens
    );
    const summary = aggregateUsage(many, 0);
    expect(summary.topSessions).toHaveLength(TOP_SESSIONS_MAX);
    // highest tokens first — s{N+4} down
    expect(summary.topSessions[0]?.sessionId).toBe(`s${TOP_SESSIONS_MAX + 4}`);
    expect(summary.sessionCount).toBe(TOP_SESSIONS_MAX + 5); // count is NOT capped
  });

  it('breaks equal-token ties deterministically (label asc, then sessionId asc)', () => {
    const summary = aggregateUsage(
      [
        s({ sessionId: 'z', projectName: 'b', totalTokens: 500 }),
        s({ sessionId: 'y', projectName: 'a', totalTokens: 500 })
      ],
      0
    );
    expect(summary.byProject.map((b) => b.label)).toEqual(['a', 'b']);
    expect(summary.topSessions.map((e) => e.sessionId)).toEqual(['y', 'z']);
  });

  it('handles an empty input', () => {
    const summary = aggregateUsage([], 7);
    expect(summary).toEqual({
      generatedAt: 7,
      sessionCount: 0,
      totalTokens: 0,
      totalPromptCount: 0,
      totalToolCalls: 0,
      totalMcpCalls: 0,
      byProject: [],
      byModel: [],
      topSessions: []
    });
  });
});
