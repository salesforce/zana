/**
 * Host schedule_list / schedule_run_now / schedule_set_enabled for conversation
 * threads. List and setEnabled read/write `.zcc/schedules` JSON (the desktop
 * SchedulerManager watches those dirs). runNow emits a hub command the desktop
 * renderer forwards to the live SchedulerManager — it cannot spawn a PTY from
 * this process. projectId is closed over from the owning conversation row.
 */

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';
import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project, ScheduledTask } from '@zana-ai/zcc-domain/product';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  SCHEDULE_LIST_DESCRIPTION,
  SCHEDULE_RUN_NOW_DESCRIPTION,
  SCHEDULE_SET_ENABLED_DESCRIPTION,
  formatResolveError,
  projectSchedule,
  resolveSchedule,
  scopeSchedules
} from '../scheduler/schedule-manage-mcp-tools.js';

export const SCHEDULE_LIST_NAME = 'schedule_list';
export const SCHEDULE_RUN_NOW_NAME = 'schedule_run_now';
export const SCHEDULE_SET_ENABLED_NAME = 'schedule_set_enabled';

export const HOST_SCHEDULE_INSTRUCTION = [
  'List or toggle Scheduler UI schedules with `schedule_list` / `schedule_set_enabled`.',
  'Fire one immediately with `schedule_run_now` (desktop Scheduler).'
].join(' ');

export const HOST_SCHEDULE_TOOLS: DynamicTool[] = [
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
  }
];

function fail(name: string, error: string): ToolCallResponse {
  return pluginToolResultToResponse(name, { ok: false, error });
}

function row(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function globalSchedulesDir(): string {
  return join(resolveZccDataDir(process.env, os.homedir()), 'schedules');
}

function projectSchedulesDir(project: Project): string {
  return join(project.path, '.zcc', 'schedules');
}

function readTaskFile(path: string): ScheduledTask | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ScheduledTask>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
    if (typeof raw.enabled !== 'boolean' || typeof raw.projectId !== 'string') return null;
    return raw as ScheduledTask;
  } catch {
    return null;
  }
}

function listInDir(dir: string, source: ScheduledTask['source']): ScheduledTask[] {
  if (!existsSync(dir)) return [];
  const out: ScheduledTask[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const task = readTaskFile(join(dir, name));
    if (task) {
      task.source = source;
      out.push(task);
    }
  }
  return out;
}

function listAll(projects: Project[]): ScheduledTask[] {
  const out = listInDir(globalSchedulesDir(), 'global');
  for (const project of projects) {
    out.push(...listInDir(projectSchedulesDir(project), { projectId: project.id }));
  }
  return out;
}

function locateFile(id: string, projects: Project[]): string | null {
  const candidates = [join(globalSchedulesDir(), `${id}.json`)];
  for (const project of projects) candidates.push(join(projectSchedulesDir(project), `${id}.json`));
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

function writeTaskAtomic(path: string, task: ScheduledTask): void {
  const { source: _source, ...rest } = task;
  void _source;
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(rest, null, 2));
  renameSync(tmp, path);
}

export async function invokeHostScheduleTool(
  ctx: ProductHttpContext,
  args: { name: string; threadId: string; projectId: string; input: unknown }
): Promise<ToolCallResponse> {
  const { name, projectId, input } = args;
  const fields = row(input);
  try {
    const projects = ctx.toProjects();
    const widen = fields.allProjects === true;
    const scoped = scopeSchedules(listAll(projects), projectId, widen);

    if (name === SCHEDULE_LIST_NAME) {
      const hits = scoped.map(projectSchedule);
      return pluginToolResultToResponse(name, {
        scope: widen ? 'all-projects' : `project:${projectId}`,
        count: hits.length,
        schedules: hits
      });
    }

    const id = typeof fields.id === 'string' ? fields.id.trim() : '';
    if (!id) throw new Error('id is required');
    const found = resolveSchedule(scoped, id);
    if (!found.ok) return fail(name, formatResolveError(found, id));

    if (name === SCHEDULE_RUN_NOW_NAME) {
      ctx.hub.emit('scheduler:command', { action: 'run-now', id: found.task.id });
      const delivered = ctx.hub.size();
      if (delivered === 0) {
        return fail(name, 'No connected app window received the run-now command. Is the desktop app open?');
      }
      return pluginToolResultToResponse(name, {
        ok: true,
        action: 'run-now',
        schedule: projectSchedule(found.task),
        delivered
      });
    }

    if (name === SCHEDULE_SET_ENABLED_NAME) {
      if (typeof fields.enabled !== 'boolean') throw new Error('enabled is required');
      const path = locateFile(found.task.id, projects);
      if (!path) return fail(name, `schedule not found: ${id}`);
      const next: ScheduledTask = {
        ...found.task,
        enabled: fields.enabled,
        updatedAt: new Date().toISOString()
      };
      writeTaskAtomic(path, next);
      ctx.hub.emit('scheduler:command', {
        action: 'set-enabled',
        id: found.task.id,
        enabled: fields.enabled
      });
      ctx.hub.emit('scheduler:changed', listAll(projects));
      return pluginToolResultToResponse(name, {
        ok: true,
        action: fields.enabled ? 'enable' : 'disable',
        schedule: projectSchedule(next)
      });
    }

    return fail(name, `Unsupported schedule tool: ${name}`);
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : `${name} failed`);
  }
}
