import { describe, expect, it } from 'vitest';
import { COVERAGE_LIMITS, agentSuitePath, coverageGaps, coverageStatus, draftCasesPrompt, graphCoverage, readGraphCoverage } from '../lib/graph-coverage.js';
import type { ScenarioSuite } from '../lib/studio-contract.js';

const suite: Pick<ScenarioSuite, 'cases' | 'lastResults'> = {
  cases: [
    { id: 'ok', name: 'Happy quote', utterances: ['q'], expect: { topic: 'Quotes', actions: ['Price'] } },
    { id: 'bad', name: 'Submit', utterances: ['s'], expect: { topic: 'Quotes', actions: ['Submit'] } },
    { id: 'new', name: 'Never run', utterances: ['n'], expect: { topic: 'Orders' } }
  ],
  lastResults: {
    ok: { outcome: 'pass', runId: 'r', at: 1, observed: { topics: ['Quotes'], actions: ['Price'], traced: true } },
    bad: { outcome: 'fail', runId: 'r', at: 1, notes: ['Action "Submit" not called.'], observed: { topics: ['Quotes'], actions: [], traced: true } }
  }
};
const labels = ['start_agent', 'Quotes', 'Orders', 'Price', 'Submit', 'Errors'];

describe('graphCoverage', () => {
  it('projects cases onto paths with the nodes their last run missed', () => {
    expect(graphCoverage([suite]).cases).toEqual([
      { id: 'ok', name: 'Happy quote', outcome: 'pass', path: ['start_agent', 'Quotes', 'Price'], missing: [] },
      { id: 'bad', name: 'Submit', outcome: 'fail', reason: 'Action "Submit" not called.', path: ['start_agent', 'Quotes', 'Submit'], missing: ['Submit'] },
      { id: 'new', name: 'Never run', path: ['start_agent', 'Orders'], missing: [] }
    ]);
  });
  it('bounds the case count', () => {
    const many = { cases: Array.from({ length: COVERAGE_LIMITS.cases + 5 }, (_, i) => ({ id: `c${i}`, name: 'n', utterances: ['u'], expect: {} })) };
    expect(graphCoverage([many, many]).cases).toHaveLength(COVERAGE_LIMITS.cases);
  });
  it('colours nodes: fail beats pass, unreached stays none, unknown labels are ignored', () => {
    const coverage = graphCoverage([suite]);
    expect(coverageStatus(coverage, labels)).toEqual({ start_agent: 'pass', Quotes: 'fail', Orders: 'none', Price: 'pass', Submit: 'fail', Errors: 'none' });
    expect(coverageStatus({ cases: [{ id: 'x', name: 'x', outcome: 'pass', path: ['Ghost', 'Price'], missing: [] }, { id: 'y', name: 'y', outcome: 'pass', path: ['Price'], missing: [] }] }, ['Price'])).toEqual({ Price: 'pass' });
    expect(coverageGaps(coverage, labels)).toEqual(['Errors']);
  });
});

describe('readGraphCoverage', () => {
  const row = { id: 'a', name: 'A', outcome: 'fail', reason: 'why', path: ['start_agent'], missing: [] };
  it('accepts bounded coverage and copies it', () => {
    expect(readGraphCoverage({ cases: [row, { id: 'b', name: 'B', path: [], missing: [] }] })).toEqual({ cases: [row, { id: 'b', name: 'B', path: [], missing: [] }] });
  });
  it.each([
    null, 'x', {}, { cases: 'x' }, { cases: [null] }, { cases: Array(COVERAGE_LIMITS.cases + 1).fill(row) },
    { cases: [{ ...row, id: 1 }] }, { cases: [{ ...row, name: 'n'.repeat(COVERAGE_LIMITS.text + 1) }] },
    { cases: [{ ...row, path: Array(COVERAGE_LIMITS.names + 1).fill('a') }] }, { cases: [{ ...row, missing: [3] }] },
    { cases: [{ ...row, outcome: 'maybe' }] }, { cases: [{ ...row, reason: 4 }] }
  ])('refuses %j', value => { expect(readGraphCoverage(value)).toBeNull(); });
});

describe('agentSuitePath and draftCasesPrompt', () => {
  it('derives the suite path without node:path', () => {
    expect(agentSuitePath('force-app/main/default/aiAuthoringBundles/Bot/Bot.agent')).toBe('tests/Bot.scenario.json');
    expect(agentSuitePath('C:\\x\\My Bot.afscript')).toBe('tests/My_Bot.scenario.json');
    expect(agentSuitePath('dir/.agent')).toBeNull();
  });
  it('asks for cases that reach the gaps without touching the agent', () => {
    const prompt = draftCasesPrompt(['Errors', 'Refund'], 'tests/Bot.scenario.json');
    expect(prompt).toContain('Errors, Refund');
    expect(prompt).toContain('tests/Bot.scenario.json');
    expect(prompt).toContain('Do not change the agent source');
  });
});
