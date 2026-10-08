/**
 * Test-only harness: the real server store and RPC handlers behind the SDK's
 * test runtime, so UI tests exercise the same validation and live refresh
 * (`changed` → realtime) the app does.
 */
import { act, render, type RenderResult } from '@testing-library/react';
import { createElement, useEffect, useRef, type ReactElement } from 'react';
import { vi } from 'vitest';
import { installTestPluginRuntime, type NavigateCall, type RpcCall } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { RenderReports } from '../server/render-reports.js';
import { createRpcHandlers } from '../server/rpc.js';
import { DesignDocStore } from '../server/store.js';
import { createTestDatabase } from '../server/test-db.js';
import { CHANGED_CHANNEL, type DocActor } from '../shared/contract.js';

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
  projects?: Array<{ id: string; name: string }>;
  /** What `navigate.openThreadPanel` returns (false: no thread to attach to). */
  threadPanel?: boolean;
  context?: { projectId?: string | null; threadId?: string | null };
  /** Serve standalone pages at this URL (`pageLink`); unset, the RPC refuses. */
  pageUrl?(docId: string, path: string): string;
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
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const store = new DesignDocStore(createTestDatabase());
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
  const handlers = createRpcHandlers({ store, changed: (docId) => emit({ docId }), sdk: sdk as never, pageUrl: options.pageUrl, reports });
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

  const installed = installTestPluginRuntime({ rpc, context: options.context ?? {} });
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
    call: (method, args) => rpc[method]!(args ?? null) as Promise<unknown>
  };
}
