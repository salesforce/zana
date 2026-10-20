import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';
import { THREAD_SESSION_RELEASE_DEFAULTS, type AppConfig } from '@zana-ai/zcc-domain/product';
import {
  createAgentRuntimeAdapter,
  type CreateAgentRuntimeFn
} from './agent-runtime-adapter.js';
import type { ThreadRuntimeAdapter } from './thread-runtime-types.js';

export type { ThreadRuntimeAdapter } from './thread-runtime-types.js';

export const IDLE_PROVIDER_SESSION_REAP_AFTER_MS = THREAD_SESSION_RELEASE_DEFAULTS.minutes * 60 * 1000;
export const IDLE_PROVIDER_SESSION_REAP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Host-side AgentRuntime manager. Lives beside PtyManager: this path owns
 * thread.start / turn.submit / thread.stop / thread.resume. It never imports
 * PtyManager, LaunchProvider, or HARNESS_REGISTRATIONS.
 *
 * Owns per-environment skill-catalog refresh (idle environments only) and
 * idle provider-session reaping. Busy runtimes keep their current catalog
 * until they have no threads and no background work.
 */
export function createRuntimeManager(options: {
  emit: (event: HostEventEnvelope) => void;
  dataDir?: string;
  loadConfig?: Parameters<typeof createAgentRuntimeAdapter>[0]['loadConfig'];
  createRuntime?: CreateAgentRuntimeFn;
  bridgeBundleDir?: string;
  getRemoteDefaultPath?: Parameters<typeof createAgentRuntimeAdapter>[0]['getRemoteDefaultPath'];
  onInteractiveRequest?: Parameters<typeof createAgentRuntimeAdapter>[0]['onInteractiveRequest'];
  onPluginToolCall?: Parameters<typeof createAgentRuntimeAdapter>[0]['onPluginToolCall'];
  fetchPluginHostArtifact?: Parameters<typeof createAgentRuntimeAdapter>[0]['fetchPluginHostArtifact'];
  artifactCacheLogger?: Parameters<typeof createAgentRuntimeAdapter>[0]['artifactCacheLogger'];
  onProcessExit?: Parameters<typeof createAgentRuntimeAdapter>[0]['onProcessExit'];
  /** Set 0 to disable. Defaults to 5 minutes. */
  idleReapIntervalMs?: number;
  /** Overrides Settings `threadSessionReleaseMinutes`. */
  idleReapAfterMs?: number;
}): ThreadRuntimeAdapter {
  const adapter = createAgentRuntimeAdapter(options);
  const intervalMs = options.idleReapIntervalMs ?? IDLE_PROVIDER_SESSION_REAP_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  if (intervalMs > 0) {
    timer = setInterval(() => {
      void adapter.refreshSkillCatalog();
      const idleForMs = options.idleReapAfterMs ?? idleReapAfterMsFromConfig(options.loadConfig);
      if (idleForMs === null) return;
      void adapter.reapIdleProviderSessions({
        idleForMs,
        nowMs: Date.now(),
        providerSessionReapingEnabled: true
      });
    }, intervalMs);
    timer.unref?.();
  }
  return {
    ...adapter,
    dispose() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      adapter.dispose();
    }
  };
}

/**
 * Settings `threadSessionReleaseMinutes`, read on every sweep so a change
 * applies without restarting the daemon. `null` means never release. The
 * daemon reads config.json directly, so the value is validated here too.
 */
export function idleReapAfterMsFromConfig(loadConfig?: () => AppConfig): number | null {
  let minutes: unknown;
  try {
    minutes = loadConfig?.().threadSessionReleaseMinutes;
  } catch {
    minutes = undefined;
  }
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return IDLE_PROVIDER_SESSION_REAP_AFTER_MS;
  if (minutes <= 0) return null;
  const clamped = Math.max(
    THREAD_SESSION_RELEASE_DEFAULTS.minMinutes,
    Math.min(THREAD_SESSION_RELEASE_DEFAULTS.maxMinutes, Math.round(minutes))
  );
  return clamped * 60 * 1000;
}
