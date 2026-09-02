import type { CcApi } from '@zana-ai/zcc-desktop-contract';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type {
  AgentMessage,
  AgentRecord,
  AppConfig,
  CreateTerminalRequest,
  FollowUp,
  Goal,
  InboxEntry,
  Persona,
  Project,
  Result,
  SavedRecord,
  SavedRecordInput,
  ScheduledTask,
  Suggestion,
  Team,
  TerminalSession,
  FsEntry,
  FsReadResult,
  PluginAppEntry
} from '@zana-ai/zcc-domain/product';
import { hasDesktopBridge } from './app-surface.js';
import { apiJson, fetchWithAppSurface } from './fetch-with-app-surface.js';
import { subscribeProductEvent } from './product-ws.js';

function noopSubscribe(_cb: unknown): () => void {
  return () => {};
}

const pluginAppListeners = new Set<(entries: PluginAppEntry[]) => void>();

function emitPluginApps(apps: PluginAppEntry[]): void {
  for (const listener of pluginAppListeners) listener(apps);
}

function httpProduct(): Pick<
  CcApi,
  | 'projects'
  | 'config'
  | 'inbox'
  | 'suggestions'
  | 'followups'
  | 'saved'
  | 'goals'
  | 'scheduler'
  | 'personas'
  | 'teams'
  | 'agents'
  | 'terminals'
  | 'threads'
  | 'environments'
  | 'harness'
  | 'library'
  | 'quickPrompts'
  | 'fs'
  | 'files'
  | 'pluginApps'
  | 'extensions'
  | 'updates'
  | 'app'
  | 'voice'
  | 'hosts'
  | 'relay'
  | 'marketplaces'
  | 'cliSkills'
> {
  return {
    projects: {
      list: async () => {
        const body = await apiJson<{ projects: Project[] }>('/projects');
        return body.projects;
      },
      touch: async (id: string) => {
        if (!id) return null;
        const body = await apiJson<{ project: Project }>(`/projects/${encodeURIComponent(id)}/touch`, {
          method: 'POST',
          body: '{}'
        });
        return body.project;
      },
      add: async (path: string, opts?: { hostId?: string }) => {
        const body = await apiJson<{ project: Project }>('/projects', {
          method: 'POST',
          body: JSON.stringify({ path, hostId: opts?.hostId })
        });
        return body.project;
      },
      update: async (id: string, patch: Parameters<CcApi['projects']['update']>[1]) => {
        const body = await apiJson<{ project: Project }>(`/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch)
        });
        return body.project;
      },
      reorder: async (orderedIds: string[]) => {
        const body = await apiJson<{ projects: Project[] }>('/projects/reorder', {
          method: 'POST',
          body: JSON.stringify({ orderedIds })
        });
        return body.projects;
      },
      pickDirectory: async () => null,
      addRemote: async () => ({ ok: false, code: 'unavailable', message: 'remote projects require the desktop app' }),
      clone: async (input: { url: string; name?: string }) => {
        try {
          const response = await fetchWithAppSurface('/api/v1/projects/clone', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: input.url, name: input.name })
          });
          const body = await response.json() as {
            ok?: boolean;
            project?: Project;
            path?: string;
            code?: string;
            message?: string;
          };
          if (!response.ok || !body.ok || !body.project) {
            return {
              ok: false as const,
              code: (body.code === 'DEST_EXISTS' || body.code === 'clone_target_exists' ? 'DEST_EXISTS' : 'CLONE_FAILED') as 'DEST_EXISTS' | 'CLONE_FAILED',
              message: body.message ?? 'clone failed',
              path: body.path
            };
          }
          return { ok: true as const, project: body.project };
        } catch (error) {
          return {
            ok: false as const,
            code: 'CLONE_FAILED' as const,
            message: error instanceof Error ? error.message : String(error)
          };
        }
      },
      onCloneProgress: (cb: (line: string) => void) => subscribeProductEvent('projects:cloneProgress', (payload) => {
        const text = payload && typeof payload === 'object' && 'text' in payload
          ? (payload as { text: unknown }).text
          : payload;
        if (typeof text === 'string') cb(text);
      }),
      cloneRoot: async () => {
        try {
          const body = await apiJson<{ path: string }>('/projects/clone-root');
          return body.path;
        } catch {
          return '';
        }
      },
      ensureQuickAgent: async () => ({
        ok: false,
        code: 'unavailable',
        message: 'scratch workspace requires the desktop app'
      }),
      remove: async () => false,
      gitStatus: async () => null,
      paths: async (projectId: string, opts?: {
        query?: string;
        limit?: number;
        includeFiles?: boolean;
        includeDirectories?: boolean;
      }) => {
        const params = new URLSearchParams();
        if (opts?.query) params.set('query', opts.query);
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.includeFiles === false) params.set('includeFiles', 'false');
        if (opts?.includeDirectories === false) params.set('includeDirectories', 'false');
        const suffix = params.toString();
        return apiJson(`/projects/${encodeURIComponent(projectId)}/paths${suffix ? `?${suffix}` : ''}`);
      },
      onChanged: (cb: (projects: Project[]) => void) =>
        subscribeProductEvent<Project[]>('projects:changed', cb)
    } as unknown as CcApi['projects'],
    config: {
      get: async () => {
        const body = await apiJson<{ config: AppConfig }>('/config');
        return body.config;
      },
      set: async (patch) => {
        const body = await apiJson<{ config: AppConfig }>('/config', {
          method: 'PATCH',
          body: JSON.stringify(patch)
        });
        return body.config;
      },
      onChanged: (cb: (config: AppConfig) => void) =>
        subscribeProductEvent<AppConfig>('config:changed', cb)
    } as CcApi['config'],
    inbox: {
      history: async (opts) => {
        const params = new URLSearchParams();
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.before) params.set('before', opts.before);
        if (opts?.projectId) params.set('projectId', opts.projectId);
        const q = params.toString();
        return apiJson<{ entries: InboxEntry[]; hasMore: boolean }>(`/inbox${q ? `?${q}` : ''}`);
      },
      delete: async (id) => {
        const body = await apiJson<{ ok: boolean }>(`/inbox/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return body.ok;
      },
      deleteMany: async (ids) => {
        const body = await apiJson<{ removed: number }>('/inbox', {
          method: 'DELETE',
          body: JSON.stringify({ ids })
        });
        return body.removed;
      },
      onAppended: (cb: (entry: InboxEntry) => void) =>
        subscribeProductEvent<InboxEntry>('inbox:appended', cb),
      onRemoved: (cb: (id: string) => void) => subscribeProductEvent<string>('inbox:removed', cb),
      onUpdated: (cb: (entry: InboxEntry) => void) =>
        subscribeProductEvent<InboxEntry>('inbox:updated', cb),
      onPruned: (cb: (ids: string[]) => void) => subscribeProductEvent<string[]>('inbox:pruned', cb)
    } as CcApi['inbox'],
    suggestions: {
      list: async (projectId?: string) => {
        const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
        return apiJson<{ entries: Suggestion[]; hasMore: boolean }>(`/suggestions${q}`);
      },
      dismiss: async (id: string) => {
        const body = await apiJson<{ ok: boolean }>(`/suggestions/${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });
        return body.ok;
      },
      onAppended: (cb: (entry: Suggestion) => void) =>
        subscribeProductEvent<Suggestion>('suggestions:appended', cb),
      onRemoved: (cb: (id: string) => void) =>
        subscribeProductEvent<string>('suggestions:removed', cb),
      onUpdated: (cb: (entry: Suggestion) => void) =>
        subscribeProductEvent<Suggestion>('suggestions:updated', cb),
      onPruned: (cb: (ids: string[]) => void) =>
        subscribeProductEvent<string[]>('suggestions:pruned', cb)
    } as CcApi['suggestions'],
    followups: {
      list: async () => {
        const body = await apiJson<{ followups: FollowUp[] }>('/follow-ups');
        return body.followups;
      },
      setStatus: async (id, status, resolution) => {
        const body = await apiJson<{ followUp: FollowUp }>(`/follow-ups/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status, resolution })
        });
        return { ok: true, value: body.followUp };
      },
      markSpawned: async (id: string) => {
        const body = await apiJson<{ followUp: FollowUp }>(`/follow-ups/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ spawnedAt: new Date().toISOString() })
        });
        return { ok: true, value: body.followUp };
      },
      onChanged: (cb: (followups: FollowUp[]) => void) =>
        subscribeProductEvent<FollowUp[]>('followups:changed', cb)
    } as CcApi['followups'],
    saved: {
      list: async () => {
        const body = await apiJson<{ records: SavedRecord[] }>('/saved');
        return body.records;
      },
      save: async (input: SavedRecordInput) => {
        const body = await apiJson<{ record: SavedRecord }>('/saved', {
          method: 'POST',
          body: JSON.stringify(input)
        });
        return body.record;
      },
      delete: async (id: string) => {
        const body = await apiJson<{ ok: boolean }>(`/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return body.ok;
      },
      onChanged: (cb: (records: SavedRecord[]) => void) =>
        subscribeProductEvent<SavedRecord[]>('saved:changed', cb)
    } as CcApi['saved'],
    goals: {
      list: async () => {
        const body = await apiJson<{ goals: Goal[] }>('/goals');
        return body.goals;
      },
      onChanged: (cb: (goals: Goal[]) => void) => subscribeProductEvent<Goal[]>('goals:changed', cb)
    } as CcApi['goals'],
    scheduler: {
      list: async () => {
        const body = await apiJson<{ tasks: ScheduledTask[] }>('/scheduler');
        return body.tasks;
      },
      onChanged: (cb: (tasks: ScheduledTask[]) => void) =>
        subscribeProductEvent<ScheduledTask[]>('scheduler:changed', cb),
      create: async () => ({ ok: false, code: 'unavailable', message: 'scheduling requires the desktop app' }),
      update: async () => ({ ok: false, code: 'unavailable', message: 'scheduling requires the desktop app' }),
      delete: async () => ({ ok: false, code: 'unavailable', message: 'scheduling requires the desktop app' }),
      setEnabled: async () => ({ ok: false, code: 'unavailable', message: 'scheduling requires the desktop app' }),
      runNow: async () => ({ ok: false, code: 'unavailable', message: 'scheduling requires the desktop app' }),
      listTemplates: async () => [],
      onTemplatesChanged: noopSubscribe,
      revealTemplatesDir: async () => ({
        ok: false,
        path: '',
        message: 'schedule templates require the desktop app'
      }),
      groups: {
        list: async () => [],
        create: async () => ({ ok: false, code: 'unavailable', message: 'schedule groups require the desktop app' }),
        update: async () => ({ ok: false, code: 'unavailable', message: 'schedule groups require the desktop app' }),
        delete: async () => ({ ok: false, code: 'unavailable', message: 'schedule groups require the desktop app' }),
        reorder: async () => [],
        onChanged: noopSubscribe
      }
    } as CcApi['scheduler'],
    personas: {
      list: async () => {
        const body = await apiJson<{ personas: Persona[] }>('/personas');
        return body.personas;
      },
      onChanged: (cb: (personas: Persona[]) => void) =>
        subscribeProductEvent<Persona[]>('personas:changed', cb)
    } as CcApi['personas'],
    teams: {
      list: async () => {
        const body = await apiJson<{ teams: Team[] }>('/teams');
        return body.teams;
      },
      onChanged: noopSubscribe
    } as CcApi['teams'],
    agents: {
      list: async () => {
        const body = await apiJson<{ agents: AgentRecord[] }>('/agents');
        return body.agents;
      },
      messages: async () => {
        const body = await apiJson<{ messages: AgentMessage[] }>('/agents');
        return body.messages;
      },
      onRegistryChanged: (cb: () => void) =>
        subscribeProductEvent('agent-status:changed', () => cb()),
      onMessage: noopSubscribe,
      onMessagesPruned: noopSubscribe
    } as CcApi['agents'],
    terminals: {
      verifyTmux: async () => ({ installed: false, installHint: 'tmux requires the desktop app' }),
      listTmuxRestoreCandidates: async () => [],
      list: async () => {
        const body = await apiJson<{ sessions: TerminalSession[] }>('/terminals');
        return body.sessions;
      },
      restore: async () => ({
        ok: false,
        code: 'unavailable',
        message: 'restoring terminal tabs requires the desktop app'
      }),
      reconnectRemote: async () => ({
        ok: false,
        code: 'unavailable',
        message: 'reconnecting remote tabs requires the desktop app'
      }),
      create: async (req: CreateTerminalRequest): Promise<Result<TerminalSession>> => {
        const response = await fetchWithAppSurface('/api/v1/terminals', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req)
        });
        const body = (await response.json()) as Result<TerminalSession> & {
          code?: string;
          message?: string;
        };
        if (response.ok && body.ok) return body;
        return {
          ok: false,
          code: body.code ?? 'launch-unavailable',
          message: body.message ?? 'terminal launch is not available'
        };
      },
      setActiveSession: async () => {},
      setFavorites: async () => {},
      setHeartbeat: async () => null,
      setHeadless: async () => null,
      backlog: async () => '',
      onData: (cb) => subscribeProductEvent<{ sessionId: string; data: string }>('terminals:data', (payload) => {
        cb(payload.sessionId, payload.data);
      }),
      onUpdated: (cb) => subscribeProductEvent('terminals:updated', (payload) => {
        if (payload && typeof payload === 'object' && 'id' in payload) {
          cb(payload as TerminalSession);
        }
      }),
      onExit: (cb) => subscribeProductEvent<{ sessionId: string; code: number }>('terminals:exit', (payload) => {
        cb(payload.sessionId, payload.code);
      }),
      onWake: noopSubscribe,
      onTitle: noopSubscribe,
      onAgentStatus: noopSubscribe,
      onSubagents: noopSubscribe,
      onSubagentChildren: noopSubscribe,
      onIdleTriage: noopSubscribe,
      onCatchUpSummary: noopSubscribe,
      onOverseerActivity: noopSubscribe,
      agentStatusSnapshot: async () => [],
      agentStatusSince: async () => ({ mode: 'replay' as const, events: [], headSeq: 0 }),
      subagentSnapshot: async () => [],
      subagentChildrenSnapshot: async () => [],
      generateCatchUpSummary: async () => {
        throw new Error('generateCatchUpSummary requires the desktop app');
      },
      clearAgentBlocked: async () => false,
      summarizeIdle: async () => ({ summarized: 0 }),
      summarizeSession: async () => ({ ok: false as const, reason: 'ineligible' as const }),
      sessionStats: async () => null,
      closeFollowup: async () => ({ summarized: 0, followedUp: 0 }),
      resize: async (sessionId, cols, rows) => {
        await apiJson(`/terminals/${encodeURIComponent(sessionId)}/resize`, {
          method: 'POST',
          body: JSON.stringify({ cols, rows })
        });
      },
      write: async (sessionId, data) => {
        await apiJson(`/terminals/${encodeURIComponent(sessionId)}/input`, {
          method: 'POST',
          body: JSON.stringify({ data })
        });
      },
      reply: async () => false,
      close: async (sessionId) => {
        const response = await fetchWithAppSurface(`/api/v1/terminals/${encodeURIComponent(sessionId)}/close`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        });
        return response.ok;
      }
    } as CcApi['terminals'],
    hosts: {
      createJoinCode: async () => apiJson('/hosts/join-codes', { method: 'POST', body: '{}' }),
      list: async () => apiJson<Host[]>('/hosts'),
      get: async (id) => apiJson<Host>(`/hosts/${encodeURIComponent(id)}`),
      update: async (id, patch) => apiJson<Host>(`/hosts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      }),
      updatePermissionCeiling: async (id, maxPermissionMode) => apiJson<Host>(
        `/hosts/${encodeURIComponent(id)}/permission-ceiling`,
        { method: 'PATCH', body: JSON.stringify({ maxPermissionMode }) }
      ),
      retryUpdate: async (id) => apiJson(`/hosts/${encodeURIComponent(id)}/retry-update`, {
        method: 'POST',
        body: '{}'
      }),
      remove: async (id) => apiJson(`/hosts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: '{}'
      }),
      directory: async (id, path) => {
        const query = path ? `?path=${encodeURIComponent(path)}` : '';
        return apiJson(`/hosts/${encodeURIComponent(id)}/directory${query}`);
      },
      pathsExist: async (id, paths) => apiJson(`/hosts/${encodeURIComponent(id)}/paths/exist`, {
        method: 'POST',
        body: JSON.stringify({ paths })
      }),
      pickFolder: async (id, clientHostId) => apiJson(`/hosts/${encodeURIComponent(id)}/pick-folder`, {
        method: 'POST',
        body: JSON.stringify({ clientHostId })
      }),
      cloneDefaultPath: async (id, projectId) => apiJson(
        `/hosts/${encodeURIComponent(id)}/clone-default-path?projectId=${encodeURIComponent(projectId)}`
      ),
      providerCliStatus: async (id) => apiJson(`/hosts/${encodeURIComponent(id)}/provider-clis/status`),
      installProviderCli: async (id, request) => {
        const response = await fetchWithAppSurface(
          `/api/v1/hosts/${encodeURIComponent(id)}/provider-clis/install`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
          }
        );
        if (!response.ok) {
          let detail = `${response.status}`;
          try {
            const body = (await response.json()) as { error?: string; message?: string };
            detail = body.message ?? body.error ?? detail;
          } catch {
            /* keep status */
          }
          throw new Error(detail);
        }
        const text = await response.text();
        return text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Awaited<ReturnType<CcApi['hosts']['installProviderCli']>>[number]);
      },
      bootstrap: async (projectId) => {
        const response = await fetchWithAppSurface('/api/v1/hosts/bootstrap', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId })
        });
        if (!response.ok) {
          let detail = `${response.status}`;
          try {
            const body = (await response.json()) as { error?: string; message?: string };
            detail = body.message ?? body.error ?? detail;
          } catch {
            /* keep status */
          }
          throw new Error(detail);
        }
        const text = await response.text();
        return text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Awaited<ReturnType<CcApi['hosts']['bootstrap']>>[number]);
      },
      repair: async (id) => {
        const response = await fetchWithAppSurface(
          `/api/v1/hosts/${encodeURIComponent(id)}/repair`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
        );
        if (!response.ok) {
          let detail = `${response.status}`;
          try {
            const body = (await response.json()) as { error?: string; message?: string };
            detail = body.message ?? body.error ?? detail;
          } catch {
            /* keep status */
          }
          throw new Error(detail);
        }
        const text = await response.text();
        return text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Awaited<ReturnType<CcApi['hosts']['repair']>>[number]);
      },
      updateSshIdentity: async (id, patch) => apiJson<Host>(
        `/hosts/${encodeURIComponent(id)}/ssh-identity`,
        { method: 'PATCH', body: JSON.stringify(patch) }
      ),
      onChanged: (cb) => subscribeProductEvent<Host[] | undefined>('hosts:changed', cb),
      relaunchLocal: async () => apiJson<{ ok: true } | { ok: false; message: string }>(
        '/hosts/relaunch-local',
        { method: 'POST', body: '{}' }
      ),
      pairing: {
        start: async () => ({ ok: false as const, message: 'SSH pairing requires the desktop app' }),
        write: async () => undefined,
        resize: async () => undefined,
        stop: async () => undefined,
        status: async () => ({ running: false, sshHost: null, backlog: '', exitCode: null }),
        onData: () => () => {},
        onExit: () => () => {}
      }
    } as CcApi['hosts'],
    relay: {
      status: async () => apiJson<{
        state: 'connected' | 'offline' | 'unconfigured';
        sessionId?: string;
        joinUntil?: number;
      }>('/relay'),
      renewJoinWindow: async () => apiJson<{
        state: 'connected' | 'offline' | 'unconfigured';
        sessionId?: string;
        joinUntil?: number;
      }>('/relay/renew-join', { method: 'POST', body: '{}' }),
      onChanged: (cb) => subscribeProductEvent<{
        state: 'connected' | 'offline' | 'unconfigured';
        sessionId?: string;
        joinUntil?: number;
      }>('relay:changed', cb)
    } as CcApi['relay'],
    marketplaces: {
      list: async () => {
        const body = await apiJson<{ catalogs: Awaited<ReturnType<CcApi['marketplaces']['list']>> }>('/marketplaces');
        return body.catalogs;
      },
      add: async (source) => apiJson('/marketplaces', {
        method: 'POST',
        body: JSON.stringify({ source })
      }),
      refresh: async (source) => apiJson('/marketplaces/refresh', {
        method: 'POST',
        body: JSON.stringify({ source })
      }),
      remove: async (source) => apiJson('/marketplaces/remove', {
        method: 'POST',
        body: JSON.stringify({ source })
      })
    },
    cliSkills: {
      status: async (hostIds) => {
        const suffix = hostIds && hostIds.length > 0
          ? `?hostIds=${encodeURIComponent(hostIds.join(','))}`
          : '';
        return apiJson(`/system/cli-skills${suffix}`);
      },
      install: async (hostIds) => apiJson('/system/cli-skills/install', {
        method: 'POST',
        body: JSON.stringify({ hostIds })
      })
    },
    threads: {
      create: async (input) => {
        const response = await fetchWithAppSurface('/api/v1/threads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId: input.projectId,
            providerId: input.providerId,
            input: input.input ?? [],
            hostId: input.hostId,
            environment: input.environment,
            cwd: input.cwd,
            title: input.title,
            permissionMode: input.permissionMode,
            model: input.model,
            reasoningLevel: input.reasoningLevel,
            acpMode: input.acpMode
          })
        });
        const body = (await response.json()) as Awaited<ReturnType<CcApi['threads']['create']>> & {
          code?: string;
          message?: string;
          error?: string;
        };
        if (response.ok && body.ok) return body;
        return {
          ok: false,
          code: body.code ?? 'thread-create-failed',
          message: body.message ?? body.error ?? 'thread create is not available'
        };
      },
      spawn: async (input) => httpProduct().threads.create(input),
      list: async (projectId) => {
        const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
        const body = await apiJson<{ threads: Awaited<ReturnType<CcApi['threads']['list']>> }>(`/threads${suffix}`);
        return body.threads;
      },
      get: async (threadId) => apiJson(`/threads/${encodeURIComponent(threadId)}`),
      send: async (threadId, input, mode, extras) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/send`, {
          method: 'POST',
          body: JSON.stringify({
            input,
            mode,
            ...(extras?.model ? { model: extras.model } : {}),
            ...(extras?.reasoningLevel ? { reasoningLevel: extras.reasoningLevel } : {})
            , ...(extras?.acpMode ? { acpMode: extras.acpMode } : {})
          })
        }),
      stop: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/stop`, { method: 'POST', body: '{}' }),
      cancelPlan: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/plan/cancel`, { method: 'POST', body: '{}' }),
      resume: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/resume`, { method: 'POST', body: '{}' }),
      timeline: async (threadId, query) => {
        const params = new URLSearchParams();
        if (query?.segmentLimit) params.set('segmentLimit', String(query.segmentLimit));
        if (query?.beforeAnchorSeq) params.set('beforeAnchorSeq', String(query.beforeAnchorSeq));
        if (query?.beforeAnchorId) params.set('beforeAnchorId', query.beforeAnchorId);
        if (query?.afterSequence) params.set('afterSequence', query.afterSequence);
        if (query?.includeNestedRows) params.set('includeNestedRows', query.includeNestedRows);
        if (query?.summaryOnly) params.set('summaryOnly', query.summaryOnly);
        const suffix = params.size ? `?${params.toString()}` : '';
        return apiJson(`/threads/${encodeURIComponent(threadId)}/timeline${suffix}`);
      },
      read: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/read`, { method: 'POST', body: '{}' }),
      unread: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/unread`, { method: 'POST', body: '{}' }),
      rename: async (threadId, title) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title })
        }),
      conversationOutline: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/conversation-outline`),
      timelineTurnSummaryDetails: async (threadId, query) => {
        const params = new URLSearchParams();
        params.set('turnId', query.turnId);
        params.set('sourceSeqStart', query.sourceSeqStart);
        params.set('sourceSeqEnd', query.sourceSeqEnd);
        return apiJson(`/threads/${encodeURIComponent(threadId)}/timeline/turn-summary-details?${params.toString()}`);
      },
      queuedMessages: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/queued-messages`),
      createQueuedMessage: async (threadId, body) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/queued-messages`, {
          method: 'POST',
          body: JSON.stringify(body)
        }),
      updateQueuedMessage: async (threadId, queuedMessageId, body) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/queued-messages/${encodeURIComponent(queuedMessageId)}`, {
          method: 'PATCH',
          body: JSON.stringify(body)
        }),
      deleteQueuedMessage: async (threadId, queuedMessageId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/queued-messages/${encodeURIComponent(queuedMessageId)}`, {
          method: 'DELETE'
        }),
      sendQueuedMessage: async (threadId, queuedMessageId, mode) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/queued-messages/${encodeURIComponent(queuedMessageId)}/send`, {
          method: 'POST',
          body: JSON.stringify({ mode })
        }),
      reorderQueuedMessage: async (threadId, queuedMessageId, previousQueuedMessageId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/queued-messages/${encodeURIComponent(queuedMessageId)}/order`, {
          method: 'PATCH',
          body: JSON.stringify({ previousQueuedMessageId })
        }),
      editMessage: async (threadId, body) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/edit-message`, {
          method: 'POST',
          body: JSON.stringify(body)
        }),
      hostFileContent: async (threadId, path) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/host-files/content?path=${encodeURIComponent(path)}`),
      storageFiles: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/thread-storage/files`),
      storageContent: async (threadId, path) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/thread-storage/content?path=${encodeURIComponent(path)}`),
      open: async (threadId, body) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/open`, {
          method: 'POST',
          body: JSON.stringify(body)
        }),
      onOpen: (cb) => subscribeProductEvent('threads:open', cb),
      events: async (threadId) => apiJson(`/threads/${encodeURIComponent(threadId)}/events`),
      executionOptions: async (query) => {
        const params = new URLSearchParams();
        if (query?.providerId) params.set('providerId', query.providerId);
        const suffix = params.size ? `?${params.toString()}` : '';
        return apiJson(`/system/execution-options${suffix}`);
      },
      providers: async () => apiJson('/threads/providers'),
      commands: async (projectId) =>
        apiJson(`/projects/${encodeURIComponent(projectId)}/commands`),
      onUpdated: (cb) => subscribeProductEvent('threads:updated', cb),
      onEvent: (cb) => subscribeProductEvent('threads:event', cb),
      interactions: {
        list: async (threadId) =>
          apiJson(`/threads/${encodeURIComponent(threadId)}/interactions`),
        get: async (threadId, interactionId) =>
          apiJson(`/threads/${encodeURIComponent(threadId)}/interactions/${encodeURIComponent(interactionId)}`),
        resolve: async (threadId, interactionId, resolution) =>
          apiJson(`/threads/${encodeURIComponent(threadId)}/interactions/${encodeURIComponent(interactionId)}/resolve`, {
            method: 'POST',
            body: JSON.stringify(resolution)
          }),
        respond: async (threadId, interactionId, value) =>
          apiJson(`/threads/${encodeURIComponent(threadId)}/interactions/${encodeURIComponent(interactionId)}/respond`, {
            method: 'POST',
            body: JSON.stringify({ value })
          }),
        cancel: async (threadId, interactionId) =>
          apiJson(`/threads/${encodeURIComponent(threadId)}/interactions/${encodeURIComponent(interactionId)}/cancel`, {
            method: 'POST',
            body: '{}'
          })
      },
      archive: async (threadId) => {
        const body = await apiJson<{ ok: boolean }>(`/threads/${encodeURIComponent(threadId)}/archive`, {
          method: 'POST',
          body: '{}'
        });
        return body;
      },
      closeFollowup: async (threadId) => {
        const body = await apiJson<{ ok: boolean; summarized: number; followedUp: number }>(
          `/threads/${encodeURIComponent(threadId)}/close-followup`,
          {
            method: 'POST',
            body: '{}'
          }
        );
        return body;
      },
      fork: async (threadId, options) => {
        const response = await fetchWithAppSurface(`/api/v1/threads/${encodeURIComponent(threadId)}/fork`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(options?.sourceSeqEnd != null ? { sourceSeqEnd: options.sourceSeqEnd } : {})
        });
        return (await response.json()) as Awaited<ReturnType<CcApi['threads']['fork']>>;
      }
    } as CcApi['threads'],
    environments: {
      list: async (projectId, hostId) => {
        const params = hostId ? `?hostId=${encodeURIComponent(hostId)}` : '';
        const body = await apiJson<{ environments: Awaited<ReturnType<CcApi['environments']['list']>> }>(
          `/projects/${encodeURIComponent(projectId)}/environments${params}`
        );
        return body.environments;
      },
      status: async (environmentId) => {
        return apiJson(`/environments/${encodeURIComponent(environmentId)}/status`);
      },
      diff: async (environmentId, target) => {
        const suffix = target ? `?target=${encodeURIComponent(JSON.stringify(target))}` : '';
        return apiJson(`/environments/${encodeURIComponent(environmentId)}/diff${suffix}`);
      },
      diffFiles: async (environmentId, target) => {
        const suffix = target ? `?target=${encodeURIComponent(JSON.stringify(target))}` : '';
        return apiJson(`/environments/${encodeURIComponent(environmentId)}/diff/files${suffix}`);
      },
      diffPatch: async (environmentId, body) =>
        apiJson(`/environments/${encodeURIComponent(environmentId)}/diff/patch`, {
          method: 'POST',
          body: JSON.stringify(body)
        }),
      pullRequest: async (environmentId) => {
        return apiJson(`/environments/${encodeURIComponent(environmentId)}/pull-request`);
      },
      action: async (environmentId, action) => {
        return apiJson(`/environments/${encodeURIComponent(environmentId)}/actions`, {
          method: 'POST',
          body: JSON.stringify(action)
        });
      },
      cancelProvision: async (environmentId) => {
        return apiJson(`/environments/${encodeURIComponent(environmentId)}/provision/cancel`, {
          method: 'POST',
          body: '{}'
        });
      },
      destroy: async (environmentId) => {
        return apiJson(`/environments/${encodeURIComponent(environmentId)}`, {
          method: 'DELETE'
        });
      }
    } as CcApi['environments'],
    harness: {
      verify: async () => {
        const body = await apiJson<{ results: Awaited<ReturnType<CcApi['harness']['verify']>> }>('/harness/verify');
        return body.results;
      },
      descriptors: async () => {
        const body = await apiJson<{ descriptors: Awaited<ReturnType<CcApi['harness']['descriptors']>> }>(
          '/harness/descriptors'
        );
        return body.descriptors;
      },
      agentDescriptors: async (projectId, profile, refresh = false) => {
        const params = new URLSearchParams({ projectId, profile });
        if (refresh) params.set('refresh', 'true');
        return apiJson<Awaited<ReturnType<CcApi['harness']['agentDescriptors']>>>(
          `/harness/agent-descriptors?${params.toString()}`
        );
      },
      effectiveDefault: async (projectId: string) =>
        apiJson<Awaited<ReturnType<CcApi['harness']['effectiveDefault']>>>(
          `/harness/effective-default?projectId=${encodeURIComponent(projectId)}`
        )
    } as CcApi['harness'],
    library: {
      list: async () => {
        const body = await apiJson<{ docs: Awaited<ReturnType<CcApi['library']['list']>> }>('/library');
        return body.docs;
      },
      read: async (scope, relPath, projectId) => {
        const params = new URLSearchParams({ scope, relPath });
        if (projectId) params.set('projectId', projectId);
        return apiJson<Awaited<ReturnType<CcApi['library']['read']>>>(`/library/content?${params.toString()}`);
      },
      onChanged: (cb) => subscribeProductEvent('library:changed', cb)
    } as CcApi['library'],
    quickPrompts: {
      list: async () => {
        const body = await apiJson<{ prompts: Awaited<ReturnType<CcApi['quickPrompts']['list']>> }>('/quick-prompts');
        return body.prompts;
      },
      onChanged: noopSubscribe
    } as CcApi['quickPrompts'],
    fs: {
      listDir: async (path) => {
        const body = await apiJson<{ entries: FsEntry[] }>('/fs/list-dir', {
          method: 'POST',
          body: JSON.stringify({ path })
        });
        return body.entries;
      },
      readFile: async (path) => {
        try {
          return await apiJson<FsReadResult>('/fs/read', {
            method: 'POST',
            body: JSON.stringify({ path })
          });
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      }
    } as CcApi['fs'],
    files: {
      pathForFile: (_file: File) => {
        throw new Error('pathForFile requires the desktop app');
      },
      read: async (input) => apiJson('/files/read', {
        method: 'POST',
        body: JSON.stringify(input)
      }),
      list: async (input) => apiJson('/files/list', {
        method: 'POST',
        body: JSON.stringify(input)
      }),
      listPaths: async (input) => apiJson('/files/paths', {
        method: 'POST',
        body: JSON.stringify(input)
      })
    },
    pluginApps: {
      list: async () => {
        const body = await apiJson<{ apps?: PluginAppEntry[] }>('/plugin-apps');
        return Array.isArray(body.apps) ? body.apps : [];
      },
      setEnabled: async (id, enabled) => {
        try {
          await apiJson(`/plugin-apps/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, {
            method: 'POST',
            body: '{}'
          });
          const body = await apiJson<{ apps?: PluginAppEntry[] }>('/plugin-apps');
          emitPluginApps(Array.isArray(body.apps) ? body.apps : []);
          return { ok: true as const, value: true as const };
        } catch (error) {
          return {
            ok: false as const,
            code: 'WRITE_FAILED',
            message: error instanceof Error ? error.message : String(error)
          };
        }
      },
      checkUpdates: async () => {
        const body = await apiJson<{ updates?: Array<{
          id: string;
          current: string;
          available: string;
          marketplace: string;
        }> }>('/plugin-apps/updates');
        const listed = await apiJson<{ apps?: PluginAppEntry[] }>('/plugin-apps');
        emitPluginApps(Array.isArray(listed.apps) ? listed.apps : []);
        return Array.isArray(body.updates) ? body.updates : [];
      },
      applyUpdate: async (id) => {
        try {
          await apiJson(`/plugin-apps/${encodeURIComponent(id)}/update`, {
            method: 'POST',
            body: '{}'
          });
          const listed = await apiJson<{ apps?: PluginAppEntry[] }>('/plugin-apps');
          emitPluginApps(Array.isArray(listed.apps) ? listed.apps : []);
          return { ok: true as const, value: true as const };
        } catch (error) {
          return {
            ok: false as const,
            code: 'WRITE_FAILED',
            message: error instanceof Error ? error.message : String(error)
          };
        }
      },
      remove: async (id) => {
        try {
          await apiJson(`/plugin-apps/${encodeURIComponent(id)}/remove`, {
            method: 'POST',
            body: '{}'
          });
          const listed = await apiJson<{ apps?: PluginAppEntry[] }>('/plugin-apps');
          emitPluginApps(Array.isArray(listed.apps) ? listed.apps : []);
          return { ok: true as const, value: true as const };
        } catch (error) {
          return {
            ok: false as const,
            code: 'WRITE_FAILED',
            message: error instanceof Error ? error.message : String(error)
          };
        }
      },
      reload: async (id) => {
        try {
          await apiJson(`/plugin-apps/${encodeURIComponent(id)}/reload`, {
            method: 'POST',
            body: '{}'
          });
          const listed = await apiJson<{ apps?: PluginAppEntry[] }>('/plugin-apps');
          emitPluginApps(Array.isArray(listed.apps) ? listed.apps : []);
          return { ok: true as const, value: true as const };
        } catch (error) {
          return {
            ok: false as const,
            code: 'WRITE_FAILED',
            message: error instanceof Error ? error.message : String(error)
          };
        }
      },
      callRpc: async (pluginId, method, args) => {
        const body = await apiJson<{ value?: unknown }>(
          `/plugin-apps/${encodeURIComponent(pluginId)}/rpc`,
          {
            method: 'POST',
            body: JSON.stringify({ method, args })
          }
        );
        return body.value;
      },
      getSettings: async (pluginId) =>
        apiJson(`/plugin-apps/${encodeURIComponent(pluginId)}/settings`),
      setSettings: async (pluginId, values) => {
        const payload: Record<string, string | boolean | null> = {};
        for (const [key, value] of Object.entries(values)) {
          payload[key] = value === undefined ? null : value;
        }
        return apiJson(`/plugin-apps/${encodeURIComponent(pluginId)}/settings`, {
          method: 'POST',
          body: JSON.stringify({ values: payload })
        });
      },
      onChanged: (cb) => {
        pluginAppListeners.add(cb);
        return () => {
          pluginAppListeners.delete(cb);
        };
      }
    } as CcApi['pluginApps'],
    voice: {
      hasApiKey: async () => {
        const body = await apiJson<{ enabled: boolean }>('/system/voice-status');
        return body.enabled;
      },
      ensureMicAccess: async () => true,
      transcribe: async (audio, mimeType) => {
        const started = Date.now();
        try {
          const binary = atob(audio);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const form = new FormData();
          form.set('file', new Blob([bytes], { type: mimeType }), 'recording.webm');
          const response = await fetchWithAppSurface('/api/v1/system/voice-transcription', {
            method: 'POST',
            body: form
          });
          if (!response.ok) {
            let detail = `${response.status}`;
            try {
              const body = (await response.json()) as { error?: string; message?: string };
              detail = body.message ?? body.error ?? detail;
            } catch {
              /* keep status */
            }
            return { ok: false, text: '', error: detail, ms: Date.now() - started };
          }
          const body = (await response.json()) as { text?: string };
          return { ok: true, text: (body.text ?? '').trim(), ms: Date.now() - started };
        } catch (error) {
          return {
            ok: false,
            text: '',
            error: error instanceof Error ? error.message : String(error),
            ms: Date.now() - started
          };
        }
      }
    },
    extensions: {
      list: async () => {
        const body = await apiJson<{ extensions: unknown[] }>('/extensions');
        return body.extensions as Awaited<ReturnType<CcApi['extensions']['list']>>;
      },
      onChanged: noopSubscribe
    } as CcApi['extensions'],
    updates: {
      check: async () => {
        throw new Error('updates.check requires the desktop app');
      },
      download: async () => {
        throw new Error('updates.download requires the desktop app');
      },
      skip: async () => {
        throw new Error('updates.skip requires the desktop app');
      },
      quitAndInstall: async () => {
        throw new Error('updates.quitAndInstall requires the desktop app');
      },
      simulate: async () => {
        throw new Error('updates.simulate requires the desktop app');
      },
      getStatus: async () => ({ kind: 'idle' as const }),
      onStatus: noopSubscribe,
      onProgress: noopSubscribe,
      consumeWhatsNew: async () => null,
      getReleaseNotes: async () => []
    } as CcApi['updates'],
    app: {
      isFullScreen: async () => false,
      setFullScreen: async () => {},
      onFullScreenChanged: noopSubscribe,
      onMenuEvent: noopSubscribe,
      onFavoritesChanged: noopSubscribe,
      onFocusSession: noopSubscribe,
      onOpenScheduler: noopSubscribe,
      onOpenAgents: noopSubscribe,
      onFocusInboxEntry: noopSubscribe,
      homedir: async () => '',
      version: async () => '',
      microVmSupported: async () => false
    } as CcApi['app']
  };
}

function withStubs<T extends object>(family: string, impl: T): T {
  return new Proxy(impl, {
    get(target, method: string | symbol) {
      if (typeof method === 'string' && method in target) {
        return (target as Record<string, unknown>)[method];
      }
      const name = String(method);
      if (name.startsWith('on')) return noopSubscribe;
      return async () => {
        throw new Error(`${family}.${name} is unavailable in the browser`);
      };
    }
  });
}

function stubFamily(family: string): unknown {
  return withStubs(family, {});
}

/**
 * Product I/O adapter. Desktop keeps talking to the preload bridge. A browser
 * tab uses loopback `/api/v1` + `/ws` and never receives a `window.cc` stand-in.
 */
export const product: CcApi = new Proxy({} as CcApi, {
  get(_target, family: string | symbol) {
    const name = String(family);
    if (name === 'hosts') {
      const http = httpProduct().hosts;
      if (hasDesktopBridge()) {
        const desktop = (window.cc as unknown as CcApi).hosts;
        return withStubs('hosts', {
          ...http,
          relaunchLocal: desktop?.relaunchLocal ?? http.relaunchLocal,
          pairing: desktop?.pairing ?? http.pairing
        });
      }
      return withStubs('hosts', http);
    }
    if (name === 'threads' || name === 'environments' || name === 'relay' || name === 'marketplaces' || name === 'cliSkills') {
      const http = httpProduct() as unknown as Record<string, unknown>;
      return withStubs(name, http[name] as object);
    }
    if (name === 'files') {
      const http = httpProduct().files;
      if (hasDesktopBridge()) {
        const desktop = (window.cc as unknown as CcApi).files;
        return {
          ...http,
          pathForFile: desktop?.pathForFile ?? ((file: File) => {
            throw new Error('pathForFile requires the desktop app');
          })
        };
      }
      return {
        ...http,
        pathForFile: (_file: File) => {
          throw new Error('pathForFile requires the desktop app');
        }
      };
    }
    if (name === 'voice') {
      const http = httpProduct().voice;
      if (hasDesktopBridge()) {
        const desktop = (window.cc as unknown as CcApi).voice;
        return {
          transcribe: http.transcribe,
          hasApiKey: http.hasApiKey,
          ensureMicAccess: desktop?.ensureMicAccess ?? http.ensureMicAccess
        };
      }
      return http;
    }
    if (hasDesktopBridge()) {
      const desktop = (window.cc as unknown as Record<string, unknown>)[name];
      if (name === 'projects') {
        return wrapDesktopProjects(desktop as CcApi['projects']);
      }
      return desktop;
    }
    const http = httpProduct() as unknown as Record<string, unknown>;
    const impl = http[String(family)];
    return impl ? withStubs(String(family), impl as object) : stubFamily(String(family));
  }
});

function wrapDesktopProjects(desktop: CcApi['projects']): CcApi['projects'] {
  const http = httpProduct().projects;
  return {
    ...desktop,
    add: async (path, opts) => {
      if (opts?.hostId) {
        const project = await http.add(path, opts) as unknown as Project;
        return { ok: true as const, value: project };
      }
      return desktop.add(path, opts);
    },
    clone: http.clone,
    onCloneProgress: http.onCloneProgress,
    cloneRoot: async () => {
      const fromDesktop = await desktop.cloneRoot().catch(() => '');
      if (fromDesktop) return fromDesktop;
      return http.cloneRoot();
    },
    paths: http.paths
  };
}
