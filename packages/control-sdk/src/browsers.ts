import { ControlError } from './errors.js';
import type { ProductHttpClient } from './http.js';
import { listHosts, pickConnectedHost } from './hosts.js';

export type DesktopBrowserSkip = { skip: true; reason: string };

export type DesktopBrowserScope = {
  hostId: string;
  instanceId: string;
  generation: string;
  threadId: string;
};

export type DesktopBrowserInstanceScope = {
  hostId: string;
  instanceId: string;
  generation: string;
};

export type DesktopBrowserInstance = DesktopBrowserInstanceScope & {
  label?: string;
};

export type DesktopBrowserTab = {
  tabId: string;
  threadId?: string;
  url?: string;
  title?: string | null;
  profile?: { kind?: string; id?: string };
  control?: { controllerLabel?: string } | null;
};

export type DesktopBrowserLease = DesktopBrowserScope & {
  leaseId: string;
  tabIds: string[];
  controllerLabel: string;
  expiresAt: number;
};

export type DesktopBrowserConnection = {
  hostId: string;
  wsEndpoint: string;
  expiresAt: number;
};

export type DesktopBrowserCapture = {
  mimeType: string;
  width?: number;
  height?: number;
  base64: string;
};

export type DesktopBrowserCreated = {
  tab: DesktopBrowserTab;
};

export type PickedDesktopBrowser = {
  hostId: string;
  instance: DesktopBrowserInstance;
};

export function assertLoopbackWs(wsEndpoint: string): URL {
  let url: URL;
  try {
    url = new URL(wsEndpoint);
  } catch {
    throw new ControlError('HTTP_ERROR', 'Desktop returned a malformed browser connection');
  }
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new ControlError('HTTP_ERROR', 'Desktop returned a non-loopback browser connection');
  }
  return url;
}

export function jpegMagicOk(base64: string): boolean {
  const buf = Buffer.from(base64, 'base64');
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export function importSourcesLeakCookieMaterial(result: unknown): boolean {
  const json = JSON.stringify(result);
  return /encrypted_value|cookieValue|"cookies":/.test(json);
}

const DESKTOP_BROWSER_IMPORT_SOURCE_IDS = new Set([
  'chrome',
  'chromium',
  'edge',
  'brave',
  'vivaldi',
  'opera',
  'arc',
  'firefox',
  'safari'
]);

const DESKTOP_BROWSER_IMPORT_FAILURE_REASONS = new Set([
  'notInstalled',
  'needsKeychainApproval',
  'keychainItemMissing',
  'needsFullDiskAccess',
  'browserRunning',
  'unsupportedPlatform',
  'keychainUnavailable',
  'unknownSource',
  'unknownSourceProfile',
  'readFailed'
]);

const LIVE_MISSING_IMPORT_PROFILE = '__zcc-live-missing-profile__';

export type DesktopBrowserImportProbePlan = {
  sourceId: string;
  sourceProfileDirectory: string;
  copiesCookies: boolean;
};

export type DesktopBrowserImportOutcome =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; reason: string };

export type DesktopBrowserImportProbe = DesktopBrowserImportProbePlan & {
  outcome: DesktopBrowserImportOutcome;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listedImportSources(value: unknown): Array<{
  id: string;
  unavailable?: string;
  profiles: string[];
}> {
  const record = asRecord(value);
  const rows = record && Array.isArray(record.sources) ? record.sources : [];
  const listed: Array<{ id: string; unavailable?: string; profiles: string[] }> = [];
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec || typeof rec.id !== 'string' || !DESKTOP_BROWSER_IMPORT_SOURCE_IDS.has(rec.id)) continue;
    const profiles: string[] = [];
    if (Array.isArray(rec.profiles)) {
      for (const profile of rec.profiles) {
        const entry = asRecord(profile);
        if (entry && typeof entry.directory === 'string' && entry.directory.length > 0) {
          profiles.push(entry.directory);
        }
      }
    }
    listed.push({
      id: rec.id,
      profiles,
      ...(typeof rec.unavailable === 'string' ? { unavailable: rec.unavailable } : {})
    });
  }
  return listed;
}

export function planDesktopBrowserImportProbe(
  sources: unknown,
  opts: { copyCookies?: boolean } = {}
): DesktopBrowserImportProbePlan {
  const rows = listedImportSources(sources);
  if (rows.length === 0) {
    throw new ControlError('HTTP_ERROR', 'desktop browser import sources were empty');
  }
  if (opts.copyCookies) {
    const ready = rows.find((row) => !row.unavailable && row.profiles[0]);
    if (ready?.profiles[0]) {
      return {
        sourceId: ready.id,
        sourceProfileDirectory: ready.profiles[0],
        copiesCookies: true
      };
    }
  }
  const chosen = rows.find((row) => row.unavailable) ?? rows[0];
  return {
    sourceId: chosen.id,
    sourceProfileDirectory: LIVE_MISSING_IMPORT_PROFILE,
    copiesCookies: false
  };
}

export function parseDesktopBrowserImportOutcome(value: unknown): DesktopBrowserImportOutcome {
  if (importSourcesLeakCookieMaterial(value)) {
    throw new ControlError('HTTP_ERROR', 'desktop browser import leaked cookie material');
  }
  const rec = asRecord(value);
  if (!rec) {
    throw new ControlError('HTTP_ERROR', 'desktop browser import returned a malformed outcome');
  }
  if (rec.ok === true) {
    if (typeof rec.imported !== 'number' || typeof rec.skipped !== 'number') {
      throw new ControlError('HTTP_ERROR', 'desktop browser import returned a malformed outcome');
    }
    return { ok: true, imported: rec.imported, skipped: rec.skipped };
  }
  if (rec.ok === false && typeof rec.reason === 'string' && DESKTOP_BROWSER_IMPORT_FAILURE_REASONS.has(rec.reason)) {
    return { ok: false, reason: rec.reason };
  }
  throw new ControlError('HTTP_ERROR', 'desktop browser import returned a malformed outcome');
}

export async function probeLoopbackCdpVersion(
  wsEndpoint: string,
  timeoutMs = 10_000
): Promise<{ product?: string }> {
  assertLoopbackWs(wsEndpoint);
  if (typeof WebSocket === 'undefined') {
    throw new ControlError('HTTP_ERROR', 'WebSocket is not available to probe the desktop CDP endpoint');
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsEndpoint);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      reject(new ControlError('TIMEOUT', 'CDP Browser.getVersion timed out'));
    }, timeoutMs);
    const finish = (error?: unknown, product?: string) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      if (error) reject(error instanceof ControlError ? error : new ControlError('HTTP_ERROR', String(error)));
      else resolve({ product });
    };
    ws.addEventListener('error', () => finish(new ControlError('HTTP_ERROR', 'CDP WebSocket failed')));
    ws.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { result?: { product?: unknown } };
        const product = parsed.result && typeof parsed.result.product === 'string'
          ? parsed.result.product
          : undefined;
        finish(undefined, product);
      } catch (error) {
        finish(error);
      }
    });
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
    });
  });
}

export class DesktopBrowserHandle {
  constructor(
    readonly http: ProductHttpClient,
    readonly scope: DesktopBrowserScope
  ) {}

  async listTabs(): Promise<{ tabs: DesktopBrowserTab[] }> {
    const listed = await this.http.request<{ tabs?: DesktopBrowserTab[] }>(
      'POST',
      '/api/v1/desktop-browsers/tabs',
      { body: this.scope }
    );
    return { tabs: listed.tabs ?? [] };
  }

  async create(opts?: { url?: string; presentation?: 'hidden' | 'reveal' }): Promise<DesktopBrowserCreated> {
    const created = await this.http.request<DesktopBrowserCreated>(
      'POST',
      '/api/v1/desktop-browsers/create',
      {
        body: {
          ...this.scope,
          url: opts?.url ?? 'about:blank',
          presentation: opts?.presentation ?? 'hidden'
        }
      }
    );
    if (!created.tab?.tabId) {
      throw new ControlError('HTTP_ERROR', 'desktop browser create did not return a tab id');
    }
    return created;
  }

  async acquire(opts: {
    tabIds: string[];
    controllerLabel: string;
    ttlMs?: number;
    allowPersonal?: boolean;
  }): Promise<DesktopBrowserLease> {
    const lease = await this.http.request<DesktopBrowserLease>(
      'POST',
      '/api/v1/desktop-browsers/acquire',
      {
        body: {
          ...this.scope,
          tabIds: opts.tabIds,
          controllerLabel: opts.controllerLabel,
          ...(opts.ttlMs === undefined ? {} : { ttlMs: opts.ttlMs }),
          ...(opts.allowPersonal ? { allowPersonal: true } : {})
        }
      }
    );
    if (!lease.leaseId) {
      throw new ControlError('HTTP_ERROR', 'desktop browser acquire did not return a lease id');
    }
    return lease;
  }

  async connection(leaseId: string): Promise<DesktopBrowserConnection> {
    const opened = await this.http.request<DesktopBrowserConnection>(
      'POST',
      '/api/v1/desktop-browsers/connection',
      { body: { ...this.scope, leaseId } }
    );
    if (!opened.wsEndpoint) {
      throw new ControlError('HTTP_ERROR', 'desktop browser connection did not return a wsEndpoint');
    }
    assertLoopbackWs(opened.wsEndpoint);
    return opened;
  }

  async release(leaseId: string): Promise<{ ok: true }> {
    return this.http.request<{ ok: true }>(
      'POST',
      '/api/v1/desktop-browsers/release',
      { body: { ...this.scope, leaseId } }
    );
  }

  async reveal(tabId: string): Promise<{ ok: true }> {
    return this.http.request<{ ok: true }>(
      'POST',
      '/api/v1/desktop-browsers/reveal',
      { body: { ...this.scope, tabId } }
    );
  }

  async close(tabId: string): Promise<{ ok: true }> {
    return this.http.request<{ ok: true }>(
      'POST',
      '/api/v1/desktop-browsers/close',
      { body: { ...this.scope, tabId } }
    );
  }

  async capture(tabId: string): Promise<DesktopBrowserCapture> {
    const shot = await this.http.request<DesktopBrowserCapture>(
      'POST',
      '/api/v1/desktop-browsers/capture',
      { body: { ...this.scope, tabId } }
    );
    if (typeof shot.base64 !== 'string' || shot.base64.length === 0) {
      throw new ControlError('HTTP_ERROR', 'desktop browser capture did not return an image');
    }
    return shot;
  }
}

export async function listDesktopBrowserInstances(
  http: ProductHttpClient,
  hostId: string
): Promise<{ instances: DesktopBrowserInstance[] }> {
  const listed = await http.request<{ instances?: Array<DesktopBrowserInstance & { hostId?: string }> }>(
    'POST',
    '/api/v1/desktop-browsers/instances',
    { body: { hostId } }
  );
  return {
    instances: (listed.instances ?? []).map((row) => ({ ...row, hostId: row.hostId ?? hostId }))
  };
}

export async function listDesktopBrowserImportSources(
  http: ProductHttpClient,
  scope: DesktopBrowserInstanceScope
): Promise<unknown> {
  return http.request('POST', '/api/v1/desktop-browsers/import-sources', {
    body: {
      hostId: scope.hostId,
      instanceId: scope.instanceId,
      generation: scope.generation
    }
  });
}

export async function importDesktopBrowserCookies(
  http: ProductHttpClient,
  input: DesktopBrowserInstanceScope & {
    sourceId: string;
    sourceProfileDirectory: string;
    profile?: { kind: 'personal' } | { kind: 'automation'; id: string };
  }
): Promise<unknown> {
  return http.request('POST', '/api/v1/desktop-browsers/import-cookies', {
    body: {
      hostId: input.hostId,
      instanceId: input.instanceId,
      generation: input.generation,
      sourceId: input.sourceId,
      sourceProfileDirectory: input.sourceProfileDirectory,
      ...(input.profile ? { profile: input.profile } : {})
    }
  });
}

export async function runDesktopBrowserImportProbe(
  http: ProductHttpClient,
  input: DesktopBrowserInstanceScope & {
    threadId: string;
    sources: unknown;
    copyCookies?: boolean;
  }
): Promise<DesktopBrowserImportProbe> {
  const plan = planDesktopBrowserImportProbe(input.sources, { copyCookies: input.copyCookies });
  const outcome = parseDesktopBrowserImportOutcome(
    await importDesktopBrowserCookies(http, {
      hostId: input.hostId,
      instanceId: input.instanceId,
      generation: input.generation,
      sourceId: plan.sourceId,
      sourceProfileDirectory: plan.sourceProfileDirectory,
      profile: { kind: 'automation', id: input.threadId }
    })
  );
  if (!plan.copiesCookies && outcome.ok) {
    throw new ControlError(
      'HTTP_ERROR',
      'desktop browser import copied cookies during a non-copy probe'
    );
  }
  return { ...plan, outcome };
}

export async function pickDesktopBrowserInstance(
  http: ProductHttpClient,
  opts: { hostId?: string; isolated?: boolean } = {}
): Promise<PickedDesktopBrowser | DesktopBrowserSkip> {
  if (opts.isolated) {
    return {
      skip: true,
      reason: 'Desktop browser needs an attached Electron app (isolated stacks have no BrowserView).'
    };
  }
  let host;
  try {
    host = pickConnectedHost(await listHosts(http), opts.hostId);
  } catch (error) {
    if (error instanceof ControlError && error.code === 'APP_NOT_RUNNING') throw error;
    return { skip: true, reason: 'Could not list connected hosts for desktop browser.' };
  }
  if (!host) {
    return { skip: true, reason: 'No connected host for desktop browser.' };
  }
  const { instances } = await listDesktopBrowserInstances(http, host.id);
  const instance = instances[0];
  if (!instance) {
    return { skip: true, reason: `No desktop windows registered on host ${host.id}.` };
  }
  return { hostId: host.id, instance };
}

export async function runDesktopBrowserLeaseCycle(
  handle: DesktopBrowserHandle,
  opts: {
    url?: string;
    controllerLabel?: string;
    ttlMs?: number;
    probeCdp?: boolean;
    cdpTimeoutMs?: number;
  } = {}
): Promise<{
  tabId: string;
  leaseId: string;
  wsEndpoint: string;
  capture: DesktopBrowserCapture;
  cdpProduct?: string;
}> {
  const created = await handle.create({
    url: opts.url ?? 'about:blank',
    presentation: 'hidden'
  });
  const tabId = created.tab.tabId;
  let leaseId: string | undefined;
  try {
    const lease = await handle.acquire({
      tabIds: [tabId],
      controllerLabel: opts.controllerLabel ?? 'zcc-live',
      ttlMs: opts.ttlMs ?? 30_000
    });
    leaseId = lease.leaseId;
    const connection = await handle.connection(leaseId);
    let cdpProduct: string | undefined;
    if (opts.probeCdp) {
      cdpProduct = (await probeLoopbackCdpVersion(connection.wsEndpoint, opts.cdpTimeoutMs ?? 10_000)).product;
    }
    const capture = await handle.capture(tabId);
    return {
      tabId,
      leaseId,
      wsEndpoint: connection.wsEndpoint,
      capture,
      cdpProduct
    };
  } finally {
    if (leaseId) await handle.release(leaseId).catch(() => undefined);
    await handle.close(tabId).catch(() => undefined);
  }
}
