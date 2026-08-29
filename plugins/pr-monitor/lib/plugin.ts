import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { computeNavBadge } from './badge.js';
import type { PrMonitorContext } from './context.js';
import { createGhExec } from './gh-exec.js';
import { inboxDeliveriesForDeltas } from './inbox-delivery.js';
import { defaultPrMonitorDataDir, migrateLegacyKv } from './migrate.js';
import { setupPrMonitor } from './pr-main.js';
import { invokeRpc } from './rpc.js';
import {
  DEFAULT_PR_MONITOR_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type MonitoredPr,
  type PrMonitorSettings,
  type PrStatusDelta,
  type SyncHealth
} from './types.js';

type PollAllResult = {
  ok: boolean;
  prs?: MonitoredPr[];
  deltas?: PrStatusDelta[];
  health?: SyncHealth;
  error?: string;
};

export interface PrMonitorPluginDeps {
  exec?: PrMonitorContext['exec'];
  dataDir?: string;
  startBackground?: boolean;
  pollIntervalMs?: number;
  /** Test seam so background-inbox coverage never spawns `gh`. */
  pollAll?: () => Promise<PollAllResult>;
}

const MIN_POLL_MINUTES = 15;
const MAX_POLL_MINUTES = 120;

function clampPollMs(minutes: number | undefined, overrideMs?: number): number {
  if (typeof overrideMs === 'number' && overrideMs > 0) return overrideMs;
  const value = Number.isFinite(minutes) ? Number(minutes) : DEFAULT_PR_MONITOR_SETTINGS.pollIntervalMinutes;
  const clamped = Math.min(MAX_POLL_MINUTES, Math.max(MIN_POLL_MINUTES, value));
  return clamped * 60_000;
}

async function readSettings(zcc: ZccPluginApi): Promise<PrMonitorSettings> {
  const stored = await zcc.storage.kv.get<PrMonitorSettings>(SETTINGS_STORAGE_KEY);
  return { ...DEFAULT_PR_MONITOR_SETTINGS, ...stored };
}

export async function createPrMonitorPlugin(zcc: ZccPluginApi, deps: PrMonitorPluginDeps = {}): Promise<void> {
  await migrateLegacyKv(zcc.storage.kv, deps.dataDir ?? defaultPrMonitorDataDir());
  const exec = deps.exec ?? createGhExec();
  const ctx: PrMonitorContext = {
    moduleId: zcc.pluginId,
    log: (message) => zcc.log.info(message),
    exec,
    storage: {
      get: (key) => zcc.storage.kv.get(key),
      set: (key, value) => zcc.storage.kv.set(key, value)
    }
  };
  const methods = setupPrMonitor(ctx);

  for (const [name, handler] of Object.entries(methods)) {
    if (typeof handler !== 'function') continue;
    zcc.rpc.method(name, (args) => invokeRpc(handler as (...fnArgs: never[]) => unknown, args));
  }

  zcc.rpc.method('storageGet', async (key) => {
    if (typeof key !== 'string' || !key.trim()) return undefined;
    return zcc.storage.kv.get(key);
  });
  zcc.rpc.method('storageSet', async (args) => {
    const rec = args as { key?: unknown; value?: unknown };
    if (typeof rec?.key !== 'string' || !rec.key.trim()) {
      throw new Error('storageSet requires a key');
    }
    await zcc.storage.kv.set(rec.key, rec.value);
  });
  zcc.rpc.method('listProjects', async () => zcc.sdk.projects.list());
  zcc.rpc.method('pushInbox', async (args) => {
    const rec = args as { projectId?: unknown; comments?: unknown };
    const projectId = typeof rec?.projectId === 'string' ? rec.projectId.trim() : '';
    const comments = typeof rec?.comments === 'string' ? rec.comments : '';
    if (!projectId || !comments.trim()) {
      throw new Error('pushInbox requires projectId and comments');
    }
    return zcc.sdk.inbox.push({ projectId, comments });
  });
  zcc.rpc.method('badge', async () => {
    const prs = await methods.listPrs();
    const settings = await readSettings(zcc);
    return { count: computeNavBadge({ settings, prs }) };
  });

  async function deliverInbox(deltas: PrStatusDelta[] | undefined): Promise<void> {
    if (!deltas?.length) return;
    const settings = await readSettings(zcc);
    for (const delivery of inboxDeliveriesForDeltas(deltas, settings)) {
      try {
        await zcc.sdk.inbox.push({ projectId: delivery.projectId, comments: delivery.comments });
      } catch (err) {
        zcc.log.warn(
          `inbox push failed for ${delivery.pr.repo}#${delivery.pr.number}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  if (deps.startBackground === false) return;

  zcc.background.service('poll', () => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      const settings = await readSettings(zcc);
      if (settings.autoSyncEnabled !== false) {
        try {
          const result = (await (deps.pollAll ?? methods.pollAll)()) as PollAllResult;
          if (result.ok) await deliverInbox(result.deltas);
        } catch (err) {
          zcc.log.warn(`poll failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (stopped) return;
      const waitMs = clampPollMs(settings.pollIntervalMinutes, deps.pollIntervalMs);
      timer = setTimeout(() => {
        void tick();
      }, waitMs);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  });
}
