/**
 * Host list_projects / register_project / create_local_extension for
 * conversation threads. Identity for register_project confinement is the
 * owning thread's project (relative paths) plus HOME / cloneRoot / known
 * project trees (Rule 1) — never a forged projectId.
 */

import * as os from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import { toProjectSummary } from '@zana-ai/zcc-domain/product';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { LIST_PROJECTS_DESCRIPTION } from '../projects/list-projects-mcp-tool.js';
import { REGISTER_PROJECT_DESCRIPTION } from '../projects/register-project-mcp-tool.js';
import { CREATE_LOCAL_EXTENSION_DESCRIPTION } from '../extensions/create-local-extension-mcp-tool.js';
import {
  clampLocalKind,
  mintLocalId,
  scaffoldLocalExtension,
  workingDirFor
} from '../extensions/local-extension.js';

export const LIST_PROJECTS_NAME = 'list_projects';
export const REGISTER_PROJECT_NAME = 'register_project';
export const CREATE_LOCAL_EXTENSION_NAME = 'create_local_extension';

export const HOST_CATALOG_INSTRUCTION = [
  'Discover or add projects with `list_projects` / `register_project`.',
  'Scaffold a local plugin with `create_local_extension`.'
].join(' ');

export const HOST_CATALOG_TOOLS: DynamicTool[] = [
  {
    name: LIST_PROJECTS_NAME,
    description: LIST_PROJECTS_DESCRIPTION,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    presentation: {
      label: { pending: 'Listing projects', completed: 'Listed projects' },
      icon: { glyph: 'Folder' }
    }
  },
  {
    name: REGISTER_PROJECT_NAME,
    description: REGISTER_PROJECT_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          description: 'Directory to register. Relative paths resolve against this project root.'
        }
      }
    },
    presentation: {
      label: { pending: 'Registering project', completed: 'Registered project' },
      icon: { glyph: 'FolderPlus' }
    }
  },
  {
    name: CREATE_LOCAL_EXTENSION_NAME,
    description: CREATE_LOCAL_EXTENSION_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        description: { type: 'string', maxLength: 140 },
        kind: {
          type: 'string',
          enum: ['panel', 'main-panel', 'mcp-consumer', 'agent-preset']
        }
      }
    },
    presentation: {
      label: { pending: 'Creating plugin', completed: 'Created plugin' },
      icon: { glyph: 'Puzzle' }
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

function isWithin(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

function confineRegisterPath(
  ctx: ProductHttpContext,
  absPath: string
): string {
  let realTarget: string;
  try {
    realTarget = realpathSync(absPath);
  } catch {
    throw new Error(`register_project rejected: path does not exist (${absPath})`);
  }
  const cloneRoot = ctx.config.getConfig().cloneRoot?.trim() || '';
  const allowedBases = [os.homedir(), cloneRoot]
    .filter((b): b is string => !!b)
    .concat(ctx.toProjects().map((p) => p.path));
  const allowed = allowedBases.some((base) => {
    try {
      return isWithin(realTarget, realpathSync(base));
    } catch {
      return false;
    }
  });
  if (!allowed) {
    throw new Error(
      `register_project rejected: ${absPath} is outside HOME, the clone root, and all known projects`
    );
  }
  return realTarget;
}

export async function invokeHostCatalogTool(
  ctx: ProductHttpContext,
  args: { name: string; threadId: string; projectId: string; input: unknown }
): Promise<ToolCallResponse> {
  const { name, projectId, input } = args;
  const fields = row(input);
  try {
    if (name === LIST_PROJECTS_NAME) {
      return pluginToolResultToResponse(
        name,
        ctx.toProjects().map((project) => toProjectSummary(project))
      );
    }

    if (name === REGISTER_PROJECT_NAME) {
      const path = typeof fields.path === 'string' ? fields.path.trim() : '';
      if (!path) throw new Error('path is required');
      const projectRoot = ctx.toProjects().find((project) => project.id === projectId)?.path;
      let absPath: string;
      if (isAbsolute(path)) {
        absPath = resolve(path);
      } else if (projectRoot) {
        absPath = resolve(projectRoot, path);
      } else {
        throw new Error('a relative path was given but the originating project root is unknown. Pass an absolute path.');
      }
      const confined = confineRegisterPath(ctx, absPath);
      const existed = ctx.toProjects().some((project) => {
        try {
          return realpathSync(project.path) === confined;
        } catch {
          return project.path === confined;
        }
      });
      const project = await ctx.projects.add(confined);
      ctx.hub.emit('projects:changed', ctx.projects.list());
      return pluginToolResultToResponse(name, {
        ok: true,
        alreadyExisted: existed,
        id: project.id,
        name: project.name,
        path: project.path
      });
    }

    if (name === CREATE_LOCAL_EXTENSION_NAME) {
      const pluginName = typeof fields.name === 'string' ? fields.name.trim() : '';
      if (!pluginName) throw new Error('A name is required');
      const taken = new Set((ctx.plugins?.list() ?? []).map((row) => row.id));
      const id = mintLocalId({ name: pluginName, taken });
      const workingDir = workingDirFor(resolve(os.homedir(), 'zcc-workspace'), id);
      const scaffolded = await scaffoldLocalExtension(workingDir, {
        id,
        name: pluginName,
        description: typeof fields.description === 'string' ? fields.description : undefined,
        kind: clampLocalKind(fields.kind)
      });
      if (!scaffolded.ok) {
        return fail(name, scaffolded.message);
      }
      if (ctx.plugins) {
        await ctx.plugins.install(workingDir);
      }
      const project = await ctx.projects.add(workingDir);
      ctx.hub.emit('projects:changed', ctx.projects.list());
      return pluginToolResultToResponse(name, {
        ok: true,
        id,
        workingDir,
        projectId: project.id
      });
    }

    return fail(name, `Unsupported catalog tool: ${name}`);
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : `${name} failed`);
  }
}
