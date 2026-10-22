/**
 * squad_propose / squad_launch / squad_plan_check — let a running agent (PTY or Modern thread)
 * prepare a Squad launch from files it wrote (or start one when the user asked for that),
 * and dry-run a portable plan.
 *
 * Trust model: identity (`sessionId`, `projectId`) comes from the MCP route and
 * is closed over here, never read from agent input. Unlike `launch_team`, the
 * liveness check FAILS CLOSED: a missing validator, a false result or a throw
 * all deny. main owns every other decision behind the injected deps.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SQUAD_PROPOSAL_LIMITS,
  type SquadLaunchNowErrorCode,
  type SquadLaunchNowResult,
  type SquadPlanCheckResult,
  type SquadProposalErrorCode,
  type SquadProposalInput,
  type SquadProposalResult
} from '@zana-ai/zcc-domain/squad-proposal';

type DepResult<T> = { ok: true; value: T } | { ok: false; code: SquadProposalErrorCode; message: string };

export type SquadProposeDep = (
  route: { projectId: string; sessionId: string },
  input: SquadProposalInput
) => Promise<DepResult<SquadProposalResult>>;

export type SquadLaunchNowDep = (
  route: { projectId: string; sessionId: string },
  input: SquadProposalInput
) => Promise<
  | { ok: true; value: SquadLaunchNowResult }
  | { ok: false; code: SquadLaunchNowErrorCode | (string & {}); message: string }
>;

export type SquadPlanCheckDep = (
  route: { projectId: string },
  input: { path?: string; text?: string }
) => Promise<DepResult<SquadPlanCheckResult>>;

export interface RegisterSquadProposalToolsOpts {
  sessionId?: string;
  projectId: string;
  propose?: SquadProposeDep;
  launchSquadNow?: SquadLaunchNowDep;
  checkPlan?: SquadPlanCheckDep;
  validateRouteIdentity?: (sessionId: string, projectId: string) => boolean | Promise<boolean>;
  /** Owner-session gate for starting a Squad; falls back to `validateRouteIdentity`, as `execution.start` does. */
  validateOwnerRouteIdentity?: (sessionId: string, projectId: string) => boolean | Promise<boolean>;
  /** Unexpected dependency failures, with tool and route context; defaults to console.error. */
  logError?: (context: string, error: unknown) => void;
}

export const SQUAD_PROPOSE_DESCRIPTION =
  "Prepare a Squad launch in YOUR project from files you wrote or read (design, portable plan). Nothing starts until the user reviews it in the Inbox card and presses Launch. Use planning 'provided' with a validated portable plan as a source when list_teams says canInferPlan is false. Pass the files' exact paths, wherever they are: this project, the user's home folder or the clone root (protected locations such as ~/.ssh are refused with SOURCE_NOT_ALLOWED). Do not copy them. Members of a running Squad cannot propose.";

export const SQUAD_LAUNCH_DESCRIPTION =
  "Launch a Squad in YOUR project from files you wrote or read. This is the preferred way for an agent to start a Squad; do not hand-build an execution.start request. mode 'review' (the default choice) prepares the launch and the user presses Launch in the Inbox card; it behaves exactly like squad_propose. mode 'now' starts the Squad immediately with no Inbox card and makes you its owner (you answer its blockers and get its reports): use it ONLY when the user explicitly asked to run it now, start immediately or skip the Inbox. If the Squad or its Project requires review, it refuses and you must retry with mode 'review'. Use planning 'provided' with a validated portable plan as a source when list_teams says canInferPlan is false. Pass the files' exact paths, wherever they are: this project, the user's home folder or the clone root (protected locations such as ~/.ssh are refused with SOURCE_NOT_ALLOWED). Do not copy them. Members of a running Squad cannot launch.";

export const SQUAD_PLAN_CHECK_DESCRIPTION =
  'Check a portable-executable plan exactly as a Squad Launch will in Plan provided in goal mode. Pass the plan file path (in this project, the home folder or the clone root) or the plan text. Returns the parsed steps or the reason it fails. Read-only.';

/**
 * Transport bounds only (Rule 5): four times the real limits. The proposal service enforces
 * the real limits, so an agent gets a coded error (e.g. TOO_MANY_SOURCES) it can act on
 * instead of the SDK's generic invalid-params text.
 */
const TRANSPORT = {
  teamIdChars: 256,
  pathChars: 4096,
  goalChars: SQUAD_PROPOSAL_LIMITS.goalChars * 4,
  titleChars: SQUAD_PROPOSAL_LIMITS.titleChars * 4,
  summaryChars: SQUAD_PROPOSAL_LIMITS.summaryChars * 4,
  maxSources: SQUAD_PROPOSAL_LIMITS.maxSources * 4
} as const;

const FIELD_HELP = {
  teamId: 'The id of the Squad to propose (from list_teams).',
  goal: `What the Squad should accomplish (at most ${SQUAD_PROPOSAL_LIMITS.goalChars} characters).`,
  planning: "'infer': the orchestrator plans. 'provided': a portable plan in sources is used.",
  sources: `Exact paths of the files to attach (design, plan); at most ${SQUAD_PROPOSAL_LIMITS.maxSources}. Relative paths are read from the project root; files outside it may be under the home folder or the clone root.`,
  title: `Short card title (at most ${SQUAD_PROPOSAL_LIMITS.titleChars} characters).`,
  summary: `One-paragraph summary for the card (at most ${SQUAD_PROPOSAL_LIMITS.summaryChars} characters).`,
  mode: "'review': the user reviews and launches it from the Inbox (default choice). 'now': start immediately, only when the user explicitly asked for that.",
  planPath: 'Path of the plan file: relative to the project, or absolute (home folder or clone root).',
  planText: 'The plan text (at most 1 MiB).'
} as const;

export const squadProposeInputSchema = {
  teamId: z.string().min(1).max(TRANSPORT.teamIdChars).describe(FIELD_HELP.teamId),
  goal: z.string().min(1).max(TRANSPORT.goalChars).describe(FIELD_HELP.goal),
  planning: z.enum(['infer', 'provided']).optional().describe(FIELD_HELP.planning),
  sources: z.array(z.string().min(1).max(TRANSPORT.pathChars)).max(TRANSPORT.maxSources).optional().describe(FIELD_HELP.sources),
  title: z.string().max(TRANSPORT.titleChars).optional().describe(FIELD_HELP.title),
  summary: z.string().max(TRANSPORT.summaryChars).optional().describe(FIELD_HELP.summary)
};

export const squadLaunchInputSchema = {
  ...squadProposeInputSchema,
  mode: z.enum(['review', 'now']).describe(FIELD_HELP.mode)
};

export const squadPlanCheckInputSchema = {
  path: z.string().min(1).max(TRANSPORT.pathChars).optional().describe(FIELD_HELP.planPath),
  text: z.string().optional().describe(FIELD_HELP.planText)
};

/** The same bounds and help as JSON Schema, for the Modern thread bridge (which doesn't take zod). */
export const SQUAD_PROPOSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    teamId: { type: 'string', minLength: 1, maxLength: TRANSPORT.teamIdChars, description: FIELD_HELP.teamId },
    goal: { type: 'string', minLength: 1, maxLength: TRANSPORT.goalChars, description: FIELD_HELP.goal },
    planning: { type: 'string', enum: ['infer', 'provided'], description: FIELD_HELP.planning },
    sources: { type: 'array', maxItems: TRANSPORT.maxSources, items: { type: 'string', minLength: 1, maxLength: TRANSPORT.pathChars }, description: FIELD_HELP.sources },
    title: { type: 'string', maxLength: TRANSPORT.titleChars, description: FIELD_HELP.title },
    summary: { type: 'string', maxLength: TRANSPORT.summaryChars, description: FIELD_HELP.summary }
  },
  required: ['teamId', 'goal']
};

export const SQUAD_LAUNCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ...SQUAD_PROPOSE_JSON_SCHEMA.properties,
    mode: { type: 'string', enum: ['review', 'now'], description: FIELD_HELP.mode }
  },
  required: ['teamId', 'goal', 'mode']
};

export const SQUAD_PLAN_CHECK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', minLength: 1, maxLength: TRANSPORT.pathChars, description: FIELD_HELP.planPath },
    text: { type: 'string', description: FIELD_HELP.planText }
  }
};

const NOT_OWNER_MESSAGE = 'DENIED: this conversation cannot start a Squad. Use mode review.';
const NO_LAUNCH_NOW_MESSAGE = "UNAVAILABLE: starting a Squad immediately is not available here. Use mode 'review' so the user can Launch it from the Inbox.";

const NOT_LIVE_MESSAGE = 'NOT_LIVE: originating session is not live in this project.';

function errorResult(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}

async function isLive(opts: RegisterSquadProposalToolsOpts, sessionId: string): Promise<boolean> {
  if (!opts.validateRouteIdentity) return false;
  try {
    return (await opts.validateRouteIdentity(sessionId, opts.projectId)) === true;
  } catch {
    return false;
  }
}

async function isOwner(opts: RegisterSquadProposalToolsOpts, sessionId: string): Promise<boolean> {
  const gate = opts.validateOwnerRouteIdentity ?? opts.validateRouteIdentity;
  if (!gate) return false;
  try {
    return (await gate(sessionId, opts.projectId)) === true;
  } catch {
    return false;
  }
}

export function registerSquadProposalTools(server: McpServer, opts: RegisterSquadProposalToolsOpts): void {
  const { sessionId, propose, launchSquadNow, checkPlan } = opts;
  if (!sessionId || !propose) return;
  // A dependency that throws is a bug or an outage: log the cause, give the agent a stable error without internals.
  const unexpected = (tool: string, err: unknown) => {
    try {
      (opts.logError ?? ((context, error) => console.error(context, error)))(`${tool} failed unexpectedly (project ${opts.projectId}, session ${sessionId})`, err);
    } catch { /* logging must not throw */ }
    return errorResult(`${tool} failed: INVALID: unexpected error. Try again; if it keeps failing, tell the user.`);
  };

  server.registerTool(
    'squad_propose',
    { description: SQUAD_PROPOSE_DESCRIPTION, inputSchema: squadProposeInputSchema },
    async (input) => {
      if (!(await isLive(opts, sessionId))) return errorResult(`squad_propose failed: ${NOT_LIVE_MESSAGE}`);
      try {
        const res = await propose({ projectId: opts.projectId, sessionId }, input as SquadProposalInput);
        return res.ok
          ? { content: [{ type: 'text' as const, text: JSON.stringify(res.value) }] }
          : errorResult(`squad_propose failed: ${res.code}: ${res.message}`);
      } catch (err) {
        return unexpected('squad_propose', err);
      }
    }
  );

  server.registerTool(
    'squad_launch',
    { description: SQUAD_LAUNCH_DESCRIPTION, inputSchema: squadLaunchInputSchema },
    async ({ mode, ...input }) => {
      if (!(await isLive(opts, sessionId))) return errorResult(`squad_launch failed: ${NOT_LIVE_MESSAGE}`);
      const route = { projectId: opts.projectId, sessionId };
      try {
        if (mode === 'review') {
          const res = await propose(route, input as SquadProposalInput);
          return res.ok
            ? { content: [{ type: 'text' as const, text: JSON.stringify(res.value) }] }
            : errorResult(`squad_launch failed: ${res.code}: ${res.message}`);
        }
        if (!launchSquadNow) return errorResult(`squad_launch failed: ${NO_LAUNCH_NOW_MESSAGE}`);
        if (!(await isOwner(opts, sessionId))) return errorResult(`squad_launch failed: ${NOT_OWNER_MESSAGE}`);
        const res = await launchSquadNow(route, input as SquadProposalInput);
        return res.ok
          ? { content: [{ type: 'text' as const, text: JSON.stringify(res.value) }] }
          : errorResult(`squad_launch failed: ${res.code}: ${res.message}`);
      } catch (err) {
        return unexpected('squad_launch', err);
      }
    }
  );

  if (!checkPlan) return;
  server.registerTool(
    'squad_plan_check',
    { description: SQUAD_PLAN_CHECK_DESCRIPTION, inputSchema: squadPlanCheckInputSchema },
    async (input) => {
      if (!(await isLive(opts, sessionId))) return errorResult(`squad_plan_check failed: ${NOT_LIVE_MESSAGE}`);
      const { path, text } = input;
      if ((path === undefined) === (text === undefined)) {
        return errorResult('squad_plan_check failed: INVALID: pass exactly one of path or text.');
      }
      if (text !== undefined && Buffer.byteLength(text, 'utf8') > SQUAD_PROPOSAL_LIMITS.planTextBytes) {
        return errorResult('squad_plan_check failed: INVALID: text exceeds 1 MiB.');
      }
      try {
        const res = await checkPlan({ projectId: opts.projectId }, path !== undefined ? { path } : { text });
        return res.ok
          ? { content: [{ type: 'text' as const, text: JSON.stringify(res.value) }] }
          : errorResult(`squad_plan_check failed: ${res.code}: ${res.message}`);
      } catch (err) {
        return unexpected('squad_plan_check', err);
      }
    }
  );
}
