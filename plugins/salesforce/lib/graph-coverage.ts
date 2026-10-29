import { caseChecks, failureReason } from './case-checks.js';
import type { CaseOutcome, ScenarioSuite } from './studio-contract.js';

/**
 * The scenario suite projected onto the conversation map: for each case the
 * nodes it should reach and the ones its last run missed. Sent to the graph
 * iframe, so every field is bounded.
 */
export interface CoverageCase { id: string; name: string; outcome?: CaseOutcome; reason?: string; path: string[]; missing: string[] }
export interface GraphCoverage { cases: CoverageCase[] }
export type CoverageStatus = 'pass' | 'fail' | 'none';

export const COVERAGE_LIMITS = { cases: 200, names: 50, text: 200 } as const;
const START = 'start_agent';

/** `force-app/.../Bot.agent` → `tests/Bot.scenario.json`; null when no file name survives. No node:path, so the renderer can use it. */
export function agentSuitePath(agentPath: string): string | null {
  const name = (agentPath.split(/[\\/]/).pop() ?? '').replace(/\.(agent|afscript)$/i, '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z0-9]+/, '');
  return name ? `tests/${name.slice(0, 100)}.scenario.json` : null;
}

export function graphCoverage(suites: readonly Pick<ScenarioSuite, 'cases' | 'lastResults'>[]): GraphCoverage {
  const cases: CoverageCase[] = [];
  for (const suite of suites) {
    for (const row of suite.cases) {
      if (cases.length >= COVERAGE_LIMITS.cases) break;
      const result = suite.lastResults?.[row.id];
      const checks = caseChecks(row.expect, result).filter(check => check.kind === 'topic' || check.kind === 'action');
      const reason = failureReason(result);
      cases.push({
        id: row.id.slice(0, COVERAGE_LIMITS.text), name: row.name.slice(0, COVERAGE_LIMITS.text),
        ...(result ? { outcome: result.outcome } : {}),
        ...(reason ? { reason: reason.slice(0, COVERAGE_LIMITS.text) } : {}),
        path: [START, ...checks.map(check => check.target)].slice(0, COVERAGE_LIMITS.names),
        missing: checks.filter(check => check.state === 'ko').map(check => check.target).slice(0, COVERAGE_LIMITS.names)
      });
    }
  }
  return { cases };
}

/**
 * Node label → status. A node on a failing case's path is a fail even when another case passes through it.
 * Every conversation starts at start_agent, so it only says whether any case ran.
 */
export function coverageStatus(coverage: GraphCoverage, labels: readonly string[]): Record<string, CoverageStatus> {
  const status: Record<string, CoverageStatus> = Object.fromEntries(labels.map(label => [label, 'none' as CoverageStatus]));
  for (const row of coverage.cases) {
    if (row.outcome !== 'pass' && row.outcome !== 'fail') continue;
    for (const label of row.path) {
      if (!(label in status)) continue;
      if (label === START) { status[label] = 'pass'; continue; }
      if (row.outcome === 'fail' || status[label] === 'none') status[label] = row.outcome;
    }
  }
  return status;
}

/** Labels no case reaches: the "add a case for this" list. Start is always reached, so it never counts. */
export function coverageGaps(coverage: GraphCoverage, labels: readonly string[]): string[] {
  const reached = new Set(coverage.cases.flatMap(row => row.path));
  return labels.filter(label => label !== START && !reached.has(label));
}

/** Untrusted bridge input → a bounded GraphCoverage, or null. */
export function readGraphCoverage(value: unknown): GraphCoverage | null {
  if (!value || typeof value !== 'object' || !Array.isArray((value as GraphCoverage).cases)) return null;
  const rows = (value as { cases: unknown[] }).cases;
  if (rows.length > COVERAGE_LIMITS.cases) return null;
  const text = (item: unknown) => typeof item === 'string' && item.length <= COVERAGE_LIMITS.text;
  const names = (item: unknown) => Array.isArray(item) && item.length <= COVERAGE_LIMITS.names && item.every(text);
  const cases: CoverageCase[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;
    if (!text(r.id) || !text(r.name) || !names(r.path) || !names(r.missing)) return null;
    if (r.outcome !== undefined && r.outcome !== 'pass' && r.outcome !== 'fail' && r.outcome !== 'inconclusive') return null;
    if (r.reason !== undefined && !text(r.reason)) return null;
    cases.push({ id: r.id as string, name: r.name as string, ...(r.outcome ? { outcome: r.outcome as CaseOutcome } : {}), ...(r.reason ? { reason: r.reason as string } : {}), path: [...r.path as string[]], missing: [...r.missing as string[]] });
  }
  return { cases };
}

/** The thread agent's instructions for "Draft cases for gaps". */
export function draftCasesPrompt(labels: readonly string[], suitePath: string): string {
  return [
    `Draft Agentforce scenario test cases that reach these untested parts of the agent: ${labels.join(', ')}.`,
    `Add them to ${suitePath}: one case per topic or action, with realistic utterances and an expect block (topic, actions, and criteria where useful).`,
    'Read suites.list first and preserve existing cases. Save them with sf_workbench suites.save (expectedSha256 when updating), then run them with suites.run. Do not change the agent source, publish or activate anything.'
  ].join('\n');
}
