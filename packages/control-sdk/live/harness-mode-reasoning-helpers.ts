import { ControlError } from '../src/errors.js';
import { isSkip, preflightOrSkip } from '../src/matrix.js';
import { Zcc } from '../src/client.js';
import type { ProjectRecord } from '../src/projects.js';
import type {
  CliAgentLaunchSpec,
  ExecutionState,
  ModelLevel
} from '../src/types.js';
import { SCENARIO_PROFILES, type ScenarioProfile } from './cli-agent-helpers.js';

export const CRASH_PROMPT = 'Reply with PONG then stop. Do not use tools.';
export const PLAN_PROMPT = `/plan ${CRASH_PROMPT}`;
export const ALIVE_TIMEOUT_MS = 30_000;

export const THREAD_PROVIDER_BY_PROFILE = {
  claude: 'claude-code',
  cursor: 'acp-cursor',
  codex: 'codex',
  opencode: 'acp-opencode'
} as const;

export const EXECUTION_STATES: readonly ExecutionState[] = [
  'plan',
  'interactive',
  'accept-edits',
  'autonomous'
];

/**
 * `accept-edits` sets `unattendedAllowed: false` on every harness target, so
 * product-server CLI Agent HTTP (unattended) is DENIED. `interactive` with a
 * closest/conditional mapping also needs consent the unattended path cannot
 * mint. Those launches still belong in the case table: a clean DENIED is not
 * a crash.
 */

/** Mapped CLI model levels per profile. Cursor has no low / extra-high mapping. */
export const CLI_MODEL_LEVELS: Record<ScenarioProfile, readonly ModelLevel[]> = {
  claude: ['low', 'medium', 'high'],
  cursor: ['medium', 'high'],
  codex: ['low', 'medium', 'high'],
  opencode: ['low', 'medium', 'high']
};

const THREAD_ALIVE = new Set(['starting', 'running', 'active', 'idle', 'waiting', 'working', 'stopping', 'unknown']);
const CLI_ALIVE = new Set(['working', 'idle', 'done', 'starting', 'unknown']);
const THREAD_CRASH = new Set(['error']);
const CLI_CRASH = new Set(['exited']);

export interface ThreadModeReasoningCase {
  name: string;
  providerId: string;
  prompt: string;
  acpMode?: string;
  reasoningLevel?: string;
}

export interface CliModeReasoningCase {
  name: string;
  profile: ScenarioProfile;
  harnessRouting?: CliAgentLaunchSpec['harnessRouting'];
}

export function threadModeReasoningCases(): ThreadModeReasoningCase[] {
  return [
    { name: 'claude-code mode agent', providerId: 'claude-code', prompt: CRASH_PROMPT },
    { name: 'claude-code mode plan', providerId: 'claude-code', prompt: PLAN_PROMPT },
    { name: 'claude-code reasoning low', providerId: 'claude-code', prompt: CRASH_PROMPT, reasoningLevel: 'low' },
    { name: 'claude-code reasoning medium', providerId: 'claude-code', prompt: CRASH_PROMPT, reasoningLevel: 'medium' },
    { name: 'claude-code reasoning high', providerId: 'claude-code', prompt: CRASH_PROMPT, reasoningLevel: 'high' },
    { name: 'acp-cursor mode agent', providerId: 'acp-cursor', prompt: CRASH_PROMPT, acpMode: 'agent' },
    { name: 'acp-cursor mode plan', providerId: 'acp-cursor', prompt: CRASH_PROMPT, acpMode: 'plan' },
    { name: 'acp-cursor reasoning low', providerId: 'acp-cursor', prompt: CRASH_PROMPT, reasoningLevel: 'low' },
    { name: 'acp-cursor reasoning medium', providerId: 'acp-cursor', prompt: CRASH_PROMPT, reasoningLevel: 'medium' },
    { name: 'acp-cursor reasoning high', providerId: 'acp-cursor', prompt: CRASH_PROMPT, reasoningLevel: 'high' },
    { name: 'codex mode agent', providerId: 'codex', prompt: CRASH_PROMPT },
    { name: 'codex mode plan', providerId: 'codex', prompt: PLAN_PROMPT },
    { name: 'codex reasoning low', providerId: 'codex', prompt: CRASH_PROMPT, reasoningLevel: 'low' },
    { name: 'codex reasoning medium', providerId: 'codex', prompt: CRASH_PROMPT, reasoningLevel: 'medium' },
    { name: 'codex reasoning high', providerId: 'codex', prompt: CRASH_PROMPT, reasoningLevel: 'high' },
    { name: 'acp-opencode mode build', providerId: 'acp-opencode', prompt: CRASH_PROMPT, acpMode: 'build' },
    { name: 'acp-opencode mode plan', providerId: 'acp-opencode', prompt: CRASH_PROMPT, acpMode: 'plan' },
    { name: 'acp-opencode reasoning low', providerId: 'acp-opencode', prompt: CRASH_PROMPT, reasoningLevel: 'low' },
    { name: 'acp-opencode reasoning medium', providerId: 'acp-opencode', prompt: CRASH_PROMPT, reasoningLevel: 'medium' },
    { name: 'acp-opencode reasoning high', providerId: 'acp-opencode', prompt: CRASH_PROMPT, reasoningLevel: 'high' }
  ];
}

function routingFor(
  profile: string,
  intent: NonNullable<CliAgentLaunchSpec['harnessRouting']>['byAdapter'][string]
): CliAgentLaunchSpec['harnessRouting'] {
  return { schemaVersion: 1, byAdapter: { [profile]: intent } };
}

export function cliModeReasoningCases(): CliModeReasoningCase[] {
  const cases: CliModeReasoningCase[] = [];
  for (const profile of SCENARIO_PROFILES) {
    for (const executionState of EXECUTION_STATES) {
      cases.push({
        name: `${profile} executionState ${executionState}`,
        profile,
        harnessRouting: routingFor(profile, { executionState })
      });
    }
  }
  for (const roleTargetId of ['build', 'plan'] as const) {
    cases.push({
      name: `opencode role ${roleTargetId}`,
      profile: 'opencode',
      harnessRouting: routingFor('opencode', { roleTargetId })
    });
  }
  for (const profile of SCENARIO_PROFILES) {
    for (const modelLevel of CLI_MODEL_LEVELS[profile]) {
      cases.push({
        name: `${profile} modelLevel ${modelLevel}`,
        profile,
        harnessRouting: routingFor(profile, { modelLevel })
      });
    }
  }
  return cases;
}

export async function waitUntilAlive(
  refresh: () => Promise<{ status?: string }>,
  opts: {
    kind: 'thread' | 'cli-agent';
    sleep: (ms: number) => Promise<void>;
    nowMs: () => number;
    timeoutMs?: number;
  }
): Promise<{ status: string }> {
  const timeoutMs = opts.timeoutMs ?? ALIVE_TIMEOUT_MS;
  const deadline = opts.nowMs() + timeoutMs;
  let lastStatus = '';
  while (opts.nowMs() < deadline) {
    try {
      const row = await refresh();
      const status = row.status ?? '';
      lastStatus = status;
      if (opts.kind === 'thread') {
        if (THREAD_CRASH.has(status)) {
          throw new ControlError('UNHEALTHY', `thread entered error state`, { details: row });
        }
        if (THREAD_ALIVE.has(status) || status.length > 0) return { status };
      } else {
        if (CLI_CRASH.has(status)) {
          throw new ControlError('UNHEALTHY', `CLI agent exited before becoming alive`, { details: row });
        }
        if (CLI_ALIVE.has(status) || (status.length > 0 && status !== 'error')) return { status };
      }
    } catch (error) {
      if (error instanceof ControlError && error.code === 'NOT_FOUND') {
        throw new ControlError(
          'UNHEALTHY',
          `${opts.kind} disappeared before becoming alive`,
          { details: error.details }
        );
      }
      throw error;
    }
    await opts.sleep(250);
  }
  throw new ControlError(
    'TIMEOUT',
    `${opts.kind} did not become alive within ${timeoutMs}ms (last=${lastStatus || 'unknown'})`
  );
}

/** Product-server CLI Agent launches are unattended; some execution states refuse that cleanly. */
export function isUnattendedPolicyDeny(error: unknown): boolean {
  if (!(error instanceof ControlError)) return false;
  if (error.code !== 'HTTP_ERROR') return false;
  const message = error.message;
  return message.includes('disallows unattended execution') || message.includes('no matching consent');
}

export async function withLiveThread(
  providerId: string,
  fn: (ctx: { zcc: Zcc; project: ProjectRecord }) => Promise<void>
): Promise<void> {
  const zcc = await Zcc.connect();
  try {
    const project = await zcc.projects.ensureLiveSandbox();
    const pre = await preflightOrSkip(zcc, { surface: 'thread', providerId });
    if (isSkip(pre)) {
      console.warn(`[live] skip thread ${providerId}: ${pre.reason}`);
      return;
    }
    await fn({ zcc, project });
  } finally {
    await zcc.close();
  }
}
