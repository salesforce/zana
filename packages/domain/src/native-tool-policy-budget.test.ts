import { describe, expect, it } from 'vitest';
import {
  ASK_APPROVAL_MS,
  DECISION_PHASE_MAX_MS,
  HOOK_TIMEOUT_SEC,
  MAX_MAIN_CEILING_MS,
  RELAY_BACKSTOP_MS,
  RELAY_BACKSTOP_SEC,
  TOOL_POLICY_ASK_RENDERER_ID,
  clampAskApprovalMs,
  isToolPolicyAskAllow,
  mainCeilingMs,
  parseToolPolicyAskCard,
  sanitizeToolPolicyAskText
} from './native-tool-policy-budget.js';

describe('native tool policy budget', () => {
  it('matches the decided approval range', () => {
    expect(ASK_APPROVAL_MS).toEqual({ min: 10_000, max: 120_000, default: 60_000 });
  });

  it.each([
    [undefined, 60_000],
    [null, 60_000],
    ['5000', 60_000],
    [Number.NaN, 60_000],
    [Number.POSITIVE_INFINITY, 60_000],
    [0, 10_000],
    [-5, 10_000],
    [9_999, 10_000],
    [10_000, 10_000],
    [20_000.9, 20_000],
    [120_000, 120_000],
    [120_001, 120_000],
    [9e9, 120_000]
  ])('clamps %s to %s', (requested, expected) => {
    expect(clampAskApprovalMs(requested)).toBe(expected);
  });

  it('adds both phases and the margin to the ceiling', () => {
    expect(mainCeilingMs(5_000)).toBe(6_000);
    expect(mainCeilingMs(5_000, 60_000)).toBe(66_000);
    expect(MAX_MAIN_CEILING_MS).toBe(mainCeilingMs(DECISION_PHASE_MAX_MS, ASK_APPROVAL_MS.max));
  });

  it('keeps every transport backstop above every main ceiling', () => {
    const ceilings = [mainCeilingMs(DECISION_PHASE_MAX_MS), mainCeilingMs(DECISION_PHASE_MAX_MS, ASK_APPROVAL_MS.min),
      mainCeilingMs(DECISION_PHASE_MAX_MS, ASK_APPROVAL_MS.default), MAX_MAIN_CEILING_MS];
    for (const ceiling of ceilings) {
      expect(ceiling).toBeLessThan(RELAY_BACKSTOP_MS);
      expect(ceiling).toBeLessThan(RELAY_BACKSTOP_SEC * 1_000);
    }
    expect(RELAY_BACKSTOP_SEC * 1_000).toBeGreaterThanOrEqual(RELAY_BACKSTOP_MS);
    expect(HOOK_TIMEOUT_SEC).toBeGreaterThan(RELAY_BACKSTOP_SEC);
  });
});

describe('ask card helpers', () => {
  it('parses only a well-formed card', () => {
    expect(parseToolPolicyAskCard(null)).toBeNull();
    expect(parseToolPolicyAskCard('x')).toBeNull();
    expect(parseToolPolicyAskCard({ kind: 'other', toolName: 'a', prompt: 'p' })).toBeNull();
    expect(parseToolPolicyAskCard({ kind: 'tool-policy-ask', toolName: 1, prompt: 'p' })).toBeNull();
    expect(parseToolPolicyAskCard({ kind: 'tool-policy-ask', toolName: 'a', prompt: 'p' }))
      .toEqual({ kind: 'tool-policy-ask', toolName: 'a', prompt: 'p', inputPreview: '' });
    expect(parseToolPolicyAskCard({ kind: 'tool-policy-ask', toolName: 'a', prompt: 'p', inputPreview: 'i' })?.inputPreview).toBe('i');
  });

  it('treats only an exact allow as allow', () => {
    expect(isToolPolicyAskAllow({ decision: 'allow' })).toBe(true);
    expect(isToolPolicyAskAllow({ decision: 'deny' })).toBe(false);
    expect(isToolPolicyAskAllow({ decision: 'ALLOW' })).toBe(false);
    expect(isToolPolicyAskAllow('allow')).toBe(false);
    expect(isToolPolicyAskAllow(null)).toBe(false);
    expect(isToolPolicyAskAllow(undefined)).toBe(false);
  });

  it('sanitizes and caps card text', () => {
    expect(sanitizeToolPolicyAskText('  a\u0000b\u0007c\nd  ', 50)).toBe('abc\nd');
    expect(sanitizeToolPolicyAskText('x'.repeat(30), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('keeps the renderer id out of reach of plugin renderer ids', () => {
    expect(TOOL_POLICY_ASK_RENDERER_ID).not.toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});
