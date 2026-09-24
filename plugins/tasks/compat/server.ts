import { z } from 'zod';
/** BB Tasks domain adapter. Host authority remains in the public Zana SDK. */
import type { ZccPluginApi, PluginDatabase as ZccDatabase, PluginSdkThreadSummary } from '@zana-ai/zcc-plugin-sdk';
import type { PluginRpcContract } from '@zana-ai/zcc-plugin-sdk';
// Keep the packaged server self-contained; contracts are an identity helper.
export function defineRpcContract<const Contract extends PluginRpcContract>(contract: Contract): Contract { return contract; }
export type { PluginRpcHandlers, PluginCliContext, PluginCliResult } from '@zana-ai/zcc-plugin-sdk';
export type { PluginMessageDirectiveProps, PluginThreadPanelProps } from '@zana-ai/zcc-plugin-sdk/app';
export interface PluginMentionItem { id: string; title: string; subtitle?: string }

type Params<T> = T extends unknown[] ? T : [T];
export function adaptDatabase(db: ZccDatabase) {
  return {
    exec: (sql: string) => db.runScript(sql),
    pragma: (sql: string) => sql.includes('=') ? db.runScript(`PRAGMA ${sql}`) : db.prepare(`PRAGMA ${sql}`).all(),
    prepare<T = unknown[], R = Record<string, unknown>>(sql: string) {
      const stmt = db.prepare(sql);
      return {
        all: (...args: Params<T>) => stmt.all(...args) as R[],
        get: (...args: Params<T>) => stmt.get(...args) as R | undefined,
        run: (...args: Params<T>) => stmt.run(...args),
      };
    },
    transaction<A extends unknown[], R>(fn: (...args: A) => R) {
      return (...args: A): R => db.transaction(() => fn(...args));
    },
  };
}
export function normalizeThread(thread: PluginSdkThreadSummary | null) {
  if (!thread) throw Object.assign(new Error('Thread not found'), { code: 'thread_not_found' });
  const status = (['pending', 'starting', 'active', 'stopping', 'idle', 'error'] as const).find(status => status === thread.status) ?? 'error';
  return { ...thread, status, title: thread.title ?? null, titleFallback: thread.titleFallback ?? null,
    updatedAt: thread.updatedAt ?? thread.createdAt ?? 0, deletedAt: thread.deletedAt ?? null,
    originKind: thread.originKind ?? null, originPluginId: thread.originPluginId ?? null,
    visibility: thread.visibility ?? 'visible' };
}
type SpawnInput = Omit<Parameters<ZccPluginApi['sdk']['threads']['spawn']>[0], 'environment'> & {
  environment?: { type: 'project-default' } | { type: 'host'; hostId: string; workspace: {
    type: 'managed-worktree'; baseBranch: { kind: 'default' } | { kind: 'named'; name: string }
  }};
};
type HttpContext = {
  req: { query(): Record<string, string>; query(name: string): string | undefined; header(name: string): string | undefined; raw: Request };
  json(value: unknown, status?: number): Response;
};
const adapted = new WeakSet<object>();
export function adaptPluginApi(zcc: ZccPluginApi): BbPluginApi {
  if (adapted.has(zcc)) return zcc as unknown as BbPluginApi;
  const api = createPluginApi(zcc); adapted.add(api); return api;
}
function createPluginApi(zcc: ZccPluginApi) {
  const db = adaptDatabase(zcc.storage.database());
  return {
    ...zcc,
    rpc: { ...zcc.rpc, register(contract: unknown, handlers: Record<string, (input: never) => unknown>) {
      const schemas = contract as Record<string, { input: z.ZodType; output: z.ZodType }>;
      for (const [method, handler] of Object.entries(handlers)) {
        zcc.rpc.method(method, async input => {
          const parsed = schemas[method]!.input.safeParse(input ?? null);
          if (!parsed.success) throw Object.assign(new Error(parsed.error.message), { code: 'invalid_input' });
          let result: unknown;
          try { result = await handler(parsed.data as never); }
          catch (cause) { throw Object.assign(new Error(cause instanceof Error ? cause.message : String(cause)), { code: 'handler_error', cause }); }
          return schemas[method]!.output.parse(result);
        });
      }
    } },
    background: { ...zcc.background, service(name: string, service: { start(signal: AbortSignal): Promise<void> }) {
      zcc.background.service(name, () => {
        const controller = new AbortController();
        void service.start(controller.signal).catch(error => zcc.log.error(String(error)));
        return () => controller.abort();
      });
    } },
    storage: { ...zcc.storage, database: () => db },
    http: { route(method: Parameters<ZccPluginApi['http']['route']>[0], path: string,
      handler: (ctx: HttpContext) => Response | Promise<Response>, _options?: { auth: 'token' }) {
      zcc.http.route(method, path, async (request) => {
        const url = new URL(path, 'http://plugin.local');
        for (const [key, value] of Object.entries(request.query)) url.searchParams.set(key, value);
        const raw = new Request(url, { method, headers: request.headers,
          ...(method === 'GET' ? {} : { body: request.rawBody as BodyInit | undefined }) });
        const result = await handler({ req: { query: ((name?: string) => name === undefined ? request.query : request.query[name]) as HttpContext['req']['query'], header: name => raw.headers.get(name) ?? undefined, raw },
          json: (value, status = 200) => Response.json(value, { status }) });
        return { status: result.status, headers: Object.fromEntries(result.headers), body: new Uint8Array(await result.arrayBuffer()) };
      });
    } },
    ui: { ...zcc.ui, registerMentionProvider(reg: { id: string; label: string;
      search(ctx: { query: string; projectId: string | null }): PluginMentionItem[];
      resolve(id: string): { context: string } }) {
      zcc.ui.registerMentionProvider({ ...reg, search: ctx => reg.search({ query: typeof ctx === 'string' ? ctx : ctx.query,
        projectId: typeof ctx === 'string' ? null : ctx.projectId ?? null }).map(item => ({ id: item.id, label: [item.title, item.subtitle].filter(Boolean).join(' · ') })) });
    } },
    events: { on(name: Parameters<ZccPluginApi['events']['on']>[0], handler: (event: { thread: ReturnType<typeof normalizeThread> }) => void) {
      zcc.events.on(name, async event => {
        const thread = event.thread ?? await zcc.sdk.threads.get({ threadId: event.threadId });
        if (thread) handler({ thread: normalizeThread(thread) });
      });
    } },
    sdk: {
      ...zcc.sdk,
      system: { config: async () => ({ primaryHostId: (await zcc.sdk.system.defaultHost())?.id ?? null }) },
      projects: { list: (_args?: { includePersonal?: boolean }) => zcc.sdk.projects.list() },
      providers: { ...zcc.sdk.providers, list: async () => (await zcc.sdk.providers.list()).map(provider => ({ ...provider,
        displayName: provider.displayName ?? provider.id, logoUrl: provider.logoUrl ?? null, icon: provider.icon ? { glyph: provider.icon } : null, strings: { iconTint: provider.strings?.iconTint ? { light: provider.strings.iconTint, dark: provider.strings.iconTint } : null } })) },
      environments: { ...zcc.sdk.environments, pullRequest: async (args: { environmentId: string }) => {
        const result = await zcc.sdk.environments.pullRequest(args);
        if (result.unavailableReason) return { outcome: 'unavailable' as const };
        if (!result.pullRequest) return { outcome: 'absent' as const };
        const state = result.pullRequest.state.toLowerCase();
        return { outcome: 'found' as const, pullRequest: { ...result.pullRequest, updatedAt: result.pullRequest.updatedAt ?? '', state: result.pullRequest.isDraft ? 'draft' as const : state === 'merged' ? 'merged' as const : state === 'closed' ? 'closed' as const : 'open' as const } };
      } },
      threads: {
        ...zcc.sdk.threads,
        get: async (args: { threadId: string }) => normalizeThread(await zcc.sdk.threads.get(args)),
        list: async (args?: { limit?: number }) => (await zcc.sdk.threads.search({ query: '', limit: args?.limit })).map(normalizeThread),
        search: async (args: { query: string; limitPerGroup: string }) => {
          const group = async (archived: boolean) => ({ results: (await zcc.sdk.threads.search({
            query: args.query, archived, limit: Math.min(25, Number(args.limitPerGroup) || 10)
          })).map(t => ({ thread: normalizeThread(t) })) });
          const [active, archived] = await Promise.all([group(false), group(true)]);
          return { active, archived };
        },
        send: (args: { threadId: string; input: { type: 'text'; text: string; mentions: unknown[] }[]; mode: 'steer-if-active' }) =>
          zcc.sdk.threads.send({ threadId: args.threadId, prompt: args.input.map(row => row.text).join('\n'), mode: args.mode }),
        spawn: ({ environment, ...args }: SpawnInput) => zcc.sdk.threads.spawn({ ...args,
          ...(environment?.type === 'host' ? { hostId: environment.hostId, environment: { kind: 'worktree' as const,
            ...(environment.workspace.baseBranch.kind === 'named' ? { baseBranch: environment.workspace.baseBranch.name } : {}) } } : {}) }),
      },
    },
  };
}
export type BbPluginApi = ReturnType<typeof createPluginApi>;
