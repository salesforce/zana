import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { createFakePluginHost as createHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { adaptPluginApi, normalizeThread, type BbPluginApi } from './server';
import type { PluginSdkThreadSummary } from '@zana-ai/zcc-plugin-sdk';

export function makeThreadResponse(overrides: Partial<PluginSdkThreadSummary> = {}) {
  return normalizeThread({ id: 'thr_test', projectId: 'proj_test', hostId: 'host_test', environmentId: null,
    providerId: 'codex', status: 'idle', createdAt: 1, ...overrides });
}
type PartialSdk = { [K in keyof BbPluginApi['sdk']]?: Partial<BbPluginApi['sdk'][K]> };
export function createFakePluginHost(options: { pluginId?: string; sdk?: PartialSdk } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zcc-tasks-'));
  const db = createSqliteDatabase(join(root, 'tasks.db'));
  const host = createHost({ pluginId: options.pluginId ?? 'tasks', database: {
    runScript: sql => db.exec(sql), prepare: sql => db.prepare(sql), migrate: statements => statements.forEach(sql => db.exec(sql)),
    transaction: fn => db.transaction(fn)(),
  } });
  const bb = adaptPluginApi(host.zcc);
  const calls = new Map<string, unknown[][]>();
  const stubs = new Map<string, (...args: any[]) => any>();
  const defaults: PartialSdk = {
    system: { config: async () => ({ primaryHostId: 'host_test' }) },
    threads: { get: async ({ threadId }) => makeThreadResponse({ id: threadId }),
      spawn: async () => ({ id: 'thr_spawned' }), send: async ({ threadId }) => ({ id: threadId }), list: async () => [],
      search: async () => ({ active: { results: [] }, archived: { results: [] } }) },
    providers: { list: async () => [], models: async () => ({ models: [], selectedOnlyModels: [], modelLoadError: null }) },
    hosts: { list: async () => [] }, projects: { list: async () => [] },
    files: { read: async ({ path }) => { const { readFile } = await import('node:fs/promises'); const bytes = await readFile(path); return { content: bytes.toString('utf8'), contentEncoding: 'utf8', sizeBytes: bytes.length }; },
      write: async ({ path, content, contentEncoding }) => { const { writeFile } = await import('node:fs/promises'); await writeFile(path, Buffer.from(content, contentEncoding === 'base64' ? 'base64' : 'utf8')); } },
  };
  for (const key of Object.keys(bb.sdk) as (keyof BbPluginApi['sdk'])[]) {
    const group = bb.sdk[key] as Record<string, any>;
    Object.assign(group, defaults[key]);
    for (const method of Object.keys(group)) {
      if (typeof group[method] !== 'function') continue;
      const original = group[method]; const name = `${key}.${method}`;
      group[method] = (...args: unknown[]) => { const entries = calls.get(name) ?? []; entries.push(name === 'threads.spawn' ? [{ ...(args[0] as object), origin: 'plugin', originPluginId: options.pluginId ?? 'tasks' }] : args); calls.set(name, entries); return (stubs.get(name) ?? original)(...args); };
    }
    for (const [method, implementation] of Object.entries(options.sdk?.[key] ?? {})) stubs.set(`${key}.${method}`, implementation as any);
  }
  const services = new Map<string, { start(signal: AbortSignal): Promise<void> }>();
  const controllers = new Set<AbortController>();
  bb.background.service = (name, service) => { services.set(name, service); };
  const logEntries: { level: string; message: string }[] = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) bb.log[level] = message => { logEntries.push({ level, message }); };
  const mentions: Parameters<BbPluginApi['ui']['registerMentionProvider']>[0][] = [];
  const registerMention = bb.ui.registerMentionProvider;
  bb.ui.registerMentionProvider = reg => { mentions.push(reg); registerMention(reg); };
  const realtimeSignals: { channel: string; payload: unknown }[] = [];
  bb.realtime.publish = (channel, payload) => { realtimeSignals.push({ channel, payload }); };
  const harness = {
    ...host.harness,
    realtimeSignals,
    logEntries,
    registrations: { ...host.harness.registrations, mentionProviders: mentions, get threadEventHandlers() { return Object.fromEntries(['thread.created', 'thread.active', 'thread.idle', 'thread.failed', 'thread.deleted', 'interaction.pending', 'message.queued', 'message.dispatched', 'turn.failed', 'message.cancelled', 'thread.unarchived'].map(name => [name, host.harness.events.filter(e => e.name === name).length])); } },
    sdk: { stub: (path: string, implementation: (...args: any[]) => any) => { stubs.set(path, implementation); }, callsTo: (path: string) => calls.get(path) ?? [] },
    runService(name: string) { const controller = new AbortController(); controllers.add(controller); const done = services.get(name)!.start(controller.signal); return { controller, stop: async () => { controller.abort(); await done; }, done }; },
    async fetchHttp(method: any, path: string, init: RequestInit = {}) {
      const request = new Request(new URL(path, 'http://plugin.local'), { ...init, method });
      const url = new URL(request.url);
      const route = host.harness.httpRoutes.find(r => r.method === method && r.path === url.pathname);
      if (!route) return new Response('not found', { status: 404 });
      const result = await route.handler({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: undefined,
        rawBody: new Uint8Array(await request.arrayBuffer()), headers: Object.fromEntries(request.headers) });
      return new Response(result.json === undefined ? result.body as BodyInit : JSON.stringify(result.json), { status: result.status, headers: result.headers });
    },
    async dispose() { for (const controller of controllers) controller.abort(); await host.harness.dispose(); db.close(); rmSync(root, { recursive: true, force: true }); },
  };
  return { bb, zcc: host.zcc, harness };
}
