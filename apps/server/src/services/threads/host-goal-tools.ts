/**
 * Host goal_create / goal_list for conversation threads.
 *
 * Writes `<project>/.zcc/goals/<id>.json` so the desktop GoalManager watcher
 * picks the goal up. projectId is closed over from the owning conversation
 * row (Rule 1) — never agent-supplied, never the global goals directory.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import type { Goal, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { GOAL_CREATE_DESCRIPTION, GOAL_LIST_DESCRIPTION } from '../goals/goal-mcp-tools.js';

export const GOAL_CREATE_NAME = 'goal_create';
export const GOAL_LIST_NAME = 'goal_list';

export const HOST_GOAL_INSTRUCTION =
  'Create or list persistent Goals in THIS project with `goal_create` / `goal_list`.';

export const HOST_GOAL_TOOLS: DynamicTool[] = [
  {
    name: GOAL_CREATE_NAME,
    description: GOAL_CREATE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'statement'],
      properties: {
        title: { type: 'string', minLength: 1 },
        statement: { type: 'string', minLength: 1 },
        successCriteria: { type: 'array', items: { type: 'string' } },
        maxIterations: { type: 'integer', minimum: 1, maximum: 100 },
        noProgressLimit: { type: 'integer', minimum: 1, maximum: 20 },
        profile: { type: 'string', enum: [...VALID_PROFILES] },
        activate: { type: 'boolean' }
      }
    },
    presentation: {
      label: { pending: 'Creating goal', completed: 'Created goal' },
      icon: { glyph: 'Target' }
    }
  },
  {
    name: GOAL_LIST_NAME,
    description: GOAL_LIST_DESCRIPTION,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    presentation: {
      label: { pending: 'Listing goals', completed: 'Listed goals' },
      icon: { glyph: 'List' }
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

function goalsDir(ctx: ProductHttpContext, projectId: string): string {
  const project = ctx.toProjects().find((p) => p.id === projectId);
  if (!project?.path) throw new Error(`unknown project: ${projectId}`);
  return join(project.path, '.zcc', 'goals');
}

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

function readGoalFile(path: string): Goal | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Goal>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
    if (typeof raw.statement !== 'string' || typeof raw.projectId !== 'string') return null;
    return raw as Goal;
  } catch {
    return null;
  }
}

function listProjectGoals(dir: string, projectId: string): Goal[] {
  if (!existsSync(dir)) return [];
  const out: Goal[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const goal = readGoalFile(join(dir, name));
    if (goal && goal.projectId === projectId) out.push(goal);
  }
  return out;
}

function writeGoalAtomic(dir: string, goal: Goal): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${goal.id}.json`);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const { source: _source, ...persisted } = goal as Goal & { source?: unknown };
  void _source;
  writeFileSync(tmp, JSON.stringify(persisted, null, 2));
  renameSync(tmp, file);
}

export async function invokeHostGoalTool(
  ctx: ProductHttpContext,
  args: { name: string; threadId: string; projectId: string; input: unknown }
): Promise<ToolCallResponse> {
  const { name, projectId, input } = args;
  const fields = row(input);
  try {
    const dir = goalsDir(ctx, projectId);
    if (name === GOAL_LIST_NAME) {
      return pluginToolResultToResponse(name, listProjectGoals(dir, projectId).map(summarize));
    }
    if (name === GOAL_CREATE_NAME) {
      const title = typeof fields.title === 'string' ? fields.title.trim() : '';
      const statement = typeof fields.statement === 'string' ? fields.statement.trim() : '';
      if (!title || !statement) throw new Error('title and statement are required');
      const profile = typeof fields.profile === 'string' && (VALID_PROFILES as readonly string[]).includes(fields.profile)
        ? (fields.profile as LaunchProfileId)
        : 'claude-yolo';
      const now = new Date().toISOString();
      const goal: Goal = {
        id: randomUUID(),
        projectId,
        title,
        statement,
        successCriteria: Array.isArray(fields.successCriteria)
          ? fields.successCriteria.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          : [],
        driver: 'native',
        assignment: { kind: 'profile', profile },
        cadence: { mode: 'continuous' },
        maxIterations:
          typeof fields.maxIterations === 'number' && fields.maxIterations > 0
            ? Math.min(100, Math.round(fields.maxIterations))
            : 10,
        iteration: 0,
        noProgressLimit:
          typeof fields.noProgressLimit === 'number' && fields.noProgressLimit > 0
            ? Math.round(fields.noProgressLimit)
            : 2,
        status: fields.activate === true ? 'active' : 'draft',
        history: { retain: 20, iterations: [] },
        createdAt: now,
        updatedAt: now
      };
      writeGoalAtomic(dir, goal);
      ctx.hub.emit('goals:changed', listProjectGoals(dir, projectId));
      return pluginToolResultToResponse(name, {
        ok: true,
        id: goal.id,
        title: goal.title,
        status: goal.status
      });
    }
    return fail(name, `Unsupported goal tool: ${name}`);
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : `${name} failed`);
  }
}
