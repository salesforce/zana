// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';

const hostsState: { current: Host[] } = { current: [] };

vi.mock('../../lib/product-client.js', () => ({
  product: {
    hosts: {
      list: async () => [],
      onChanged: () => () => {},
      providerCliStatus: async () => ({}),
      installProviderCli: async () => [],
      repair: async () => [],
      updateSshIdentity: async () => undefined,
      update: async () => undefined,
      updatePermissionCeiling: async () => undefined,
      retryUpdate: async () => undefined,
      remove: async () => undefined,
      relaunchLocal: async () => ({ ok: true as const })
    },
    relay: {
      status: async () => ({ state: 'unconfigured' }),
      renewJoinWindow: async () => ({ state: 'unconfigured' }),
      onChanged: () => () => {}
    }
  }
}));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => hostsState.current }));
vi.mock('./AddMachineDialog.js', () => ({ AddMachineDialog: () => <div data-testid="add-machine-dialog" /> }));
vi.mock('@/store', () => ({
  useData: (selector: (s: { projects: never[] }) => unknown) => selector({ projects: [] }),
  useUi: { getState: () => ({ appendHostInstallLogs: () => undefined }) }
}));

import { MachinesTab } from './MachinesSettingsView';
import { machineSearchId } from '@/lib/settings-search/providers/machines';

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

afterEach(cleanup);

describe('MachinesTab settings-search targets', () => {
  it('exposes the add-machine button and a per-machine card target', () => {
    hostsState.current = [
      {
        id: 'h1', name: 'MacBook', type: 'persistent', status: 'connected', maxPermissionMode: 'full',
        lastSeenAt: 1, lastRejectedProtocolVersion: null, isPrimary: true, canRepairViaSsh: false,
        createdAt: 1, updatedAt: 1
      } as Host
    ];
    const { container } = render(
      <MachinesTab config={config} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />
    );
    const add = container.querySelector('button[data-settings-target="machines.add-machine"]');
    expect(add).not.toBeNull();
    fireEvent.click(add!);
    expect(container.querySelector('[data-testid="add-machine-dialog"]')).not.toBeNull();
    expect(container.querySelector(`[data-settings-target="${machineSearchId('h1')}"]`)).not.toBeNull();
  });
});
