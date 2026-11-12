// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../lib/product-client.js';
import { MachinesSettingsView } from './MachinesSettingsView.js';

const h = vi.hoisted(() => ({ hosts: [] as unknown[], appendLogs: vi.fn() }));

vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: async () => ({ connectMachines: false }) }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  hosts: { repair: vi.fn(), updateSshIdentity: vi.fn(), providerCliStatus: vi.fn(async () => ({})) }
} }));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => h.hosts }));
vi.mock('@/store', () => ({
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] }),
  useUi: { getState: () => ({ appendHostInstallLogs: h.appendLogs }) }
}));
vi.mock('../../lib/host-install-run.js', () => ({
  runHostInstallWithDrawer: vi.fn(async (input: any) => {
    const events = await input.run(() => undefined);
    await input.onSettled(events);
    return events;
  })
}));
vi.mock('./AddMachineDialog.js', () => ({ AddMachineDialog: () => null }));
vi.mock('../../components/HostSshIdentityDialog.js', () => ({ HostSshIdentityDialog: ({ hostName }: { hostName: string }) =>
  <div data-testid="ssh-dialog">{hostName}</div> }));

const config = { version: 1, theme: 'system', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13,
  lastProjectId: null, publicAppUrl: 'https://machine.example.com' } as AppConfig;
const offline = {
  id: 'h1', name: 'devbox', type: 'persistent', status: 'disconnected', maxPermissionMode: 'full',
  lastSeenAt: 1, lastRejectedProtocolVersion: null, isPrimary: false, canRepairViaSsh: true, createdAt: 1, updatedAt: 1
} as Host;

function setup() {
  h.hosts = [offline];
  render(<MachinesSettingsView config={config} onConfigDraft={() => undefined} onUpdate={async () => undefined} />);
}
const reconnect = () => fireEvent.click(screen.getByTestId('machine-reconnect-h1'));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('Machines reconnect onSettled handling', () => {
  it('shows the repair error, then clears it when a retry succeeds', async () => {
    setup();
    vi.mocked(product.hosts.repair).mockResolvedValueOnce([{ type: 'error', code: 'daemon_down', message: 'ssh timed out' }])
      .mockResolvedValue([{ type: 'done', hostId: 'h1' }]);
    reconnect();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('ssh timed out'));
    reconnect();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(product.hosts.repair).toHaveBeenCalledTimes(2);
  });

  it('opens the SSH identity dialog on ssh_identity_required without an error banner', async () => {
    setup();
    vi.mocked(product.hosts.repair).mockResolvedValue([{ type: 'error', code: 'ssh_identity_required', message: 'bind ssh' }]);
    reconnect();
    await waitFor(() => expect(screen.getByTestId('ssh-dialog').textContent).toBe('devbox'));
  });
});

describe('Machines reinstall daemon', () => {
  const online = { ...offline, status: 'connected' } as Host;
  function setupOnline() {
    h.hosts = [online];
    render(<MachinesSettingsView config={config} onConfigDraft={() => undefined} onUpdate={async () => undefined} />);
  }
  const reinstall = () => fireEvent.click(screen.getByTestId('machine-reinstall-h1'));

  it('does nothing when the confirmation is declined', () => {
    const confirm = vi.fn(() => false); vi.stubGlobal('confirm', confirm);
    setupOnline();
    reinstall();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('devbox'));
    expect(product.hosts.repair).not.toHaveBeenCalled();
  });

  it('reinstalls a connected machine through repair and shows a failure on the card', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    setupOnline();
    expect(screen.queryByTestId('machine-reconnect-h1')).toBeNull();
    vi.mocked(product.hosts.repair).mockResolvedValueOnce([{ type: 'error', code: 'install_failed', message: 'upload failed' }]);
    reinstall();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('upload failed'));
    expect(product.hosts.repair).toHaveBeenCalledWith('h1', expect.any(Function));
  });

  it('asks for an SSH host first when the machine has none', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    h.hosts = [{ ...online, canRepairViaSsh: false }];
    render(<MachinesSettingsView config={config} onConfigDraft={() => undefined} onUpdate={async () => undefined} />);
    reinstall();
    await waitFor(() => expect(screen.getByTestId('ssh-dialog').textContent).toBe('devbox'));
    expect(product.hosts.repair).not.toHaveBeenCalled();
  });
});
