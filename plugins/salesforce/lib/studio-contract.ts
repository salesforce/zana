/**
 * Salesforce Studio shared contract (WS-0). Isomorphic: imported by the server
 * (lib/*), the renderer (src/app/*) and the playground iframe. No node imports.
 */
export type StudioTool = 'code' | 'preview' | 'tests' | 'graph' | 'actions' | 'data' | 'deploy' | 'assistant' | 'comments' | 'agents';
export type StudioEngine = 'rehearse' | 'simulate' | 'live';
export interface StudioDiagnostic { line: number; column: number; endLine: number; endColumn: number; severity: 'error' | 'warning' | 'info' | 'hint'; message: string; code?: string }
/** Problem counters count errors and warnings; info and hint entries are listed but not counted. */
export function countProblems(diagnostics: readonly StudioDiagnostic[]): number {
  return diagnostics.filter(item => item.severity === 'error' || item.severity === 'warning').length;
}
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
  author: { kind: 'user' | 'agent'; threadId?: string; name: string }; createdAt: number; editedAt?: number; resolved?: { at: number; note: string; by: string };
}
export interface ProposeEditInput { path: string; expectedSha256: string; content?: string; edits?: Array<{ startLine: number; endLine: number; text: string }>; summary: string }
export type ProposalOutcome = { outcome: 'accepted' | 'rejected' | 'partial'; acceptedHunks: number; rejectedHunks: number; sha256?: string; note?: string };
export interface TraceStep {
  kind: 'input' | 'llm' | 'tools' | 'topic' | 'action' | 'variable' | 'transition' | 'response' | 'delegate' | 'unknown';
  label: string; latencyMs?: number; inputPreview?: string; outputPreview?: string; source?: { path: string; line: number };
  /** Bounded, redacted scalar fields. Missing evidence never counts as a passing assertion. */
  stateEvidence?: Record<string, string | number | boolean | null>;
  actionEvidence?: { input: Record<string, string | number | boolean | null>; output: Record<string, string | number | boolean | null> };
}
export interface ActionAssertion { action: string; side: 'input' | 'output'; field: string; operator: 'equals' | 'contains' | 'less_than' | 'greater_than'; value: string | number | boolean | null }
export interface StateAssertion { variable: string; value: string | number | boolean | null }
export interface AssertionResult { label: string; outcome: CaseOutcome; actual: string }
export interface ConversationMessage { role: 'user' | 'agent'; message: string; topic?: string }
export interface TurnTrace { runId: string; turn: number; planId?: string; available: boolean; truncated?: boolean; reason?: string; steps: TraceStep[] }
export interface ScenarioCase {
  /** External forms, initial records or async completion that message replay cannot create. */
  prerequisites?: string[];
  contextVariables?: import('./preview-context.js').PreviewContextVariable[];
  id: string; name: string; utterances: string[]; expect: { topic?: string; actions?: string[]; forbiddenActions?: string[]; contains?: string[]; criteria?: string; maxLatencyMs?: number; actionChecks?: ActionAssertion[]; stateChecks?: StateAssertion[] };
  /** Set when the case was pinned from a Preview conversation. */
  pinned?: { runId: string; at: number };
}
export type CaseOutcome = 'pass' | 'fail' | 'inconclusive';
/** The last `sf agent test run-eval` of a suite against the org's published agent. */
export interface SuiteEval {
  at: number; org: string; orgId: string; passed: boolean; specPath: string; botVersionId?: string;
  /** False when the CLI reported totals only, so cases carry no outcome. */
  perCase: boolean; results: Record<string, { outcome: CaseOutcome }>;
  /** Cases with more than one utterance. New specs replay the final turn with recorded history. */
  multiTurn: string[];
  /** Absent on older evaluations that tested only the opening message. */
  historyReplay?: true;
}
/** What a Simulate run of one case saw. `traced` is false when no runtime trace was available, so topic/action checks could not run. */
export interface CaseObserved { topics: string[]; actions: string[]; traced: boolean; traceComplete?: boolean }
/** A saved Simulate result. `notes`, `observed` and `reply` are the run's evidence, kept small so a Fail always says why. */
export interface CaseResult { outcome: CaseOutcome; runId: string; at: number; notes?: string[]; observed?: CaseObserved; reply?: string; /** The AI judge's verdict on `criteria`, when it ran. */ judge?: CaseOutcome;
  /** Bounded recorded messages, independent of the expiring live preview session. */
  conversation?: ConversationMessage[];
  conversationTruncated?: boolean;
  setupBlocked?: boolean;
  /** This attempt was explicitly cancelled, so it has no evaluation verdict. */
  stopped?: boolean;
  deterministic?: CaseOutcome;
  latencyMs?: number; assertions?: AssertionResult[]; sourceHash?: string; caseHash?: string;
  /** Complete preceding messages for a final-turn org replay. Omitted when evidence is incomplete or too large. */
  history?: ConversationMessage[];
}
export interface SuiteComparison { referenceHash: string; candidateHash: string; suiteHash: string; at: number; reference: Record<string, CaseResult>; candidate: Record<string, CaseResult> }
/** Ephemeral progress, scoped to the project and suite; never persisted as a test result. */
export interface SuiteProgress {
  id: string; mode: 'simulate' | 'proposal' | 'compare' | 'org-eval'; startedAt: number;
  comparisonPhase?: 'reference' | 'candidate';
  caseIds: string[]; completed: number; currentCaseId?: string;
  stage: 'starting' | 'conversation' | 'trace' | 'judging' | 'saving' | 'org-eval';
  turn?: number; totalTurns?: number; results: Record<string, CaseResult>;
}
export interface ScenarioSuite { id: string; path: string; cases: ScenarioCase[]; lastResults?: Record<string, CaseResult>; lastEval?: SuiteEval; progress?: SuiteProgress }
/** One reference an agent makes (`apex://X`, `flow://Y`, a Lightning Type, or an LWC one of its types renders with), as listed on its explorer node. */
export interface ExplorerUse { kind: 'apex' | 'flow' | 'prompt' | 'lightning-type' | 'lwc'; apiName: string }
/**
 * `usedBy` lists at most 20 agent paths per reference; `uses` (agent nodes only, scanned agents only) is the uncapped inverse.
 * `via` (LWC nodes only) names the Lightning Types whose renderer or editor uses the component.
 */
export interface ExplorerNode { kind: 'agent' | 'apex' | 'flow' | 'prompt' | 'lightning-type' | 'lwc' | 'scenario' | 'org-agent'; path?: string; apiName: string; usedBy?: string[]; via?: string[]; uses?: ExplorerUse[]; badge?: { dirty?: boolean; problems?: number; status?: 'pass' | 'fail' } }
export interface LightningTypeProperty { name: string; type?: string; title?: string; description?: string; required: boolean }
/** One Lightning Type as `studio.lightningType` returns it: a project bundle, a standard platform type, or a missing reference. */
export interface LightningTypeView {
  ref: string; standard: boolean; status: 'ready' | 'standard' | 'missing'; path?: string; title?: string; description?: string; message?: string;
  properties: LightningTypeProperty[]; files: Array<{ path: string; content: string; truncated?: boolean }>;
  /** The LWCs the bundle's channel renderer.json / editor.json override with; `path` is set when the component is in this project. */
  components: LightningTypeComponent[];
}
/** `ref` is the `definition` as written (`c/offerCard`); `target` is the overridden property, `$` for the whole type. */
export interface LightningTypeComponent { ref: string; namespace: string; name: string; role: 'renderer' | 'editor'; channel: string; target: string; path?: string }
/** One LWC bundle as `studio.lwc` returns it: its source files, or why it is not in the project. */
export interface LwcBundleView { ref: string; name: string; status: 'ready' | 'missing'; path?: string; message?: string; files: Array<{ path: string; content: string; truncated?: boolean }> }

export const STUDIO_RPC = {
  askAgent: 'studio.askAgent', draftAgent: 'studio.draftAgent', threads: 'studio.threads', unlink: 'studio.unlinkThread',
  viewPublish: 'studio.view.publish', viewGet: 'studio.view.get', explorer: 'studio.explorer', lightningType: 'studio.lightningType', lwc: 'studio.lwc',
  comments: 'studio.comments.list', commentAdd: 'studio.comments.add', commentResolve: 'studio.comments.resolve',
  commentUpdate: 'studio.comments.update', commentDelete: 'studio.comments.delete',
  trace: 'agentLab.trace', suites: 'studio.suites.list', suiteSave: 'studio.suites.save', suiteRun: 'studio.suites.run', suiteStart: 'studio.suites.start', suiteResult: 'studio.suites.result', suiteStop: 'studio.suites.stop', suiteCompare: 'studio.suites.compare',
  suiteImport: 'studio.suites.import', suiteSpec: 'studio.suites.spec', suiteEval: 'studio.suites.eval',
  loopStart: 'studio.loop.start', loopStop: 'studio.loop.stop', loopGet: 'studio.loop.get',
  outcome: 'control.outcome',
} as const;
export const UI_WAKE_CHANNEL = 'sf.ui.wake'; // payload {viewId} only - never command data
export const STUDIO_CHANGED_CHANNEL = 'sf.studio.changed'; // {projectId, path?, kind:'threads'|'comments'|'suites'|'suite-progress'|'loop'}
export const CONTEXT_CHANGED_CHANNEL = 'context.changed'; // {projectId, changeId, origin?} - origin names the window that made the change

/** The `origin` a window tags its context RPCs with, or null when absent or malformed. */
export function contextOrigin(args: unknown): string | null {
  const value = args && typeof args === 'object' ? (args as Record<string, unknown>).origin : undefined;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

/** The largest Agent Script source the Studio edits, previews, saves or retrieves: 10 MB. */
export const AGENT_SOURCE_MAX = 10 * 1024 * 1024;
export const AGENT_SOURCE_MAX_LABEL = '10 MB';

export const STUDIO_LIMITS = { diagnostics: 50, selectionText: 2000, quote: 2000, commentBody: 2000 } as const;
export const STUDIO_TOOLS: readonly StudioTool[] = ['code', 'preview', 'tests', 'graph', 'actions', 'data', 'deploy', 'assistant', 'comments', 'agents'];
export const STUDIO_ENGINES: readonly StudioEngine[] = ['rehearse', 'simulate', 'live'];
/** The engines Preview offers. Rehearse is hidden for now; saved Rehearse runs still load and replay. */
export const PREVIEW_ENGINES: readonly StudioEngine[] = ['simulate', 'live'];
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
    && typeof value.createdAt === 'number' && (value.editedAt === undefined || typeof value.editedAt === 'number')
    && (resolved === undefined || (isRecord(resolved) && typeof resolved.at === 'number' && typeof resolved.note === 'string' && typeof resolved.by === 'string'));
}

/** Validates the structural shape of a ProposeEditInput (bounds mirror the control channel: content <= AGENT_SOURCE_MAX, <=50 edits). */
export function isProposeEditInput(value: unknown): value is ProposeEditInput {
  if (!isRecord(value)) return false;
  if (typeof value.path !== 'string' || !value.path || typeof value.summary !== 'string' || value.summary.length > 1000) return false;
  if (typeof value.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedSha256)) return false;
  const hasContent = value.content !== undefined;
  const hasEdits = value.edits !== undefined;
  if (hasContent === hasEdits) return false;
  if (hasContent) return typeof value.content === 'string' && value.content.length <= AGENT_SOURCE_MAX;
  return Array.isArray(value.edits) && value.edits.length >= 1 && value.edits.length <= 50
    && value.edits.every(edit => isRecord(edit) && isPos(edit.startLine) && isPos(edit.endLine) && Number(edit.endLine) >= Number(edit.startLine) - 1 && typeof edit.text === 'string' && edit.text.length <= AGENT_SOURCE_MAX);
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
