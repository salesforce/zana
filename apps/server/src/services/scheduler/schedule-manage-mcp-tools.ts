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
import { launchOptionsSchema } from '@zana-ai/zcc-domain/launch-options';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ScheduledTask,
  ScheduleUpdateInput,
  ScheduleReloadResult,
  ScheduleRetryResult,
  ScheduleRunQuery,
  ScheduleRunQueryResult,
  ScheduleRunRef
} from '@zana-ai/zcc-domain/product';
import { scheduleRunQuerySchema, scheduleRunRefsSchema } from './schedule-run-schemas.js';
import { compactRunRow, openRetryRefs } from '@zana-ai/zcc-domain/schedule-health';

export const scheduleDefinitionPatchSchema = z.object({
  prompt: z.string().max(1_000_000).optional(),
  extraArgs: z.array(z.string().max(16_384)).max(256).optional(),
  kind: z.enum(['agent', 'team']).optional(),
  teamId: z.string().min(1).max(256).nullable().optional(),
  planSource: z.enum(['provided', 'infer']).nullable().optional(),
  launchOptions: launchOptionsSchema.nullable().optional().describe('Operator-owned team launch overrides. Readable here; changes require the Scheduler UI.'),
  every: z.string().min(1).optional(),
  cron: z.string().min(1).optional(),
  tz: z.string().min(1).nullable().optional()
}).strict().refine(patch => Object.values(patch).some(value => value !== undefined), 'At least one definition field is required')
  .refine(patch => !(patch.every !== undefined && patch.cron !== undefined), 'every and cron are mutually exclusive');

/**
 * Live SchedulerManager slice the tools call. The manager is the authority
 * (in-memory + disk); the tools never read `.zcc/schedules` themselves.
 */
export interface ScheduleAgentApi {
  list(): ScheduledTask[];
  get?(id: string): ScheduledTask;
  update?(id: string, patch: ScheduleUpdateInput): Promise<ScheduledTask>;
  reload?(id: string): Promise<ScheduleReloadResult>;
  runNow(id: string): ScheduledTask | Promise<ScheduledTask>;
  setEnabled(id: string, enabled: boolean): ScheduledTask | null | Promise<ScheduledTask | null>;
  queryRuns?(query: ScheduleRunQuery): Promise<ScheduleRunQueryResult>;
  retryRuns?(refs: ScheduleRunRef[]): Promise<ScheduleRetryResult[]>;
  dismissRuns?(refs: ScheduleRunRef[]): Promise<number>;
}

const MAX_RETRY_REFS = 50;
const MAX_DISMISS_REFS = 200;

export const SCHEDULE_GET_DESCRIPTION = 'Read the live Scheduler UI definition that the app will run, including prompt, extraArgs, cadence and updatedAt. Default scope is this project; allProjects explicitly widens it.';
export const SCHEDULE_UPDATE_DESCRIPTION = 'Patch prompt, extraArgs or cadence through the same Scheduler UI edit path. Supply id and patch. Default scope is this project; allProjects explicitly widens it. Use schedule_get to verify the acknowledged definition.';
export const SCHEDULE_RELOAD_DESCRIPTION = 'Re-read one Scheduler UI schedule from its owning disk now. Returns reloaded:true, or reloaded:false with a reason and live session IDs; deferred reloads are retried automatically. Default scope is this project; allProjects explicitly widens it.';

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

export const SCHEDULE_RUNS_DESCRIPTION = [
  'List scheduled runs that need attention, or any run history, across',
  'Zana Command Center Scheduler schedules: failed, skipped (limit reached) and',
  'missed runs, each with a reason code, attempt number and a ref',
  '(scheduleId + runId) for schedule_retry / schedule_dismiss.',
  '',
  'Default `state` is "open" (unresolved problems from the last 7 days);',
  '"problems" adds resolved and dismissed ones, "all" includes successes.',
  'Filter with outcomes, reasonCodes, since/until (ISO), scheduleIds, limit.',
  "By default only THIS project's schedules are included; pass",
  '`allProjects: true` to widen. Read-only.'
].join(' ');

export const SCHEDULE_RETRY_DESCRIPTION = [
  'Retry problem runs of Scheduler schedules (same as Retry in the Scheduler',
  'UI). Pass `refs` ([{ scheduleId, runId }], max 50, from schedule_runs) or',
  '`open: true` to retry every open retryable problem (up to 50). Retrying a',
  'missed marker runs the missed time once. Returns one result per ref with',
  'status started / queued, or an error. By default only THIS project\'s',
  'schedules are in scope; refs outside it are rejected. Pass',
  '`allProjects: true` to widen. First use asks the user for permission unless',
  'Trust ZCC tools is on.'
].join(' ');

export const SCHEDULE_DISMISS_DESCRIPTION = [
  'Dismiss problem runs so they leave the open list (same as Dismiss in the',
  'Scheduler UI). Pass `refs` ([{ scheduleId, runId }], max 200, from',
  'schedule_runs). The run record is kept. By default only THIS project\'s',
  'schedules are in scope; refs outside it are rejected. Pass',
  '`allProjects: true` to widen.'
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

const allProjectsField = z.boolean().optional().describe(
  "When true, include every project's schedules instead of just this one. Defaults to false (this project only)."
);

/** The query fields, minus `projectId`: scope comes from the route, never the agent. */
const { projectId: _routeScoped, ...scheduleRunQueryFields } = scheduleRunQuerySchema.shape;
void _routeScoped;
export const scheduleRunsInputSchema = { ...scheduleRunQueryFields, allProjects: allProjectsField };

const refsField = (max: number) => scheduleRunRefsSchema(max).describe(`Run references from schedule_runs (max ${max}).`);
export const scheduleRetryInputSchema = {
  refs: refsField(MAX_RETRY_REFS).optional(),
  open: z.boolean().optional().describe('Retry every open retryable problem in scope (up to 50) instead of listing refs.'),
  allProjects: allProjectsField
};
export const scheduleDismissInputSchema = { refs: refsField(MAX_DISMISS_REFS), allProjects: allProjectsField };

export const scheduleUpdateInputSchema = { ...scheduleRunNowInputSchema, patch: scheduleDefinitionPatchSchema };

export function projectScheduleDefinition(task: ScheduledTask) {
  return { ...projectSchedule(task), profile: task.profile, kind: task.kind, teamId: task.teamId, planSource: task.planSource, ...(task.kind === 'team' && task.launchOptions !== undefined ? { launchOptions: task.launchOptions } : {}), prompt: task.prompt ?? '', extraArgs: task.extraArgs ?? [], updatedAt: task.updatedAt };
}

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

  for (const name of ['schedule_get', 'schedule_reload', 'schedule_update'] as const) {
    server.registerTool(name, {
      description: name === 'schedule_get' ? SCHEDULE_GET_DESCRIPTION : name === 'schedule_reload' ? SCHEDULE_RELOAD_DESCRIPTION : SCHEDULE_UPDATE_DESCRIPTION,
      inputSchema: name === 'schedule_update' ? scheduleUpdateInputSchema : scheduleRunNowInputSchema
    }, async (input: { id: string; allProjects?: boolean; patch?: z.infer<typeof scheduleDefinitionPatchSchema> }) => {
      try {
        const found = lookupInScope(scheduleAgentApi, projectId, input.id, input.allProjects === true);
        if (!found.ok) return fail(name, formatResolveError(found, input.id));
        if (name === 'schedule_get') return okJson({ ok: true, schedule: projectScheduleDefinition(scheduleAgentApi.get?.(found.task.id) ?? found.task) });
        if (name === 'schedule_reload') {
          if (!scheduleAgentApi.reload) throw new Error('Schedule reload is unavailable');
          const result = await scheduleAgentApi.reload(found.task.id);
          return okJson({ ok: true, ...result, schedule: projectScheduleDefinition(result.schedule) });
        }
        if (!scheduleAgentApi.update) throw new Error('Schedule update is unavailable');
        const patch = scheduleDefinitionPatchSchema.parse(input.patch);
        if (patch.launchOptions !== undefined) throw new Error('launchOptions changes are operator-only; use the Scheduler UI');
        const task = await scheduleAgentApi.update(found.task.id, patch);
        return okJson({ ok: true, schedule: projectScheduleDefinition(task) });
      } catch (error) { return fail(name, error instanceof Error ? error.message : String(error)); }
    });
  }

  const unavailable = (tool: string) => fail(tool, 'Schedule run history is unavailable');

  server.registerTool(
    'schedule_runs',
    { description: SCHEDULE_RUNS_DESCRIPTION, inputSchema: scheduleRunsInputSchema },
    async ({ allProjects, ...query }) => {
      try {
        if (!scheduleAgentApi.queryRuns) return unavailable('schedule_runs');
        const widen = allProjects === true;
        const result = await scheduleAgentApi.queryRuns({ ...query, ...(widen ? {} : { projectId }) });
        // Compact rows: full run records would cost tens of thousands of tokens.
        return okJson({ scope: widen ? 'all-projects' : `project:${projectId}`, total: result.total, truncated: result.truncated, rows: result.rows.map(compactRunRow) });
      } catch (err) {
        return fail('schedule_runs', err instanceof Error ? err.message : String(err));
      }
    }
  );

  /** Keep the refs whose schedule is in scope; the rest are rejected as not found. */
  const splitByScope = (refs: ScheduleRunRef[], widen: boolean) => {
    const inScope = new Set(scopeSchedules(scheduleAgentApi.list(), projectId, widen).map((task) => task.id));
    return { allowed: refs.filter((ref) => inScope.has(ref.scheduleId)), rejected: refs.filter((ref) => !inScope.has(ref.scheduleId)) };
  };

  server.registerTool(
    'schedule_retry',
    { description: SCHEDULE_RETRY_DESCRIPTION, inputSchema: scheduleRetryInputSchema },
    async ({ refs, open, allProjects }) => {
      try {
        if (!scheduleAgentApi.retryRuns || !scheduleAgentApi.queryRuns) return unavailable('schedule_retry');
        if ((refs === undefined) === (open !== true)) return fail('schedule_retry', 'pass either refs or open: true');
        const widen = allProjects === true;
        let wanted: ScheduleRunRef[];
        if (refs) wanted = refs;
        else {
          const found = await scheduleAgentApi.queryRuns({ state: 'open', limit: 500, ...(widen ? {} : { projectId }) });
          wanted = openRetryRefs(found.rows, MAX_RETRY_REFS);
        }
        const { allowed, rejected } = splitByScope(wanted, widen);
        const done = allowed.length ? await scheduleAgentApi.retryRuns(allowed) : [];
        const results: ScheduleRetryResult[] = [
          ...done,
          ...rejected.map((ref) => ({ ...ref, ok: false, error: 'schedule not found' }))
        ];
        // `ok` is the call's outcome: false only when nothing could be retried.
        return okJson({ ok: results.length === 0 || results.some((r) => r.ok), allOk: results.every((r) => r.ok), count: results.length, results });
      } catch (err) {
        return fail('schedule_retry', err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    'schedule_dismiss',
    { description: SCHEDULE_DISMISS_DESCRIPTION, inputSchema: scheduleDismissInputSchema },
    async ({ refs, allProjects }) => {
      try {
        if (!scheduleAgentApi.dismissRuns) return unavailable('schedule_dismiss');
        const { allowed, rejected } = splitByScope(refs, allProjects === true);
        const dismissed = allowed.length ? await scheduleAgentApi.dismissRuns(allowed) : 0;
        return okJson({ ok: dismissed > 0 || rejected.length === 0, allOk: rejected.length === 0 && dismissed === allowed.length, dismissed, rejected });
      } catch (err) {
        return fail('schedule_dismiss', err instanceof Error ? err.message : String(err));
      }
    }
  );

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
        const task = await scheduleAgentApi.runNow(found.task.id);
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
        const task = await scheduleAgentApi.setEnabled(found.task.id, enabled);
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
