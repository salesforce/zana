import { isAbsolute, join, relative, sep } from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig, CreateTerminalRequest, FollowUpStatus, LibraryScope, Persona } from '@zana-ai/zcc-domain/product';
import { browserRequestProblem, headerValue } from './browser-request-guard.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './disk-json.js';
import { readJsonBody, sendJson } from './json.js';
import type { ProductHttpContext } from './product-context.js';
import { createThreadFromRequest, ThreadCreateError, threadView, type SpawnThreadInput } from './thread-create.js';
import { archiveThread, destroyEnvironment } from '../services/environments/environment-cleanup.js';
import {
  environmentDiff,
  environmentPullRequest,
  environmentStatus,
  listProjectEnvironments,
  runEnvironmentAction
} from '../services/environments/environment-actions.js';
import { spawnEnvironmentChoiceSchema } from '@zana-ai/zcc-domain';
import { normalizeRepoUrl } from '../services/projects/git-clone.js';
import { harnessDescriptors, harnessEffectiveDefault, harnessVerify } from './harness-via-rpc.js';
import { isSafeRelPath, listLibraryDocs, listQuickPrompts, readLibraryDoc } from './library-via-host.js';
import { listProjectDir, readProjectFile } from './project-fs-via-host.js';
import { getThread, listLiveThreads, listThreadsByProject, threadOutputTail } from '@zana-ai/zcc-db';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';

const VALID_FOLLOW_UP_STATUS: FollowUpStatus[] = ['open', 'resolved', 'dismissed'];

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function confineCwd(projectPath: string, cwd: string | undefined): string | null {
  const root = realpathSync(projectPath);
  if (!cwd) return root;
  let resolved: string;
  try {
    resolved = realpathSync(cwd);
  } catch {
    return null;
  }
  return isContained(root, resolved) ? resolved : null;
}

const COLS_MIN = 20;
const COLS_MAX = 300;
const ROWS_MIN = 8;
const ROWS_MAX = 100;

function parseTerminalGeometry(body: { cols?: unknown; rows?: unknown }): { cols: number; rows: number } | null {
  const cols = typeof body.cols === 'number' && Number.isInteger(body.cols) ? body.cols : NaN;
  const rows = typeof body.rows === 'number' && Number.isInteger(body.rows) ? body.rows : NaN;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return null;
  return {
    cols: Math.min(COLS_MAX, Math.max(COLS_MIN, cols)),
    rows: Math.min(ROWS_MAX, Math.max(ROWS_MIN, rows))
  };
}

function routeParams(pathname: string, pattern: string): Record<string, string> | null {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i]!;
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i]!);
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

/**
 * Loopback product HTTP API. Origin-guarded for browsers; unauthenticated for
 * callers that send no Origin (CLI). Host-daemon tokens never appear here.
 */
export async function handleProductHttp(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext
): Promise<boolean> {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (!requestUrl.pathname.startsWith('/api/')) return false;

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      Allow: 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'no-store'
    }).end();
    return true;
  }

  const problem = browserRequestProblem(
    {
      req: {
        url: requestUrl.href,
        method: request.method ?? 'GET',
        header: (name) => headerValue(request.headers, name)
      }
    },
    { config: ctx.origins },
    { requireJsonForMutation: true }
  );
  if (problem) {
    sendJson(response, problem.status, { error: problem.error });
    return true;
  }

  const method = (request.method ?? 'GET').toUpperCase();
  const path = requestUrl.pathname;

  try {
    if (path === '/api/v1/health' && (method === 'GET' || method === 'HEAD')) {
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (path === '/api/v1/projects' && method === 'GET') {
      sendJson(response, 200, { projects: ctx.projects.list() });
      return true;
    }

    if (path === '/api/v1/projects' && method === 'POST') {
      const body = (await readJsonBody(request)) as { path?: unknown };
      if (typeof body.path !== 'string' || body.path.length === 0) {
        sendJson(response, 400, { error: 'path is required' });
        return true;
      }
      const project = await ctx.projects.add(body.path);
      ctx.hub.emit('projects:changed', ctx.projects.list());
      sendJson(response, 200, { project });
      return true;
    }

    const projectTouch = routeParams(path, '/api/v1/projects/:id/touch');
    if (projectTouch && method === 'POST') {
      const project = await ctx.projects.touch(projectTouch.id);
      if (!project) {
        sendJson(response, 404, { error: 'project not found' });
        return true;
      }
      ctx.hub.emit('projects:changed', ctx.projects.list());
      sendJson(response, 200, { project });
      return true;
    }

    const projectOne = routeParams(path, '/api/v1/projects/:id');
    if (projectOne && method === 'PATCH') {
      const patch = (await readJsonBody(request)) as { name?: string; color?: string; category?: string };
      const project = await ctx.projects.update(projectOne.id, patch);
      if (!project) {
        sendJson(response, 404, { error: 'project not found' });
        return true;
      }
      ctx.hub.emit('projects:changed', ctx.projects.list());
      sendJson(response, 200, { project });
      return true;
    }

    if (path === '/api/v1/config' && method === 'GET') {
      sendJson(response, 200, { config: ctx.config.getConfig() });
      return true;
    }

    if (path === '/api/v1/config' && (method === 'PATCH' || method === 'POST')) {
      const patch = (await readJsonBody(request)) as Partial<AppConfig>;
      const config = ctx.config.setConfig(patch);
      ctx.hub.emit('config:changed', config);
      sendJson(response, 200, { config });
      return true;
    }

    if (path === '/api/v1/inbox' && method === 'GET') {
      const projectId = requestUrl.searchParams.get('projectId') ?? undefined;
      const limitRaw = requestUrl.searchParams.get('limit');
      const before = requestUrl.searchParams.get('before') ?? undefined;
      const limit = limitRaw ? Number(limitRaw) : 100;
      const result = await ctx.inbox.read({
        projectId,
        before: before ?? undefined,
        limit: Number.isFinite(limit) ? limit : 100
      });
      sendJson(response, 200, result);
      return true;
    }

    const inboxOne = routeParams(path, '/api/v1/inbox/:id');
    if (inboxOne && method === 'DELETE') {
      const ok = await ctx.inbox.delete(inboxOne.id);
      sendJson(response, ok ? 200 : 404, { ok });
      return true;
    }

    if (path === '/api/v1/inbox' && method === 'DELETE') {
      const body = (await readJsonBody(request)) as { ids?: unknown };
      const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
      const removed = await ctx.inbox.deleteMany(ids);
      sendJson(response, 200, { removed });
      return true;
    }

    if (path === '/api/v1/suggestions' && method === 'GET') {
      const projectId = requestUrl.searchParams.get('projectId') ?? undefined;
      const result = await ctx.suggestions.read({ projectId, limit: 200 });
      sendJson(response, 200, result);
      return true;
    }

    const suggestionOne = routeParams(path, '/api/v1/suggestions/:id');
    if (suggestionOne && method === 'DELETE') {
      const ok = await ctx.suggestions.delete(suggestionOne.id);
      sendJson(response, ok ? 200 : 404, { ok });
      return true;
    }

    if (path === '/api/v1/follow-ups' && method === 'GET') {
      const records = [
        ...listJsonFiles(join(ctx.dataDir, 'followups')),
        ...ctx.toProjects().flatMap((project) => listJsonFiles(join(project.path, '.zcc', 'followups')))
      ];
      sendJson(response, 200, { followups: records });
      return true;
    }

    const followUpOne = routeParams(path, '/api/v1/follow-ups/:id');
    if (followUpOne && (method === 'PATCH' || method === 'POST')) {
      const body = (await readJsonBody(request)) as {
        status?: unknown;
        resolution?: unknown;
        spawnedAt?: unknown;
      };
      const dirs = [
        join(ctx.dataDir, 'followups'),
        ...ctx.toProjects().map((project) => join(project.path, '.zcc', 'followups'))
      ];
      let record: Record<string, unknown> | null = null;
      let dir: string | null = null;
      for (const candidate of dirs) {
        record = readJsonFile(candidate, followUpOne.id);
        if (record) {
          dir = candidate;
          break;
        }
      }
      if (!record || !dir) {
        sendJson(response, 404, { error: 'follow-up not found' });
        return true;
      }
      if (typeof body.status === 'string') {
        if (!VALID_FOLLOW_UP_STATUS.includes(body.status as FollowUpStatus)) {
          sendJson(response, 400, { error: 'invalid status' });
          return true;
        }
        record.status = body.status;
        record.updatedAt = new Date().toISOString();
        if (body.status === 'resolved' || body.status === 'dismissed') {
          record.resolvedAt = new Date().toISOString();
        }
      }
      if (typeof body.resolution === 'string') record.resolution = body.resolution;
      if (typeof body.spawnedAt === 'string') record.spawnedAt = body.spawnedAt;
      writeJsonFile(dir, followUpOne.id, record);
      const followups = [
        ...listJsonFiles(join(ctx.dataDir, 'followups')),
        ...ctx.toProjects().flatMap((project) => listJsonFiles(join(project.path, '.zcc', 'followups')))
      ];
      ctx.hub.emit('followups:changed', followups);
      sendJson(response, 200, { followUp: record });
      return true;
    }

    if (path === '/api/v1/saved' && method === 'GET') {
      sendJson(response, 200, { records: await ctx.saved.list() });
      return true;
    }

    if (path === '/api/v1/saved' && method === 'POST') {
      const input = (await readJsonBody(request)) as Parameters<ProductHttpContext['saved']['save']>[0];
      const record = await ctx.saved.save(input);
      sendJson(response, 200, { record });
      return true;
    }

    const savedOne = routeParams(path, '/api/v1/saved/:id');
    if (savedOne && method === 'DELETE') {
      const ok = await ctx.saved.delete(savedOne.id);
      sendJson(response, ok ? 200 : 404, { ok });
      return true;
    }

    if (path === '/api/v1/goals' && method === 'GET') {
      const records = [
        ...listJsonFiles(join(ctx.dataDir, 'goals')),
        ...ctx.toProjects().flatMap((project) => listJsonFiles(join(project.path, '.zcc', 'goals')))
      ];
      sendJson(response, 200, { goals: records });
      return true;
    }

    if (path === '/api/v1/scheduler' && method === 'GET') {
      const records = [
        ...listJsonFiles(join(ctx.dataDir, 'schedules')),
        ...ctx.toProjects().flatMap((project) => listJsonFiles(join(project.path, '.zcc', 'schedules')))
      ];
      sendJson(response, 200, { tasks: records });
      return true;
    }

    if (path === '/api/v1/personas' && method === 'GET') {
      sendJson(response, 200, { personas: listJsonFiles(join(ctx.dataDir, 'personas')) });
      return true;
    }

    if (path === '/api/v1/teams' && method === 'GET') {
      sendJson(response, 200, { teams: listJsonFiles(join(ctx.dataDir, 'teams')) });
      return true;
    }

    if (path === '/api/v1/library' && method === 'GET') {
      try {
        const docs = await listLibraryDocs(ctx);
        sendJson(response, 200, { docs });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/library/content' && method === 'GET') {
      const scope = requestUrl.searchParams.get('scope');
      const relPath = requestUrl.searchParams.get('relPath') ?? '';
      const projectId = requestUrl.searchParams.get('projectId') ?? undefined;
      if (scope !== 'global' && scope !== 'project') {
        sendJson(response, 400, { error: 'scope is required' });
        return true;
      }
      if (!isSafeRelPath(relPath)) {
        sendJson(response, 403, { ok: false, message: 'path escapes library root' });
        return true;
      }
      try {
        const result = await readLibraryDoc(ctx, scope as LibraryScope, relPath, projectId);
        sendJson(response, result.ok ? 200 : 404, result);
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/quick-prompts' && method === 'GET') {
      try {
        const prompts = await listQuickPrompts(ctx);
        sendJson(response, 200, { prompts });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/fs/list-dir' && method === 'POST') {
      const body = (await readJsonBody(request)) as { path?: unknown };
      try {
        const entries = await listProjectDir(ctx, typeof body.path === 'string' ? body.path : '');
        sendJson(response, 200, { entries });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/fs/read' && method === 'POST') {
      const body = (await readJsonBody(request)) as { path?: unknown };
      try {
        const result = await readProjectFile(ctx, typeof body.path === 'string' ? body.path : '');
        sendJson(response, result.ok ? 200 : 404, result);
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/harness/verify' && method === 'GET') {
      try {
        sendJson(response, 200, { results: await harnessVerify(ctx.hostHub) });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/harness/descriptors' && method === 'GET') {
      try {
        sendJson(response, 200, { descriptors: await harnessDescriptors(ctx.hostHub) });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/harness/effective-default' && method === 'GET') {
      const projectId = requestUrl.searchParams.get('projectId') ?? '';
      const project = ctx.toProjects().find((row) => row.id === projectId);
      try {
        const result = await harnessEffectiveDefault({
          hub: ctx.hostHub,
          project,
          config: ctx.config.getConfig(),
          personas: listJsonFiles(join(ctx.dataDir, 'personas')) as Persona[]
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/threads' && method === 'GET') {
      const projectId = requestUrl.searchParams.get('projectId');
      const threads = projectId ? listThreadsByProject(ctx.db, projectId) : listLiveThreads(ctx.db);
      sendJson(response, 200, { threads: threads.map((thread) => threadView(ctx, thread)) });
      return true;
    }

    const threadOutput = routeParams(path, '/api/v1/threads/:id/output');
    if (threadOutput && method === 'GET') {
      const thread = getThread(ctx.db, threadOutput.id);
      if (!thread) {
        sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
        return true;
      }
      sendJson(response, 200, { output: threadOutputTail(ctx.db, thread.id) });
      return true;
    }

    const threadResize = routeParams(path, '/api/v1/threads/:id/resize');
    if (threadResize && method === 'POST') {
      const thread = getThread(ctx.db, threadResize.id);
      if (!thread) {
        sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
        return true;
      }
      const body = (await readJsonBody(request)) as { cols?: unknown; rows?: unknown };
      const geometry = parseTerminalGeometry(body);
      if (!geometry) {
        sendJson(response, 400, { error: 'bad-geometry', message: 'cols and rows must be positive integers' });
        return true;
      }
      try {
        await ctx.hostHub.callHostOnlineRpc({
          hostId: thread.hostId,
          command: {
            type: 'thread.resize',
            threadId: thread.id,
            cols: geometry.cols,
            rows: geometry.rows
          }
        });
        sendJson(response, 200, { ok: true, threadId: thread.id, ...geometry });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/threads' && method === 'POST') {
      const body = (await readJsonBody(request)) as {
        projectId?: unknown;
        providerId?: unknown;
        input?: unknown;
        hostId?: unknown;
        environment?: unknown;
        checkout?: unknown;
      };
      const input = Array.isArray(body.input)
        ? body.input.filter((part): part is string => typeof part === 'string')
        : typeof body.input === 'string' ? [body.input] : [];
      const environmentChoice = body.environment === undefined
        ? undefined
        : spawnEnvironmentChoiceSchema.safeParse(body.environment);
      if (environmentChoice && !environmentChoice.success) {
        sendJson(response, 400, { ok: false, code: 'invalid-environment', message: 'environment choice is invalid' });
        return true;
      }
      try {
        const thread = await createThreadFromRequest(ctx, {
          projectId: typeof body.projectId === 'string' ? body.projectId : '',
          providerId: typeof body.providerId === 'string' ? body.providerId : '',
          input,
          hostId: typeof body.hostId === 'string' ? body.hostId : undefined,
          environment: environmentChoice?.data,
          checkout: body.checkout && typeof body.checkout === 'object'
            ? body.checkout as SpawnThreadInput['checkout']
            : undefined
        });
        sendJson(response, 201, { ok: true, value: threadView(ctx, thread) });
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadArchive = routeParams(path, '/api/v1/threads/:id/archive');
    if (threadArchive && method === 'POST') {
      try {
        const ok = await archiveThread(ctx, threadArchive.id);
        if (!ok) {
          sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
          return true;
        }
        sendJson(response, 200, { ok: true, threadId: threadArchive.id });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    const projectEnvironments = routeParams(path, '/api/v1/projects/:id/environments');
    if (projectEnvironments && method === 'GET') {
      sendJson(response, 200, {
        environments: listProjectEnvironments(ctx, projectEnvironments.id, requestUrl.searchParams.get('hostId') ?? undefined)
      });
      return true;
    }

    const envStatus = routeParams(path, '/api/v1/environments/:id/status');
    if (envStatus && method === 'GET') {
      try {
        sendJson(response, 200, await environmentStatus(ctx, envStatus.id));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const envDiff = routeParams(path, '/api/v1/environments/:id/diff');
    if (envDiff && method === 'GET') {
      try {
        const raw = requestUrl.searchParams.get('target');
        const target = raw ? JSON.parse(raw) : undefined;
        sendJson(response, 200, await environmentDiff(ctx, envDiff.id, target));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const envPr = routeParams(path, '/api/v1/environments/:id/pull-request');
    if (envPr && method === 'GET') {
      try {
        sendJson(response, 200, await environmentPullRequest(ctx, envPr.id));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const envActions = routeParams(path, '/api/v1/environments/:id/actions');
    if (envActions && method === 'POST') {
      try {
        const body = await readJsonBody(request);
        sendJson(response, 200, await runEnvironmentAction(ctx, envActions.id, body));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const envDestroy = routeParams(path, '/api/v1/environments/:id');
    if (envDestroy && method === 'DELETE') {
      try {
        await destroyEnvironment(ctx, envDestroy.id);
        sendJson(response, 200, { ok: true, environmentId: envDestroy.id });
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const projectBranches = routeParams(path, '/api/v1/projects/:id/branches');
    if (projectBranches && method === 'GET') {
      const project = ctx.toProjects().find((row) => row.id === projectBranches.id);
      if (!project || !project.path) {
        sendJson(response, 404, { error: 'unknown-project', message: 'project is not registered' });
        return true;
      }
      try {
        const hostId = ctx.hostHub.resolveHostId(requestUrl.searchParams.get('hostId') ?? undefined);
        const result = await ctx.hostHub.callHostOnlineRpc<{ branches: string[]; truncated: boolean }>({
          hostId,
          command: {
            type: 'host.list_branches',
            workspacePath: project.path,
            workspaceProvisionType: 'unmanaged',
            limit: 200
          }
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/projects/clone' && method === 'POST') {
      const body = (await readJsonBody(request)) as { url?: unknown; name?: unknown; hostId?: unknown };
      if (typeof body.url !== 'string' || body.url.trim().length === 0) {
        sendJson(response, 400, { ok: false, code: 'invalid-url', message: 'url is required' });
        return true;
      }
      try {
        const normalized = normalizeRepoUrl(body.url);
        const slug = typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || normalized.repoName
          : normalized.repoName;
        const hostId = ctx.hostHub.resolveHostId(typeof body.hostId === 'string' ? body.hostId : undefined);
        const cloned = await ctx.hostHub.callHostOnlineRpc<{ path: string; gitRemoteUrl: string | null }>({
          hostId,
          command: {
            type: 'project.clone',
            remoteUrl: normalized.cloneUrl,
            projectSlug: slug
          }
        });
        const project = await ctx.projects.add(cloned.path);
        ctx.hub.emit('projects:changed', ctx.projects.list());
        sendJson(response, 201, { ok: true, project, path: cloned.path, gitRemoteUrl: cloned.gitRemoteUrl });
      } catch (error) {
        if (error instanceof Error && /Enter a repository URL|Invalid repository URL|URL too long/.test(error.message)) {
          sendJson(response, 400, { ok: false, code: 'invalid-url', message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/plugins' && method === 'GET') {
      sendJson(response, 200, { plugins: [] });
      return true;
    }

    if (path === '/api/v1/extensions' && method === 'GET') {
      sendJson(response, 200, { extensions: [] });
      return true;
    }

    if (path === '/api/v1/mcp' && method === 'GET') {
      sendJson(response, 200, { servers: [] });
      return true;
    }

    if (path === '/api/v1/agents' && method === 'GET') {
      sendJson(response, 200, { agents: [], messages: [] });
      return true;
    }

    if (path === '/api/v1/agent-status' && method === 'GET') {
      sendJson(response, 200, { byId: {} });
      return true;
    }

    if (path === '/api/v1/terminals' && method === 'GET') {
      sendJson(response, 200, { sessions: [] });
      return true;
    }

    if (path === '/api/v1/terminals' && method === 'POST') {
      const body = (await readJsonBody(request)) as CreateTerminalRequest;
      if (typeof body?.projectId !== 'string' || body.projectId.length === 0) {
        sendJson(response, 400, { ok: false, code: 'invalid-project', message: 'projectId is required' });
        return true;
      }
      const project = ctx.projects.list().find((row) => row.id === body.projectId);
      if (!project) {
        sendJson(response, 404, { ok: false, code: 'unknown-project', message: 'project is not registered' });
        return true;
      }
      if (project.remote) {
        sendJson(response, 403, {
          ok: false,
          code: 'remote-unsupported',
          message: 'remote launches are not authorized on the loopback API'
        });
        return true;
      }
      let cwd: string;
      try {
        if (!statSync(project.path).isDirectory()) throw new Error('not a directory');
        const confined = confineCwd(project.path, body.cwd);
        if (!confined) {
          sendJson(response, 403, {
            ok: false,
            code: 'cwd-escape',
            message: 'cwd is outside the registered project'
          });
          return true;
        }
        cwd = confined;
      } catch {
        sendJson(response, 403, {
          ok: false,
          code: 'cwd-escape',
          message: 'project path is not a confined directory'
        });
        return true;
      }
      void cwd;
      sendJson(response, 503, {
        ok: false,
        code: 'launch-unavailable',
        message: 'terminal launch is authorized but the host session runtime is not attached'
      });
      return true;
    }

    sendJson(response, 404, { error: 'not found' });
    return true;
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
    return true;
  }
}

function sendHostFailure(response: ServerResponse, error: unknown): void {
  if (error instanceof HostUnavailableError) {
    sendJson(response, 503, { ok: false, code: error.code, message: error.message });
    return;
  }
  if (error instanceof AmbiguousHostError) {
    sendJson(response, 409, { ok: false, code: error.code, message: error.message });
    return;
  }
  if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
    const status = (error as { status: number; code?: string; message?: string });
    sendJson(response, status.status, {
      ok: false,
      code: status.code ?? 'host-error',
      message: status.message ?? (error instanceof Error ? error.message : String(error))
    });
    return;
  }
  sendJson(response, 500, {
    error: error instanceof Error ? error.message : String(error)
  });
}

export function isProductApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}
