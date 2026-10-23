import { DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS } from '@zana-ai/zcc-host-daemon-contract';
import type { HostBridgeLaunch } from '@zana-ai/zcc-contracts/host-rpc';
import type {
  PluginProviderDeclaration,
  PluginProviderHandle
} from '@zana-ai/zcc-plugin-sdk/server';
import type { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';

export interface ThreadProviderRecord extends PluginProviderDeclaration {
  pluginId: string;
  hostEntry: string | null;
  unavailableReason?: string;
}

const providers = new Map<string, ThreadProviderRecord[]>();
const registrationListeners = new Set<() => void>();
let providerStartup: Promise<unknown> | null = null;
const pluginStartupDeadlines = new WeakMap<Promise<unknown>, number>();

export const THREAD_PROVIDER_STARTUP_WAIT_MS = 30_000;

function currentProvider(id: string): ThreadProviderRecord | undefined {
  return providers.get(id)?.at(-1);
}

function fakeProviderEnabled(): boolean {
  return process.env.ZCC_FAKE_PROVIDER === '1' || process.env.ZCC_AGENT_RUNTIME_ADAPTER === 'fake';
}

const FAKE_DECLARATION: PluginProviderDeclaration & { pluginId: string; hostEntry: string } = {
  pluginId: 'provider-fake',
  id: 'fake',
  displayName: 'Fake',
  icon: './icons/pi.svg',
  hostEntry: 'src/bridge/bridge.ts',
  capabilities: {
    supportsServiceTier: true,
    fork: 'checkpoint',
    supportsManualCompaction: true,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ['full'],
    reasoningLevels: ['none', 'low', 'medium', 'high']
  },
  models: {
    scope: 'host',
    fallback: [{
      id: 'fake-model',
      displayName: 'Fake Model',
      description: 'In-process fake provider model',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Low' },
        { reasoningEffort: 'medium', description: 'Medium' },
        { reasoningEffort: 'high', description: 'High' }
      ],
      defaultReasoningEffort: 'medium',
      isDefault: true
    }]
  },
  composerActions: ['plan']
};

function syncFakeProvider(): void {
  if (fakeProviderEnabled()) {
    if (!providers.has('fake')) providers.set('fake', [FAKE_DECLARATION]);
  } else {
    providers.delete('fake');
  }
}

export function registerThreadProvider(
  pluginId: string,
  declaration: PluginProviderDeclaration,
  hostEntry?: string | null,
  unavailableReason?: string
): PluginProviderHandle {
  const record: ThreadProviderRecord = {
    ...declaration,
    pluginId,
    ...(unavailableReason ? { unavailableReason } : {}),
    hostEntry: hostEntry ?? currentProvider(declaration.id)?.hostEntry ?? 'src/bridge/bridge.ts'
  };
  const stack = providers.get(declaration.id) ?? [];
  stack.push(record);
  providers.set(declaration.id, stack);
  for (const listener of [...registrationListeners]) listener();
  return {
    id: declaration.id,
    unregister() {
      const current = providers.get(declaration.id);
      if (!current) return;
      const next = current.filter((entry) => entry !== record);
      if (next.length > 0) providers.set(declaration.id, next);
      else providers.delete(declaration.id);
    }
  };
}

/** Plugin startup registers providers as each plugin loads; thread creation waits on it. */
export function trackThreadProviderStartup(startup: Promise<unknown>): void {
  providerStartup = startup;
}

/**
 * A host can connect as soon as the server listens, before plugin startup has
 * begun. Call this before listening so provider waits hold from then on; call
 * the returned release once plugin startup settles.
 */
export function holdThreadProviderStartup(): () => void {
  let release!: () => void;
  trackThreadProviderStartup(new Promise<void>((resolve) => { release = resolve; }));
  return release;
}

/**
 * Bundled plugins load one at a time after launch, and a provider joins the
 * catalog only once its plugin has loaded. Resolves when `providerId` registers,
 * plugin startup settles, or `timeoutMs` passes, so a thread created right after
 * launch does not fail with `unknown thread provider`.
 */
export function waitForThreadProvider(
  providerId: string,
  timeoutMs = THREAD_PROVIDER_STARTUP_WAIT_MS
): Promise<void> {
  const startup = providerStartup;
  if (!startup || getThreadProvider(providerId)) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      registrationListeners.delete(onRegister);
      resolve();
    };
    const onRegister = () => {
      if (getThreadProvider(providerId)) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    registrationListeners.add(onRegister);
    startup.then(finish, finish);
  });
}

/**
 * Plugin agent tools register as each plugin activates, in load order, so a
 * thread created as soon as its provider registers would otherwise miss the
 * tools of plugins that load after the provider. Resolves `true` once plugin
 * startup settles (or when none is tracked), `false` after `timeoutMs`.
 * The bound runs once per startup, from its first wait: later waits get only
 * the time left, so a hung plugin activation delays threads by at most one bound.
 */
export function waitForPluginStartup(timeoutMs = THREAD_PROVIDER_STARTUP_WAIT_MS): Promise<boolean> {
  const startup = providerStartup;
  if (!startup) return Promise.resolve(true);
  let deadline = pluginStartupDeadlines.get(startup);
  if (deadline === undefined) {
    deadline = Date.now() + timeoutMs;
    pluginStartupDeadlines.set(startup, deadline);
  }
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), remainingMs);
    const finish = () => {
      clearTimeout(timer);
      resolve(true);
    };
    startup.then(finish, finish);
  });
}

export function listThreadProviders(): ThreadProviderRecord[] {
  syncFakeProvider();
  const rows = [...providers.values()].flatMap((stack) => stack.at(-1) ?? []);
  if (!fakeProviderEnabled()) return rows;
  return rows.sort((a, b) => Number(b.id === 'fake') - Number(a.id === 'fake'));
}

export function getThreadProvider(providerId: string): ThreadProviderRecord | undefined {
  syncFakeProvider();
  return currentProvider(canonicalThreadProviderId(providerId));
}

export function canonicalThreadProviderId(providerId: string): string {
  if (providerId === 'claude' || providerId === 'claude-yolo') return 'claude-code';
  if (providerId === 'cursor') return 'acp-cursor';
  if (providerId === 'opencode' || providerId === 'opencode-resume' || providerId === 'opencode-yolo') return 'acp-opencode';
  if (providerId === 'grok' || providerId === 'grok-resume' || providerId === 'grok-yolo') return 'acp-grok';
  if (providerId === 'mastracode' || providerId === 'mastracode-resume' || providerId === 'mastracode-yolo') {
    return 'acp-mastracode';
  }
  if (providerId === 'afcode' || providerId === 'afcode-resume' || providerId === 'afcode-yolo') return 'acp-afcode';
  return providerId;
}

export function permissionModeForLaunchProfile(providerId: string): 'accept-edits' | 'auto' | 'full' {
  return providerId === 'claude-yolo'
    || providerId === 'opencode-yolo'
    || providerId === 'grok-yolo'
    || providerId === 'mastracode-yolo'
    || providerId === 'afcode-yolo'
    ? 'full'
    : 'accept-edits';
}

export const DEFAULT_PLAN_COMMAND = { trigger: '/', name: 'plan' } as const;

export function planCommandForProvider(providerId: string) {
  const provider = getThreadProvider(providerId);
  if (!provider?.composerActions?.includes('plan')) return null;
  return DEFAULT_PLAN_COMMAND;
}

function isDaemonBundledProvider(providerId: string): boolean {
  return providerId === 'fake' || DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS.includes(providerId);
}

function launchCapabilities(provider: ThreadProviderRecord): HostBridgeLaunch['capabilities'] {
  return {
    supportsServiceTier: provider.capabilities.supportsServiceTier,
    permissionModes: provider.capabilities.permissionModes,
    supportsThreadArchive: provider.capabilities.supportsThreadArchive,
    supportsThreadRename: provider.capabilities.supportsThreadRename,
    fork: provider.capabilities.fork
  };
}

export function bridgeLaunchForProvider(
  providerId: string,
  artifacts: Pick<PluginHostArtifactRegistry, 'get'>
): HostBridgeLaunch {
  const provider = getThreadProvider(providerId);
  if (!provider) {
    throw new Error(`unknown thread provider: ${providerId}`);
  }
  if (provider.unavailableReason) {
    throw new Error(`Provider "${provider.displayName}" is unavailable: ${provider.unavailableReason}. Open Plugins to reload or update "${provider.pluginId}".`);
  }
  if (isDaemonBundledProvider(provider.id)) {
    return {
      pluginId: provider.pluginId,
      ...(provider.env ? { envPassthrough: [...provider.env.passthrough] } : {}),
      source: { kind: 'daemon-bundled', id: provider.id },
      capabilities: launchCapabilities(provider)
    };
  }
  const artifact = artifacts.get(provider.pluginId);
  if (artifact === undefined) {
    throw new Error(
      `Provider "${providerId}" has no host artifact to run. Its plugin may be disabled or still building.`
    );
  }
  return {
    pluginId: provider.pluginId,
    ...(provider.env ? { envPassthrough: [...provider.env.passthrough] } : {}),
    source: {
      kind: 'artifact',
      digest: artifact.digest,
      byteLength: artifact.byteLength
    },
    capabilities: launchCapabilities(provider)
  };
}
