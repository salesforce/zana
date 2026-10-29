import { basename, join } from 'node:path';
import {
  SF_AGENT_CLI_TIMEOUT_MS,
  type AgentCompilerKind,
  type EvalEvidence,
  type ExecResult,
  type ExecSfOptions,
  type SalesforceDeps
} from './types.js';
import { fingerprint, parsePackageDirectories, readJsonObject, resolveUnderRoot, runProjectScan, scanFilesRecursiveSteps } from './dx-project.js';
import { parsePreviewContext, type PreviewContextVariable } from './preview-context.js';

export type AgentAction =
  | 'compile'
  | 'inspect'
  | 'diagnose'
  | 'preview.start'
  | 'preview.send'
  | 'preview.end'
  | 'eval.run'
  | 'lifecycle.list'
  | 'lifecycle.publish'
  | 'lifecycle.activate'
  | 'lifecycle.deactivate';

export type AgentLspQuery = 'diagnostics' | 'hover' | 'complete' | 'definition' | 'symbols';

export interface AgentInput {
  contextVariables?: unknown;
  action?: string;
  apiName?: string;
  path?: string;
  query?: string;
  line?: number;
  column?: number;
  sessionId?: string;
  utterance?: string;
  specPath?: string;
  aiEvaluationDefinitionName?: string;
  botVersionId?: string;
  versionNumber?: number;
  allow_untested?: boolean;
  published?: boolean;
  live?: boolean;
}

export interface AgentPlan {
  contextVariables?: PreviewContextVariable[];
  action: AgentAction;
  apiName?: string;
  path?: string;
  query?: AgentLspQuery;
  line?: number;
  column?: number;
  sessionId?: string;
  utterance?: string;
  specPath?: string;
  aiEvaluationDefinitionName?: string;
  botVersionId?: string;
  versionNumber?: number;
  allowUntested: boolean;
  published: boolean;
  live: boolean;
}

export interface AgentBundle {
  apiName: string;
  path: string;
  lines: number;
  hasConfig: boolean;
  hasStartAgent: boolean;
}

export type AgentPreviewIdentity = {
  flag: 'authoring-bundle' | 'api-name';
  apiName: string;
};

export type EvidenceKv = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

const ACTIONS: readonly AgentAction[] = [
  'compile',
  'inspect',
  'diagnose',
  'preview.start',
  'preview.send',
  'preview.end',
  'eval.run',
  'lifecycle.list',
  'lifecycle.publish',
  'lifecycle.activate',
  'lifecycle.deactivate'
];

const LSP_QUERIES: readonly AgentLspQuery[] = ['diagnostics', 'hover', 'complete', 'definition', 'symbols'];
const LSP_POSITION_QUERIES = new Set<AgentLspQuery>(['hover', 'complete', 'definition']);

const COMPILER_BINS = ['agent-script', 'agentscript'];

export const EVAL_RUNS_PATH = '/einstein/ai-evaluations/runs';
export const EVAL_POLL_INTERVAL_MS = 400;
export const EVAL_POLL_MAX_ATTEMPTS = 30;

export function parseAgentInput(input: unknown): { ok: true; plan: AgentPlan } | { ok: false; error: string } {
  const raw = input && typeof input === 'object' ? (input as AgentInput) : {};
  let contextVariables: PreviewContextVariable[] | undefined;
  if (raw.contextVariables !== undefined) {
    if (raw.action !== 'preview.start') return { ok: false, error: 'Context variables can only be set when starting a preview.' };
    try { contextVariables = parsePreviewContext(raw.contextVariables); }
    catch (error) { return { ok: false, error: (error as Error).message }; }
  }
  const action = typeof raw.action === 'string' ? raw.action.trim() : '';
  if (!ACTIONS.includes(action as AgentAction)) {
    return { ok: false, error: `Unknown sf_agent action. Use ${ACTIONS.join(', ')}. Create/mutate/deploy are not offered.` };
  }
  const apiName = typeof raw.apiName === 'string' ? raw.apiName.trim() : '';
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  const queryRaw = typeof raw.query === 'string' ? raw.query.trim() : '';
  const query = queryRaw
    ? LSP_QUERIES.includes(queryRaw as AgentLspQuery)
      ? (queryRaw as AgentLspQuery)
      : undefined
    : action === 'diagnose'
      ? 'diagnostics'
      : undefined;
  if (action === 'diagnose' && queryRaw && !query) {
    return { ok: false, error: `diagnose query must be ${LSP_QUERIES.join(', ')}.` };
  }
  const line =
    typeof raw.line === 'number' && Number.isFinite(raw.line) ? Math.max(0, Math.floor(raw.line)) : undefined;
  const column =
    typeof raw.column === 'number' && Number.isFinite(raw.column) ? Math.max(0, Math.floor(raw.column)) : undefined;
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : '';
  const utterance = typeof raw.utterance === 'string' ? raw.utterance : '';
  const specPath = typeof raw.specPath === 'string' ? raw.specPath.trim() : '';
  const aiEvaluationDefinitionName =
    typeof raw.aiEvaluationDefinitionName === 'string' ? raw.aiEvaluationDefinitionName.trim() : '';
  const botVersionId = typeof raw.botVersionId === 'string' ? raw.botVersionId.trim() : '';
  const versionNumber =
    typeof raw.versionNumber === 'number' && Number.isFinite(raw.versionNumber)
      ? Math.floor(raw.versionNumber)
      : undefined;

  if (
    (action === 'compile' || action === 'diagnose' || action === 'preview.start' || action === 'lifecycle.publish') &&
    !apiName &&
    !path
  ) {
    return { ok: false, error: `${action} requires apiName or path.` };
  }
  if (action === 'diagnose' && query && LSP_POSITION_QUERIES.has(query) && (line === undefined || column === undefined)) {
    return { ok: false, error: `diagnose ${query} requires line and column (0-based).` };
  }
  if (action === 'preview.send' && (!sessionId || !utterance.trim())) {
    return { ok: false, error: 'preview.send requires sessionId and utterance.' };
  }
  if (action === 'preview.end' && !sessionId) {
    return { ok: false, error: 'preview.end requires sessionId.' };
  }
  if (action === 'eval.run' && !specPath && !aiEvaluationDefinitionName) {
    return {
      ok: false,
      error: 'eval.run requires specPath (confined YAML/JSON) or aiEvaluationDefinitionName.'
    };
  }
  if (action === 'lifecycle.activate' && !apiName && !botVersionId) {
    return { ok: false, error: 'lifecycle.activate requires apiName or botVersionId.' };
  }
  if (action === 'lifecycle.deactivate' && !apiName) {
    return { ok: false, error: 'lifecycle.deactivate requires the agent apiName.' };
  }

  return {
    ok: true,
    plan: {
      ...(contextVariables ? { contextVariables } : {}),
      action: action as AgentAction,
      apiName: apiName || undefined,
      path: path || undefined,
      query,
      line,
      column,
      sessionId: sessionId || undefined,
      utterance: utterance || undefined,
      specPath: specPath || undefined,
      aiEvaluationDefinitionName: aiEvaluationDefinitionName || undefined,
      botVersionId: botVersionId || undefined,
      versionNumber,
      allowUntested: raw.allow_untested === true,
      published: raw.published === true,
      live: raw.live === true
    }
  };
}

export function scanAgentBundles(projectRoot: string, deps: SalesforceDeps): AgentBundle[] {
  return runProjectScan(scanAgentBundlesSteps(projectRoot, deps));
}

export function* scanAgentBundlesSteps(projectRoot: string, deps: SalesforceDeps): Generator<void, AgentBundle[]> {
  const manifest = deps.readFile(join(projectRoot, 'sfdx-project.json')) ?? '{}';
  const packages = parsePackageDirectories(manifest);
  const found: AgentBundle[] = [];
  for (const pkg of packages) {
    const pkgRoot = resolveUnderRoot(projectRoot, pkg, deps.realpath);
    if (!pkgRoot) continue;
    const { files } = yield* scanFilesRecursiveSteps(pkgRoot, deps);
    for (const file of files) {
      yield;
      if (!file.endsWith('.agent')) continue;
      const source = deps.readFile(file) ?? '';
      found.push(inspectAgentSource(file, source));
    }
  }
  return found.sort((a, b) => a.apiName.localeCompare(b.apiName));
}

export function inspectAgentSource(path: string, source: string): AgentBundle {
  const apiName = basename(path).replace(/\.agent$/i, '');
  return {
    apiName,
    path,
    lines: source.split(/\r?\n/).length,
    hasConfig: /\bconfig\b/.test(source),
    hasStartAgent: /\bstart_agent\b/.test(source) || /\borchestrator\b/.test(source)
  };
}

export function findAgentBundle(
  bundles: AgentBundle[],
  apiName?: string,
  relativePath?: string
): AgentBundle | null {
  if (apiName) {
    const match = bundles.find((row) => row.apiName === apiName);
    if (match) return match;
  }
  if (relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    return (
      bundles.find(
        (row) =>
          row.path.replace(/\\/g, '/').endsWith(normalized) || row.apiName === basename(normalized).replace(/\.agent$/i, '')
      ) ?? null
    );
  }
  return null;
}

export function diagnoseAgentBundle(bundle: AgentBundle): string[] {
  const issues: string[] = [];
  if (!bundle.hasConfig) issues.push('Missing config block.');
  if (!bundle.hasStartAgent) issues.push('Missing start_agent or orchestrator entry.');
  if (bundle.lines < 2) issues.push('Agentforce file looks empty.');
  return issues;
}

export function resolveAgentCompilerBin(projectRoot: string, deps: SalesforceDeps): string | null {
  for (const name of COMPILER_BINS) {
    const bin = resolveUnderRoot(projectRoot, join('node_modules', '.bin', name), deps.realpath);
    if (bin && deps.stat(bin) !== 'missing') return bin;
  }
  return null;
}

export function agentPluginAvailable(result: ExecResult): boolean {
  if (result.code === 127) return false;
  const text = `${result.stdout}\n${result.stderr}`;
  if (/command agent not found|is not a sf command|unknown topic:? agent/i.test(text)) return false;
  return result.code === 0 || /validate|preview|publish|activate/i.test(text);
}

export function agentEvalHelpAvailable(result: ExecResult): boolean {
  if (result.code === 127) return false;
  const text = `${result.stdout}\n${result.stderr}`;
  if (/command .* not found|is not a sf command|unknown topic/i.test(text) && result.code !== 0) return false;
  return result.code === 0 || /run-eval/i.test(text);
}

export async function probeAgentCapabilities(
  projectRoot: string,
  deps: SalesforceDeps
): Promise<{ compiler: AgentCompilerKind; pluginOk: boolean }> {
  const bin = resolveAgentCompilerBin(projectRoot, deps);
  const help = await deps.execSf(['agent', '--help']);
  const pluginOk = agentPluginAvailable(help);
  if (bin) return { compiler: 'library', pluginOk };
  if (pluginOk) return { compiler: 'cli', pluginOk: true };
  return { compiler: 'missing', pluginOk: false };
}

export function parseSfJson(stdout: string): { status: number; result: unknown; message: string } {
  const obj = readJsonObject(stdout);
  if (!obj) {
    return { status: 1, result: null, message: stdout.replace(/\s+/g, ' ').trim().slice(0, 240) };
  }
  const status = typeof obj.status === 'number' ? obj.status : 0;
  const message =
    typeof obj.message === 'string'
      ? obj.message
      : typeof obj.name === 'string'
        ? obj.name
        : '';
  return { status, result: obj.result ?? null, message };
}

export function extractSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  for (const key of ['sessionId', 'session_id', 'id']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (row.result) return extractSessionId(row.result);
  return null;
}

export function compactPreviewDigest(payload: unknown, utterance?: string): Record<string, unknown> {
  const sessionId = extractSessionId(payload);
  const row = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const response =
    typeof row.response === 'string'
      ? row.response
      : typeof row.message === 'string'
        ? row.message
        : typeof row.agentResponse === 'string'
          ? row.agentResponse
          : Array.isArray(row.messages)
            ? row.messages.map((m) => m && typeof m === 'object' && typeof m.message === 'string' ? m.message : '').filter(Boolean).join('\n')
            : '';
  // planId is kept for the trace view; CLI traces are unverified so the UI treats it as optional evidence.
  const planSource = typeof row.planId === 'string' ? row.planId
    : Array.isArray(row.messages) ? row.messages.map((m) => (m && typeof m === 'object' ? (m as { planId?: unknown }).planId : undefined)).find((p) => typeof p === 'string')
    : undefined;
  const planId = typeof planSource === 'string' && planSource ? planSource.slice(0, 256) : undefined;
  return {
    sessionId,
    utterance: utterance?.slice(0, 200),
    response: response.slice(0, 32_000),
    topic: typeof row.topic === 'string' ? row.topic : undefined,
    ...(planId ? { planId } : {})
  };
}

const EVAL_LIST_KEYS = ['testCases', 'tests', 'utterances'];
const SPEC_SHAPE_ERROR = 'Eval spec must be a JSON object or a YAML mapping.';
const SPEC_EMPTY_ERROR = 'Eval spec needs a non-empty testCases, tests or utterances list.';

/**
 * Counts an eval spec's cases, in JSON or the YAML `sf agent test` format.
 * `sf agent test run-eval` parses the spec itself; this only labels the run, so
 * YAML outside the plain block or one-line flow list reads as uncounted.
 */
export function parseEvalSpec(text: string): { ok: true; format: 'json' | 'yaml'; testCount: number } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = (() => {
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return null;
      }
    })();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: SPEC_SHAPE_ERROR };
    const row = parsed as Record<string, unknown>;
    const tests = EVAL_LIST_KEYS.map(key => row[key]).find(Array.isArray);
    if (!tests || tests.length === 0) return { ok: false, error: SPEC_EMPTY_ERROR };
    return { ok: true, format: 'json', testCount: tests.length };
  }
  const counted = yamlEvalCaseCount(trimmed);
  if (counted === null) return { ok: false, error: SPEC_SHAPE_ERROR };
  if (counted === 0) return { ok: false, error: SPEC_EMPTY_ERROR };
  return { ok: true, format: 'yaml', testCount: counted };
}

/** Items in the first top-level case list; 0 for a mapping without one, null when the text is not a readable mapping. */
function yamlEvalCaseCount(text: string): number | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let keys = 0;
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i]!.match(/^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/);
    if (!key) continue;
    keys++;
    if (!EVAL_LIST_KEYS.includes(key[1]!)) continue;
    const inline = (key[2] ?? '').replace(/\s+#.*$/, '').trim();
    if (inline) return inline.startsWith('[') && inline.endsWith(']') ? flowListLength(inline.slice(1, -1)) : null;
    let indent: number | null = null;
    let count = 0;
    for (const row of lines.slice(i + 1)) {
      const body = row.trimStart();
      if (!body || body.startsWith('#')) continue;
      const lead = row.length - body.length;
      const item = body === '-' || body.startsWith('- ');
      // The next top-level key ends the list; YAML lets the items sit at the key's own indent.
      if (lead === 0 && !item) break;
      if (indent === null) {
        if (!item) return null;
        indent = lead;
      }
      if (lead < indent) break;
      if (item && lead === indent) count++;
    }
    return count;
  }
  return keys > 0 ? 0 : null;
}

function flowListLength(body: string): number {
  let depth = 0;
  let quote: string | null = null;
  let items = body.trim() ? 1 : 0;
  for (const char of body) {
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') depth--;
    else if (char === ',' && depth === 0) items++;
  }
  // A trailing comma closes the list without adding an item.
  return body.trim().endsWith(',') ? items - 1 : items;
}

export function evalCaseCount(text: string): number {
  const parsed = parseEvalSpec(text);
  return parsed.ok ? parsed.testCount : 0;
}

export function summarizeEvalRun(json: unknown, testCount: number): { passed: boolean; passedCount: number; failedCount: number } {
  const row = unwrapRecord(json);
  const passedCount =
    typeof row.passedCount === 'number'
      ? row.passedCount
      : typeof row.passCount === 'number'
        ? row.passCount
        : row.success === true
          ? testCount || 1
          : 0;
  const failedCount =
    typeof row.failedCount === 'number'
      ? row.failedCount
      : typeof row.failCount === 'number'
        ? row.failCount
        : Math.max(0, (testCount || passedCount) - passedCount);
  const passed = row.success === true || (failedCount === 0 && passedCount > 0);
  return { passed, passedCount, failedCount };
}

export function evidenceKey(orgId: string, botVersionId: string): string {
  return `eval-evidence:${orgId}:${botVersionId}`;
}

export class EvalEvidenceStore {
  constructor(private readonly kv: EvidenceKv) {}

  async record(evidence: EvalEvidence): Promise<void> {
    await this.kv.set(evidenceKey(evidence.orgId, evidence.botVersionId), evidence);
  }

  async get(orgId: string, botVersionId: string): Promise<EvalEvidence | null> {
    const row = await this.kv.get<EvalEvidence>(evidenceKey(orgId, botVersionId));
    if (!row || typeof row !== 'object') return null;
    if (typeof row.orgId !== 'string' || typeof row.botVersionId !== 'string') return null;
    return row;
  }
}

export function canActivate(input: {
  evidence: EvalEvidence | null;
  orgId: string;
  botVersionId: string;
  allowUntested: boolean;
}): { ok: true; untested: boolean } | { ok: false; code: 'eval_required'; error: string } {
  const matched =
    Boolean(input.evidence) &&
    input.evidence!.orgId === input.orgId &&
    input.evidence!.botVersionId === input.botVersionId;
  if (matched && input.evidence!.passed) return { ok: true, untested: false };
  if (input.allowUntested) return { ok: true, untested: true };
  if (!input.evidence) {
    return {
      ok: false,
      code: 'eval_required',
      error: 'lifecycle.activate needs matching eval.run evidence for this org and BotVersion, or allow_untested: true (intent, not approval).'
    };
  }
  if (!matched) {
    return {
      ok: false,
      code: 'eval_required',
      error: 'Eval evidence does not match this org and BotVersion.'
    };
  }
  return {
    ok: false,
    code: 'eval_required',
    error: 'Last eval.run for this BotVersion did not pass. Fix the agent or pass allow_untested: true.'
  };
}

export function specFingerprint(specText: string): string {
  return fingerprint(specText);
}

export function agentCliOpts(projectRoot?: string | null): ExecSfOptions {
  return {
    timeoutMs: SF_AGENT_CLI_TIMEOUT_MS,
    ...(projectRoot ? { cwd: projectRoot } : {})
  };
}

/** `sf agent preview` crashes on an authoring bundle without default_agent_user (common for employee agents and new drafts). */
export function lacksDefaultAgentUser(source: string): boolean {
  return !/^\s*default_agent_user\s*:\s*["']?[^\s"'#]/m.test(source);
}

export function previewArgs(
  verb: 'start' | 'send' | 'end',
  plan: Pick<AgentPlan, 'sessionId' | 'utterance' | 'live' | 'contextVariables'>,
  alias: string,
  identity?: AgentPreviewIdentity
): string[] {
  const args = ['agent', 'preview', verb, '--json', '--target-org', alias];
  if (identity?.flag === 'authoring-bundle') {
    args.push('--authoring-bundle', identity.apiName);
    if (verb === 'start') args.push(plan.live ? '--use-live-actions' : '--simulate-actions');
  } else if (identity?.flag === 'api-name') {
    args.push('--api-name', identity.apiName);
  }
  if (plan.sessionId && verb !== 'start') args.push('--session-id', plan.sessionId);
  if (verb === 'send') args.push('--utterance', plan.utterance ?? '');
  if (verb === 'start' && plan.contextVariables?.length) args.push('--context-variables-json', JSON.stringify(parsePreviewContext(plan.contextVariables)));
  return args;
}

export function publishArgs(apiName: string, alias: string): string[] {
  return [
    'agent',
    'publish',
    'authoring-bundle',
    '--json',
    '--api-name',
    apiName,
    '--target-org',
    alias,
    '--skip-retrieve'
  ];
}

export function activateArgs(apiName: string, alias: string, versionNumber?: number): string[] {
  const args = ['agent', 'activate', '--json', '--api-name', apiName, '--target-org', alias];
  if (versionNumber !== undefined) args.push('--version', String(versionNumber));
  return args;
}

/** Takes the agent's active version offline; the org keeps every version for a later activate. */
export function deactivateArgs(apiName: string, alias: string): string[] {
  return ['agent', 'deactivate', '--json', '--api-name', apiName, '--target-org', alias];
}

export function validateArgs(apiName: string, alias: string): string[] {
  return ['agent', 'validate', 'authoring-bundle', '--json', '--api-name', apiName, '--target-org', alias];
}

export function runEvalArgs(specPath: string, alias: string): string[] {
  return ['agent', 'test', 'run-eval', '--spec', specPath, '--json', '--target-org', alias];
}

export const BOT_VERSION_SOQL =
  'SELECT Id, Status, VersionNumber, BotDefinition.DeveloperName FROM BotVersion ORDER BY LastModifiedDate DESC LIMIT 25';

export function evalResultsPath(runId: string): string {
  return `${EVAL_RUNS_PATH}/${runId}/results`;
}

export function evalRunPath(runId: string): string {
  return `${EVAL_RUNS_PATH}/${runId}`;
}

export function extractEvalRunId(payload: unknown): string | null {
  const row = unwrapRecord(payload);
  for (const key of ['id', 'runId', 'evaluationRunId']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function evalRunStatus(payload: unknown): string {
  const row = unwrapRecord(payload);
  const status = row.status ?? row.state;
  return typeof status === 'string' ? status.trim() : '';
}

export function isEvalTerminal(status: string): boolean {
  return /^(completed|complete|failed|error|cancelled|canceled|succeeded|success)$/i.test(status.trim());
}

export function extractEvalBotVersionId(payload: unknown, fallback?: string): string {
  const row = unwrapRecord(payload);
  for (const key of ['botVersionId', 'subjectName', 'agentId', 'apiName']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const version = row.versionNumber ?? row.version;
  if (typeof version === 'number' && Number.isFinite(version)) return String(version);
  if (typeof version === 'string' && version.trim()) return version.trim();
  return fallback || 'latest';
}

function unwrapRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const row = payload as Record<string, unknown>;
  if (row.result && typeof row.result === 'object' && !Array.isArray(row.result)) {
    return row.result as Record<string, unknown>;
  }
  return row;
}
