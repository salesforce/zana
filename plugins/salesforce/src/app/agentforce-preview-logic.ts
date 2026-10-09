import type { ScenarioCase, ScenarioSuite, StudioEngine, TurnTrace } from '../../lib/studio-contract.js';
import type { LabEngine } from '../../lib/agentforce-lab-contract.js';
export type PreviewMode = 'simulate' | 'live';

export interface PreviewTurn {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
}

export function normalizePreviewMode(value: unknown): PreviewMode {
  return value === 'live' ? 'live' : 'simulate';
}

export function previewStartDisabled(busy: boolean, hasTarget: boolean, sessionId: string | null): boolean {
  return busy || !hasTarget || Boolean(sessionId);
}

export function previewSendDisabled(busy: boolean, sessionId: string | null, utterance: string): boolean {
  return busy || !sessionId || !utterance.trim();
}

export function previewEndDisabled(busy: boolean, sessionId: string | null): boolean {
  return busy || !sessionId;
}

export function appendPreviewTurn(turns: readonly PreviewTurn[], turn: PreviewTurn): PreviewTurn[] {
  return [...turns, turn].slice(-80);
}

export function previewErrorMessage(result: { error?: string; code?: string } | null | undefined): string {
  if (!result?.error) return 'Preview failed.';
  return result.error;
}

// ---- Unified PreviewWorkbench helpers (WS-6) ----

export interface RunTurn { role: 'user' | 'agent' | 'system'; text: string; latencyMs?: number; planId?: string }
export interface RunRecord {
  runId: string; engine: StudioEngine; at: number; file: string;
  turns: RunTurn[];
  /** Fetched traces keyed by planId (only Simulate/Live can have them). */
  traces: Record<string, TurnTrace>;
}
export const MAX_RUN_HISTORY = 10;
export const REHEARSE_LABEL = 'Approximation — no runtime trace';

export function engineToLab(engine: StudioEngine): LabEngine | null {
  return engine === 'rehearse' ? 'rehearsal' : engine === 'simulate' ? 'preview' : null;
}

/** Newest first, replace-by-runId, bounded. */
export function appendRun(runs: readonly RunRecord[], run: RunRecord): RunRecord[] {
  return [run, ...runs.filter(r => r.runId !== run.runId)].slice(0, MAX_RUN_HISTORY);
}

export function traceTopics(trace: TurnTrace | undefined): string[] {
  return trace?.available ? trace.steps.filter(s => s.kind === 'topic').map(s => s.label) : [];
}
export function traceActions(trace: TurnTrace | undefined): string[] {
  return trace?.available ? trace.steps.filter(s => s.kind === 'action').map(s => s.label) : [];
}
export function traceSummary(trace: TurnTrace): { steps: number; totalMs: number } {
  return { steps: trace.steps.length, totalMs: trace.steps.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0) };
}

export interface RunDiffRow { index: number; user?: string; a?: RunTurn; b?: RunTurn; topicA?: string; topicB?: string; sameText: boolean; sameTopic: boolean }
/** Pairs agent replies of two runs by position; topics come from any fetched trace. */
export function diffRuns(a: RunRecord, b: RunRecord): RunDiffRow[] {
  const replies = (run: RunRecord) => run.turns.filter(t => t.role === 'agent');
  const users = (run: RunRecord) => run.turns.filter(t => t.role === 'user');
  const ra = replies(a), rb = replies(b);
  const topic = (run: RunRecord, turn?: RunTurn) => (turn?.planId ? traceTopics(run.traces[turn.planId]).at(-1) : undefined);
  const rows: RunDiffRow[] = [];
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    const topicA = topic(a, ra[i]); const topicB = topic(b, rb[i]);
    rows.push({
      index: i + 1, user: users(a)[i]?.text ?? users(b)[i]?.text, a: ra[i], b: rb[i], topicA, topicB,
      sameText: (ra[i]?.text.trim() ?? '') === (rb[i]?.text.trim() ?? ''),
      sameTopic: topicA === topicB
    });
  }
  return rows;
}

let caseCounter = 0;
/** Turns a finished conversation into a saved scenario: user turns replayed, observed routing becomes the expectation. */
export function caseFromRun(run: RunRecord, name: string, criteria?: string): ScenarioCase {
  const utterances = run.turns.filter(t => t.role === 'user').map(t => t.text.slice(0, 4000)).slice(0, 8);
  const traces = run.turns.filter(t => t.role === 'agent' && t.planId).map(t => run.traces[t.planId!]);
  const topic = traces.flatMap(t => traceTopics(t)).at(-1);
  const actions = [...new Set(traces.flatMap(t => traceActions(t)))].slice(0, 20);
  const trimmed = name.trim().slice(0, 200) || 'Saved conversation';
  const id = `${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'case'}-${(++caseCounter).toString(36)}${Date.now().toString(36).slice(-4)}`;
  const note = criteria?.trim();
  return { id, name: trimmed, utterances, expect: { ...(topic ? { topic } : {}), ...(actions.length ? { actions } : {}), ...(note ? { criteria: note.slice(0, 4000) } : {}) } };
}

export type ChipState = 'pass' | 'fail' | 'inconclusive' | 'unrun';
export function suiteChip(suite: Pick<ScenarioSuite, 'lastResults'>, caseId: string): ChipState {
  return suite.lastResults?.[caseId]?.outcome ?? 'unrun';
}
export function suiteTally(suite: Pick<ScenarioSuite, 'cases' | 'lastResults'>): { pass: number; fail: number; total: number } {
  let pass = 0, fail = 0;
  for (const c of suite.cases) { const s = suiteChip(suite, c.id); if (s === 'pass') pass++; else if (s === 'fail') fail++; }
  return { pass, fail, total: suite.cases.length };
}

export function exportRunPayload(run: RunRecord, extra?: Record<string, unknown>) {
  return { version: 2, exportedAt: new Date().toISOString(), advisory: run.engine === 'rehearse', ...run, ...extra };
}
