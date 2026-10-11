import { createHash } from 'node:crypto';
import { getHost, type ZccDatabase } from '@zana-ai/zcc-db';
import {
  HOST_ENVIRONMENT_MAX_ENTRIES,
  HostEnvironmentEntrySchema,
  isForbiddenHostEnvironmentName,
  type HostEnvironmentEntry,
  type HostRpcCommand
} from '@zana-ai/zcc-contracts/host-rpc';

/**
 * Generic seam that lets a plugin contribute environment variables for sessions
 * that run on non-primary (remote) machines.
 *
 * Trust model
 * - A plugin may only contribute names its manifest declares in
 *   `zcc.extra.remoteEnvironment` (exact names or `PREFIX_*`). Names that
 *   redirect execution (`PATH`, `LD_*`, ...) are refused for everyone.
 * - Values live in this process's memory and in the target daemon's memory.
 *   They are never written to disk, the database, logs or diagnostics, and the
 *   daemon answers with names only.
 * - Pushes happen off the spawn path (on connect, on change and on a timer), so
 *   starting a session never waits on a plugin.
 * - The machine user's own environment always wins on the daemon side.
 *
 * Core never names a plugin or a vendor here; it only knows about environment.
 */

const MAX_ALLOWED_NAMES = 32;
const ALLOWED_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\*?$/;
const EMPTY_DIGEST = 'empty';
const DEFAULT_RESOLVE_TIMEOUT_MS = 15_000;
const DEFAULT_PUSH_TIMEOUT_MS = 10_000;
const DEFAULT_RESYNC_INTERVAL_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_PUSHES = 4;

/** Read the manifest allowlist (`zcc.extra.remoteEnvironment`). Anything malformed is ignored. */
export function parseRemoteEnvironmentNames(extra: Record<string, unknown> | undefined): string[] {
  const declared = extra?.remoteEnvironment;
  if (!Array.isArray(declared)) return [];
  const names: string[] = [];
  for (const item of declared) {
    if (typeof item !== 'string' || item.length > 128 || !ALLOWED_PATTERN.test(item)) continue;
    const base = item.endsWith('*') ? item.slice(0, -1) : item;
    if (base.length === 0 || isForbiddenHostEnvironmentName(base)) continue;
    if (!names.includes(item)) names.push(item);
    if (names.length >= MAX_ALLOWED_NAMES) break;
  }
  return names;
}

function isAllowed(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern);
}

/** True for a registered, live host that is not the primary (local) machine. */
export function nonPrimaryHostCheck(db: ZccDatabase): (hostId: string) => boolean {
  return (hostId) => {
    const host = getHost(db, hostId);
    return host !== null && host.destroyedAt === null && !host.isPrimary;
  };
}

/** The part of the host hub the service pushes through. */
export interface RemoteEnvironmentHostHub {
  connectedHostIds(): readonly string[];
  callHostOnlineRpc(input: { hostId: string; command: HostRpcCommand; timeoutMs?: number }): Promise<unknown>;
}

/** The server's service: pushes to connected non-primary machines through the host hub. */
export function createHostHubRemoteEnvironment(
  hostHub: RemoteEnvironmentHostHub,
  db: ZccDatabase,
  logger: Pick<Console, 'info' | 'warn'> = console
): RemoteEnvironmentService {
  return createRemoteEnvironmentService({
    connectedHostIds: () => hostHub.connectedHostIds(),
    isEligibleHost: nonPrimaryHostCheck(db),
    callHost: (hostId, command, timeoutMs) => hostHub.callHostOnlineRpc({ hostId, command, timeoutMs }),
    // Names, counts and host ids only: the service never passes a value to the logger.
    log: { info: (message) => logger.info(`[remote-env] ${message}`), warn: (message) => logger.warn(`[remote-env] ${message}`) }
  });
}

export interface RemoteEnvironmentRegistration {
  /** Ask for a re-resolve soon. Fire-and-forget and coalesced. */
  refresh(): void;
  dispose(): void;
}

export interface RemoteEnvironmentService {
  register(input: {
    pluginId: string;
    allowedNames: readonly string[];
    resolve: () => unknown;
  }): RemoteEnvironmentRegistration;
  hostConnected(hostId: string): void;
  hostDisconnected(hostId: string): void;
  /** Resolve every contribution and push the result to eligible machines. */
  refresh(): Promise<void>;
  dispose(): void;
}

export interface RemoteEnvironmentServiceOptions {
  connectedHostIds(): readonly string[];
  isEligibleHost(hostId: string): boolean;
  callHost(hostId: string, command: HostRpcCommand, timeoutMs: number): Promise<unknown>;
  /** Receives names, counts and host ids only. Never values. */
  log?: { info(message: string): void; warn(message: string): void };
  resolveTimeoutMs?: number;
  pushTimeoutMs?: number;
  resyncIntervalMs?: number;
  maxConcurrentPushes?: number;
}

interface Registration {
  pluginId: string;
  allowedNames: readonly string[];
  resolve: () => unknown;
}

interface Snapshot {
  entries: HostEnvironmentEntry[];
  digest: string;
  at: number;
}

function digestOf(entries: readonly HostEnvironmentEntry[]): string {
  return entries.length === 0 ? EMPTY_DIGEST : createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

function errorLabel(error: unknown): string {
  // Never the message: an upstream error can carry whatever a tool printed.
  return error instanceof Error && /^[A-Za-z0-9_.]{1,64}$/.test(error.name) ? error.name : 'Error';
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

export function createRemoteEnvironmentService(options: RemoteEnvironmentServiceOptions): RemoteEnvironmentService {
  const resolveTimeoutMs = options.resolveTimeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;
  const pushTimeoutMs = options.pushTimeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS;
  const resyncIntervalMs = options.resyncIntervalMs ?? DEFAULT_RESYNC_INTERVAL_MS;
  const maxConcurrentPushes = Math.max(1, options.maxConcurrentPushes ?? DEFAULT_MAX_CONCURRENT_PUSHES);
  const registrations = new Map<string, Registration>();
  /** Digest last delivered to each machine; absent means unknown, so the next result is always pushed once. */
  const pushed = new Map<string, string>();
  const failing = new Set<string>();
  let snapshot: Snapshot | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> | null = null;
  let again = false;
  let disposed = false;

  function ensureTimer(): void {
    if (timer || disposed || registrations.size === 0) return;
    timer = setInterval(() => { void refresh(); }, resyncIntervalMs);
    timer.unref?.();
  }

  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function unitsFor(registration: Registration, raw: unknown): HostEnvironmentEntry[][] {
    if (!Array.isArray(raw)) return [];
    const units = new Map<string, HostEnvironmentEntry[]>();
    let singles = 0;
    for (const item of raw) {
      const parsed = HostEnvironmentEntrySchema.safeParse(item);
      if (!parsed.success || !isAllowed(parsed.data.name, registration.allowedNames)) continue;
      const entry: HostEnvironmentEntry = parsed.data.group
        ? { ...parsed.data, group: `${registration.pluginId}:${parsed.data.group}`.slice(0, 128) }
        : parsed.data;
      const key = entry.group ? `group:${entry.group}` : `single:${singles++}`;
      const unit = units.get(key) ?? [];
      unit.push(entry);
      units.set(key, unit);
    }
    return [...units.values()];
  }

  async function collect(): Promise<HostEnvironmentEntry[]> {
    const merged = new Map<string, HostEnvironmentEntry>();
    for (const registration of [...registrations.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId))) {
      let raw: unknown;
      try {
        raw = await withTimeout(Promise.resolve().then(() => registration.resolve()), resolveTimeoutMs);
      } catch (error) {
        options.log?.warn(`plugin ${registration.pluginId} could not resolve (${errorLabel(error)}); forwarding nothing from it`);
        continue;
      }
      for (const unit of unitsFor(registration, raw)) {
        // A name another plugin already owns drops the whole group so a group is never half applied.
        if (unit.some((entry) => merged.has(entry.name))) continue;
        if (merged.size + unit.length > HOST_ENVIRONMENT_MAX_ENTRIES) continue;
        for (const entry of unit) merged.set(entry.name, entry);
      }
    }
    return [...merged.values()];
  }

  async function pushTo(hostId: string, entries: HostEnvironmentEntry[], digest: string): Promise<void> {
    if (disposed) return;
    if (pushed.get(hostId) === digest) return;
    try {
      const result = await options.callHost(hostId, { type: 'host.environment.replace', entries }, pushTimeoutMs);
      if (disposed) return;
      pushed.set(hostId, digest);
      if (failing.delete(hostId)) options.log?.info(`push to ${hostId} recovered`);
      const { applied, skipped } = (result ?? {}) as { applied?: unknown; skipped?: unknown };
      const names = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').join(',') : '';
      options.log?.info(`${hostId} applied [${names(applied)}] skipped [${names(skipped)}]`);
    } catch (error) {
      if (failing.has(hostId)) return;
      failing.add(hostId);
      options.log?.warn(`push to ${hostId} failed (${errorLabel(error)}); will retry`);
    }
  }

  function eligibleTargets(): string[] {
    return options.connectedHostIds().filter((id) => options.isEligibleHost(id));
  }

  async function pushAll(entries: HostEnvironmentEntry[], digest: string): Promise<void> {
    const targets = eligibleTargets();
    let next = 0;
    const worker = async () => {
      while (!disposed) {
        const hostId = targets[next++];
        if (hostId === undefined) return;
        await pushTo(hostId, entries, digest);
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrentPushes, targets.length) }, worker));
  }

  async function run(): Promise<void> {
    if (disposed) return;
    // Nobody to deliver to: do not ask plugins to do any work (for example run a tool) for nothing.
    if (eligibleTargets().length === 0) {
      snapshot = null;
      return;
    }
    const entries = await collect();
    if (disposed) return;
    const digest = digestOf(entries);
    snapshot = { entries, digest, at: Date.now() };
    await pushAll(entries, digest);
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (inflight) {
      again = true;
      return inflight;
    }
    const current: Promise<void> = run().catch(() => undefined).finally(() => {
      inflight = null;
      if (again) {
        again = false;
        void refresh();
      }
    });
    inflight = current;
    return current;
  }

  return {
    register(input) {
      if (disposed) throw new Error('remote environment service is disposed');
      const allowedNames = input.allowedNames.filter((name) => ALLOWED_PATTERN.test(name));
      if (allowedNames.length === 0) {
        throw new Error('plugin must declare zcc.extra.remoteEnvironment names to contribute remote environment');
      }
      const registration: Registration = { pluginId: input.pluginId, allowedNames, resolve: input.resolve };
      registrations.set(input.pluginId, registration);
      ensureTimer();
      void refresh();
      return {
        refresh: () => { void refresh(); },
        dispose: () => {
          if (registrations.get(input.pluginId) !== registration) return;
          registrations.delete(input.pluginId);
          if (registrations.size === 0) stopTimer();
          void refresh();
        }
      };
    },
    hostConnected(hostId) {
      if (disposed) return;
      pushed.delete(hostId);
      failing.delete(hostId);
      if (registrations.size === 0 || !options.isEligibleHost(hostId)) return;
      const fresh = snapshot !== null && Date.now() - snapshot.at < resyncIntervalMs;
      // A refresh in flight chose its targets before this host joined: queue another so it gets the new result.
      if (snapshot && fresh && !inflight) {
        void pushTo(hostId, snapshot.entries, snapshot.digest);
        return;
      }
      void refresh();
    },
    hostDisconnected(hostId) {
      pushed.delete(hostId);
      failing.delete(hostId);
    },
    refresh,
    dispose() {
      disposed = true;
      stopTimer();
      registrations.clear();
      pushed.clear();
      failing.clear();
      snapshot = null;
    }
  };
}
