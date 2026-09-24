import { createElement, isValidElement, useEffect, useRef, useSyncExternalStore, type ComponentType } from 'react';
import { TasksHostContext } from './app';
import { act, render } from '@testing-library/react';
import { installTestPluginRuntime } from '@zana-ai/zcc-plugin-sdk/testing/app';
import type { PluginSdkApp } from '@zana-ai/zcc-plugin-sdk/app';
export { loadPluginApp, installTestPluginRuntime } from '@zana-ai/zcc-plugin-sdk/testing/app';
export function renderSlot<P extends object>(registration: { component: ComponentType<P> }, props: P, options: Parameters<typeof installTestPluginRuntime>[0] & { openThreadPanel?: (args: unknown) => boolean } = {}) {
  const installed = installTestPluginRuntime(options);
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: Partial<PluginSdkApp> }).__ZCC_PLUGIN_RUNTIME__!;
  let connection = options.realtimeConnectionState ?? 'connected';
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  runtime.useRealtimeConnectionState = () => useSyncExternalStore(subscribe, () => connection);
  const navigate = runtime.useZccNavigate!();
  navigate.openThreadPanel = options.openThreadPanel ?? (() => false);
  const realtime = new Map<string, Set<(value: unknown) => void>>();
  runtime.useRealtime = (channel, handler) => {
    const ref = useRef(handler); ref.current = handler;
    useEffect(() => { const set = realtime.get(channel) ?? new Set(); const listener = (value: unknown) => ref.current(value);
      set.add(listener); realtime.set(channel, set); return () => { set.delete(listener); }; }, [channel]);
  };
  const wrap = (element: React.ReactNode) => createElement(TasksHostContext.Provider, { value: runtime }, element);
  const result = render(wrap(createElement(registration.component, props)));
  const emitRealtime = async (channel: string, payload?: unknown) => { await act(async () => { for (const listener of realtime.get(channel) ?? []) listener(payload); }); };
  return { ...result, ...installed, emitRealtime, inspection: installed,
    lifecycle: { unmount: result.unmount, rerender: (next: P | React.ReactElement) => result.rerender(wrap(isValidElement(next) ? next : createElement(registration.component, next as P))) },
    behavior: { emitRealtime, setRealtimeConnectionState: async (next: typeof connection) => { await act(async () => { connection = next; for (const listener of listeners) listener(); }); } },
  };
}
