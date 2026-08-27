import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProviderCliStatus } from '@zana-ai/zcc-contracts/host-rpc';
import { MachineCard, MachineCliInventory } from './MachineCard.js';
import { MachinesTab, RelayStatusLine } from './MachinesSettingsView.js';

const hostsState: { current: Host[] } = { current: [] };
const projectsState: { current: Array<{ hostId?: string }> } = { current: [] };

vi.mock('../../lib/product-client.js', () => ({
  product: {
    hosts: {
      list: async () => [],
      onChanged: () => () => {},
      providerCliStatus: async () => ({}),
      installProviderCli: async () => [],
      update: async () => undefined,
      updatePermissionCeiling: async () => undefined,
      retryUpdate: async () => undefined,
      remove: async () => undefined
    },
    relay: {
      status: async () => ({ state: 'unconfigured' }),
      onChanged: () => () => {}
    }
  }
}));

vi.mock('../../hooks/useHosts.js', () => ({
  useHosts: () => hostsState.current
}));

vi.mock('@/store', () => ({
  useData: (selector: (s: { projects: Array<{ hostId?: string }> }) => unknown) =>
    selector({ projects: projectsState.current })
}));

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  publicAppUrl: 'https://box.tailnet.ts.net'
};

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h1',
    name: 'grebmann-ltmmfjc.internal.salesforce.com',
    type: 'persistent',
    status: 'connected',
    maxPermissionMode: 'full',
    lastSeenAt: 1_700_000_000_000,
    lastRejectedProtocolVersion: null,
    isPrimary: false,
    canRepairViaSsh: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function cli(overrides: Partial<ProviderCliStatus> = {}): ProviderCliStatus {
  return {
    displayName: 'Codex',
    executableName: 'codex',
    executablePath: '/usr/local/bin/codex',
    installed: true,
    installSource: 'npmGlobal',
    currentVersion: '0.145.0',
    latestVersion: '0.150.0',
    minimumSupportedVersion: '0.136.0',
    npmPackageName: '@openai/codex',
    npmGlobalPackageVersion: '0.145.0',
    installAction: {
      kind: 'update',
      label: 'Update',
      commandKind: 'exec',
      command: 'codex update'
    },
    needsUpdate: true,
    versionUnsupported: false,
    ...overrides
  };
}

describe('MachinesTab', () => {
  it('renders the public origin field and add-machine control', () => {
    hostsState.current = [];
    projectsState.current = [];
    const html = renderToStaticMarkup(
      <MachinesTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Public app URL');
    expect(html).toContain('Relay token');
    expect(html).toContain('Add a machine');
    expect(html).toContain('https://box.tailnet.ts.net');
    expect(html).toContain('data-testid="machines-list"');
    expect(html).toContain('data-testid="relay-status"');
    expect(html).not.toContain('data-testid="machines-empty"');
    expect(html).toContain('Connected machines follow the server version automatically');
  });

  it('treats a blank public app URL as empty', () => {
    hostsState.current = [];
    const html = renderToStaticMarkup(
      <MachinesTab
        config={{ ...config, publicAppUrl: undefined }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('placeholder="https://your-app.herokuapp.com"');
    expect(html).toContain('value=""');
  });

  it('renders paired machines as cards', () => {
    hostsState.current = [host({ isPrimary: true, name: 'MacBook' })];
    projectsState.current = [{ hostId: 'h1' }, { hostId: 'h1' }, {}];
    const html = renderToStaticMarkup(
      <MachinesTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('data-testid="machines-list"');
    expect(html).toContain('MacBook');
    expect(html).toContain('this machine');
    expect(html).toContain('2 projects');
    expect(html).toContain('Permission ceiling');
    expect(html).not.toContain('data-testid="machines-empty"');
  });
});

describe('RelayStatusLine', () => {
  it('renders connected and offline as status, not a layout preference', () => {
    expect(renderToStaticMarkup(<RelayStatusLine state="connected" />)).toContain('Connected');
    expect(renderToStaticMarkup(<RelayStatusLine state="offline" />)).toContain('Offline');
    expect(renderToStaticMarkup(<RelayStatusLine state="unconfigured" />)).toContain('Not configured');
  });
});

describe('MachineCliInventory', () => {
  it('aligns name, current→latest version, status, and action on one row', () => {
    const html = renderToStaticMarkup(
      <MachineCliInventory
        hostId="h1"
        rows={[
          { provider: 'codex', status: cli() },
          {
            provider: 'claudeCode',
            status: cli({
              displayName: 'Claude Code',
              currentVersion: '2.1.246',
              latestVersion: '2.1.246',
              needsUpdate: false,
              installAction: null
            })
          }
        ]}
        busyKey={null}
        onInstall={vi.fn()}
      />
    );
    expect(html).toContain('Harness CLIs');
    expect(html).toContain('1 update');
    expect(html).toContain('Codex');
    expect(html).toContain('0.145.0');
    expect(html).toContain('0.150.0');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Current');
    expect(html).toContain('Update');
    expect(html).toContain('machine-cli-row--warn');
    expect(html).toContain('machine-cli-row--ok');
    expect(html).toContain('data-testid="machine-cli-list-h1"');
  });

  it('shows an unsupported badge when there is no install action', () => {
    const html = renderToStaticMarkup(
      <MachineCliInventory
        hostId="h1"
        rows={[{
          provider: 'codex',
          status: cli({
            versionUnsupported: true,
            installAction: null,
            latestVersion: '0.150.0'
          })
        }]}
        busyKey={null}
        onInstall={vi.fn()}
      />
    );
    expect(html).toContain('Unsupported');
    expect(html).toContain('settings-badge--warn');
    expect(html).not.toContain('settings-btn');
  });

  it('shows a checking placeholder when inventory has not arrived', () => {
    const html = renderToStaticMarkup(
      <MachineCliInventory hostId="h1" rows={[]} busyKey={null} onInstall={vi.fn()} />
    );
    expect(html).toContain('Checking harness CLIs');
    expect(html).not.toContain('machine-cli-list-h1');
  });

  it('shows Working… on the busy row', () => {
    const html = renderToStaticMarkup(
      <MachineCliInventory
        hostId="h1"
        rows={[{ provider: 'codex', status: cli() }]}
        busyKey="h1:codex"
        onInstall={vi.fn()}
      />
    );
    expect(html).toContain('Working…');
  });
});

describe('MachineCard', () => {
  it('keeps identity, ceiling, and CLI inventory in a card instead of one cramped row', () => {
    const html = renderToStaticMarkup(
      <MachineCard
        host={host()}
        projectCount={0}
        now={Date.now()}
        cliRows={[{ provider: 'codex', status: cli() }]}
        busyKey={null}
        renaming={false}
        renameValue=""
        onRenameValue={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameCommit={vi.fn()}
        onPermissionChange={vi.fn()}
        onRetryUpdate={vi.fn()}
        onRemove={vi.fn()}
        onInstall={vi.fn()}
      />
    );
    expect(html).toContain('machine-card');
    expect(html).toContain('grebmann-ltmmfjc.internal.salesforce.com');
    expect(html).toContain('Online');
    expect(html).toContain('0 projects');
    expect(html).toContain('Permission ceiling');
    expect(html).toContain('Rename');
    expect(html).toContain('Remove');
    expect(html).not.toContain('this machine</span>');
    expect(html).toContain('Harness CLIs');
  });

  it('hides CLI inventory while offline and omits remove on the primary machine', () => {
    const html = renderToStaticMarkup(
      <MachineCard
        host={host({ isPrimary: true, status: 'disconnected', name: 'MacBook' })}
        projectCount={1}
        now={Date.now()}
        cliRows={[{ provider: 'codex', status: cli() }]}
        busyKey={null}
        renaming={false}
        renameValue=""
        onRenameValue={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameCommit={vi.fn()}
        onPermissionChange={vi.fn()}
        onRetryUpdate={vi.fn()}
        onRemove={vi.fn()}
        onInstall={vi.fn()}
      />
    );
    expect(html).toContain('this machine');
    expect(html).toContain('1 project');
    expect(html).toContain('Connect this machine to see harness CLI versions');
    expect(html).not.toContain('Remove');
    expect(html).not.toContain('Harness CLIs');
  });

  it('offers retry update and an inline rename field', () => {
    const retrying = renderToStaticMarkup(
      <MachineCard
        host={host({ lastRejectedProtocolVersion: 16 })}
        projectCount={2}
        now={Date.now()}
        cliRows={[]}
        busyKey={null}
        renaming={false}
        renameValue=""
        onRenameValue={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameCommit={vi.fn()}
        onPermissionChange={vi.fn()}
        onRetryUpdate={vi.fn()}
        onRemove={vi.fn()}
        onInstall={vi.fn()}
      />
    );
    expect(retrying).toContain('Retry update');
    expect(retrying).toContain('Needs update');
    expect(retrying).toContain('2 projects');

    const renaming = renderToStaticMarkup(
      <MachineCard
        host={host()}
        projectCount={0}
        now={Date.now()}
        cliRows={[]}
        busyKey={null}
        renaming
        renameValue="new-name"
        onRenameValue={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameCommit={vi.fn()}
        onPermissionChange={vi.fn()}
        onRetryUpdate={vi.fn()}
        onRemove={vi.fn()}
        onInstall={vi.fn()}
      />
    );
    expect(renaming).toContain('value="new-name"');
    expect(renaming).toContain('aria-label="Machine name"');
  });
});
