/**
 * Salesforce Studio shared contract (WS-0). Isomorphic: imported by the server
 * (lib/*), the renderer (src/app/*) and the playground iframe. No node imports.
 */
export type StudioTool = 'code' | 'preview' | 'tests' | 'graph' | 'actions' | 'data' | 'deploy' | 'assistant' | 'comments' | 'agents';
export type StudioEngine = 'rehearse' | 'simulate' | 'live';
export interface StudioDiagnostic { line: number; column: number; endLine: number; endColumn: number; severity: 'error' | 'warning' | 'info' | 'hint'; message: string; code?: string }
export interface StudioViewState {
  surface: 'studio' | 'sidepanel'; path: string | null; sha256?: string; dirty: boolean;
  cursor?: { line: number; column: number }; selection?: { startLine: number; endLine: number; text: string /* <=2000 */ };
  tool: StudioTool | null; lastRun?: { runId: string; engine: StudioEngine; turn?: number }; diagnostics: StudioDiagnostic[] /* <=50 */;
  orgAlias?: string; share: boolean; at: number;
}
export type ThreadRole = 'author' | 'editor' | 'reviewer' | 'tester' | 'assistant';
export interface StudioThreadLink { threadId: string; title: string; role: ThreadRole; action?: string; path: string; lastActivityAt: number }
export interface StudioComment {
  id: string; path: string; line: number; endLine: number; quote: string; body: string;
  author: { kind: 'user' | 'agent'; threadId?: string; name: string }; createdAt: number; resolved?: { at: number; note: string; by: string };
}
export interface ProposeEditInput { path: string; expectedSha256: string; content?: string; edits?: Array<{ startLine: number; endLine: number; text: string }>; summary: string }
export type ProposalOutcome = { outcome: 'accepted' | 'rejected' | 'partial'; acceptedHunks: number; rejectedHunks: number; sha256?: string; note?: string };
export interface TraceStep {
  kind: 'input' | 'llm' | 'tools' | 'topic' | 'action' | 'variable' | 'transition' | 'response' | 'delegate' | 'unknown';
  label: string; latencyMs?: number; inputPreview?: string; outputPreview?: string; source?: { path: string; line: number };
}
export interface TurnTrace { runId: string; turn: number; planId?: string; available: boolean; reason?: string; steps: TraceStep[] }
export interface ScenarioCase { id: string; name: string; utterances: string[]; expect: { topic?: string; actions?: string[]; contains?: string[]; criteria?: string } }
export interface ScenarioSuite { id: string; path: string; cases: ScenarioCase[]; lastResults?: Record<string, { outcome: 'pass' | 'fail' | 'inconclusive'; runId: string; at: number }> }
export interface ExplorerNode { kind: 'agent' | 'apex' | 'flow' | 'prompt' | 'scenario' | 'org-agent'; path?: string; apiName: string; usedBy?: string[]; badge?: { dirty?: boolean; problems?: number; status?: 'pass' | 'fail' } }

export const STUDIO_RPC = {
  askAgent: 'studio.askAgent', threads: 'studio.threads', unlink: 'studio.unlinkThread',
  viewPublish: 'studio.view.publish', viewGet: 'studio.view.get', explorer: 'studio.explorer',
  comments: 'studio.comments.list', commentAdd: 'studio.comments.add', commentResolve: 'studio.comments.resolve',
  trace: 'agentLab.trace', suites: 'studio.suites.list', suiteSave: 'studio.suites.save', suiteRun: 'studio.suites.run',
  outcome: 'control.outcome',
} as const;
export const UI_WAKE_CHANNEL = 'sf.ui.wake'; // payload {viewId} only - never command data
export const STUDIO_CHANGED_CHANNEL = 'sf.studio.changed'; // {projectId, path?, kind:'threads'|'comments'|'suites'}

export const STUDIO_LIMITS = { diagnostics: 50, selectionText: 2000, quote: 2000 } as const;
export const STUDIO_TOOLS: readonly StudioTool[] = ['code', 'preview', 'tests', 'graph', 'actions', 'data', 'deploy', 'assistant', 'comments', 'agents'];
export const STUDIO_ENGINES: readonly StudioEngine[] = ['rehearse', 'simulate', 'live'];
const SEVERITIES: readonly StudioDiagnostic['severity'][] = ['error', 'warning', 'info', 'hint'];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isPos = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1;

export function isStudioDiagnostic(value: unknown): value is StudioDiagnostic {
  if (!isRecord(value)) return false;
  return [value.line, value.column, value.endLine, value.endColumn].every(isPos)
    && SEVERITIES.includes(value.severity as StudioDiagnostic['severity'])
    && typeof value.message === 'string' && value.message.length <= 2000
    && (value.code === undefined || typeof value.code === 'string');
}

export function isStudioDiagnostics(value: unknown, max: number = STUDIO_LIMITS.diagnostics): value is StudioDiagnostic[] {
  return Array.isArray(value) && value.length <= max && value.every(isStudioDiagnostic);
}

export function isProposalOutcome(value: unknown): value is ProposalOutcome {
  if (!isRecord(value)) return false;
  return ['accepted', 'rejected', 'partial'].includes(String(value.outcome))
    && Number.isInteger(value.acceptedHunks) && Number(value.acceptedHunks) >= 0
    && Number.isInteger(value.rejectedHunks) && Number(value.rejectedHunks) >= 0
    && (value.sha256 === undefined || typeof value.sha256 === 'string')
    && (value.note === undefined || (typeof value.note === 'string' && value.note.length <= 2000));
}

export function isStudioComment(value: unknown): value is StudioComment {
  if (!isRecord(value) || !isRecord(value.author)) return false;
  const author = value.author;
  const resolved = value.resolved;
  return typeof value.id === 'string' && typeof value.path === 'string' && isPos(value.line) && isPos(value.endLine) && Number(value.endLine) >= Number(value.line)
    && typeof value.quote === 'string' && value.quote.length <= STUDIO_LIMITS.quote && typeof value.body === 'string' && value.body.length <= 4000
    && (author.kind === 'user' || author.kind === 'agent') && typeof author.name === 'string' && (author.threadId === undefined || typeof author.threadId === 'string')
    && typeof value.createdAt === 'number'
    && (resolved === undefined || (isRecord(resolved) && typeof resolved.at === 'number' && typeof resolved.note === 'string' && typeof resolved.by === 'string'));
}

/** Validates the structural shape of a ProposeEditInput (bounds mirror the control channel: content <=180k, <=50 edits). */
export function isProposeEditInput(value: unknown): value is ProposeEditInput {
  if (!isRecord(value)) return false;
  if (typeof value.path !== 'string' || !value.path || typeof value.summary !== 'string' || value.summary.length > 1000) return false;
  if (typeof value.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedSha256)) return false;
  const hasContent = value.content !== undefined;
  const hasEdits = value.edits !== undefined;
  if (hasContent === hasEdits) return false;
  if (hasContent) return typeof value.content === 'string' && value.content.length <= 180_000;
  return Array.isArray(value.edits) && value.edits.length >= 1 && value.edits.length <= 50
    && value.edits.every(edit => isRecord(edit) && isPos(edit.startLine) && isPos(edit.endLine) && Number(edit.endLine) >= Number(edit.startLine) - 1 && typeof edit.text === 'string' && edit.text.length <= 180_000);
}

export function isStudioViewState(value: unknown): value is StudioViewState {
  if (!isRecord(value)) return false;
  const cursor = value.cursor;
  const selection = value.selection;
  const lastRun = value.lastRun;
  return (value.surface === 'studio' || value.surface === 'sidepanel')
    && (value.path === null || typeof value.path === 'string')
    && (value.sha256 === undefined || typeof value.sha256 === 'string')
    && typeof value.dirty === 'boolean' && typeof value.share === 'boolean' && typeof value.at === 'number'
    && (value.tool === null || STUDIO_TOOLS.includes(value.tool as StudioTool))
    && (value.orgAlias === undefined || typeof value.orgAlias === 'string')
    && (cursor === undefined || (isRecord(cursor) && isPos(cursor.line) && isPos(cursor.column)))
    && (selection === undefined || (isRecord(selection) && isPos(selection.startLine) && isPos(selection.endLine) && typeof selection.text === 'string' && selection.text.length <= STUDIO_LIMITS.selectionText))
    && (lastRun === undefined || (isRecord(lastRun) && typeof lastRun.runId === 'string' && STUDIO_ENGINES.includes(lastRun.engine as StudioEngine) && (lastRun.turn === undefined || Number.isInteger(lastRun.turn))))
    && isStudioDiagnostics(value.diagnostics);
}
