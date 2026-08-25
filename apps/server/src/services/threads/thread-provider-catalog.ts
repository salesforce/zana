import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { HostBridgeLaunch } from '@zana-ai/zcc-contracts/host-rpc';
import type {
  PluginProviderDeclaration,
  PluginProviderHandle
} from '@zana-ai/zcc-plugin-sdk/server';

export interface ThreadProviderRecord extends PluginProviderDeclaration {
  pluginId: string;
  hostEntry: string | null;
}

const providers = new Map<string, ThreadProviderRecord>();

const BUILTIN_DECLARATIONS: Array<PluginProviderDeclaration & { pluginId: string; hostEntry: string }> = [
  {
    pluginId: 'provider-claude-code',
    id: 'claude-code',
    displayName: 'Claude Code',
    icon: './icons/claude-code.svg',
    hostEntry: 'src/bridge/bridge.ts',
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: true,
      fork: 'checkpoint',
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: true,
      permissionModes: ['accept-edits', 'auto', 'full'],
      reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'ultracode', 'max']
    },
    composerActions: ['plan']
  },
  {
    pluginId: 'provider-codex',
    id: 'codex',
    displayName: 'Codex',
    icon: './icons/codex.svg',
    hostEntry: 'src/bridge/bridge.ts',
    capabilities: {
      supportsServiceTier: true,
      fork: 'checkpoint',
      supportsManualCompaction: true,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      permissionModes: ['accept-edits', 'auto', 'full'],
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
    },
    composerActions: ['plan', 'goal']
  },
  {
    pluginId: 'provider-pi',
    id: 'pi',
    displayName: 'Pi',
    icon: './icons/pi.svg',
    hostEntry: 'src/bridge/bridge.ts',
    capabilities: {
      supportsServiceTier: false,
      fork: 'checkpoint',
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ['full'],
      reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
    },
    composerActions: []
  },
  {
    pluginId: 'provider-acp',
    id: 'acp-cursor',
    displayName: 'Cursor',
    icon: './icons/cursor.svg',
    hostEntry: 'src/bridge/bridge.ts',
    capabilities: {
      supportsServiceTier: true,
      fork: 'tip',
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ['accept-edits', 'full'],
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max']
    },
    composerActions: []
  },
  {
    pluginId: 'provider-acp',
    id: 'acp-opencode',
    displayName: 'OpenCode',
    icon: './icons/opencode.svg',
    hostEntry: 'src/bridge/bridge.ts',
    capabilities: {
      supportsServiceTier: true,
      fork: 'tip',
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ['accept-edits', 'full'],
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max']
    },
    composerActions: []
  }
];

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
    supportsServiceTier: false,
    fork: 'checkpoint',
    supportsManualCompaction: true,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ['full'],
    reasoningLevels: ['none', 'low', 'medium', 'high']
  },
  composerActions: ['plan']
};

function seedBuiltins(): void {
  for (const entry of BUILTIN_DECLARATIONS) {
    if (!providers.has(entry.id)) providers.set(entry.id, entry);
  }
}

function syncFakeProvider(): void {
  seedBuiltins();
  if (fakeProviderEnabled()) {
    if (!providers.has('fake')) providers.set('fake', FAKE_DECLARATION);
  } else {
    providers.delete('fake');
  }
}

seedBuiltins();

export function registerThreadProvider(
  pluginId: string,
  declaration: PluginProviderDeclaration,
  hostEntry?: string | null
): PluginProviderHandle {
  providers.set(declaration.id, {
    ...declaration,
    pluginId,
    hostEntry: hostEntry ?? providers.get(declaration.id)?.hostEntry ?? null
  });
  return {
    id: declaration.id,
    unregister() {
      const current = providers.get(declaration.id);
      if (current?.pluginId === pluginId) providers.delete(declaration.id);
      seedBuiltins();
    }
  };
}

export function listThreadProviders(): ThreadProviderRecord[] {
  syncFakeProvider();
  const rows = [...providers.values()];
  if (!fakeProviderEnabled()) return rows;
  return rows.sort((a, b) => Number(b.id === 'fake') - Number(a.id === 'fake'));
}

export function getThreadProvider(providerId: string): ThreadProviderRecord | undefined {
  syncFakeProvider();
  return providers.get(canonicalThreadProviderId(providerId));
}

export function canonicalThreadProviderId(providerId: string): string {
  if (providerId === 'claude' || providerId === 'claude-yolo') return 'claude-code';
  if (providerId === 'cursor') return 'acp-cursor';
  if (providerId === 'opencode' || providerId === 'opencode-resume') return 'acp-opencode';
  return providerId;
}

export function permissionModeForLaunchProfile(providerId: string): 'accept-edits' | 'auto' | 'full' {
  return providerId === 'claude-yolo' ? 'full' : 'accept-edits';
}

function pluginRoot(pluginId: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../../plugins', pluginId),
    join(process.cwd(), 'plugins', pluginId)
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}

export function bridgeLaunchForProvider(
  providerId: string,
  dataDir: string
): HostBridgeLaunch {
  const provider = getThreadProvider(providerId);
  if (!provider) {
    throw new Error(`unknown thread provider: ${providerId}`);
  }
  const relative = provider.hostEntry ?? 'src/bridge/bridge.ts';
  const artifactPath = join(pluginRoot(provider.pluginId), relative);
  const digest = createHash('sha256').update(artifactPath).digest('hex');
  if (provider.id === 'pi' || provider.id === 'fake') {
    return {
      pluginId: provider.pluginId,
      dataDir,
      source: { kind: 'daemon-bundled', id: provider.id },
      capabilities: {
        supportsServiceTier: provider.capabilities.supportsServiceTier,
        permissionModes: provider.capabilities.permissionModes,
        supportsThreadArchive: provider.capabilities.supportsThreadArchive,
        supportsThreadRename: provider.capabilities.supportsThreadRename,
        fork: provider.capabilities.fork
      }
    };
  }
  return {
    pluginId: provider.pluginId,
    dataDir,
    source: { kind: 'artifact', digest, artifactPath },
    capabilities: {
      supportsServiceTier: provider.capabilities.supportsServiceTier,
      permissionModes: provider.capabilities.permissionModes,
      supportsThreadArchive: provider.capabilities.supportsThreadArchive,
      supportsThreadRename: provider.capabilities.supportsThreadRename,
      fork: provider.capabilities.fork
    }
  };
}
