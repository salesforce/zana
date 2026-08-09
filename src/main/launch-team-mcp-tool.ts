/**
 * launch_team — let a running agent launch a Team (a named bundle of personas)
 * into a project, opening one terminal tab per slot: the workers first, then an
 * orchestrator carrying the team prompt + the workers' session ids. The
 * agent-driven counterpart of the Teams panel's "Launch" button.
 *
 * Trust model (same as {@link registerCloseIdleAgentsTools} / the agent
 * registry): identity (`sessionId`, `projectId`) is filled by the MCP router
 * from the URL path (`/mcp/:projectId/:sessionId`) and closed over here — never
 * read from agent input. The agent supplies only WHAT to launch (`teamId`) and
 * optionally WHERE (`projectId`); when it omits the project the tool defaults to
 * the CALLER's own project (the route's projectId), not the team's default —
 * an agent launching a team means "here, where I'm working", unless it names
 * another project explicitly. main authorizes the launch end-to-end
 * ({@link launchTeam}): the team is looked up from the store (never trusted from
 * the agent), the project is validated, and each persona's existence is checked.
 *
 * Gated upstream by the `teamLaunchEnabled` config flag: when off the tool is
 * not registered, so the agent doesn't see it at all.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CancelTeamLaunchResult, LaunchTeamResult, Result, TeamLaunchAuthorizationInputSlot, TeamLaunchAuthorizationResult, TeamLaunchRequestInput } from '../shared/types.js';
import { MAX_TEAM_INITIAL_TASK_BYTES, MAX_TEAM_LAUNCH_DEADLINE_MS, MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH } from './launch/team-lifecycle-store.js';

export const LAUNCH_TEAM_DESCRIPTION = [
  'Complete a structured Team launch after authorize_team_launch. Always call',
  'authorize_team_launch first with a unique launchRequestId and exact initial',
  'task for each slot, then pass its returned slotId and authorizationId values',
  'plus identical initialTask bytes here. Bare cohort-only launch is not',
  'supported. Opens one',
  'terminal tab per slot: the worker agents first, then an orchestrator agent',
  'carrying the team prompt and the workers’ session ids (so it can delegate',
  'to them with agent_send).',
  '',
  'Discover launchable teams (and their ids) with list_teams. By default the',
  'team launches into YOUR project; pass `projectId` (resolve a name with',
  'list_projects) to launch elsewhere. Returns how many tabs opened plus the',
  '`cohortId` of this launch — the whole team shows up grouped under that cohort',
  'on the Agents board, and you can later close its idle members together.'
].join(' ');

export const launchTeamInputSchema = {
  teamId: z
    .string()
    .min(1)
    .describe('The id of the team to launch (from list_teams). Required.'),
  projectId: z
    .string()
    .optional()
    .describe(
      'Project to launch into (from list_projects). Defaults to your own project. The team is opened here regardless of the team’s own default project.'
    ),
  launchRequestId: z.string().min(1).max(MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH),
  deadlineMs: z.number().int().min(1).max(MAX_TEAM_LAUNCH_DEADLINE_MS).optional(),
  maxConcurrent: z.number().int().min(1).max(32).optional(),
  maxLaunches: z.number().int().min(1).max(32).optional(),
  slots: z.array(z.object({
    slotId: z.string().min(1).max(2048),
    initialTask: z.string().min(1).refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_TEAM_INITIAL_TASK_BYTES),
    authorizationId: z.string().min(1).max(2048)
  })).min(1).max(100)
};

export const authorizeTeamLaunchInputSchema = {
  teamId: z.string().min(1),
  projectId: z.string().optional(),
  launchRequestId: z.string().min(1).max(MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH),
  deadlineMs: z.number().int().min(1).max(MAX_TEAM_LAUNCH_DEADLINE_MS).optional(),
  maxConcurrent: z.number().int().min(1).max(32).optional(),
  maxLaunches: z.number().int().min(1).max(32).optional(),
  slots: z.array(z.object({
    initialTask: z.string().min(1).refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_TEAM_INITIAL_TASK_BYTES)
  })).min(1).max(100)
};

export const cancelTeamLaunchInputSchema = {
  launchRequestId: z.string().min(1).max(MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH)
};

export const getTeamLaunchInputSchema = cancelTeamLaunchInputSchema;
export const reportTeamTaskInputSchema = {
  launchRequestId: z.string().min(1).max(MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH),
  slotId: z.string().min(1).max(2048),
  outcome: z.enum(['complete', 'failed'])
};

export interface RegisterLaunchTeamToolOpts {
  /** Originating session (from the URL route). Absent ⇒ the tool isn't useful. */
  sessionId?: string;
  /** Owning project (from the URL route). The default launch target. */
  projectId: string;
  /**
   * Launch the team — the shared, main-authoritative {@link launchTeam} path
   * (team lookup, project validation, per-persona existence checks, the Rule-5
   * tab cap all live behind it). Returns the tabs opened + the launch cohortId.
   */
  launchTeam: (
    teamId: string,
    projectId?: string,
    request?: TeamLaunchRequestInput
  ) => Result<Pick<LaunchTeamResult, 'launched' | 'cohortId'> & Partial<LaunchTeamResult>>
    | Promise<Result<Pick<LaunchTeamResult, 'launched' | 'cohortId'> & Partial<LaunchTeamResult>>>;
  authorizeTeamLaunch?: (
    callerPrincipalId: string,
    teamId: string,
    projectId: string,
    launchRequestId: string,
    policy: { deadlineMs?: number; maxConcurrent?: number; maxLaunches?: number },
    slots: TeamLaunchAuthorizationInputSlot[]
  ) => Result<TeamLaunchAuthorizationResult> | Promise<Result<TeamLaunchAuthorizationResult>>;
  cancelTeamLaunch?: (
    callerPrincipalId: string,
    launchRequestId: string
  ) => Result<CancelTeamLaunchResult> | Promise<Result<CancelTeamLaunchResult>>;
  getTeamLaunch?: (
    callerPrincipalId: string,
    launchRequestId: string
  ) => Result<unknown> | Promise<Result<unknown>>;
  reportTeamTask?: (
    callerPrincipalId: string,
    launchRequestId: string,
    slotId: string,
    outcome: 'complete' | 'failed'
  ) => Result<unknown> | Promise<Result<unknown>>;
  validateRouteIdentity?: (sessionId: string, projectId: string) => boolean;
}

/**
 * Register `launch_team` on the given session-scoped `McpServer`. The handler
 * closes over `sessionId`/`projectId` from the URL match — the agent supplies
 * only `teamId` and an optional `projectId`.
 */
export function registerLaunchTeamTool(
  server: McpServer,
  opts: RegisterLaunchTeamToolOpts
): void {
  const { sessionId, projectId, launchTeam, authorizeTeamLaunch, cancelTeamLaunch, getTeamLaunch, reportTeamTask, validateRouteIdentity } = opts;

  if (authorizeTeamLaunch) server.registerTool(
    'authorize_team_launch',
    { description: 'Authorize exact per-slot Team launch tasks. Returns host slot ids and one-time authorization ids.', inputSchema: authorizeTeamLaunchInputSchema },
    async ({ teamId, projectId: target, launchRequestId, deadlineMs, maxConcurrent, maxLaunches, slots }) => {
      if (!sessionId) return { isError: true, content: [{ type: 'text' as const, text: 'authorize_team_launch failed: no originating session.' }] };
      if (validateRouteIdentity?.(sessionId, projectId) === false) {
        return { isError: true, content: [{ type: 'text' as const, text: 'authorize_team_launch failed: originating session is not live in this project.' }] };
      }
      if (typeof target === 'string' && target && target !== projectId) {
        return { isError: true, content: [{ type: 'text' as const, text: 'authorize_team_launch failed: cross-project launches are not allowed.' }] };
      }
      const result = await authorizeTeamLaunch(
        sessionId, teamId, projectId,
        launchRequestId, {
          ...(deadlineMs === undefined ? {} : { deadlineMs }),
          ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
          ...(maxLaunches === undefined ? {} : { maxLaunches })
        }, slots
      );
      return result.ok
        ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `authorize_team_launch failed: ${result.message}` }] };
    }
  );

  server.registerTool(
    'launch_team',
    { description: LAUNCH_TEAM_DESCRIPTION, inputSchema: launchTeamInputSchema },
    async ({ teamId, projectId: target, launchRequestId, deadlineMs, maxConcurrent, maxLaunches, slots }) => {
      if (!sessionId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'launch_team failed: no originating session (this tool only works inside a live session).'
            }
          ]
        };
      }
      if (validateRouteIdentity?.(sessionId, projectId) === false) {
        return { isError: true, content: [{ type: 'text' as const, text: 'launch_team failed: originating session is not live in this project.' }] };
      }
      if (typeof target === 'string' && target && target !== projectId) {
        return { isError: true, content: [{ type: 'text' as const, text: 'launch_team failed: cross-project launches are not allowed.' }] };
      }

      // Default to the caller's own project when none is named. main re-validates
      // whatever id we pass, so a bad agent-supplied projectId fails cleanly.
      if (!launchRequestId || !slots) {
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: 'launch_team failed: call authorize_team_launch first, then supply its launchRequestId and authorized slots.'
          }]
        };
      }
      const request = {
        callerPrincipalId: sessionId, launchRequestId, slots,
        policy: {
          ...(deadlineMs === undefined ? {} : { deadlineMs }),
          ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
          ...(maxLaunches === undefined ? {} : { maxLaunches })
        },
        requirePreauthorization: true
      };
      const resolvedProjectId = projectId;
      const res = await launchTeam(teamId, resolvedProjectId, request);
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `launch_team failed: ${res.message}` }]
        };
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(res.value) }] };
    }
  );

  if (cancelTeamLaunch) server.registerTool(
    'cancel_team_launch',
    {
      description: 'Cancel workers belonging to one Team launch request created by this live route session.',
      inputSchema: cancelTeamLaunchInputSchema
    },
    async ({ launchRequestId }) => {
      if (!sessionId || validateRouteIdentity?.(sessionId, projectId) === false) {
        return { isError: true, content: [{ type: 'text' as const, text: 'cancel_team_launch failed: originating session is not live in this project.' }] };
      }
      const result = await cancelTeamLaunch(sessionId, launchRequestId);
      return result.ok
        ? { content: [{ type: 'text' as const, text: result.value.pendingSessionIds.length > 0
            ? `Cancellation pending for Team launch "${launchRequestId}" sessions: ${result.value.pendingSessionIds.join(', ')}. Retry cancellation.`
            : `Canceled Team launch "${launchRequestId}" sessions: ${result.value.canceledSessionIds.join(', ') || 'none'}. State: ${result.value.lifecycleState}.` }] }
        : { isError: true, content: [{ type: 'text' as const, text: `cancel_team_launch failed: ${result.message}` }] };
    }
  );

  if (getTeamLaunch) server.registerTool(
    'get_team_launch',
    { description: 'Read caller-scoped durable Team launch and worker lifecycle state.', inputSchema: getTeamLaunchInputSchema },
    async ({ launchRequestId }) => {
      if (!sessionId || validateRouteIdentity?.(sessionId, projectId) === false) {
        return { isError: true, content: [{ type: 'text' as const, text: 'get_team_launch failed: originating session is not live in this project.' }] };
      }
      const result = await getTeamLaunch(sessionId, launchRequestId);
      return result.ok
        ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `get_team_launch failed: ${result.message}` }] };
    }
  );

  if (reportTeamTask) server.registerTool(
    'report_team_task',
    { description: 'Report caller-scoped Team slot task completion or failure.', inputSchema: reportTeamTaskInputSchema },
    async ({ launchRequestId, slotId, outcome }) => {
      if (!sessionId || validateRouteIdentity?.(sessionId, projectId) === false) {
        return { isError: true, content: [{ type: 'text' as const, text: 'report_team_task failed: originating session is not live in this project.' }] };
      }
      const result = await reportTeamTask(sessionId, launchRequestId, slotId, outcome);
      return result.ok
        ? { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `report_team_task failed: ${result.message}` }] };
    }
  );
}
