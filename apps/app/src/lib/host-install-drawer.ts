import type { HostBootstrapEvent } from '@zana-ai/zcc-desktop-contract';

export type HostInstallKind = 'install' | 'fix';

export type HostBootstrapStage = Extract<HostBootstrapEvent, { type: 'stage' }>['stage'];

export type HostInstallStageStatus = 'running' | 'passed' | 'failed';

export interface HostInstallStageEntry {
  stage: HostBootstrapStage;
  status: HostInstallStageStatus;
  reason?: string;
  limitMs?: number;
  /** Epoch ms when the stage reported `running`. */
  startedAt?: number;
}

export const HOST_INSTALL_STAGE_LABELS: Record<HostBootstrapStage, string> = {
  ssh: 'Connecting over SSH',
  tunnel: 'Opening tunnel',
  install: 'Installing',
  wait: 'Waiting for machine',
  register: 'Registering with this app',
  connected: 'Connected'
};

/** `m:ss` for a millisecond duration. */
export function formatHostInstallDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

type StageEvent = Extract<HostBootstrapEvent, { type: 'stage' }>;

/** Insert or update a stage in arrival order; `running` records the start time. */
export function upsertStage(
  stages: HostInstallStageEntry[],
  event: StageEvent,
  now: number = Date.now()
): HostInstallStageEntry[] {
  const index = stages.findIndex((entry) => entry.stage === event.stage);
  const previous = index >= 0 ? stages[index] : undefined;
  const next: HostInstallStageEntry = {
    stage: event.stage,
    status: event.status,
    ...(event.reason !== undefined ? { reason: event.reason } : {}),
    ...((event.limitMs ?? previous?.limitMs) !== undefined ? { limitMs: event.limitMs ?? previous?.limitMs } : {}),
    ...(event.status === 'running'
      ? { startedAt: now }
      : previous?.startedAt !== undefined ? { startedAt: previous.startedAt } : {})
  };
  if (index < 0) return [...stages, next];
  return stages.map((entry, i) => (i === index ? next : entry));
}

/** Display-only view of a stage: a running stage past its limit reads as failed. */
export function resolveStageDisplay(
  entry: HostInstallStageEntry,
  now: number
): { status: HostInstallStageStatus; reason?: string; elapsedMs?: number; timedOut: boolean } {
  const elapsedMs = entry.startedAt !== undefined ? Math.max(0, now - entry.startedAt) : undefined;
  if (entry.status === 'running' && entry.limitMs !== undefined && elapsedMs !== undefined && elapsedMs > entry.limitMs) {
    return {
      status: 'failed',
      reason: `Timed out after ${formatHostInstallDuration(entry.limitMs)}`,
      elapsedMs,
      timedOut: true
    };
  }
  return {
    status: entry.status,
    ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    timedOut: false
  };
}

export interface HostInstallDrawerState {
  open: boolean;
  busy: boolean;
  kind: HostInstallKind | null;
  target: string | null;
  logs: string[];
  stages: HostInstallStageEntry[];
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
  stages: [],
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
    stages: [],
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
  event: HostBootstrapEvent,
  now: number = Date.now()
): HostInstallDrawerState {
  if (event.type === 'stage') return { ...state, stages: upsertStage(state.stages, event, now) };
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
