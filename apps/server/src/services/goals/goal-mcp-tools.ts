/**
 * goal_* — let a running agent create and list persistent Goals in ITS OWN
 * project. The agent-facing counterpart of the renderer's `window.cc.goals.*`
 * IPC + GoalsPanel UI.
 *
 * Trust model (same as {@link registerLibraryTools}): identity — the `projectId`
 * these tools operate on — is closed over here from the MCP URL route
 * (`/mcp/:projectId/:sessionId`), NEVER read from agent input. An agent therefore
 * cannot create or enumerate goals for any OTHER project (no projectId param is
 * exposed), and `scope` is forced to the owning project so the goal is written
 * under `<project>/.zcc/goals` rather than the shared global directory.
 *
 * The actual create/list work is delegated to the injected {@link GoalAgentApi}
 * (a project-locked slice of the GoalManager), which owns the disk writes,
 * validation, and the event-driven loop. This module is just the tool wiring.
 *
 * Gated upstream by the `goalAgentApi` dep being present in McpServerOptions:
 * absent ⇒ the tools are not registered, so the agent doesn't see them.
 * Session-scoped only (a create is an action worth attributing to a session).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Goal, GoalCreateInput } from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';

/**
 * The project-locked slice of GoalManager the tools call. `projectId` is
 * supplied by the tool wiring (from the route), not the agent.
 */
export interface GoalAgentApi {
  /** Goals for one project (the route's projectId). */
  agentList(projectId: string): Goal[];
  /** Create a goal under one project. `scope` is forced to that project by the wiring. */
  agentCreate(projectId: string, input: GoalCreateInput): Goal;
}

export const GOAL_CREATE_DESCRIPTION = [
  'Create a persistent Goal in THIS project: an objective plus falsifiable',
  'success criteria that the app works toward autonomously. Each iteration the',
  'app spawns a worker session, evaluates its result against the criteria, and',
  're-spawns with feedback until they pass, the iteration cap is hit, or it',
  'stalls. The goal is written under this project (`<project>/.zcc/goals`) and',
  'appears live in the project’s Goals tab.',
  '',
  'Write SHARP, externally-checkable criteria (e.g. "`npm test` exits 0", "no',
  'TypeScript errors") — the clearer they are, the more reliable the "achieved"',
  'verdict. Set `activate: true` to arm the loop immediately; otherwise it is',
  'created as a draft the user activates. Each iteration spends real tokens, so',
  'keep `maxIterations` conservative.'
].join(' ');

export const GOAL_LIST_DESCRIPTION = [
  'List the Goals in THIS project: id, title, status, current iteration / cap,',
  'success criteria, and the latest verdict for each. Read-only; takes no',
  'arguments. Use it to see what objectives are already defined before creating',
  'a new one.'
].join(' ');

export const goalCreateInputSchema = {
  title: z.string().min(1).describe('Short human title, e.g. "Get the test suite green".'),
  statement: z
    .string()
    .min(1)
    .describe(
      'The objective handed to the worker as its opening prompt each iteration. Be concrete and outcome-focused.'
    ),
  successCriteria: z
    .array(z.string())
    .optional()
    .describe(
      'Falsifiable checks the evaluator scores each iteration against, e.g. ["`npm test` exits 0", "no TypeScript errors"]. Strongly recommended.'
    ),
  maxIterations: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Hard ceiling on iterations (cost/runaway safety). Defaults to 10.'),
  noProgressLimit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe('Consecutive no-progress rounds before the goal escalates to the user. Defaults to 2.'),
  profile: z
    .enum(VALID_PROFILES)
    .optional()
    .describe('Launch profile for each worker session. Defaults to claude-yolo.'),
  activate: z
    .boolean()
    .optional()
    .describe('Arm the loop immediately (status active) instead of creating a draft. Defaults to false.')
};

export interface RegisterGoalToolsOpts {
  /** Owning project from the URL route — the only scope these tools touch. */
  projectId: string;
  /** Originating session from the URL route — gates registration (action tools want a session). */
  sessionId?: string;
  /** The project-locked GoalManager slice. Absent ⇒ tools not registered. */
  goalAgentApi: GoalAgentApi;
}

/** A Goal projected to the compact fields the list tool echoes (drops verbose history). */
function summarize(goal: Goal) {
  const latest = goal.history?.iterations?.[0];
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    iteration: goal.iteration,
    maxIterations: goal.maxIterations,
    successCriteria: goal.successCriteria,
    lastVerdict: latest?.verdict,
    lastRationale: latest?.rationale,
    updatedAt: goal.updatedAt
  };
}

/**
 * Register goal_create / goal_list on the given session-scoped `McpServer`.
 * Each handler closes over projectId from the route; the agent supplies only
 * the goal's fields, never a project or scope.
 */
export function registerGoalTools(server: McpServer, opts: RegisterGoalToolsOpts): void {
  const { projectId, goalAgentApi } = opts;
  const fail = (tool: string, err: unknown) => ({
    isError: true as const,
    content: [
      { type: 'text' as const, text: `${tool} failed: ${err instanceof Error ? err.message : String(err)}` }
    ]
  });

  server.registerTool(
    'goal_create',
    { description: GOAL_CREATE_DESCRIPTION, inputSchema: goalCreateInputSchema },
    async ({ title, statement, successCriteria, maxIterations, noProgressLimit, profile, activate }) => {
      try {
        const goal = goalAgentApi.agentCreate(projectId, {
          // projectId + scope are forced by the wiring to the route's project —
          // the agent cannot target another project or the global directory.
          projectId,
          scope: { projectId },
          title,
          statement,
          successCriteria: successCriteria ?? [],
          maxIterations,
          noProgressLimit,
          assignment: profile ? { kind: 'profile', profile } : undefined,
          activate
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Created goal "${goal.title}" (${goal.status}) in this project. id=${goal.id}`
            }
          ]
        };
      } catch (err) {
        return fail('goal_create', err);
      }
    }
  );

  server.registerTool(
    'goal_list',
    { description: GOAL_LIST_DESCRIPTION, inputSchema: {} },
    async () => {
      try {
        const goals = goalAgentApi.agentList(projectId).map(summarize);
        return { content: [{ type: 'text' as const, text: JSON.stringify(goals, null, 2) }] };
      } catch (err) {
        return fail('goal_list', err);
      }
    }
  );
}
