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
  | 'voice'
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
            model: input.model
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
      send: async (threadId, input, mode) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/send`, {
          method: 'POST',
          body: JSON.stringify({ input, mode })
        }),
      stop: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/stop`, { method: 'POST', body: '{}' }),
      resume: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/resume`, { method: 'POST', body: '{}' }),
      timeline: async (threadId, query) => {
        const params = new URLSearchParams();
        if (query?.segmentLimit) params.set('segmentLimit', String(query.segmentLimit));
        if (query?.beforeAnchorSeq) params.set('beforeAnchorSeq', String(query.beforeAnchorSeq));
        if (query?.beforeAnchorId) params.set('beforeAnchorId', query.beforeAnchorId);
        const suffix = params.size ? `?${params.toString()}` : '';
        return apiJson(`/threads/${encodeURIComponent(threadId)}/timeline${suffix}`);
      },
      read: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/read`, { method: 'POST', body: '{}' }),
      conversationOutline: async (threadId) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/conversation-outline`),
      hostFileContent: async (threadId, path) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}/host-files/content?path=${encodeURIComponent(path)}`),
      events: async (threadId) => apiJson(`/threads/${encodeURIComponent(threadId)}/events`),
      providers: async () => apiJson('/threads/providers'),
      commands: async (projectId) =>
        apiJson(`/projects/${encodeURIComponent(projectId)}/commands`),
      onUpdated: (cb) => subscribeProductEvent('threads:updated', cb),
      onEvent: (cb) => subscribeProductEvent('threads:event', cb),
      archive: async (threadId) => {
        const body = await apiJson<{ ok: boolean }>(`/threads/${encodeURIComponent(threadId)}/archive`, {
          method: 'POST',
          body: '{}'
        });
        return body;
      },
      fork: async (threadId) => {
        const response = await fetchWithAppSurface(`/api/v1/threads/${encodeURIComponent(threadId)}/fork`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        });
        return (await response.json()) as Awaited<ReturnType<CcApi['threads']['fork']>>;
      },
      update: async (threadId, patch) =>
        apiJson(`/threads/${encodeURIComponent(threadId)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch)
        })
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
