/**
 * Test-only harness: the real server store and RPC handlers behind the SDK's
 * test runtime, so UI tests exercise the same validation and live refresh
 * (`changed` → realtime) the app does.
 */
import { act, cleanup, configure, render, type RenderResult } from '@testing-library/react';
import { createElement, useEffect, useRef, type ReactElement } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { installTestPluginRuntime, type NavigateCall, type RpcCall } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { RenderReports } from '../server/render-reports.js';
import { createRpcHandlers } from '../server/rpc.js';
import { DesignDocStore } from '../server/store.js';
import type { DesignDocPairing } from '../server/pairing.js';
import type { DesignDocPeerService } from '../server/peer-service.js';
import { createTestDatabase } from '../server/test-db.js';
import { CHANGED_CHANNEL, type DocActor } from '../shared/contract.js';

// The root `pnpm test` run does not load this plugin's vitest.setup.ts, so the
// harness registers the same per-test DOM reset for every file that uses it.
configure({ asyncUtilTimeout: 4_000 });
afterEach(() => cleanup());
beforeEach(() => window.localStorage.clear());

export const AGENT: DocActor = { kind: 'agent', label: 'Architect', threadId: 'thread-agent' };
export const PROJECTS = [
  { id: 'p1', name: 'App' },
  { id: 'p2', name: 'Site' }
];

export interface Toast {
  message: string;
  kind: 'info' | 'error';
}

export interface HarnessOptions {
  store?: DesignDocStore;
  peerSync?: DesignDocPeerService;
  pairing?: DesignDocPairing;
  projects?: Array<{ id: string; name: string; quickAgent?: boolean }>;
  /** What `navigate.openThreadPanel` returns (false: no thread to attach to). */
  threadPanel?: boolean;
  /** Whether the page has a side panel for agents (`navigate.openPanelAgent`). */
  panelAgent?: boolean;
  context?: { projectId?: string | null; threadId?: string | null };
  /** Serve standalone pages at this URL (`pageLink`); unset, the RPC refuses. */
  pageUrl?(docId: string, path: string): string;
  /** `deepLinks.base()`; unset uses the SDK default, null models a build without links. */
  deepLinkBase?: string | null;
  /** Replace RPC methods on top of the real handlers (e.g. a stubbed pairing flow). */
  rpcOverrides?: Record<string, (args?: any) => unknown>;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Stand-in for the host renderer: paragraphs, plus real anchors for `[label](href)`. */
function TestMarkdown({ content, className }: { content: string; className?: string }) {
  const html = content
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')}</p>`)
    .join('');
  return createElement('div', { 'data-testid': 'plugin-markdown', className, dangerouslySetInnerHTML: { __html: html } });
}

export interface Harness {
  store: DesignDocStore;
  /** Page runs the panel reported, as agents would read them. */
  reports: RenderReports;
  rpcCalls: RpcCall[];
  navigateCalls: NavigateCall[];
  toasts: Toast[];
  spawn: ReturnType<typeof vi.fn>;
  /** Make the next calls to `method` reject with `message`. */
  fail(method: string, message: string): void;
  restore(method: string): void;
  /** Deliver a realtime event to every mounted subscriber. */
  emit(payload: unknown, channel?: string): void;
  /** Mutate the store as an agent would, then publish the change. */
  asAgent<T>(mutate: (store: DesignDocStore) => T): Promise<T>;
  render(element: ReactElement): RenderResult;
  call(method: string, args?: unknown): Promise<unknown>;
  /** Deliver a deep link to the handlers the app registered with `deepLinks.on(route, …)`. */
  emitDeepLink(route: string, payload?: string | null): void;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const store = options.store ?? new DesignDocStore(createTestDatabase());
  const reports = new RenderReports();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (payload: unknown, channel = CHANGED_CHANNEL) => {
    for (const listener of [...(listeners.get(channel) ?? [])]) listener(payload);
  };
  const projects = options.projects ?? PROJECTS;
  let spawned = 0;
  const spawn = vi.fn(async () => ({ id: `thread-${++spawned}` }));
  const sdk = {
    threads: {
      spawn,
      get: async ({ threadId }: { threadId: string }) =>
        threadId === 'missing' ? null : { id: threadId, projectId: 'p1', title: 'Planner' }
    },
    projects: { list: async () => projects.map((project) => ({ ...project, path: `/work/${project.id}` })) }
  };
  const handlers = createRpcHandlers({ store, changed: (docId) => emit({ docId }), sdk: sdk as never, peerSync: options.peerSync, pairing: options.pairing, pageUrl: options.pageUrl, reports });
  const failures = new Map<string, string>();
  const rpc = Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      async (input: unknown) => {
        const failure = failures.get(name);
        if (failure) throw new Error(failure);
        return handler(input ?? undefined);
      }
    ])
  );

  Object.assign(rpc, options.rpcOverrides);
  const installed = installTestPluginRuntime({ rpc, deepLinkBase: options.deepLinkBase, context: options.context ?? {}, panelAgent: options.panelAgent });
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: Record<string, unknown> }).__ZCC_PLUGIN_RUNTIME__!;
  const toasts: Toast[] = [];
  runtime.toast = (message: string, kind: 'info' | 'error' = 'info') => {
    toasts.push({ message, kind });
  };
  runtime.Markdown = TestMarkdown;
  // The stock test hook keeps one handler per channel; the app subscribes many.
  runtime.useRealtime = function useRealtime(channel: string, handler: (payload: unknown) => void) {
    const ref = useRef(handler);
    ref.current = handler;
    useEffect(() => {
      const set = listeners.get(channel) ?? new Set();
      listeners.set(channel, set);
      const listener = (payload: unknown) => ref.current(payload);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    }, [channel]);
  };
  if (options.threadPanel === false) {
    // The stock runtime always accepts thread panels; model a host that cannot.
    const navigate = (runtime.useZccNavigate as () => Record<string, (...args: unknown[]) => unknown>)();
    const patched = {
      ...navigate,
      openThreadPanel: (panel: unknown) => {
        navigate.openThreadPanel!(panel);
        return false;
      }
    };
    runtime.useZccNavigate = () => patched;
  }
  (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__ = {
    callRpc: (_pluginId: string, method: string, args?: unknown) => rpc[method]!(args ?? null),
    getSettings: async () => ({ values: {} }),
    setSettings: async () => undefined
  };

  return {
    store,
    reports,
    rpcCalls: installed.rpcCalls,
    navigateCalls: installed.navigateCalls,
    toasts,
    spawn,
    fail: (method, message) => failures.set(method, message),
    restore: (method) => failures.delete(method),
    emit: (payload, channel) => act(() => emit(payload, channel)),
    asAgent: async (mutate) => {
      let result!: ReturnType<typeof mutate>;
      await act(async () => {
        result = mutate(store);
        emit({ docId: null });
      });
      return result;
    },
    render: (element) => render(element),
    call: (method, args) => rpc[method]!(args ?? null) as Promise<unknown>,
    emitDeepLink: (route, payload) => act(() => installed.emitDeepLink(route, payload))
  };
}
