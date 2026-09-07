import type { HostBootstrapEvent } from '@zana-ai/zcc-desktop-contract';

export type HostInstallKind = 'install' | 'fix';

export interface HostInstallDrawerState {
  open: boolean;
  busy: boolean;
  kind: HostInstallKind | null;
  target: string | null;
  logs: string[];
  error: string | null;
  pairingCommand: string | null;
}

export type HostInstallFinish =
  | { ok: true }
  | { ok: false; message: string; pairingCommand?: string };

export const HOST_INSTALL_LOG_CAP = 400;
/** Brief "Reconnected" flash, then dismiss. Failures stay open. */
export const HOST_INSTALL_SUCCESS_CLOSE_MS = 800;

export function hostInstallDrawerShouldAutoClose(
  state: Pick<HostInstallDrawerState, 'open' | 'busy' | 'error'>
): boolean {
  return state.open && !state.busy && state.error === null;
}

export const EMPTY_HOST_INSTALL_DRAWER: HostInstallDrawerState = {
  open: false,
  busy: false,
  kind: null,
  target: null,
  logs: [],
  error: null,
  pairingCommand: null
};

export function hostInstallDrawerTitle(state: Pick<HostInstallDrawerState, 'busy' | 'kind' | 'error'>): string {
  if (state.busy) return state.kind === 'fix' ? 'Reconnecting…' : 'Installing…';
  if (state.error) return 'Install failed';
  return state.kind === 'fix' ? 'Reconnected' : 'Installed';
}

export function capHostInstallLogs(logs: string[]): string[] {
  if (logs.length <= HOST_INSTALL_LOG_CAP) return logs;
  return logs.slice(logs.length - HOST_INSTALL_LOG_CAP);
}

export function splitHostInstallLogText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/u, ''))
    .filter((line) => line.length > 0);
}

export function reduceHostInstallOpen(
  _state: HostInstallDrawerState,
  input: { kind: HostInstallKind; target: string }
): HostInstallDrawerState {
  return {
    open: true,
    busy: true,
    kind: input.kind,
    target: input.target,
    logs: [],
    error: null,
    pairingCommand: null
  };
}

export function reduceHostInstallAppend(
  state: HostInstallDrawerState,
  lines: string[]
): HostInstallDrawerState {
  if (lines.length === 0) return state;
  return { ...state, logs: capHostInstallLogs([...state.logs, ...lines]) };
}

export function reduceHostInstallEvent(
  state: HostInstallDrawerState,
  event: HostBootstrapEvent
): HostInstallDrawerState {
  if (event.type === 'log') return reduceHostInstallAppend(state, splitHostInstallLogText(event.text));
  if (event.type === 'error') {
    return {
      ...state,
      error: event.message,
      pairingCommand: event.pairingCommand ?? state.pairingCommand
    };
  }
  return state;
}

export function reduceHostInstallFinish(
  state: HostInstallDrawerState,
  outcome: HostInstallFinish
): HostInstallDrawerState {
  if (outcome.ok) {
    return { ...state, busy: false, error: null };
  }
  return {
    ...state,
    busy: false,
    error: outcome.message,
    pairingCommand: outcome.pairingCommand ?? state.pairingCommand
  };
}
