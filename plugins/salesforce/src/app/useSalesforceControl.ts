import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { callPluginRpc, useRealtime, useRealtimeConnectionState, useZccContext } from '@zana-ai/zcc-plugin-sdk/app';
import { UI_WAKE_CHANNEL, type ProposalOutcome } from '../../lib/studio-contract.js';
import type { ControlState, UiCommand, UiCommandName } from '../../lib/workbench-control.js';

/** Fallback poll cadence: the realtime wake makes the 5s poll a safety net; without realtime keep 1.5s. */
export const POLL_MS_REALTIME = 5000;
export const POLL_MS_FALLBACK = 1500;
/**
 * A hidden window only keeps its lease alive; a realtime wake still delivers at once.
 * Half of VIEW_LEASE_MS, so one slow poll does not drop the lease.
 */
export const POLL_MS_HIDDEN = 10_000;

/** Where the person is looking: agents list the focused window's views first. */
export function viewPresence(): { visible: boolean; focused: boolean } {
  if (typeof document === 'undefined') return { visible: true, focused: false };
  return { visible: document.visibilityState !== 'hidden', focused: document.hasFocus() };
}

/**
 * Returned by `execute` for human-paced commands. The hook acks `pending:'user'`, then reports the
 * settled outcome through `control.outcome` without blocking further polls.
 */
export interface PendingUserResult extends ControlState { pending: 'user'; proposalId: string; settled: Promise<ProposalOutcome> }
export const isPendingUser = (value: unknown): value is PendingUserResult => Boolean(value) && typeof value === 'object'
  && (value as PendingUserResult).pending === 'user' && typeof (value as PendingUserResult).proposalId === 'string' && typeof (value as PendingUserResult).settled?.then === 'function';

// Module-local: these are only the surfaces in this renderer, never another Studio window.
const mountedControls = new Set<{ projectId: string; close(): Promise<void>; resume(): void }>();

/** Native close waits for every mounted surface to disappear from command routing. */
export async function closeSalesforceControls(projectId: string): Promise<void> {
  const controls = [...mountedControls].filter(control => control.projectId === projectId);
  const results = await Promise.allSettled(controls.map(control => control.close()));
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    controls.forEach(control => control.resume());
    throw failure.reason;
  }
}

export function resumeSalesforceControls(projectId: string): void {
  for (const control of mountedControls) if (control.projectId === projectId) control.resume();
}

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
  const hostWindow = useZccContext().surface;
  const connection = useRealtimeConnectionState();
  const connected = useRef(false); connected.current = connection === 'connected';
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
    let registering: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    const call = async (method: string, args: Record<string, unknown>) => {
      const result = await callPluginRpc(pluginId, method, { ...args, projectId, orgAlias, threadId }) as Record<string, any>;
      if (!result?.ok) throw Error(result?.error || 'Workbench control unavailable.');
      return result;
    };
    const closeLease = (): Promise<void> => {
      if (closing) return closing;
      if (!viewId) return Promise.resolve();
      const closingId = viewId;
      closing = call('control.close', { viewId: closingId }).then(() => {
        if (viewId === closingId) viewId = '';
        leaseId.current = '';
      }).finally(() => { closing = undefined; });
      return closing;
    };
    const close = async () => {
      cancelled = true; wake.current = () => {}; clearTimeout(timer);
      commits.current.splice(0).forEach(resolve => resolve());
      // A window can close while control.register is still acquiring its lease.
      if (registering) await registering;
      await closeLease();
    };
    const control = { projectId, close, resume: () => { if (cancelled) { cancelled = false; wake.current = () => { void poll(); }; void poll(); } } };
    mountedControls.add(control);
    const settle = (commandId: string, pending: PendingUserResult) => {
      const report = (outcome: ProposalOutcome) => { if (!cancelled) void call('control.outcome', { viewId, commandId, outcome }).catch(() => {}); };
      pending.settled.then(report, error => report({ outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 0, note: (error instanceof Error ? error.message : String(error)).slice(0, 500) }));
    };
    const poll = async () => {
      if (running) { again = true; return; }
      running = true; again = false; clearTimeout(timer);
      try {
        if (!viewId) {
          registering = call('control.register', { surface, commands: current.current.commands, ...(hostWindow ? { window: hostWindow } : {}) }).then(result => {
            viewId = result.viewId; leaseId.current = viewId;
          });
          try { await registering; } finally { registering = undefined; }
        }
        if (cancelled) return;
        const result = await call('control.poll', { viewId, state: current.current.state(), presence: viewPresence() });
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
      } catch { if (!cancelled) { viewId = ''; leaseId.current = ''; } /* A reload expires the lease; retry while this surface remains mounted. */ }
      finally {
        running = false;
        if (!cancelled) { if (again) void poll(); else timer = setTimeout(poll, delay()); }
      }
    };
    const delay = () => !connected.current ? POLL_MS_FALLBACK : viewPresence().visible ? POLL_MS_REALTIME : POLL_MS_HIDDEN;
    wake.current = () => { if (!cancelled) void poll(); };
    // Report a focus or visibility change now, so ui.views ranks the window the person just moved to.
    const nudge = () => wake.current();
    // Closing a window unloads it without React cleanup; drop the lease so no agent or window targets it.
    const unload = () => { void close().catch(() => {}); };
    document.addEventListener('visibilitychange', nudge);
    window.addEventListener('focus', nudge);
    window.addEventListener('blur', nudge);
    window.addEventListener('pagehide', unload);
    void poll();
    return () => {
      cancelled = true; wake.current = () => {}; leaseId.current = '';
      document.removeEventListener('visibilitychange', nudge);
      window.removeEventListener('focus', nudge);
      window.removeEventListener('blur', nudge);
      window.removeEventListener('pagehide', unload);
      commits.current.splice(0).forEach(resolve => resolve()); clearTimeout(timer);
      mountedControls.delete(control);
      void close().catch(() => {});
    };
  }, [pluginId, projectId, orgAlias, threadId, surface, enabled, hostWindow]);
}

export function controlText(input: ControlState, key: string, max = 4000): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length > max) throw Error(`Provide ${key} (at most ${max} characters).`);
  return value;
}
