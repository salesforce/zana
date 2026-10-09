import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { callPluginRpc, useRealtime, useRealtimeConnectionState } from '@zana-ai/zcc-plugin-sdk/app';
import { UI_WAKE_CHANNEL, type ProposalOutcome } from '../../lib/studio-contract.js';
import type { ControlState, UiCommand, UiCommandName } from '../../lib/workbench-control.js';

/** Fallback poll cadence: the realtime wake makes the 5s poll a safety net; without realtime keep 1.5s. */
export const POLL_MS_REALTIME = 5000;
export const POLL_MS_FALLBACK = 1500;

/**
 * Returned by `execute` for human-paced commands. The hook acks `pending:'user'`, then reports the
 * settled outcome through `control.outcome` without blocking further polls.
 */
export interface PendingUserResult extends ControlState { pending: 'user'; proposalId: string; settled: Promise<ProposalOutcome> }
export const isPendingUser = (value: unknown): value is PendingUserResult => Boolean(value) && typeof value === 'object'
  && (value as PendingUserResult).pending === 'user' && typeof (value as PendingUserResult).proposalId === 'string' && typeof (value as PendingUserResult).settled?.then === 'function';

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
  const connection = useRealtimeConnectionState();
  const intervalMs = useRef(POLL_MS_FALLBACK); intervalMs.current = connection === 'connected' ? POLL_MS_REALTIME : POLL_MS_FALLBACK;
  const leaseId = useRef(''); const wake = useRef<() => void>(() => {});
  // Hook sits at the top level (not in the effect) so the subscription follows the component lifecycle.
  useRealtime(UI_WAKE_CHANNEL, payload => {
    const target = payload && typeof payload === 'object' ? (payload as { viewId?: unknown }).viewId : undefined;
    if (typeof target === 'string' && target && target === leaseId.current) wake.current();
  });
  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    let viewId = ''; leaseId.current = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false; let again = false;
    const call = async (method: string, args: Record<string, unknown>) => {
      const result = await callPluginRpc(pluginId, method, { ...args, projectId, orgAlias, threadId }) as Record<string, any>;
      if (!result?.ok) throw Error(result?.error || 'Workbench control unavailable.');
      return result;
    };
    const settle = (commandId: string, pending: PendingUserResult) => {
      const report = (outcome: ProposalOutcome) => { if (!cancelled) void call('control.outcome', { viewId, commandId, outcome }).catch(() => {}); };
      pending.settled.then(report, error => report({ outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 0, note: (error instanceof Error ? error.message : String(error)).slice(0, 500) }));
    };
    const poll = async () => {
      if (running) { again = true; return; }
      running = true; again = false; clearTimeout(timer);
      try {
        if (!viewId) { viewId = (await call('control.register', { surface, commands: current.current.commands })).viewId; leaseId.current = viewId; }
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
            if (isPendingUser(extra)) {
              const { settled, pending, proposalId, ...rest } = extra;
              await call('control.ack', { viewId, commandId: command.id, ok: true, pending, proposalId, state: { ...current.current.state(), ...rest } });
              settle(command.id, extra);
            } else await call('control.ack', { viewId, commandId: command.id, ok: true, state: { ...current.current.state(), ...extra } });
          } catch (error) {
            if (!cancelled) await call('control.ack', { viewId, commandId: command.id, ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      } catch { viewId = ''; leaseId.current = ''; /* A reload expires the lease; retry while this surface remains mounted. */ }
      finally {
        running = false;
        if (!cancelled) { if (again) void poll(); else timer = setTimeout(poll, intervalMs.current); }
      }
    };
    wake.current = () => { if (!cancelled) void poll(); };
    void poll();
    return () => { cancelled = true; wake.current = () => {}; leaseId.current = ''; commits.current.splice(0).forEach(resolve => resolve()); clearTimeout(timer); if (viewId) void call('control.close', { viewId }).catch(() => {}); };
  }, [pluginId, projectId, orgAlias, threadId, surface, enabled]);
}

export function controlText(input: ControlState, key: string, max = 4000): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length > max) throw Error(`Provide ${key} (at most ${max} characters).`);
  return value;
}
