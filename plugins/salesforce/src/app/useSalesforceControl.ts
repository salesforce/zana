import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { ControlState, UiCommand, UiCommandName } from '../../lib/workbench-control.js';

/** One scoped lease per mounted surface; commands execute once, then acknowledge the rendered state. */
export function useSalesforceControl(options: {
  pluginId: string; projectId?: string; orgAlias?: string; threadId?: string; surface: string; enabled?: boolean;
  commands: readonly UiCommandName[]; state(): ControlState;
  execute(command: UiCommand): Promise<void | ControlState> | void | ControlState;
}) {
  const current = useRef(options); current.current = options;
  const [, render] = useState(0);
  const commits = useRef<Array<() => void>>([]);
  useLayoutEffect(() => { commits.current.splice(0).forEach(resolve => resolve()); });
  const { pluginId, projectId, orgAlias, threadId, surface, enabled = true } = options;
  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    let viewId = '';
    let timer: ReturnType<typeof setTimeout>;
    const call = async (method: string, args: Record<string, unknown>) => {
      const result = await callPluginRpc(pluginId, method, { ...args, projectId, orgAlias, threadId }) as Record<string, any>;
      if (!result?.ok) throw Error(result?.error || 'Workbench control unavailable.');
      return result;
    };
    const poll = async () => {
      try {
        if (!viewId) viewId = (await call('control.register', { surface, commands: current.current.commands })).viewId;
        if (cancelled) { void call('control.close', { viewId }).catch(() => {}); return; }
        const result = await call('control.poll', { viewId, state: current.current.state() });
        for (const command of (result.commands ?? []) as UiCommand[]) {
          if (cancelled) return;
          let extra: void | ControlState;
          try {
            extra = await current.current.execute(command);
            // A React commit, rather than an elapsed timer, proves the state setters reached the view.
            await new Promise<void>(resolve => { commits.current.push(resolve); render(value => value + 1); });
            if (cancelled) return;
            await call('control.ack', { viewId, commandId: command.id, ok: true, state: { ...current.current.state(), ...extra } });
          } catch (error) {
            if (!cancelled) await call('control.ack', { viewId, commandId: command.id, ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      } catch { viewId = ''; /* A reload expires the lease; retry while this surface remains mounted. */ }
      finally { if (!cancelled) timer = setTimeout(poll, 1500); }
    };
    void poll();
    return () => { cancelled = true; commits.current.splice(0).forEach(resolve => resolve()); clearTimeout(timer); if (viewId) void call('control.close', { viewId }).catch(() => {}); };
  }, [pluginId, projectId, orgAlias, threadId, surface, enabled]);
}

export function controlText(input: ControlState, key: string, max = 4000): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length > max) throw Error(`Provide ${key} (at most ${max} characters).`);
  return value;
}
