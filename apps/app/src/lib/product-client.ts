import type { CcApi } from '@zana-ai/zcc-desktop-contract';
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
  FsReadResult
} from '@zana-ai/zcc-domain/product';
import { hasDesktopBridge } from './app-surface.js';
import { apiJson, fetchWithAppSurface } from './fetch-with-app-surface.js';
import { subscribeProductEvent } from './product-ws.js';
import {
  forgetHostThread,
  isHostThread,
  rememberHostThread,
  threadEventToTerminalData,
  threadEventToTerminalExit
} from './host-thread-session.js';

function noopSubscribe(_cb: unknown): () => void {
  return () => {};
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
  | 'pluginApps'
  | 'extensions'
  | 'updates'
  | 'app'
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
      add: async (path: string) => {
        const body = await apiJson<{ project: Project }>('/projects', {
          method: 'POST',
          body: JSON.stringify({ path })
        });
        return body.project;
      },
      update: async (id, patch) => {
        const body = await apiJson<{ project: Project }>(`/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch)
        });
        return body.project;
      },
      reorder: async () => httpProduct().projects.list(),
      pickDirectory: async () => null,
      addRemote: async () => ({ ok: false, code: 'unavailable', message: 'remote projects require the desktop app' }),
      clone: async (input) => {
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
      onCloneProgress: (cb) => subscribeProductEvent('projects:cloneProgress', (payload) => {
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
      onChanged: (cb: (projects: Project[]) => void) =>
        subscribeProductEvent<Project[]>('projects:changed', cb)
    } as CcApi['projects'],
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
      listTemplates: async () => [],
      onTemplatesChanged: noopSubscribe,
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
      list: async () => {
        const body = await apiJson<{ sessions: TerminalSession[] }>('/terminals');
        return body.sessions;
      },
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
      setHeartbeat: async () => {},
      backlog: async (sessionId) => {
        try {
          const body = await apiJson<{ output: string }>(
            `/threads/${encodeURIComponent(sessionId)}/output`
          );
          return body.output;
        } catch {
          return '';
        }
      },
      onData: (cb) => subscribeProductEvent('threads:event', (payload) => {
        const chunk = threadEventToTerminalData(payload);
        if (chunk) cb(chunk.sessionId, chunk.data);
      }),
      onUpdated: noopSubscribe,
      onExit: (cb) => subscribeProductEvent('threads:event', (payload) => {
        const exit = threadEventToTerminalExit(payload);
        if (exit) cb(exit.sessionId, exit.code);
      }),
      resize: async (sessionId, cols, rows) => {
        await apiJson(`/threads/${encodeURIComponent(sessionId)}/resize`, {
          method: 'POST',
          body: JSON.stringify({ cols, rows })
        });
      },
      write: async (sessionId, data) => {
        await apiJson(`/threads/${encodeURIComponent(sessionId)}/input`, {
          method: 'POST',
          body: JSON.stringify({ data })
        });
      },
      reply: async (sessionId, text) => {
        try {
          await apiJson(`/threads/${encodeURIComponent(sessionId)}/reply`, {
            method: 'POST',
            body: JSON.stringify({ text })
          });
          return true;
        } catch {
          return false;
        }
      },
      close: async (sessionId) => {
        try {
          const response = await fetchWithAppSurface(
            `/api/v1/threads/${encodeURIComponent(sessionId)}/archive`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}'
            }
          );
          // Unknown thread = already gone. Treat as closed so a stale board
          // card can drop without looking like a live remote session.
          if (response.ok || response.status === 404) {
            forgetHostThread(sessionId);
            return true;
          }
          return false;
        } catch {
          return false;
        }
      }
    } as CcApi['terminals'],
    threads: {
      spawn: async (input) => {
        const response = await fetchWithAppSurface('/api/v1/threads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId: input.projectId,
            providerId: input.providerId,
            input: input.input == null ? [] : Array.isArray(input.input) ? input.input : [input.input],
            hostId: input.hostId,
            environment: input.environment,
            cwd: input.cwd,
            title: input.title,
            extraArgs: input.extraArgs,
            harnessRouting: input.harnessRouting,
            personaId: input.personaId,
            headless: input.headless,
            scheduled: input.scheduled,
            autoCloseOnFinish: input.autoCloseOnFinish,
            inboxLevel: input.inboxLevel,
            autonomous: input.autonomous,
            resumeSessionId: input.resumeSessionId,
            executionEnvironment: input.executionEnvironment,
            sandboxDenyNetwork: input.sandboxDenyNetwork,
            microVmImage: input.microVmImage,
            microVmCpus: input.microVmCpus,
            microVmMemoryMib: input.microVmMemoryMib,
            reconnectTmuxId: input.reconnectTmuxId,
            resume: input.resume,
            cohort: input.cohort
          })
        });
        const body = (await response.json()) as Awaited<ReturnType<CcApi['threads']['spawn']>> & {
          code?: string;
          message?: string;
        };
        if (response.ok && body.ok) return body;
        return {
          ok: false,
          code: body.code ?? 'thread-create-failed',
          message: body.message ?? 'thread spawn is not available'
        };
      },
      list: async (projectId) => {
        const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
        const body = await apiJson<{ threads: Awaited<ReturnType<CcApi['threads']['list']>> }>(`/threads${suffix}`);
        return body.threads;
      },
      onUpdated: (cb) => subscribeProductEvent('threads:updated', cb),
      archive: async (threadId) => {
        const body = await apiJson<{ ok: boolean }>(`/threads/${encodeURIComponent(threadId)}/archive`, {
          method: 'POST',
          body: '{}'
        });
        return body;
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
      agentDescriptors: async () => ({ agents: [], unsupportedReason: 'unavailable in the browser' }),
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
    pluginApps: {
      list: async () => [],
      onChanged: noopSubscribe
    } as CcApi['pluginApps'],
    extensions: {
      list: async () => {
        const body = await apiJson<{ extensions: unknown[] }>('/extensions');
        return body.extensions as Awaited<ReturnType<CcApi['extensions']['list']>>;
      },
      onChanged: noopSubscribe
    } as CcApi['extensions'],
    updates: {
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
    if (name === 'threads' || name === 'environments') {
      const http = httpProduct() as unknown as Record<string, unknown>;
      return withStubs(name, http[name] as object);
    }
    if (hasDesktopBridge()) {
      const desktop = (window.cc as unknown as Record<string, unknown>)[name];
      if (name === 'terminals') {
        return wrapDesktopTerminals(desktop as CcApi['terminals']);
      }
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
    clone: http.clone,
    onCloneProgress: http.onCloneProgress,
    cloneRoot: async () => {
      const fromDesktop = await desktop.cloneRoot().catch(() => '');
      if (fromDesktop) return fromDesktop;
      return http.cloneRoot();
    }
  };
}

function wrapDesktopTerminals(desktop: CcApi['terminals']): CcApi['terminals'] {
  const http = httpProduct().terminals;
  return {
    ...desktop,
    write: async (sessionId, data) => {
      if (isHostThread(sessionId)) return http.write(sessionId, data);
      return desktop.write(sessionId, data);
    },
    reply: async (sessionId, text) => {
      if (isHostThread(sessionId)) return http.reply(sessionId, text);
      return desktop.reply(sessionId, text);
    },
    resize: async (sessionId, cols, rows) => {
      if (isHostThread(sessionId)) return http.resize(sessionId, cols, rows);
      return desktop.resize(sessionId, cols, rows);
    },
    backlog: async (sessionId) => {
      if (isHostThread(sessionId)) return http.backlog(sessionId);
      return desktop.backlog(sessionId);
    },
    close: async (sessionId) => {
      if (isHostThread(sessionId)) return http.close(sessionId);
      return desktop.close(sessionId);
    },
    onData: (cb) => {
      const offDesktop = desktop.onData(cb);
      const offHttp = http.onData(cb);
      return () => {
        offDesktop();
        offHttp();
      };
    },
    onExit: (cb) => {
      const offDesktop = desktop.onExit(cb);
      const offHttp = http.onExit(cb);
      return () => {
        offDesktop();
        offHttp();
      };
    }
  };
}
