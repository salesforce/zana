/** Agent schedule operations go directly to the instance owner, once per request.
 * Browser subscriptions are notifications only and never execute commands. */
import { z } from 'zod';
import { asControlResult, callControlAsProductServer } from '../../http/cli-agent-ops.js';
import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import type { Result, ScheduledTask, ScheduleReloadResult, ScheduleRetryResult, ScheduleRunQueryResult, ScheduleRunRef } from '@zana-ai/zcc-domain/product';
import { compactRunRow, openRetryRefs } from '@zana-ai/zcc-domain/schedule-health';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  SCHEDULE_GET_DESCRIPTION,
  SCHEDULE_UPDATE_DESCRIPTION,
  SCHEDULE_RELOAD_DESCRIPTION,
  scheduleDefinitionPatchSchema,
  projectScheduleDefinition,
  SCHEDULE_LIST_DESCRIPTION,
  SCHEDULE_RUN_NOW_DESCRIPTION,
  SCHEDULE_SET_ENABLED_DESCRIPTION,
  SCHEDULE_RUNS_DESCRIPTION,
  SCHEDULE_RETRY_DESCRIPTION,
  SCHEDULE_DISMISS_DESCRIPTION,
  scheduleRunsInputSchema,
  scheduleRetryInputSchema,
  scheduleDismissInputSchema,
  formatResolveError,
  projectSchedule,
  resolveSchedule,
  scopeSchedules
} from '../scheduler/schedule-manage-mcp-tools.js';

export const SCHEDULE_GET_NAME = 'schedule_get';
export const SCHEDULE_UPDATE_NAME = 'schedule_update';
export const SCHEDULE_RELOAD_NAME = 'schedule_reload';
export const SCHEDULE_LIST_NAME = 'schedule_list';
export const SCHEDULE_RUN_NOW_NAME = 'schedule_run_now';
export const SCHEDULE_SET_ENABLED_NAME = 'schedule_set_enabled';
export const SCHEDULE_RUNS_NAME = 'schedule_runs';
export const SCHEDULE_RETRY_NAME = 'schedule_retry';
export const SCHEDULE_DISMISS_NAME = 'schedule_dismiss';

const runsInput = z.object(scheduleRunsInputSchema).strict();
const retryInput = z.object(scheduleRetryInputSchema).strict();
const dismissInput = z.object(scheduleDismissInputSchema).strict();
const RUN_TOOL_NAMES = [SCHEDULE_RUNS_NAME, SCHEDULE_RETRY_NAME, SCHEDULE_DISMISS_NAME];
/** Page bounds for thread tools (their replies share a 256 KB cap). */
const HOST_RUNS_DEFAULT_LIMIT = 50;
const HOST_RUNS_MAX_LIMIT = 100;
const HOST_OPEN_RETRY_SCAN = 200;

export const HOST_SCHEDULE_INSTRUCTION = [
  'Read, patch or refresh schedules with `schedule_get`, `schedule_update` and `schedule_reload`.',
  'List or toggle Scheduler UI schedules with `schedule_list` / `schedule_set_enabled`.',
  'Fire one immediately with `schedule_run_now` (desktop Scheduler).',
  'Find failed or missed runs with `schedule_runs`, then `schedule_retry` or `schedule_dismiss` them.'
].join(' ');

export const HOST_SCHEDULE_TOOLS: DynamicTool[] = [
  ...[SCHEDULE_GET_NAME, SCHEDULE_UPDATE_NAME, SCHEDULE_RELOAD_NAME].map(name => ({
    name,
    description: name === SCHEDULE_GET_NAME ? SCHEDULE_GET_DESCRIPTION : name === SCHEDULE_UPDATE_NAME ? SCHEDULE_UPDATE_DESCRIPTION : SCHEDULE_RELOAD_DESCRIPTION,
    inputSchema: {
      type: 'object', additionalProperties: false, required: name === SCHEDULE_UPDATE_NAME ? ['id', 'patch'] : ['id'],
      properties: { id: { type: 'string', minLength: 1 }, allProjects: { type: 'boolean' }, ...(name === SCHEDULE_UPDATE_NAME ? { patch: z.toJSONSchema(scheduleDefinitionPatchSchema) } : {}) }
    },
    presentation: { label: { pending: 'Reading schedule', completed: 'Schedule ready' }, icon: { glyph: 'Calendar' } }
  })),
  {
    name: SCHEDULE_LIST_NAME,
    description: SCHEDULE_LIST_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        allProjects: { type: 'boolean' }
      }
    },
    presentation: {
      label: { pending: 'Listing schedules', completed: 'Listed schedules' },
      icon: { glyph: 'Calendar' }
    }
  },
  {
    name: SCHEDULE_RUN_NOW_NAME,
    description: SCHEDULE_RUN_NOW_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1 },
        allProjects: { type: 'boolean' }
      }
    },
    presentation: {
      label: { pending: 'Running schedule', completed: 'Ran schedule' },
      icon: { glyph: 'Play' }
    }
  },
  {
    name: SCHEDULE_SET_ENABLED_NAME,
    description: SCHEDULE_SET_ENABLED_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'enabled'],
      properties: {
        id: { type: 'string', minLength: 1 },
        enabled: { type: 'boolean' },
        allProjects: { type: 'boolean' }
      }
    },
    presentation: {
      label: { pending: 'Updating schedule', completed: 'Updated schedule' },
      icon: { glyph: 'ToggleLeft' }
    }
  },
  ...([
    [SCHEDULE_RUNS_NAME, SCHEDULE_RUNS_DESCRIPTION, runsInput, 'Reading runs', 'Read runs', 'Calendar'],
    [SCHEDULE_RETRY_NAME, SCHEDULE_RETRY_DESCRIPTION, retryInput, 'Retrying runs', 'Retried runs', 'Play'],
    [SCHEDULE_DISMISS_NAME, SCHEDULE_DISMISS_DESCRIPTION, dismissInput, 'Dismissing runs', 'Dismissed runs', 'Calendar']
  ] as const).map(([name, description, schema, pending, completed, glyph]): DynamicTool => ({
    name,
    description,
    inputSchema: z.toJSONSchema(schema) as DynamicTool['inputSchema'],
    presentation: { label: { pending, completed }, icon: { glyph } }
  }))
];

function fail(name: string, error: string): ToolCallResponse {
  return pluginToolResultToResponse(name, { ok: false, error });
}

function row(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

async function invokeOwner<T>(ctx: ProductHttpContext, method: string, args: unknown[]): Promise<T> {
  const response = asControlResult<T>(await callControlAsProductServer(ctx.dataDir, 'product.invoke', { method, args }));
  if (!response.ok) throw new Error(response.message);
  return response.value;
}

export async function invokeHostScheduleTool(
  ctx: ProductHttpContext,
  args: { name: string; threadId: string; projectId: string; input: unknown }
): Promise<ToolCallResponse> {
  const { name, projectId, input } = args;
  const fields = row(input);
  try {
    if (!ctx.toProjects().some(project => project.id === projectId)) throw new Error('Unknown project');
    if (![SCHEDULE_LIST_NAME, SCHEDULE_RUN_NOW_NAME, SCHEDULE_SET_ENABLED_NAME, SCHEDULE_GET_NAME, SCHEDULE_UPDATE_NAME, SCHEDULE_RELOAD_NAME, ...RUN_TOOL_NAMES].includes(name)) throw new Error(`Unsupported schedule tool: ${name}`);
    const widen = fields.allProjects === true;
    const tasks = await invokeOwner<ScheduledTask[]>(ctx, 'scheduler.list', []);
    if (!Array.isArray(tasks)) throw new Error('Invalid scheduler response');
    const scoped = scopeSchedules(tasks, projectId, widen);

    if (name === SCHEDULE_LIST_NAME) {
      const hits = scoped.map(projectSchedule);
      return pluginToolResultToResponse(name, {
        scope: widen ? 'all-projects' : `project:${projectId}`,
        count: hits.length,
        schedules: hits
      });
    }

    if (RUN_TOOL_NAMES.includes(name)) return await invokeRunTool(ctx, name, projectId, fields, scoped, widen);

    const id = typeof fields.id === 'string' ? fields.id.trim() : '';
    if (!id) throw new Error('id is required');
    const found = resolveSchedule(scoped, id);
    if (!found.ok) return fail(name, formatResolveError(found, id));

    if (name === SCHEDULE_GET_NAME || name === SCHEDULE_RELOAD_NAME || name === SCHEDULE_UPDATE_NAME) {
      if (name === SCHEDULE_RELOAD_NAME) {
        const result = await invokeOwner<Result<ScheduleReloadResult>>(ctx, 'scheduler.reload', [found.task.id]);
        if (!result.ok) return fail(name, result.message);
        return pluginToolResultToResponse(name, { ok: true, ...result.value, schedule: projectScheduleDefinition(result.value.schedule) });
      }
      const method = name === SCHEDULE_GET_NAME ? 'get' : 'update';
      const params = name === SCHEDULE_UPDATE_NAME ? [found.task.id, scheduleDefinitionPatchSchema.parse(fields.patch)] : [found.task.id];
      if (name === SCHEDULE_UPDATE_NAME && (params[1] as { launchOptions?: unknown }).launchOptions !== undefined) {
        throw new Error('launchOptions changes are operator-only; use the Scheduler UI');
      }
      const result = await invokeOwner<Result<ScheduledTask>>(ctx, `scheduler.${method}`, params);
      if (!result.ok) return fail(name, result.message);
      const value = result.value;
      return pluginToolResultToResponse(name, { ok: true, schedule: projectScheduleDefinition(value) });
    }

    if (name === SCHEDULE_SET_ENABLED_NAME && typeof fields.enabled !== 'boolean') throw new Error('enabled is required');
    const result = await invokeOwner<Result<ScheduledTask>>(ctx,
      name === SCHEDULE_RUN_NOW_NAME ? 'scheduler.runNow' : 'scheduler.setEnabled',
      name === SCHEDULE_RUN_NOW_NAME ? [found.task.id] : [found.task.id, fields.enabled]);
    if (!result.ok) return fail(name, result.message);
    return pluginToolResultToResponse(name, {
      ok: true,
      action: name === SCHEDULE_RUN_NOW_NAME ? 'run-now' : fields.enabled ? 'enable' : 'disable',
      schedule: projectSchedule(result.value)
    });
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : `${name} failed`);
  }
}

/** schedule_runs / schedule_retry / schedule_dismiss: same scope rules as the MCP tools. */
async function invokeRunTool(
  ctx: ProductHttpContext,
  name: string,
  projectId: string,
  fields: Record<string, unknown>,
  scoped: ScheduledTask[],
  widen: boolean
): Promise<ToolCallResponse> {
  // Claude /loop rows are read-only mirrors: never a retry or dismiss target.
  const inScope = new Set(scoped.filter(task => !task.external).map(task => task.id));
  const split = (refs: ScheduleRunRef[]) => ({ allowed: refs.filter(ref => inScope.has(ref.scheduleId)), rejected: refs.filter(ref => !inScope.has(ref.scheduleId)) });
  const unwrap = <T>(result: Result<T>): T => { if (!result.ok) throw new Error(result.message); return result.value; };

  if (name === SCHEDULE_RUNS_NAME) {
    const { allProjects: _widen, ...query } = runsInput.parse(fields);
    void _widen;
    // Thread tools pass through the 256 KB product.invoke reply cap: bound the
    // page and send compact rows.
    const limit = Math.min(query.limit ?? HOST_RUNS_DEFAULT_LIMIT, HOST_RUNS_MAX_LIMIT);
    const result = unwrap(await invokeOwner<Result<ScheduleRunQueryResult>>(ctx, 'scheduler.queryRuns', [{ ...query, limit, ...(widen ? {} : { projectId }) }]));
    return pluginToolResultToResponse(name, { scope: widen ? 'all-projects' : `project:${projectId}`, total: result.total, truncated: result.truncated, rows: result.rows.map(compactRunRow) });
  }
  if (name === SCHEDULE_RETRY_NAME) {
    const input = retryInput.parse(fields);
    if ((input.refs === undefined) === (input.open !== true)) throw new Error('pass either refs or open: true');
    let wanted: ScheduleRunRef[];
    if (input.refs) wanted = input.refs;
    else {
      const found = unwrap(await invokeOwner<Result<ScheduleRunQueryResult>>(ctx, 'scheduler.queryRuns', [{ state: 'open', limit: HOST_OPEN_RETRY_SCAN, ...(widen ? {} : { projectId }) }]));
      wanted = openRetryRefs(found.rows, 50);
    }
    const { allowed, rejected } = split(wanted);
    const done = allowed.length ? unwrap(await invokeOwner<Result<ScheduleRetryResult[]>>(ctx, 'scheduler.retryRuns', [allowed])) : [];
    const results = [...done, ...rejected.map(ref => ({ ...ref, ok: false, error: 'schedule not found' }))];
    // A top-level `ok: false` marks the whole tool call failed; partial success is `allOk: false`.
    return pluginToolResultToResponse(name, { ok: results.length === 0 || results.some(r => r.ok), allOk: results.every(r => r.ok), count: results.length, results });
  }
  const input = dismissInput.parse(fields);
  const { allowed, rejected } = split(input.refs);
  const dismissed = allowed.length ? unwrap(await invokeOwner<Result<number>>(ctx, 'scheduler.dismissRuns', [allowed])) : 0;
  return pluginToolResultToResponse(name, { ok: dismissed > 0 || rejected.length === 0, allOk: rejected.length === 0 && dismissed === allowed.length, dismissed, rejected });
}
