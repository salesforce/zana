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
  TerminalSession
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
      clone: async () => ({ ok: false, code: 'unavailable', message: 'clone requires the desktop app' }),
      onCloneProgress: noopSubscribe,
      cloneRoot: async () => '',
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
        subscribeProductEvent<ScheduledTask[]>('scheduler:changed', cb)
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
      onData: noopSubscribe,
      onUpdated: noopSubscribe,
      onExit: noopSubscribe
    } as CcApi['terminals'],
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
    if (hasDesktopBridge()) {
      return (window.cc as unknown as Record<string, unknown>)[String(family)];
    }
    const http = httpProduct() as unknown as Record<string, unknown>;
    const impl = http[String(family)];
    return impl ? withStubs(String(family), impl as object) : stubFamily(String(family));
  }
});
