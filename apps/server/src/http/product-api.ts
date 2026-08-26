import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AppConfig,
  CreateTerminalRequest,
  FollowUpStatus,
  LaunchProfileId,
  LibraryScope,
  Persona,
  TerminalSession
} from '@zana-ai/zcc-domain/product';
import { browserRequestProblem, headerValue } from './browser-request-guard.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './disk-json.js';
import { applyTrustedOriginCors, readJsonBody, sendJson } from './json.js';
import type { ProductHttpContext, ProductTerminalRecord } from './product-context.js';
import { ThreadCreateError } from './thread-create.js';
import {
  conversationThreadView,
  createConversationFromRequest,
  flattenThreadInput,
  type CreateConversationInput
} from '../services/threads/conversation-create.js';
import {
  forkConversation,
  resumeConversation,
  sendConversationTurn,
  stopConversation,
  type ThreadSendMode
} from '../services/threads/conversation-lifecycle.js';
import { conversationOutline, conversationTimeline } from '../services/threads/conversation-timeline.js';
import { readLastThreadExecution } from '../services/threads/thread-last-execution.js';
import { markThreadRead } from '../services/threads/thread-reads.js';
import { readThreadHostFile } from '../services/threads/thread-host-file.js';
import { listThreadProviders, bridgeLaunchForProvider } from '../services/threads/thread-provider-catalog.js';
import {
  buildThreadExecutionOptions,
  classifyModelListError,
  type ThreadModelLoadErrorCode
} from '../services/threads/thread-execution-options.js';
import { archiveThread, destroyEnvironment } from '../services/environments/environment-cleanup.js';
import {
  environmentDiff,
  environmentDiffFiles,
  environmentDiffPatch,
  environmentPullRequest,
  environmentStatus,
  listProjectEnvironments,
  runEnvironmentAction
} from '../services/environments/environment-actions.js';
import { spawnEnvironmentChoiceSchema } from '@zana-ai/zcc-domain';
import { jsonValueSchema, pendingInteractionResolutionSchema, reasoningLevelSchema, type ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProviderListModelsResult } from '@zana-ai/zcc-contracts/host-rpc';
import { normalizeRepoUrl } from '../services/projects/git-clone.js';
import { harnessDescriptors, harnessEffectiveDefault, harnessVerify } from './harness-via-rpc.js';
import { isSafeRelPath, listLibraryDocs, listQuickPrompts, readLibraryDoc } from './library-via-host.js';
import { listProjectDir, listProjectPaths, readProjectFile } from './project-fs-via-host.js';
import { getConversationThread, getEnvironment, listConversationThreadEvents, listConversationThreadsByProject, listVisibleConversationThreads, nextConversationEventSequence, updateConversationThreadTitle } from '@zana-ai/zcc-db';
import { handleHostsApi } from './hosts-api.js';
import { resolvePublicAppUrl } from './public-app-url.js';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';
import { parseMultipartVoiceForm, readVoiceBody } from './multipart-voice.js';
import {
  transcribeVoiceOnHost,
  VoiceTranscriptionError,
  voiceTranscriptionEnabled
} from '../services/threads/voice-transcription.js';

const VALID_FOLLOW_UP_STATUS: FollowUpStatus[] = ['open', 'resolved', 'dismissed'];

function parseReasoningLevel(value: unknown): ReasoningLevel | undefined {
  const parsed = reasoningLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

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

function resolveCloneRoot(ctx: ProductHttpContext): string {
  const configured = ctx.config.getConfig().cloneRoot?.trim();
  if (configured && isAbsolute(configured)) return configured;
  return join(homedir(), 'zcc-workspace');
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

function publicTerminal(record: ProductTerminalRecord): TerminalSession {
  const { hostId: _hostId, ...session } = record;
  return session;
}

function requireTerminalSession(
  ctx: ProductHttpContext,
  sessionId: string
): ProductTerminalRecord | null {
  return ctx.terminalSessions.get(sessionId) ?? null;
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

  const method = (request.method ?? 'GET').toUpperCase();
  const path = requestUrl.pathname;
  const isVoiceTranscription = path === '/api/v1/system/voice-transcription' && method === 'POST';
  const problem = browserRequestProblem(
    {
      req: {
        url: requestUrl.href,
        method: request.method ?? 'GET',
        header: (name) => headerValue(request.headers, name)
      }
    },
    { config: ctx.origins },
    { requireJsonForMutation: request.method !== 'OPTIONS' && !isVoiceTranscription }
  );
  if (problem) {
    sendJson(response, problem.status, { error: problem.error });
    return true;
  }

  const origin = headerValue(request.headers, 'origin');
  if (origin) applyTrustedOriginCors(response, origin);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      Allow: 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'no-store',
      ...(origin
        ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'content-type, x-zcc-app-surface',
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
            Vary: 'Origin'
          }
        : {})
    }).end();
    return true;
  }

  try {
    if (path === '/api/v1/health' && (method === 'GET' || method === 'HEAD')) {
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (await handleHostsApi(request, response, ctx, path, method, requestUrl)) {
      return true;
    }

    if (path === '/api/v1/projects' && method === 'GET') {
      sendJson(response, 200, { projects: ctx.projects.list() });
      return true;
    }

    if (path === '/api/v1/projects' && method === 'POST') {
      const body = (await readJsonBody(request)) as { path?: unknown; hostId?: unknown };
      if (typeof body.path !== 'string' || body.path.length === 0) {
        sendJson(response, 400, { error: 'path is required' });
        return true;
      }
      const hostId = typeof body.hostId === 'string' && body.hostId.length > 0 ? body.hostId : undefined;
      const project = await ctx.projects.add(body.path, hostId ? { hostId } : undefined);
      ctx.hub.emit('projects:changed', ctx.projects.list());
      sendJson(response, 200, { project });
      return true;
    }

    if (path === '/api/v1/projects/reorder' && method === 'POST') {
      const body = (await readJsonBody(request)) as { orderedIds?: unknown };
      const orderedIds = Array.isArray(body.orderedIds)
        ? body.orderedIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (orderedIds.length === 0) {
        sendJson(response, 400, { error: 'orderedIds is required' });
        return true;
      }
      const projects = await ctx.projects.reorder(orderedIds);
      ctx.hub.emit('projects:changed', ctx.projects.list());
      sendJson(response, 200, { projects });
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
      const config = ctx.config.getConfig();
      sendJson(response, 200, {
        config: {
          ...config,
          publicAppUrl: resolvePublicAppUrl({ configUrl: config.publicAppUrl }) ?? config.publicAppUrl
        }
      });
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
        const project = projectId ? ctx.toProjects().find((row) => row.id === projectId) : undefined;
        const result = await readLibraryDoc(ctx, scope as LibraryScope, relPath, projectId, project?.hostId);
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
        sendJson(response, 200, { results: await harnessVerify(ctx.hostHub, requestUrl.searchParams.get('hostId') ?? undefined) });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/harness/descriptors' && method === 'GET') {
      try {
        sendJson(response, 200, { descriptors: await harnessDescriptors(ctx.hostHub, requestUrl.searchParams.get('hostId') ?? undefined) });
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
          personas: listJsonFiles(join(ctx.dataDir, 'personas')) as Persona[],
          hostId: requestUrl.searchParams.get('hostId') ?? project?.hostId
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/threads/providers' && method === 'GET') {
      sendJson(response, 200, {
        providers: listThreadProviders().map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          pluginId: provider.pluginId,
          permissionModes: provider.capabilities.permissionModes,
          reasoningLevels: provider.capabilities.reasoningLevels ?? [],
          composerActions: provider.composerActions ?? []
        }))
      });
      return true;
    }

    if (path === '/api/v1/threads' && method === 'GET') {
      const projectId = requestUrl.searchParams.get('projectId');
      const threads = projectId
        ? listConversationThreadsByProject(ctx.db, projectId)
        : listVisibleConversationThreads(ctx.db);
      sendJson(response, 200, { threads: threads.map((thread) => conversationThreadView(ctx, thread)) });
      return true;
    }

    const threadById = routeParams(path, '/api/v1/threads/:id');
    if (threadById && method === 'GET') {
      const thread = getConversationThread(ctx.db, threadById.id);
      if (!thread) {
        sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
        return true;
      }
      sendJson(response, 200, {
        thread: {
          ...conversationThreadView(ctx, thread),
          ...readLastThreadExecution(ctx, thread.id)
        }
      });
      return true;
    }
    if (threadById && method === 'PATCH') {
      const thread = getConversationThread(ctx.db, threadById.id);
      if (!thread) {
        sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
        return true;
      }
      const body = (await readJsonBody(request)) as { title?: unknown };
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
      if (!title) {
        sendJson(response, 400, { error: 'invalid-input', message: 'title is required' });
        return true;
      }
      const updated = updateConversationThreadTitle(ctx.db, thread.id, title) ?? thread;
      ctx.threadTitleNamer?.reserve(thread.id);
      ctx.hub.emit('threads:updated', conversationThreadView(ctx, updated));
      sendJson(response, 200, { thread: conversationThreadView(ctx, updated) });
      return true;
    }

    const threadEvents = routeParams(path, '/api/v1/threads/:id/events');
    if (threadEvents && method === 'GET') {
      const thread = getConversationThread(ctx.db, threadEvents.id);
      if (!thread) {
        sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
        return true;
      }
      sendJson(response, 200, { events: listConversationThreadEvents(ctx.db, thread.id) });
      return true;
    }

    const threadTimeline = routeParams(path, '/api/v1/threads/:id/timeline');
    if (threadTimeline && method === 'GET') {
      try {
        sendJson(response, 200, conversationTimeline(ctx, threadTimeline.id, {
          segmentLimit: requestUrl.searchParams.get('segmentLimit'),
          beforeAnchorSeq: requestUrl.searchParams.get('beforeAnchorSeq'),
          beforeAnchorId: requestUrl.searchParams.get('beforeAnchorId')
        }));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadRead = routeParams(path, '/api/v1/threads/:id/read');
    if (threadRead && method === 'POST') {
      const thread = getConversationThread(ctx.db, threadRead.id);
      if (!thread) {
        sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
        return true;
      }
      const maxSeq = Math.max(0, nextConversationEventSequence(ctx.db, thread.id) - 1);
      const lastReadSeq = markThreadRead(ctx.dataDir, thread.id, maxSeq);
      sendJson(response, 200, { thread: { ...conversationThreadView(ctx, thread), lastReadSeq } });
      return true;
    }

    const threadUnread = routeParams(path, '/api/v1/threads/:id/unread');
    if (threadUnread && method === 'POST') {
      const thread = getConversationThread(ctx.db, threadUnread.id);
      if (!thread) {
        sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
        return true;
      }
      const lastReadSeq = markThreadRead(ctx.dataDir, thread.id, 0);
      sendJson(response, 200, { thread: { ...conversationThreadView(ctx, thread), lastReadSeq } });
      return true;
    }

    const threadOutline = routeParams(path, '/api/v1/threads/:id/conversation-outline');
    if (threadOutline && method === 'GET') {
      try {
        sendJson(response, 200, conversationOutline(ctx, threadOutline.id));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadHostFile = routeParams(path, '/api/v1/threads/:id/host-files/content');
    if (threadHostFile && method === 'GET') {
      try {
        const pathParam = requestUrl.searchParams.get('path') ?? '';
        sendJson(response, 200, await readThreadHostFile(ctx, threadHostFile.id, pathParam));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadOutput = routeParams(path, '/api/v1/threads/:id/output');
    if (threadOutput && (method === 'GET' || method === 'POST')) {
      sendJson(response, 410, { error: 'gone', message: 'PTY thread output moved off /api/v1/threads; use /threads/:id/timeline' });
      return true;
    }

    const threadResize = routeParams(path, '/api/v1/threads/:id/resize');
    if (threadResize && method === 'POST') {
      sendJson(response, 410, { error: 'gone', message: 'PTY resize is not a Thread API' });
      return true;
    }

    const threadInput = routeParams(path, '/api/v1/threads/:id/input');
    if (threadInput && method === 'POST') {
      sendJson(response, 410, { error: 'gone', message: 'PTY input is not a Thread API; use POST /threads/:id/send' });
      return true;
    }

    const threadStop = routeParams(path, '/api/v1/threads/:id/stop');
    if (threadStop && method === 'POST') {
      try {
        const thread = await stopConversation(ctx, threadStop.id);
        sendJson(response, 200, { ok: true, thread: conversationThreadView(ctx, thread) });
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadResume = routeParams(path, '/api/v1/threads/:id/resume');
    if (threadResume && method === 'POST') {
      try {
        const thread = await resumeConversation(ctx, threadResume.id);
        sendJson(response, 200, { ok: true, thread: conversationThreadView(ctx, thread) });
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadFork = routeParams(path, '/api/v1/threads/:id/fork');
    if (threadFork && method === 'POST') {
      try {
        const thread = await forkConversation(ctx, threadFork.id);
        sendJson(response, 201, { ok: true, thread: conversationThreadView(ctx, thread), value: conversationThreadView(ctx, thread) });
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadSend = routeParams(path, '/api/v1/threads/:id/send');
    const threadReply = routeParams(path, '/api/v1/threads/:id/reply');
    if ((threadSend || threadReply) && method === 'POST') {
      const id = threadSend?.id ?? threadReply?.id;
      const body = (await readJsonBody(request)) as {
        input?: unknown;
        text?: unknown;
        mode?: unknown;
        model?: unknown;
        reasoningLevel?: unknown;
      };
      const mode = body.mode === 'start' || body.mode === 'auto' || body.mode === 'steer'
        || body.mode === 'queue-if-active' || body.mode === 'steer-if-active'
        ? body.mode as ThreadSendMode
        : 'auto';
      try {
        const thread = await sendConversationTurn(ctx, id!, body.input ?? body.text, mode, {
          model: typeof body.model === 'string' ? body.model : undefined,
          reasoningLevel: parseReasoningLevel(body.reasoningLevel)
        });
        sendJson(response, 200, { ok: true, thread: conversationThreadView(ctx, thread) });
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, {
            ok: false,
            code: error.code,
            error: error.code,
            message: error.message
          });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/threads' && method === 'POST') {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const environmentChoice = body.environment === undefined
        ? undefined
        : spawnEnvironmentChoiceSchema.safeParse(body.environment);
      if (environmentChoice && !environmentChoice.success) {
        sendJson(response, 400, { ok: false, code: 'invalid-environment', message: 'environment choice is invalid' });
        return true;
      }
      try {
        const thread = await createConversationFromRequest(ctx, {
          projectId: typeof body.projectId === 'string' ? body.projectId : '',
          providerId: typeof body.providerId === 'string' ? body.providerId : 'claude-code',
          input: flattenThreadInput(body.input ?? body.prompt),
          hostId: typeof body.hostId === 'string' ? body.hostId : undefined,
          id: typeof body.id === 'string' ? body.id : undefined,
          environment: environmentChoice?.data,
          checkout: body.checkout && typeof body.checkout === 'object'
            ? body.checkout as CreateConversationInput['checkout']
            : undefined,
          cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          permissionMode: body.permissionMode === 'accept-edits' || body.permissionMode === 'auto' || body.permissionMode === 'full'
            ? body.permissionMode
            : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
          reasoningLevel: parseReasoningLevel(body.reasoningLevel)
        });
        sendJson(response, 201, { ok: true, value: conversationThreadView(ctx, thread), thread: conversationThreadView(ctx, thread) });
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadInteractionResolve = routeParams(path, '/api/v1/threads/:id/interactions/:interactionId/resolve');
    if (threadInteractionResolve && method === 'POST') {
      try {
        const parsed = pendingInteractionResolutionSchema.safeParse(await readJsonBody(request));
        if (!parsed.success) {
          sendJson(response, 400, { error: 'invalid_request', message: 'invalid resolution' });
          return true;
        }
        const resolution = parsed.data;
        const interaction = await ctx.pendingInteractions.resolvePendingInteraction({
          threadId: threadInteractionResolve.id,
          interactionId: threadInteractionResolve.interactionId,
          resolution
        });
        sendJson(response, 200, interaction);
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadInteractionRespond = routeParams(path, '/api/v1/threads/:id/interactions/:interactionId/respond');
    if (threadInteractionRespond && method === 'POST') {
      try {
        const body = (await readJsonBody(request)) as { value?: unknown };
        const parsed = jsonValueSchema.safeParse(body?.value);
        if (!parsed.success) {
          sendJson(response, 400, { error: 'invalid_request', message: 'respond value must be JSON' });
          return true;
        }
        const interaction = ctx.pendingInteractions.respondToPluginInteraction({
          threadId: threadInteractionRespond.id,
          interactionId: threadInteractionRespond.interactionId,
          value: parsed.data
        });
        sendJson(response, 200, interaction);
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadInteractionCancel = routeParams(path, '/api/v1/threads/:id/interactions/:interactionId/cancel');
    if (threadInteractionCancel && method === 'POST') {
      try {
        const interaction = ctx.pendingInteractions.cancelPluginInteraction({
          threadId: threadInteractionCancel.id,
          interactionId: threadInteractionCancel.interactionId,
          reason: 'user'
        });
        sendJson(response, 200, interaction);
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadInteraction = routeParams(path, '/api/v1/threads/:id/interactions/:interactionId');
    if (threadInteraction && method === 'GET') {
      try {
        sendJson(response, 200, ctx.pendingInteractions.getThreadInteraction({
          threadId: threadInteraction.id,
          interactionId: threadInteraction.interactionId
        }));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const threadInteractions = routeParams(path, '/api/v1/threads/:id/interactions');
    if (threadInteractions && method === 'GET') {
      const thread = getConversationThread(ctx.db, threadInteractions.id);
      if (!thread) {
        sendJson(response, 404, { error: 'unknown-thread', message: 'thread is not registered' });
        return true;
      }
      sendJson(response, 200, ctx.pendingInteractions.listPendingThreadInteractions(thread.id));
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

    const projectCommands = routeParams(path, '/api/v1/projects/:id/commands');
    if (projectCommands && method === 'GET') {
      sendJson(response, 200, {
        commands: listThreadProviders().flatMap((provider) =>
          (provider.composerActions ?? []).map((name) => ({
            id: `${provider.id}:${name}`,
            name: `/${name}`,
            providerId: provider.id,
            description: `${provider.displayName} ${name}`
          }))
        )
      });
      return true;
    }

    const projectPaths = routeParams(path, '/api/v1/projects/:id/paths');
    if (projectPaths && method === 'GET') {
      try {
        const limitRaw = requestUrl.searchParams.get('limit');
        const parsedLimit = limitRaw ? Number(limitRaw) : undefined;
        sendJson(response, 200, await listProjectPaths(ctx, projectPaths.id, {
          query: requestUrl.searchParams.get('query') ?? requestUrl.searchParams.get('q') ?? undefined,
          limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
          includeFiles: requestUrl.searchParams.get('includeFiles') !== 'false',
          includeDirectories: requestUrl.searchParams.get('includeDirectories') !== 'false'
        }));
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

    const envDiffFiles = routeParams(path, '/api/v1/environments/:id/diff/files');
    if (envDiffFiles && method === 'GET') {
      try {
        const raw = requestUrl.searchParams.get('target');
        const target = raw ? JSON.parse(raw) : undefined;
        sendJson(response, 200, await environmentDiffFiles(ctx, envDiffFiles.id, target));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    const envDiffPatch = routeParams(path, '/api/v1/environments/:id/diff/patch');
    if (envDiffPatch && method === 'POST') {
      try {
        const body = await readJsonBody(request);
        sendJson(response, 200, await environmentDiffPatch(ctx, envDiffPatch.id, body));
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

    const envCancel = routeParams(path, '/api/v1/environments/:id/provision/cancel');
    if (envCancel && method === 'POST') {
      const environment = getEnvironment(ctx.db, envCancel.id);
      if (!environment) {
        sendJson(response, 404, { ok: false, code: 'unknown-environment', message: 'environment is not registered' });
        return true;
      }
      if (environment.status !== 'provisioning') {
        sendJson(response, 409, { ok: false, code: 'not-provisioning', message: 'environment is not provisioning' });
        return true;
      }
      try {
        await ctx.hostHub.callHostOnlineRpc({
          hostId: environment.hostId,
          command: { type: 'environment.provision.cancel', environmentId: environment.id }
        });
        sendJson(response, 200, { ok: true, environmentId: environment.id, cancelled: true });
      } catch (error) {
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
        const hostId = ctx.hostHub.resolveHostId(
          requestUrl.searchParams.get('hostId') ?? project.hostId ?? undefined
        );
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

    if (path === '/api/v1/projects/clone-root' && method === 'GET') {
      sendJson(response, 200, { path: resolveCloneRoot(ctx) });
      return true;
    }

    if (path === '/api/v1/projects/clone' && method === 'POST') {
      const body = (await readJsonBody(request)) as {
        url?: unknown;
        name?: unknown;
        hostId?: unknown;
        targetPath?: unknown;
      };
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
        const targetPath = typeof body.targetPath === 'string' && isAbsolute(body.targetPath)
          ? body.targetPath
          : join(resolveCloneRoot(ctx), slug);
        const cloned = await ctx.hostHub.callHostOnlineRpc<{ path: string; gitRemoteUrl: string | null }>({
          hostId,
          command: {
            type: 'project.clone',
            remoteUrl: normalized.cloneUrl,
            projectSlug: slug,
            targetPath
          },
          timeoutMs: 20 * 60 * 1000
        });
        const project = await ctx.projects.add(cloned.path, { hostId });
        ctx.hub.emit('projects:changed', ctx.projects.list());
        sendJson(response, 201, { ok: true, project, path: cloned.path, gitRemoteUrl: cloned.gitRemoteUrl });
      } catch (error) {
        if (error instanceof Error && /Enter a repository URL|Invalid repository URL|URL too long/.test(error.message)) {
          sendJson(response, 400, { ok: false, code: 'invalid-url', message: error.message });
          return true;
        }
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'clone_target_exists') {
          sendJson(response, 409, {
            ok: false,
            code: 'DEST_EXISTS',
            message: error instanceof Error ? error.message : 'clone target already exists',
            path: typeof (error as { path?: unknown }).path === 'string' ? (error as { path: string }).path : undefined
          });
          return true;
        }
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/plugins' && method === 'GET') {
      sendJson(response, 200, { plugins: ctx.plugins?.list() ?? [] });
      return true;
    }

    if (path === '/api/v1/plugins/contributions' && method === 'GET') {
      sendJson(response, 200, { cliCommands: ctx.plugins?.cliContributions() ?? [] });
      return true;
    }

    const pluginCli = path.match(/^\/api\/v1\/plugins\/([^/]+)\/cli$/);
    if (pluginCli && method === 'POST') {
      const pluginId = decodeURIComponent(pluginCli[1]!);
      if (!ctx.plugins) {
        sendJson(response, 503, { ok: false, code: 'plugin-host-unavailable', message: 'plugin host is unavailable' });
        return true;
      }
      const body = (await readJsonBody(request)) as { argv?: unknown };
      const argv = Array.isArray(body?.argv) ? body.argv.map((item) => String(item)) : [];
      try {
        sendJson(response, 200, await ctx.plugins.runCliCommand(pluginId, argv));
      } catch (error) {
        sendJson(response, 404, {
          ok: false,
          code: 'plugin-cli-missing',
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return true;
    }

    const pluginHttp = path.match(/^\/api\/v1\/plugins\/([^/]+)\/http(\/.*)$/);
    if (pluginHttp && ctx.plugins) {
      const pluginId = decodeURIComponent(pluginHttp[1]!);
      const routePath = pluginHttp[2]!;
      const httpMethod = method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      if (httpMethod === 'GET' || httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH' || httpMethod === 'DELETE') {
        const query: Record<string, string> = {};
        requestUrl.searchParams.forEach((value, key) => {
          query[key] = value;
        });
        let body: unknown = undefined;
        if (httpMethod !== 'GET') {
          try {
            body = await readJsonBody(request);
          } catch {
            body = undefined;
          }
        }
        try {
          const result = await ctx.plugins.dispatchHttp(pluginId, {
            method: httpMethod,
            path: routePath,
            query,
            body
          });
          const status = result.status ?? 200;
          if (result.json !== undefined) {
            sendJson(response, status, result.json);
          } else {
            response.writeHead(status, result.headers ?? { 'content-type': 'text/plain; charset=utf-8' });
            response.end(result.body ?? '');
          }
        } catch (error) {
          sendJson(response, 404, {
            ok: false,
            code: 'plugin-http-missing',
            message: error instanceof Error ? error.message : String(error)
          });
        }
        return true;
      }
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
      sendJson(response, 200, {
        sessions: [...ctx.terminalSessions.values()].map(publicTerminal)
      });
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
      if (ctx.hostHub.connectedHostIds().length === 0) {
        sendJson(response, 502, {
          ok: false,
          code: 'host_disconnected',
          message: 'Host is not connected'
        });
        return true;
      }
      try {
        const hostId = ctx.hostHub.resolveHostId();
        const sessionId = randomUUID();
        const cols = typeof body.cols === 'number' ? body.cols : 80;
        const rows = typeof body.rows === 'number' ? body.rows : 24;
        const started = await ctx.hostHub.callHostOnlineRpc<{
          sessionId: string;
          started: true;
          pid?: number;
        }>({
          hostId,
          command: {
            type: 'terminal.start',
            sessionId,
            root: realpathSync(project.path),
            cwd,
            cols,
            rows
          }
        });
        const record: ProductTerminalRecord = {
          id: sessionId,
          projectId: project.id,
          title: typeof body.title === 'string' && body.title.length > 0 ? body.title : 'Terminal',
          profile: (typeof body.profile === 'string' ? body.profile : 'shell') as LaunchProfileId,
          cwd,
          pid: started.pid,
          status: 'running',
          createdAt: Date.now(),
          hostId
        };
        ctx.terminalSessions.set(sessionId, record);
        ctx.hub.emit('terminals:updated', publicTerminal(record));
        sendJson(response, 201, { ok: true, value: publicTerminal(record) });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    const terminalInput = routeParams(path, '/api/v1/terminals/:id/input');
    if (terminalInput && method === 'POST') {
      const session = requireTerminalSession(ctx, terminalInput.id);
      if (!session) {
        sendJson(response, 404, { ok: false, code: 'unknown-session', message: 'terminal is not registered' });
        return true;
      }
      const body = (await readJsonBody(request)) as { data?: unknown };
      if (typeof body?.data !== 'string') {
        sendJson(response, 400, { ok: false, code: 'invalid-input', message: 'data is required' });
        return true;
      }
      try {
        await ctx.hostHub.callHostOnlineRpc({
          hostId: session.hostId,
          command: { type: 'terminal.input', sessionId: session.id, data: body.data }
        });
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    const terminalResize = routeParams(path, '/api/v1/terminals/:id/resize');
    if (terminalResize && method === 'POST') {
      const session = requireTerminalSession(ctx, terminalResize.id);
      if (!session) {
        sendJson(response, 404, { ok: false, code: 'unknown-session', message: 'terminal is not registered' });
        return true;
      }
      const body = (await readJsonBody(request)) as { cols?: unknown; rows?: unknown };
      if (typeof body?.cols !== 'number' || typeof body?.rows !== 'number') {
        sendJson(response, 400, { ok: false, code: 'invalid-resize', message: 'cols and rows are required' });
        return true;
      }
      try {
        await ctx.hostHub.callHostOnlineRpc({
          hostId: session.hostId,
          command: {
            type: 'terminal.resize',
            sessionId: session.id,
            cols: body.cols,
            rows: body.rows
          }
        });
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    const terminalClose = routeParams(path, '/api/v1/terminals/:id/close');
    if (terminalClose && method === 'POST') {
      const session = requireTerminalSession(ctx, terminalClose.id);
      if (!session) {
        sendJson(response, 404, { ok: false, code: 'unknown-session', message: 'terminal is not registered' });
        return true;
      }
      try {
        await ctx.hostHub.callHostOnlineRpc({
          hostId: session.hostId,
          command: { type: 'terminal.stop', sessionId: session.id }
        });
        session.status = 'exited';
        session.finishedAt = Date.now();
        ctx.hub.emit('terminals:updated', publicTerminal(session));
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendHostFailure(response, error);
      }
      return true;
    }

    if (path === '/api/v1/system/execution-options' && method === 'GET') {
      const providerId = requestUrl.searchParams.get('providerId') ?? undefined;
      const requestedHostId = requestUrl.searchParams.get('hostId') ?? undefined;
      let availability: Awaited<ReturnType<typeof harnessVerify>> = [];
      try {
        availability = await harnessVerify(ctx.hostHub, requestedHostId);
      } catch {
        availability = [];
      }
      let listed: ProviderListModelsResult | null = null;
      let listError: ThreadModelLoadErrorCode | null = null;
      if (providerId) {
        try {
          const hostId = ctx.hostHub.resolveHostId(requestedHostId);
          const dataDir = join(ctx.dataDir, 'thread-bridges', providerId);
          mkdirSync(dataDir, { recursive: true, mode: 0o700 });
          listed = await ctx.hostHub.callHostOnlineRpc<ProviderListModelsResult>({
            hostId,
            timeoutMs: 20_000,
            command: {
              type: 'provider.list_models',
              providerId,
              bridgeLaunch: bridgeLaunchForProvider(providerId, dataDir)
            }
          });
        } catch (error) {
          listed = null;
          listError = classifyModelListError(error);
        }
      }
      sendJson(response, 200, buildThreadExecutionOptions({ providerId, availability, listed, listError }));
      return true;
    }

    if (path === '/api/v1/system/voice-status' && method === 'GET') {
      sendJson(response, 200, { enabled: voiceTranscriptionEnabled(ctx) });
      return true;
    }

    if (path === '/api/v1/system/voice-transcription' && method === 'POST') {
      const contentType = headerValue(request.headers, 'content-type') ?? '';
      if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        sendJson(response, 415, { error: 'content-type must be multipart/form-data' });
        return true;
      }
      try {
        const body = await readVoiceBody(request);
        const form = parseMultipartVoiceForm(body, contentType);
        if (!form.file) {
          sendJson(response, 400, { error: 'invalid_request', message: 'Audio file is required' });
          return true;
        }
        const text = await transcribeVoiceOnHost(ctx, {
          bytes: form.file.bytes,
          mimeType: form.file.mimeType,
          filename: form.file.filename,
          prompt: form.prompt
        });
        sendJson(response, 200, { text });
      } catch (error) {
        if (error instanceof VoiceTranscriptionError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return true;
        }
        if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
          const status = error as { status: number; code?: string; message?: string };
          sendJson(response, status.status, {
            error: status.code ?? 'invalid_request',
            message: status.message ?? (error instanceof Error ? error.message : String(error))
          });
          return true;
        }
        throw error;
      }
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
  if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'clone_target_exists') {
    sendJson(response, 409, {
      ok: false,
      code: 'DEST_EXISTS',
      message: error instanceof Error ? error.message : 'clone target already exists'
    });
    return;
  }
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    sendJson(response, 500, {
      ok: false,
      code: (error as { code: string }).code,
      message: error instanceof Error ? error.message : String(error)
    });
    return;
  }
  sendJson(response, 500, {
    ok: false,
    code: 'host-error',
    message: error instanceof Error ? error.message : String(error)
  });
}

export function isProductApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}
