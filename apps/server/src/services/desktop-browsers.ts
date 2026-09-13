import { randomUUID } from 'node:crypto';
import { getConversationThread, getThreadTabs, replaceThreadTabs } from '@zana-ai/zcc-db';
import type { DesktopBrowserTab } from '@zana-ai/zcc-host-daemon-contract';
import type { HostRpcCommand } from '@zana-ai/zcc-contracts/host-rpc';
import {
  threadTabsSchema,
  type ExperimentalDesktopBrowserAcquireRequest,
  type ExperimentalDesktopBrowserCreateRequest,
  type ExperimentalDesktopBrowserImportCookiesRequest,
  type ExperimentalDesktopBrowserInstanceRequest,
  type ExperimentalDesktopBrowserLease,
  type ExperimentalDesktopBrowserLeaseRequest,
  type ExperimentalDesktopBrowserScope,
  type ExperimentalDesktopBrowserTabRequest,
  type ThreadTab
} from '@zana-ai/zcc-server-contract';
import type { ProductHttpContext } from '../http/product-context.js';

export const DESKTOP_BROWSER_MAX_LEASES = 100;

export class DesktopBrowserError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface LeaseEntry {
  lease: ExperimentalDesktopBrowserLease;
  active: boolean;
  timer: ReturnType<typeof setTimeout>;
}

const registries = new WeakMap<object, Map<string, LeaseEntry>>();

function registry(ctx: Pick<ProductHttpContext, 'hub'>): Map<string, LeaseEntry> {
  let leases = registries.get(ctx.hub);
  if (!leases) {
    leases = new Map();
    registries.set(ctx.hub, leases);
  }
  return leases;
}

function requireBrokerRpc(
  ctx: Pick<ProductHttpContext, 'hostHub'>
): ProductHttpContext['hostHub'] {
  const hub = ctx.hostHub;
  if (!hub?.callHostOnlineRpc) {
    throw new DesktopBrowserError(
      503,
      'desktop_browser_unavailable',
      'Desktop browser is only available in the desktop app.'
    );
  }
  return hub;
}

async function callDesktopBrowserRpc<T>(
  ctx: Pick<ProductHttpContext, 'hostHub'>,
  hostId: string,
  command: HostRpcCommand,
  timeoutMs?: number
): Promise<T> {
  try {
    return await requireBrokerRpc(ctx).callHostOnlineRpc<T>({ hostId, command, timeoutMs });
  } catch (error) {
    if (error instanceof DesktopBrowserError) throw error;
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
    const name = error instanceof Error ? error.name : '';
    if (
      name === 'HostUnavailableError'
      || code === 'host-unavailable'
      || code === 'unknown_command'
      || code === 'desktop_browser_unavailable'
    ) {
      throw new DesktopBrowserError(
        503,
        'desktop_browser_unavailable',
        'Desktop browser is only available in the desktop app.'
      );
    }
    throw new DesktopBrowserError(
      502,
      code || 'desktop_browser_failed',
      error instanceof Error ? error.message : 'Desktop browser operation failed'
    );
  }
}

function requireThread(ctx: Pick<ProductHttpContext, 'db'>, threadId: string) {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new DesktopBrowserError(404, 'unknown-thread', 'thread is not registered');
  }
  return thread;
}

function scopeCommand(input: ExperimentalDesktopBrowserScope) {
  return {
    instanceId: input.instanceId,
    generation: input.generation,
    threadId: input.threadId
  };
}

function authorize(ctx: Pick<ProductHttpContext, 'db'>, scope: ExperimentalDesktopBrowserScope) {
  requireThread(ctx, scope.threadId);
}

function sameScope(a: ExperimentalDesktopBrowserScope, b: ExperimentalDesktopBrowserScope) {
  return (
    a.hostId === b.hostId
    && a.instanceId === b.instanceId
    && a.generation === b.generation
    && a.threadId === b.threadId
  );
}

function parseStoredTabs(tabsJson: string): ThreadTab[] {
  try {
    const parsed = threadTabsSchema.safeParse(JSON.parse(tabsJson) as unknown);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function emitTabs(
  ctx: Pick<ProductHttpContext, 'db' | 'hub'>,
  threadId: string,
  revision: number,
  tabs: ThreadTab[]
) {
  const thread = getConversationThread(ctx.db, threadId);
  ctx.hub.emit('threads:tabs', {
    type: 'thread-tabs',
    threadId,
    projectId: thread?.projectId,
    revision,
    tabs
  });
}

function requireLease(
  ctx: Pick<ProductHttpContext, 'db' | 'hub'>,
  input: ExperimentalDesktopBrowserLeaseRequest
) {
  authorize(ctx, input);
  const entry = registry(ctx).get(input.leaseId);
  if (!entry || !entry.active || entry.lease.expiresAt <= Date.now() || !sameScope(entry.lease, input)) {
    throw new DesktopBrowserError(
      409,
      'desktop_control_expired',
      'Browser control has expired or belongs to a different desktop/thread'
    );
  }
  return entry;
}

export function persistDesktopBrowserTab(
  ctx: Pick<ProductHttpContext, 'db' | 'hub'>,
  scope: ExperimentalDesktopBrowserScope,
  tab: DesktopBrowserTab
) {
  if (tab.threadId !== scope.threadId || tab.url.length > 4096) return;
  requireThread(ctx, scope.threadId);
  const stored = getThreadTabs(ctx.db, scope.threadId);
  const tabs = stored ? parseStoredTabs(stored.tabsJson) : [];
  const next: ThreadTab = {
    id: tab.tabId,
    kind: 'browser',
    environmentId: null,
    title: tab.title.slice(0, 1024) || null,
    url: tab.url,
    desktopTarget: {
      hostId: scope.hostId,
      instanceId: scope.instanceId,
      generation: scope.generation
    }
  };
  const index = tabs.findIndex((value) => value.id === tab.tabId);
  if (index < 0) tabs.push(next);
  else tabs[index] = next;
  const parsed = threadTabsSchema.parse(tabs);
  const replaced = replaceThreadTabs(ctx.db, {
    threadId: scope.threadId,
    expectedRevision: stored?.revision ?? 0,
    tabsJson: JSON.stringify(parsed)
  });
  if (replaced === 'conflict') {
    throw new DesktopBrowserError(409, 'revision_conflict', 'Thread tabs were updated elsewhere');
  }
  emitTabs(ctx, scope.threadId, replaced.revision, parsed);
}

export function removeDesktopBrowserTab(
  ctx: Pick<ProductHttpContext, 'db' | 'hub'>,
  scope: ExperimentalDesktopBrowserScope,
  tabId: string
) {
  const stored = getThreadTabs(ctx.db, scope.threadId);
  if (!stored) return;
  const tabs = parseStoredTabs(stored.tabsJson);
  const filtered = tabs.filter(
    (tab) =>
      !(
        tab.id === tabId
        && tab.kind === 'browser'
        && tab.desktopTarget?.hostId === scope.hostId
        && tab.desktopTarget.instanceId === scope.instanceId
        && tab.desktopTarget.generation === scope.generation
      )
  );
  if (filtered.length === tabs.length) return;
  const replaced = replaceThreadTabs(ctx.db, {
    threadId: scope.threadId,
    expectedRevision: stored.revision,
    tabsJson: JSON.stringify(filtered)
  });
  if (replaced === 'conflict') return;
  emitTabs(ctx, scope.threadId, replaced.revision, filtered);
}

export async function listDesktopBrowserInstances(
  ctx: Pick<ProductHttpContext, 'hostHub'>,
  hostId: string
) {
  const result = await callDesktopBrowserRpc<{
    instances: Array<{ instanceId: string; generation: string; label: string }>;
  }>(ctx, hostId, { type: 'desktop.browser.list_instances' }, 10_000);
  return {
    instances: result.instances.map((instance) => ({ ...instance, hostId }))
  };
}

export async function listDesktopBrowserTabs(
  ctx: Pick<ProductHttpContext, 'db' | 'hub' | 'hostHub'>,
  scope: ExperimentalDesktopBrowserScope
) {
  authorize(ctx, scope);
  const result = await callDesktopBrowserRpc<{ tabs: DesktopBrowserTab[] }>(
    ctx,
    scope.hostId,
    { type: 'desktop.browser.list_tabs', ...scopeCommand(scope) },
    10_000
  );
  if (result.tabs.some((tab) => tab.threadId !== scope.threadId)) {
    throw new DesktopBrowserError(502, 'desktop_tab_scope', 'Desktop returned tabs outside the requested thread');
  }
  return result;
}

export async function createDesktopBrowserTab(
  ctx: Pick<ProductHttpContext, 'db' | 'hub' | 'hostHub'>,
  input: ExperimentalDesktopBrowserCreateRequest
) {
  authorize(ctx, input);
  const result = await callDesktopBrowserRpc<{ tab: DesktopBrowserTab }>(
    ctx,
    input.hostId,
    {
      type: 'desktop.browser.create_tab',
      ...scopeCommand(input),
      tabId: `browser:${randomUUID()}`,
      url: input.url,
      presentation: input.presentation,
      profile: { kind: 'automation', id: randomUUID() }
    },
    15_000
  );
  try {
    persistDesktopBrowserTab(ctx, input, result.tab);
  } catch (error) {
    await desktopBrowserTabAction(ctx, { ...input, tabId: result.tab.tabId }, 'close').catch(() => {});
    throw error;
  }
  return result;
}

export async function releaseDesktopBrowserControl(
  ctx: Pick<ProductHttpContext, 'db' | 'hub' | 'hostHub'>,
  input: ExperimentalDesktopBrowserLeaseRequest
) {
  const entry = registry(ctx).get(input.leaseId);
  if (!entry) return { ok: true as const };
  if (!sameScope(entry.lease, input)) {
    throw new DesktopBrowserError(
      403,
      'desktop_control_scope',
      'Browser control belongs to a different desktop/thread'
    );
  }
  entry.active = false;
  clearTimeout(entry.timer);
  registry(ctx).delete(input.leaseId);
  await callDesktopBrowserRpc(ctx, input.hostId, {
    type: 'desktop.browser.release_control',
    ...scopeCommand(input),
    leaseId: input.leaseId
  });
  return { ok: true as const };
}

export async function acquireDesktopBrowserControl(
  ctx: Pick<ProductHttpContext, 'db' | 'hub' | 'hostHub'>,
  input: ExperimentalDesktopBrowserAcquireRequest
) {
  authorize(ctx, input);
  const activeCount = [...registry(ctx).values()].filter((entry) => entry.active).length;
  if (activeCount >= DESKTOP_BROWSER_MAX_LEASES) {
    throw new DesktopBrowserError(429, 'desktop_control_limit', 'Too many concurrent browser control leases');
  }
  const lease: ExperimentalDesktopBrowserLease = {
    hostId: input.hostId,
    ...scopeCommand(input),
    leaseId: randomUUID(),
    tabIds: input.tabIds,
    controllerLabel: input.controllerLabel,
    expiresAt: Date.now() + input.ttlMs
  };
  const timer = setTimeout(() => {
    void releaseDesktopBrowserControl(ctx, lease).catch(() => {});
  }, input.ttlMs);
  timer.unref();
  const entry: LeaseEntry = { lease, timer, active: true };
  registry(ctx).set(lease.leaseId, entry);
  try {
    const { tabs } = await listDesktopBrowserTabs(ctx, input);
    const selected = input.tabIds.map((id) => tabs.find((tab) => tab.tabId === id));
    if (selected.some((tab) => !tab || tab.threadId !== input.threadId)) {
      throw new DesktopBrowserError(403, 'desktop_tab_scope', 'A requested tab does not belong to this thread');
    }
    if (!input.allowPersonal && selected.some((tab) => tab?.profile.kind === 'personal')) {
      throw new DesktopBrowserError(
        403,
        'desktop_personal_handoff_required',
        'Controlling a personal tab requires an explicit handoff'
      );
    }
    if (!entry.active) {
      throw new DesktopBrowserError(409, 'desktop_control_expired', 'Browser control was cancelled while checking tabs');
    }
    await callDesktopBrowserRpc(ctx, input.hostId, {
      type: 'desktop.browser.acquire_control',
      ...scopeCommand(input),
      leaseId: lease.leaseId,
      tabIds: lease.tabIds,
      controllerLabel: lease.controllerLabel,
      expiresAt: lease.expiresAt
    });
    if (!entry.active || lease.expiresAt <= Date.now()) {
      await callDesktopBrowserRpc(ctx, input.hostId, {
        type: 'desktop.browser.release_control',
        ...scopeCommand(input),
        leaseId: lease.leaseId
      });
      throw new DesktopBrowserError(409, 'desktop_control_expired', 'Browser control was cancelled while connecting');
    }
    try {
      await desktopBrowserTabAction(ctx, { ...input, tabId: input.tabIds[0]! }, 'reveal');
      if (!entry.active || lease.expiresAt <= Date.now()) {
        throw new DesktopBrowserError(
          409,
          'desktop_control_expired',
          'Browser control was cancelled while revealing the tab'
        );
      }
    } catch (error) {
      await releaseDesktopBrowserControl(ctx, lease).catch(() => {});
      throw error;
    }
    return lease;
  } catch (error) {
    entry.active = false;
    clearTimeout(timer);
    registry(ctx).delete(lease.leaseId);
    throw error;
  }
}

function requireLoopbackWs(wsEndpoint: string) {
  try {
    const url = new URL(wsEndpoint);
    if (url.protocol === 'ws:' && url.hostname === '127.0.0.1' && !url.username && !url.password) {
      return;
    }
  } catch {
    /* fall through */
  }
  throw new DesktopBrowserError(502, 'desktop_connection_scope', 'Desktop returned a non-loopback browser connection');
}

export async function openDesktopBrowserConnection(
  ctx: Pick<ProductHttpContext, 'db' | 'hub' | 'hostHub'>,
  input: ExperimentalDesktopBrowserLeaseRequest
) {
  const entry = requireLease(ctx, input);
  const result = await callDesktopBrowserRpc<{ wsEndpoint: string; expiresAt: number }>(
    ctx,
    input.hostId,
    {
      type: 'desktop.browser.open_connection',
      ...scopeCommand(input),
      leaseId: input.leaseId,
      tabIds: entry.lease.tabIds
    }
  );
  requireLoopbackWs(result.wsEndpoint);
  requireLease(ctx, input);
  return { ...result, hostId: input.hostId, expiresAt: entry.lease.expiresAt };
}

export async function desktopBrowserTabAction(
  ctx: Pick<ProductHttpContext, 'db' | 'hub' | 'hostHub'>,
  input: ExperimentalDesktopBrowserTabRequest,
  action: 'reveal' | 'close'
) {
  authorize(ctx, input);
  const result = await callDesktopBrowserRpc(ctx, input.hostId, {
    type: action === 'close' ? 'desktop.browser.close_tab' : 'desktop.browser.reveal_tab',
    ...scopeCommand(input),
    tabId: input.tabId
  });
  if (action === 'close') removeDesktopBrowserTab(ctx, input, input.tabId);
  return result;
}

export async function captureDesktopBrowserTab(
  ctx: Pick<ProductHttpContext, 'db' | 'hub' | 'hostHub'>,
  input: ExperimentalDesktopBrowserTabRequest
) {
  authorize(ctx, input);
  return callDesktopBrowserRpc(ctx, input.hostId, {
    type: 'desktop.browser.capture_tab',
    ...scopeCommand(input),
    tabId: input.tabId
  });
}

export async function listDesktopBrowserImportSources(
  ctx: Pick<ProductHttpContext, 'hostHub'>,
  input: ExperimentalDesktopBrowserInstanceRequest
) {
  return callDesktopBrowserRpc(ctx, input.hostId, {
    type: 'desktop.browser.list_import_sources',
    instanceId: input.instanceId,
    generation: input.generation
  });
}

export async function importDesktopBrowserCookies(
  ctx: Pick<ProductHttpContext, 'hostHub'>,
  input: ExperimentalDesktopBrowserImportCookiesRequest
) {
  return callDesktopBrowserRpc(ctx, input.hostId, {
    type: 'desktop.browser.import_cookies',
    instanceId: input.instanceId,
    generation: input.generation,
    sourceId: input.sourceId,
    sourceProfileDirectory: input.sourceProfileDirectory,
    profile: input.profile
  });
}

export async function revokeThreadDesktopBrowserControl(
  ctx: Pick<ProductHttpContext, 'db' | 'hub' | 'hostHub'>,
  threadId: string
) {
  const leases = [...registry(ctx).values()].filter((entry) => entry.lease.threadId === threadId);
  await Promise.allSettled(leases.map((entry) => releaseDesktopBrowserControl(ctx, entry.lease)));
}

export function syncDesktopBrowserTabs(
  ctx: Pick<ProductHttpContext, 'db' | 'hub'>,
  scope: ExperimentalDesktopBrowserScope,
  nativeTabs: DesktopBrowserTab[]
) {
  requireThread(ctx, scope.threadId);
  const stored = getThreadTabs(ctx.db, scope.threadId);
  const tabs = stored ? parseStoredTabs(stored.tabsJson) : [];
  const ids = new Set(nativeTabs.map((tab) => tab.tabId));
  const next = tabs.filter(
    (tab) =>
      !(
        tab.kind === 'browser'
        && tab.desktopTarget?.hostId === scope.hostId
        && tab.desktopTarget.instanceId === scope.instanceId
        && tab.desktopTarget.generation === scope.generation
        && !ids.has(tab.id)
      )
  );
  for (const tab of nativeTabs) {
    if (tab.threadId !== scope.threadId || tab.url.length > 4096) continue;
    const index = next.findIndex((value) => value.id === tab.tabId);
    const previous = next[index];
    if (
      previous
      && (
        previous.kind !== 'browser'
        || (
          previous.desktopTarget
          && (
            previous.desktopTarget.hostId !== scope.hostId
            || previous.desktopTarget.instanceId !== scope.instanceId
          )
        )
      )
    ) {
      continue;
    }
    const value: ThreadTab = {
      id: tab.tabId,
      kind: 'browser',
      environmentId: null,
      title: tab.title.slice(0, 1024) || null,
      url: tab.url,
      desktopTarget: {
        hostId: scope.hostId,
        instanceId: scope.instanceId,
        generation: scope.generation
      }
    };
    if (index === -1) next.push(value);
    else next[index] = value;
  }
  const parsed = threadTabsSchema.parse(next);
  if (JSON.stringify(parsed) === JSON.stringify(tabs)) return;
  const replaced = replaceThreadTabs(ctx.db, {
    threadId: scope.threadId,
    expectedRevision: stored?.revision ?? 0,
    tabsJson: JSON.stringify(parsed)
  });
  if (replaced === 'conflict') return;
  emitTabs(ctx, scope.threadId, replaced.revision, parsed);
}
