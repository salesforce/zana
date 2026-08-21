import { describe, it, expect } from 'vitest';
import type { IdleTriageResult } from '@zana-ai/zcc-domain/product';
import { sideListNeedsYou } from '../components/listpane/AgentsList.js';

/**
 * The left-side AgentsListPane "Needs you" group. Contract:
 *  - `blocked` is ALWAYS "Needs you" (a real permission prompt / question),
 *    regardless of the optional setting.
 *  - A triage-flagged idle agent is promoted to "Needs you" ONLY when the
 *    `agentListNeedsYouFromTriage` setting is on; otherwise it stays Idle.
 *  - A `working` agent is never "Needs you" here (it has its own group).
 * This guards the opt-in gating the user asked for.
 */
const awaitingReply: IdleTriageResult = {
  sessionId: 's1',
  resolution: 'awaiting-reply',
  summary: 'needs a decision',
  confidence: 0.95,
  at: 0
};

describe('sideListNeedsYou', () => {
  it('blocked is always Needs you, setting off or on', () => {
    expect(sideListNeedsYou({ state: 'blocked' }, false, 'medium')).toBe(true);
    expect(sideListNeedsYou({ state: 'blocked' }, true, 'medium')).toBe(true);
  });

  it('a triaged idle agent is NOT promoted when the setting is OFF', () => {
    expect(sideListNeedsYou({ state: 'idle', triage: awaitingReply }, false, 'medium')).toBe(false);
  });

  it('a triaged idle agent IS promoted when the setting is ON', () => {
    expect(sideListNeedsYou({ state: 'idle', triage: awaitingReply }, true, 'medium')).toBe(true);
  });

  it('respects sensitivity: a low-confidence question is suppressed at low sensitivity', () => {
    const lowConf: IdleTriageResult = { ...awaitingReply, confidence: 0.4 };
    expect(sideListNeedsYou({ state: 'idle', triage: lowConf }, true, 'low')).toBe(false);
    // …but medium ignores confidence for awaiting-reply, so it surfaces there.
    expect(sideListNeedsYou({ state: 'idle', triage: lowConf }, true, 'medium')).toBe(true);
  });

  it('an idle agent with no triage verdict is never promoted', () => {
    expect(sideListNeedsYou({ state: 'idle' }, true, 'high')).toBe(false);
  });

  it('a working agent is never Needs you here, even triaged', () => {
    expect(sideListNeedsYou({ state: 'working', triage: awaitingReply }, true, 'high')).toBe(false);
  });

  it('a `done` triage verdict never surfaces (it is not awaiting you)', () => {
    const done: IdleTriageResult = { ...awaitingReply, resolution: 'done' };
    expect(sideListNeedsYou({ state: 'idle', triage: done }, true, 'high')).toBe(false);
  });
});
