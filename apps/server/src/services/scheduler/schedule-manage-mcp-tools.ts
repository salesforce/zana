/**
 * schedule_list / schedule_run_now / schedule_set_enabled — operate on the
 * same `.zcc/schedules` store the desktop Scheduler UI uses.
 *
 * These are Zana Command Center schedules (`~/.zcc/schedules/*.json` and
 * `<project>/.zcc/schedules/*.json`), NOT the marketplace `zana_schedule_*`
 * tools which read `<workspace>/.zana/scheduler/*.yml`.
 *
 * Trust (Rule 1): `projectId` is closed over from the MCP URL route, never
 * taken from the agent. Default scope is THIS project; `allProjects: true` is
 * an explicit widen (same shape as inbox_search). Mutations use that same
 * scope so a cross-project id without the widen returns "not found" rather
 * than leaking another project's schedules.
 *
 * Gated upstream by `scheduleAgentApi` being present on McpServerOptions:
 * absent ⇒ the tools are not registered. Available on both route shapes
 * (list/run/toggle need no originating session).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

/**
 * Live SchedulerManager slice the tools call. The manager is the authority
 * (in-memory + disk); the tools never read `.zcc/schedules` themselves.
 */
export interface ScheduleAgentApi {
  list(): ScheduledTask[];
  runNow(id: string): ScheduledTask;
  setEnabled(id: string, enabled: boolean): ScheduledTask | null;
}

export const SCHEDULE_LIST_DESCRIPTION = [
  "List Zana Command Center Scheduler schedules — the same rows the app's",
  'Scheduler UI shows, stored as JSON at ~/.zcc/schedules/ and',
  '<project>/.zcc/schedules/. This is NOT the marketplace zana_schedule_*',
  'surface and does NOT read .zana/scheduler YAML.',
  '',
  "By default this lists only THIS project's schedules (the project identity",
  'comes from the MCP URL). Pass `allProjects: true` to list every schedule',
  'the user has (the UI aggregate). Read-only: it never creates, edits, or',
  'fires a schedule.'
].join(' ');

export const SCHEDULE_RUN_NOW_DESCRIPTION = [
  'Fire a Zana Command Center Scheduler schedule immediately (same as the',
  "Scheduler UI's Run now). Operates on .zcc/schedules JSON — NOT",
  '.zana/scheduler YAML / zana_schedule_trigger.',
  '',
  'Pass `id` as the schedule id (from schedule_list), a unique name, or a',
  'unique id prefix. By default only THIS project\'s schedules are visible;',
  'pass `allProjects: true` to target a schedule in another project.',
  'First use asks the user for permission unless Trust ZCC tools is on.'
].join(' ');

export const SCHEDULE_SET_ENABLED_DESCRIPTION = [
  'Enable or disable a Zana Command Center Scheduler schedule (same as the',
  "Scheduler UI toggle). Operates on .zcc/schedules JSON — NOT",
  '.zana/scheduler YAML / zana_schedule_enable / zana_schedule_disable.',
  '',
  'Pass `id` as the schedule id (from schedule_list), a unique name, or a',
  'unique id prefix, and `enabled: true|false`. By default only THIS',
  "project's schedules are visible; pass `allProjects: true` to target a",
  'schedule in another project. First use asks the user for permission',
  'unless Trust ZCC tools is on.'
].join(' ');

export const scheduleListInputSchema = {
  allProjects: z
    .boolean()
    .optional()
    .describe(
      "When true, list every project's schedules instead of just this one. Defaults to false (this project only)."
    )
};

export const scheduleRunNowInputSchema = {
  id: z
    .string()
    .min(1)
    .describe(
      'Schedule id (from schedule_list), unique name, or unique id prefix.'
    ),
  allProjects: z
    .boolean()
    .optional()
    .describe(
      "When true, resolve `id` against every project's schedules. Defaults to false (this project only)."
    )
};

export const scheduleSetEnabledInputSchema = {
  id: z
    .string()
    .min(1)
    .describe(
      'Schedule id (from schedule_list), unique name, or unique id prefix.'
    ),
  enabled: z.boolean().describe('true to enable (will fire on cadence), false to park without deleting.'),
  allProjects: z
    .boolean()
    .optional()
    .describe(
      "When true, resolve `id` against every project's schedules. Defaults to false (this project only)."
    )
};

export interface RegisterScheduleManageToolsOpts {
  /** The agent's own project, from the URL route. The default (confined) scope. */
  projectId: string;
  scheduleAgentApi: ScheduleAgentApi;
}

/** Compact projection returned to the agent — omits prompt, extraArgs, run history. */
export interface ScheduleListHit {
  id: string;
  name: string;
  enabled: boolean;
  projectId: string;
  schedule: { every?: string; cron?: string; tz?: string };
  lastRunAt?: string;
  nextRunAt?: string;
  lastRunResult?: ScheduledTask['status']['lastRunResult'];
  runCount: number;
}

export function projectSchedule(task: ScheduledTask): ScheduleListHit {
  const cadence: ScheduleListHit['schedule'] = {};
  if (task.schedule.every) cadence.every = task.schedule.every;
  if (task.schedule.cron) cadence.cron = task.schedule.cron;
  if (task.schedule.tz) cadence.tz = task.schedule.tz;
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    projectId: task.projectId,
    schedule: cadence,
    ...(task.status.lastRunAt ? { lastRunAt: task.status.lastRunAt } : {}),
    ...(task.status.nextRunAt ? { nextRunAt: task.status.nextRunAt } : {}),
    ...(task.status.lastRunResult ? { lastRunResult: task.status.lastRunResult } : {}),
    runCount: task.status.runCount
  };
}

export function scopeSchedules(
  tasks: readonly ScheduledTask[],
  projectId: string,
  allProjects: boolean
): ScheduledTask[] {
  return allProjects ? [...tasks] : tasks.filter((t) => t.projectId === projectId);
}

export type ScheduleResolveResult =
  | { ok: true; task: ScheduledTask }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; name: string }> };

/**
 * Resolve a user/agent query against an already-scoped list.
 * Precedence: exact id → unique case-insensitive name → unique id prefix.
 */
export function resolveSchedule(
  tasks: readonly ScheduledTask[],
  query: string
): ScheduleResolveResult {
  const q = query.trim();
  if (!q) return { ok: false, reason: 'not_found' };

  const exactId = tasks.find((t) => t.id === q);
  if (exactId) return { ok: true, task: exactId };

  const lower = q.toLowerCase();
  const nameMatches = tasks.filter((t) => t.name.toLowerCase() === lower);
  if (nameMatches.length === 1) return { ok: true, task: nameMatches[0] };
  if (nameMatches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: nameMatches.map((t) => ({ id: t.id, name: t.name }))
    };
  }

  const prefixMatches = tasks.filter((t) => t.id.startsWith(q));
  if (prefixMatches.length === 1) return { ok: true, task: prefixMatches[0] };
  if (prefixMatches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: prefixMatches.map((t) => ({ id: t.id, name: t.name }))
    };
  }

  return { ok: false, reason: 'not_found' };
}

export function formatResolveError(result: Extract<ScheduleResolveResult, { ok: false }>, query: string): string {
  if (result.reason === 'not_found') {
    return `schedule not found: ${query}`;
  }
  const listed = result.candidates.map((c) => `${c.id} (${c.name})`).join(', ');
  return `ambiguous schedule ${JSON.stringify(query)}: ${listed}. Pass the exact id.`;
}

function fail(tool: string, message: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: `${tool} failed: ${message}` }]
  };
}

function okJson(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
  };
}

function lookupInScope(
  api: ScheduleAgentApi,
  projectId: string,
  query: string,
  allProjects: boolean
): ScheduleResolveResult {
  return resolveSchedule(scopeSchedules(api.list(), projectId, allProjects), query);
}

/**
 * Register schedule_list / schedule_run_now / schedule_set_enabled.
 * Handlers close over the route's projectId; the agent cannot supply one.
 */
export function registerScheduleManageTools(
  server: McpServer,
  opts: RegisterScheduleManageToolsOpts
): void {
  const { projectId, scheduleAgentApi } = opts;

  server.registerTool(
    'schedule_list',
    { description: SCHEDULE_LIST_DESCRIPTION, inputSchema: scheduleListInputSchema },
    async ({ allProjects }) => {
      try {
        const widen = allProjects === true;
        const scoped = scopeSchedules(scheduleAgentApi.list(), projectId, widen);
        const hits = scoped.map(projectSchedule);
        return okJson({
          scope: widen ? 'all-projects' : `project:${projectId}`,
          count: hits.length,
          schedules: hits
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('schedule_list', message);
      }
    }
  );

  server.registerTool(
    'schedule_run_now',
    { description: SCHEDULE_RUN_NOW_DESCRIPTION, inputSchema: scheduleRunNowInputSchema },
    async ({ id, allProjects }) => {
      try {
        const found = lookupInScope(scheduleAgentApi, projectId, id, allProjects === true);
        if (!found.ok) return fail('schedule_run_now', formatResolveError(found, id));
        const task = scheduleAgentApi.runNow(found.task.id);
        return okJson({ ok: true, action: 'run-now', schedule: projectSchedule(task) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('schedule_run_now', message);
      }
    }
  );

  server.registerTool(
    'schedule_set_enabled',
    {
      description: SCHEDULE_SET_ENABLED_DESCRIPTION,
      inputSchema: scheduleSetEnabledInputSchema
    },
    async ({ id, enabled, allProjects }) => {
      try {
        const found = lookupInScope(scheduleAgentApi, projectId, id, allProjects === true);
        if (!found.ok) return fail('schedule_set_enabled', formatResolveError(found, id));
        const task = scheduleAgentApi.setEnabled(found.task.id, enabled);
        if (!task) return fail('schedule_set_enabled', `schedule not found: ${id}`);
        return okJson({
          ok: true,
          action: enabled ? 'enable' : 'disable',
          schedule: projectSchedule(task)
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('schedule_set_enabled', message);
      }
    }
  );
}
