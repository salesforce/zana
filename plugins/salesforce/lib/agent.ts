import { basename, join } from 'node:path';
import {
  SF_AGENT_CLI_TIMEOUT_MS,
  type AgentCompilerKind,
  type EvalEvidence,
  type ExecResult,
  type ExecSfOptions,
  type SalesforceDeps
} from './types.js';
import { fingerprint, listFilesRecursive, parsePackageDirectories, readJsonObject, resolveUnderRoot } from './dx-project.js';

export type AgentAction =
  | 'compile'
  | 'inspect'
  | 'preview.start'
  | 'preview.send'
  | 'preview.end'
  | 'eval.run'
  | 'lifecycle.list'
  | 'lifecycle.publish'
  | 'lifecycle.activate';

export interface AgentInput {
  action?: string;
  apiName?: string;
  path?: string;
  sessionId?: string;
  utterance?: string;
  specPath?: string;
  aiEvaluationDefinitionName?: string;
  botVersionId?: string;
  versionNumber?: number;
  allow_untested?: boolean;
  published?: boolean;
}

export interface AgentPlan {
  action: AgentAction;
  apiName?: string;
  path?: string;
  sessionId?: string;
  utterance?: string;
  specPath?: string;
  aiEvaluationDefinitionName?: string;
  botVersionId?: string;
  versionNumber?: number;
  allowUntested: boolean;
  published: boolean;
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
  'preview.start',
  'preview.send',
  'preview.end',
  'eval.run',
  'lifecycle.list',
  'lifecycle.publish',
  'lifecycle.activate'
];

const COMPILER_BINS = ['agent-script', 'agentscript'];

export const EVAL_RUNS_PATH = '/einstein/ai-evaluations/runs';
export const EVAL_POLL_INTERVAL_MS = 400;
export const EVAL_POLL_MAX_ATTEMPTS = 30;

export function parseAgentInput(input: unknown): { ok: true; plan: AgentPlan } | { ok: false; error: string } {
  const raw = input && typeof input === 'object' ? (input as AgentInput) : {};
  const action = typeof raw.action === 'string' ? raw.action.trim() : '';
  if (!ACTIONS.includes(action as AgentAction)) {
    return { ok: false, error: `Unknown sf_agent action. Use ${ACTIONS.join(', ')}. Create/mutate/deploy are not offered.` };
  }
  const apiName = typeof raw.apiName === 'string' ? raw.apiName.trim() : '';
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
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

  if ((action === 'compile' || action === 'preview.start' || action === 'lifecycle.publish') && !apiName && !path) {
    return { ok: false, error: `${action} requires apiName or path.` };
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

  return {
    ok: true,
    plan: {
      action: action as AgentAction,
      apiName: apiName || undefined,
      path: path || undefined,
      sessionId: sessionId || undefined,
      utterance: utterance || undefined,
      specPath: specPath || undefined,
      aiEvaluationDefinitionName: aiEvaluationDefinitionName || undefined,
      botVersionId: botVersionId || undefined,
      versionNumber,
      allowUntested: raw.allow_untested === true,
      published: raw.published === true
    }
  };
}

export function scanAgentBundles(projectRoot: string, deps: SalesforceDeps): AgentBundle[] {
  const manifest = deps.readFile(join(projectRoot, 'sfdx-project.json')) ?? '{}';
  const packages = parsePackageDirectories(manifest);
  const found: AgentBundle[] = [];
  for (const pkg of packages) {
    const pkgRoot = resolveUnderRoot(projectRoot, pkg, deps.realpath);
    if (!pkgRoot) continue;
    const files = listFilesRecursive(pkgRoot, deps);
    for (const file of files) {
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
  if (bundle.lines < 2) issues.push('Agent Script file looks empty.');
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
          : '';
  return {
    sessionId,
    utterance: utterance?.slice(0, 200),
    response: response.slice(0, 800),
    topic: typeof row.topic === 'string' ? row.topic : undefined
  };
}

export function parseEvalSpec(text: string): { ok: true; spec: unknown; testCount: number } | { ok: false; error: string } {
  const parsed = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  })();
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Eval spec must be a JSON object.' };
  const row = parsed as { tests?: unknown; utterances?: unknown };
  const tests = Array.isArray(row.tests) ? row.tests : Array.isArray(row.utterances) ? row.utterances : null;
  if (!tests || tests.length === 0) return { ok: false, error: 'Eval spec needs a non-empty tests or utterances array.' };
  return { ok: true, spec: parsed, testCount: tests.length };
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

export function previewArgs(
  verb: 'start' | 'send' | 'end',
  plan: Pick<AgentPlan, 'sessionId' | 'utterance'>,
  alias: string,
  identity?: AgentPreviewIdentity
): string[] {
  const args = ['agent', 'preview', verb, '--json', '--target-org', alias];
  if (identity?.flag === 'authoring-bundle') {
    args.push('--authoring-bundle', identity.apiName);
    if (verb === 'start') args.push('--simulate-actions');
  } else if (identity?.flag === 'api-name') {
    args.push('--api-name', identity.apiName);
  }
  if (plan.sessionId && verb !== 'start') args.push('--session-id', plan.sessionId);
  if (verb === 'send') args.push('--utterance', plan.utterance ?? '');
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
