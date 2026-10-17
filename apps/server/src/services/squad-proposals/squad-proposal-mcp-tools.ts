/**
 * squad_propose / squad_plan_check — let a running agent (PTY or Modern thread)
 * prepare a Squad launch from files it wrote, and dry-run a portable plan.
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

export type SquadPlanCheckDep = (
  route: { projectId: string },
  input: { path?: string; text?: string }
) => Promise<DepResult<SquadPlanCheckResult>>;

export interface RegisterSquadProposalToolsOpts {
  sessionId?: string;
  projectId: string;
  propose?: SquadProposeDep;
  checkPlan?: SquadPlanCheckDep;
  validateRouteIdentity?: (sessionId: string, projectId: string) => boolean | Promise<boolean>;
}

export const SQUAD_PROPOSE_DESCRIPTION =
  "Prepare a Squad launch in YOUR project from files you wrote (design, portable plan). Nothing starts until the user reviews it in the Inbox card and presses Launch. Use planning 'provided' with a validated portable plan as a source when list_teams says canInferPlan is false. Files must be inside this project. Members of a running Squad cannot propose.";

export const SQUAD_PLAN_CHECK_DESCRIPTION =
  'Check a portable-executable plan exactly as a Squad Launch will in Plan provided in goal mode. Pass a project file path or the plan text. Returns the parsed steps or the reason it fails. Read-only.';

/**
 * Transport bounds only (Rule 5): four times the real limits. The proposal service enforces
 * the real limits, so an agent gets a coded error (e.g. TOO_MANY_SOURCES) it can act on
 * instead of the SDK's generic invalid-params text.
 */
const TRANSPORT = {
  goalChars: SQUAD_PROPOSAL_LIMITS.goalChars * 4,
  titleChars: SQUAD_PROPOSAL_LIMITS.titleChars * 4,
  summaryChars: SQUAD_PROPOSAL_LIMITS.summaryChars * 4,
  maxSources: SQUAD_PROPOSAL_LIMITS.maxSources * 4
} as const;

export const squadProposeInputSchema = {
  teamId: z.string().min(1).max(256).describe('The id of the Squad to propose (from list_teams).'),
  goal: z.string().min(1).max(TRANSPORT.goalChars).describe(`What the Squad should accomplish (at most ${SQUAD_PROPOSAL_LIMITS.goalChars} characters).`),
  planning: z
    .enum(['infer', 'provided'])
    .optional()
    .describe("'infer': the orchestrator plans. 'provided': a portable plan in sources is used."),
  sources: z
    .array(z.string().min(1).max(4096))
    .max(TRANSPORT.maxSources)
    .optional()
    .describe(`Project file paths to attach (design, plan); at most ${SQUAD_PROPOSAL_LIMITS.maxSources}. Must be inside this project.`),
  title: z.string().max(TRANSPORT.titleChars).optional().describe(`Short card title (at most ${SQUAD_PROPOSAL_LIMITS.titleChars} characters).`),
  summary: z.string().max(TRANSPORT.summaryChars).optional().describe(`One-paragraph summary for the card (at most ${SQUAD_PROPOSAL_LIMITS.summaryChars} characters).`)
};

export const squadPlanCheckInputSchema = {
  path: z.string().min(1).max(4096).optional().describe('Project file path of the plan.'),
  text: z.string().optional().describe('The plan text (at most 1 MiB).')
};

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

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerSquadProposalTools(server: McpServer, opts: RegisterSquadProposalToolsOpts): void {
  const { sessionId, propose, checkPlan } = opts;
  if (!sessionId || !propose) return;

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
        return errorResult(`squad_propose failed: INVALID: ${describeError(err)}`);
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
        return errorResult(`squad_plan_check failed: INVALID: ${describeError(err)}`);
      }
    }
  );
}
