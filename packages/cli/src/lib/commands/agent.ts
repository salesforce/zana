import { errResult, type CliResult } from '../cli-result.js';
import { flagValue, hasFlag, splitSentinel, stripFlags } from '../flag-parse.js';
import {
  renderOrJson,
  resolveServerUrl,
  sleepMs,
  type ProductHttpDeps
} from '../product-http.js';
import {
  CliAgentHandle,
  ControlError,
  ProductHttpClient,
  assertRoleXorModel,
  exitCodeForControlError,
  launchCliAgent,
  type CliAgentLaunchSpec,
  type CliAgentWaitUntil,
  type ExecutionState,
  type ModelLevel
} from '@zana-ai/zcc-control';

const EXECUTION_STATES: readonly ExecutionState[] = ['plan', 'interactive', 'accept-edits', 'autonomous'];
const MODEL_LEVELS: readonly ModelLevel[] = ['low', 'medium', 'high', 'extra-high'];
const WAIT_UNTIL: readonly CliAgentWaitUntil[] = ['idle', 'working', 'done', 'exited'];

function parseDuration(raw: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(raw.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = match[2] ?? 's';
  if (unit === 'ms') return n;
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60_000;
  return n * 3_600_000;
}

function asCliError(error: unknown, idleMessage?: string): CliResult {
  if (error instanceof ControlError && error.code === 'TIMEOUT') {
    return {
      exitCode: 124,
      stdout: '',
      stderr: `Error: ${idleMessage ?? error.message}\n`
    };
  }
  if (error instanceof ControlError) {
    return errResult(error.message, exitCodeForControlError(error));
  }
  return errResult(error instanceof Error ? error.message : String(error));
}

function productHttp(deps?: ProductHttpDeps): ProductHttpClient {
  return new ProductHttpClient(resolveServerUrl(deps), {
    fetchImpl: deps?.fetchImpl,
    nowMs: deps?.nowMs ?? (() => Date.now()),
    sleep: deps?.sleep ?? ((ms) => sleepMs(ms, deps))
  });
}

function routingFromFlags(
  profile: string,
  state: string | undefined,
  modelLevel: string | undefined,
  role: string | undefined
): CliAgentLaunchSpec['harnessRouting'] {
  if (!state && !modelLevel && !role) return undefined;
  const intent: NonNullable<CliAgentLaunchSpec['harnessRouting']>['byAdapter'][string] = {};
  if (role) intent.roleTargetId = role;
  if (modelLevel) intent.modelLevel = modelLevel as ModelLevel;
  if (state) intent.executionState = state as ExecutionState;
  return { schemaVersion: 1, byAdapter: { [profile]: intent } };
}

export async function runAgentLaunch(
  args: string[],
  json: boolean,
  deps: ProductHttpDeps | undefined,
  dataDir: string
): Promise<CliResult> {
  const { head, tail } = splitSentinel(args);
  const extraFlags = [
    '--project', '--prompt', '--profile', '--persona', '--title', '--timeout',
    '--execution-state', '--model-level', '--role'
  ];
  const projectId = flagValue(head, '--project')
    ?? stripFlags(head, extraFlags, ['--wait', '--json'])[0];
  const promptFromFlag = flagValue(head, '--prompt');
  const positional = stripFlags(head, extraFlags, ['--wait', '--json']);
  const promptParts = tail.length > 0
    ? tail
    : promptFromFlag
      ? [promptFromFlag]
      : positional.slice(projectId && positional[0] === projectId ? 1 : (flagValue(head, '--project') ? 0 : 1));
  const prompt = promptParts.join(' ').trim();
  if (!projectId) return errResult('agent launch requires --project <id>', 2);
  if (!prompt) return errResult('agent launch requires --prompt or a prompt positional', 2);
  const state = flagValue(head, '--execution-state');
  if (state && !EXECUTION_STATES.includes(state as ExecutionState)) {
    return errResult(`invalid --execution-state '${state}'`, 2);
  }
  const modelLevel = flagValue(head, '--model-level');
  if (modelLevel && !MODEL_LEVELS.includes(modelLevel as ModelLevel)) {
    return errResult(`invalid --model-level '${modelLevel}'`, 2);
  }
  const timeoutRaw = flagValue(head, '--timeout') ?? '5m';
  const timeoutMs = parseDuration(timeoutRaw);
  if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
  const profile = flagValue(head, '--profile') ?? 'claude';
  const harnessRouting = routingFromFlags(profile, state, modelLevel, flagValue(head, '--role'));
  try {
    assertRoleXorModel({ harnessRouting });
    const agent = await launchCliAgent(productHttp(deps), {
      projectId,
      profile,
      prompt,
      personaId: flagValue(head, '--persona'),
      title: flagValue(head, '--title'),
      harnessRouting
    }, { runId: 'operator', dataDir, tagged: false });
    if (!hasFlag(head, '--wait')) {
      const row = agent.snapshot();
      return renderOrJson(json, row, `${row.id}\t${row.status ?? 'starting'}\n`);
    }
    const waited = await agent.wait({ until: 'idle', timeoutMs });
    return renderOrJson(json, waited, `${waited.id}\t${waited.status ?? '?'}\n`);
  } catch (error) {
    return asCliError(error, 'timed out waiting for CLI agent; it is still running');
  }
}

export async function runAgentWait(
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const timeoutRaw = flagValue(rest, '--timeout') ?? '5m';
  const timeoutMs = parseDuration(timeoutRaw);
  if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
  const untilRaw = flagValue(rest, '--until') ?? 'idle';
  if (!WAIT_UNTIL.includes(untilRaw as CliAgentWaitUntil)) {
    return errResult(`invalid --until '${untilRaw}'`, 2);
  }
  const id = stripFlags(rest, ['--timeout', '--until'], ['--json'])[0];
  if (!id) return errResult('agent wait requires a <sessionId>', 2);
  const agent = new CliAgentHandle(productHttp(deps), id, {
    id,
    projectId: '',
    profile: '',
    status: 'unknown'
  });
  try {
    const row = await agent.wait({ until: untilRaw as CliAgentWaitUntil, timeoutMs });
    return renderOrJson(json, row, `${row.id}\t${row.status ?? '?'}\n`);
  } catch (error) {
    return asCliError(error, `timed out waiting for CLI agent ${id}; it is still running`);
  }
}

export async function runAgentReply(
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const id = rest[0];
  const text = rest.slice(1).join(' ').trim();
  if (!id || !text) return errResult('agent reply requires a <sessionId> and a message', 2);
  const agent = new CliAgentHandle(productHttp(deps), id, {
    id,
    projectId: '',
    profile: '',
    status: 'unknown'
  });
  try {
    await agent.reply(text);
    return renderOrJson(json, { ok: true, id }, `${id} replied\n`);
  } catch (error) {
    return asCliError(error);
  }
}

export async function runAgentStop(
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const id = rest[0];
  if (!id) return errResult('agent stop requires a <sessionId>', 2);
  const agent = new CliAgentHandle(productHttp(deps), id, {
    id,
    projectId: '',
    profile: '',
    status: 'unknown'
  });
  try {
    await agent.stop();
    return renderOrJson(json, { ok: true, id }, `${id} stopped\n`);
  } catch (error) {
    return asCliError(error);
  }
}
