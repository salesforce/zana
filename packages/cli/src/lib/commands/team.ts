import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TEAM_GOAL_MAX_CHARS } from '@zana-ai/zcc-domain/product';
import { errResult, type CliResult } from '../cli-result.js';
import { flagValue, hasFlag, stripFlags } from '../flag-parse.js';
import {
  nowMs,
  productRequest,
  renderOrJson,
  sleepMs,
  type ProductHttpDeps
} from '../product-http.js';

interface TeamLaunchValue {
  kind?: 'job' | 'run';
  id?: string;
  state?: string;
}

interface TeamStatusValue {
  kind?: 'job' | 'run';
  id?: string;
  projectId?: string;
  teamId?: string;
  state?: string;
  stateVersion?: number;
  goal?: string;
  summary?: string;
  blockers?: Array<{ id?: string; question?: string; resolved?: boolean }>;
}

const MAX_WAIT_MS = 24 * 60 * 60 * 1_000;

function parseDuration(raw: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(raw.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  const unit = match[2] ?? 's';
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000;
  const milliseconds = n * multiplier;
  return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_WAIT_MS ? milliseconds : undefined;
}

async function resolveGoal(raw: string | undefined): Promise<{ ok: true; goal: string } | { ok: false; result: CliResult }> {
  if (!raw) return { ok: false, result: errResult('team launch requires --goal', 2) };
  if (raw.startsWith('@')) {
    const file = raw.slice(1);
    if (!file) return { ok: false, result: errResult('--goal @file requires a path', 2) };
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(resolve(file), 'r');
      const buffer = Buffer.alloc(TEAM_GOAL_MAX_CHARS + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > TEAM_GOAL_MAX_CHARS) {
        return { ok: false, result: errResult(`goal file '${file}' exceeds ${TEAM_GOAL_MAX_CHARS} bytes`, 2) };
      }
      const goal = buffer.subarray(0, bytesRead).toString('utf8').trim();
      if (!goal) return { ok: false, result: errResult(`goal file '${file}' is empty`, 2) };
      if (goal.length > TEAM_GOAL_MAX_CHARS) {
        return { ok: false, result: errResult(`goal file '${file}' exceeds ${TEAM_GOAL_MAX_CHARS} characters`, 2) };
      }
      return { ok: true, goal };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, result: errResult(`cannot read goal file '${file}': ${detail}`, 2) };
    } finally {
      await handle?.close();
    }
  }
  return { ok: true, goal: raw };
}

function formatStatus(row: TeamStatusValue): string {
  return `${row.id ?? '?'}\t${row.kind ?? '?'}\t${row.state ?? '?'}\t${row.teamId ?? '-'}`;
}

function isTerminal(state: string | undefined): boolean {
  const value = (state ?? '').toLowerCase();
  return value === 'completed' || value === 'stopped' || value === 'failed';
}

async function waitForId(
  id: string,
  timeoutMs: number,
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const deadline = nowMs(deps) + timeoutMs;
  while (nowMs(deps) < deadline) {
    const shown = await productRequest<{ ok?: boolean; value?: TeamStatusValue }>(
      'GET',
      `/api/v1/executions/${encodeURIComponent(id)}`,
      { deps }
    );
    if (!shown.ok) {
      return shown.result;
    }
    const row = shown.data.value ?? (shown.data as TeamStatusValue);
    if (isTerminal(row.state)) {
      return renderOrJson(json, row, `${formatStatus(row)}\n`);
    }
    await sleepMs(500, deps);
  }
  return {
    exitCode: 124,
    stdout: '',
    stderr: `Error: timed out waiting for ${id}\n`
  };
}

export async function runTeamCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult | undefined> {
  if (subcommand === 'ls' || subcommand === 'list' || !subcommand) return undefined;

  if (subcommand === 'launch') {
    const teamId = flagValue(rest, '--team');
    const projectId = flagValue(rest, '--project');
    const goalRaw = flagValue(rest, '--goal');
    const modeRaw = flagValue(rest, '--mode') ?? 'structured';
    const title = flagValue(rest, '--title');
    const summary = flagValue(rest, '--summary');
    const wait = hasFlag(rest, '--wait');
    if (!teamId) return errResult('team launch requires --team <id>', 2);
    if (!projectId) return errResult('team launch requires --project <id>', 2);
    if (modeRaw !== 'structured' && modeRaw !== 'freeform') {
      return errResult("--mode must be 'structured' or 'freeform'", 2);
    }
    const resolved = await resolveGoal(goalRaw);
    if (!resolved.ok) return resolved.result;
    const timeoutRaw = flagValue(rest, '--timeout') ?? '5m';
    const timeoutMs = parseDuration(timeoutRaw);
    if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
    const launched = await productRequest<{ ok?: boolean; value?: TeamLaunchValue }>(
      'POST',
      '/api/v1/teams/launch',
      {
        deps,
        body: {
          teamId,
          projectId,
          goal: resolved.goal,
          mode: modeRaw,
          ...(title ? { title } : {}),
          ...(summary ? { summary } : {})
        }
      }
    );
    if (!launched.ok) return launched.result;
    const row = launched.data.value;
    if (!row?.id) return errResult('team launch did not return an id');
    if (!wait) return renderOrJson(json, row, `${row.id}\t${row.kind ?? '?'}\t${row.state ?? 'starting'}\n`);
    return waitForId(row.id, timeoutMs, json, deps);
  }

  if (subcommand === 'status') {
    const id = rest[0];
    if (!id) return errResult('team status requires <id>', 2);
    const shown = await productRequest<{ value?: TeamStatusValue }>(
      'GET',
      `/api/v1/executions/${encodeURIComponent(id)}`,
      { deps }
    );
    if (!shown.ok) return shown.result;
    const row = shown.data.value ?? (shown.data as TeamStatusValue);
    return renderOrJson(json, row, `${formatStatus(row)}\n`);
  }

  if (subcommand === 'wait') {
    const timeoutRaw = flagValue(rest, '--timeout') ?? '5m';
    const timeoutMs = parseDuration(timeoutRaw);
    if (timeoutMs === undefined) return errResult(`invalid --timeout '${timeoutRaw}'`, 2);
    const id = stripFlags(rest, ['--timeout'], [])[0];
    if (!id) return errResult('team wait requires <id>', 2);
    return waitForId(id, timeoutMs, json, deps);
  }

  if (subcommand === 'answer') {
    const text = flagValue(rest, '--text');
    const blockerId = flagValue(rest, '--blocker');
    const id = stripFlags(rest, ['--text', '--blocker'], [])[0];
    if (!id || !text) return errResult('team answer requires <id> and --text', 2);
    const answered = await productRequest<unknown>(
      'POST',
      `/api/v1/executions/${encodeURIComponent(id)}/answer`,
      { deps, body: { message: text, ...(blockerId ? { blockerId } : {}) } }
    );
    if (!answered.ok) return answered.result;
    return renderOrJson(json, answered.data, 'ok\n');
  }

  if (subcommand === 'stop') {
    const id = rest[0];
    if (!id) return errResult('team stop requires <id>', 2);
    const stopped = await productRequest<unknown>(
      'POST',
      `/api/v1/executions/${encodeURIComponent(id)}/stop`,
      { deps, body: {} }
    );
    if (!stopped.ok) return stopped.result;
    return renderOrJson(json, stopped.data, `${id} stopped\n`);
  }

  return errResult(
    `unknown team command '${subcommand}'. Try ls, launch, status, wait, answer, stop.`,
    2
  );
}
