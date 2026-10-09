import { describe, expect, it } from 'vitest';
import type { TurnTrace } from '../../lib/studio-contract.js';
import {
  MAX_RUN_HISTORY, appendRun, caseFromRun, diffRuns, engineToLab, exportRunPayload,
  suiteChip, suiteTally, traceActions, traceSummary, traceTopics, type RunRecord
} from './agentforce-preview-logic.js';

const trace = (planId: string, topic: string, action?: string): TurnTrace => ({
  runId: 'r', turn: 1, planId, available: true,
  steps: [
    { kind: 'topic', label: topic, latencyMs: 10 },
    ...(action ? [{ kind: 'action' as const, label: action, latencyMs: 5 }] : [])
  ]
});
const run = (runId: string, reply = 'hi', topic = 'Orders'): RunRecord => ({
  runId, engine: 'simulate', at: 1, file: 'A.agent',
  turns: [{ role: 'user', text: 'hello' }, { role: 'agent', text: reply, planId: 'p1' }],
  traces: { p1: trace('p1', topic, 'GetOrder') }
});

describe('run helpers', () => {
  it('maps engines', () => {
    expect(engineToLab('rehearse')).toBe('rehearsal');
    expect(engineToLab('simulate')).toBe('preview');
    expect(engineToLab('live')).toBeNull();
  });
  it('appendRun is newest-first, deduped and bounded', () => {
    let runs: RunRecord[] = [];
    for (let i = 0; i < 15; i++) runs = appendRun(runs, run(`r${i}`));
    expect(runs).toHaveLength(MAX_RUN_HISTORY);
    expect(runs[0].runId).toBe('r14');
    expect(appendRun(runs, run('r10'))[0].runId).toBe('r10');
    expect(appendRun(runs, run('r10')).filter(r => r.runId === 'r10')).toHaveLength(1);
  });
  it('reads topics, actions and summary', () => {
    const t = trace('p', 'T', 'A');
    expect(traceTopics(t)).toEqual(['T']);
    expect(traceActions(t)).toEqual(['A']);
    expect(traceTopics(undefined)).toEqual([]);
    expect(traceActions({ ...t, available: false })).toEqual([]);
    expect(traceSummary(t)).toEqual({ steps: 2, totalMs: 15 });
  });
  it('diffs runs by position', () => {
    const rows = diffRuns(run('a', 'same'), run('b', 'other', 'Billing'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sameText: false, sameTopic: false, topicA: 'Orders', topicB: 'Billing', user: 'hello' });
    const same = diffRuns(run('a'), run('b'))[0];
    expect(same.sameText && same.sameTopic).toBe(true);
    const longer = run('c'); longer.turns.push({ role: 'user', text: 'more' }, { role: 'agent', text: 'x' });
    expect(diffRuns(run('a'), longer)).toHaveLength(2);
  });
  it('builds a scenario case from a run', () => {
    const c = caseFromRun(run('a'), ' My Case! ', ' be nice ');
    expect(c).toMatchObject({ name: 'My Case!', utterances: ['hello'], expect: { topic: 'Orders', actions: ['GetOrder'], criteria: 'be nice' } });
    expect(c.id).toMatch(/^my-case-/);
    const bare = caseFromRun({ ...run('a'), traces: {} }, '   ');
    expect(bare.name).toBe('Saved conversation');
    expect(bare.expect).toEqual({});
    expect(bare.id).not.toBe(c.id);
    expect(caseFromRun(run('a'), '!!!').id).toMatch(/^case-/);
  });
  it('tallies suites', () => {
    const suite = {
      cases: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as never,
      lastResults: { a: { outcome: 'pass', runId: 'x', at: 1 }, b: { outcome: 'fail', runId: 'x', at: 1 }, c: { outcome: 'inconclusive', runId: 'x', at: 1 } }
    };
    expect(suiteChip(suite, 'a')).toBe('pass');
    expect(suiteChip(suite, 'd')).toBe('unrun');
    expect(suiteChip({}, 'a')).toBe('unrun');
    expect(suiteTally(suite)).toEqual({ pass: 1, fail: 1, total: 4 });
  });
  it('exports a run with advisory flag for rehearse', () => {
    const p = exportRunPayload({ ...run('a'), engine: 'rehearse' }, { note: 'x' });
    expect(p).toMatchObject({ version: 2, advisory: true, runId: 'a', note: 'x' });
    expect(exportRunPayload(run('a')).advisory).toBe(false);
  });
});
