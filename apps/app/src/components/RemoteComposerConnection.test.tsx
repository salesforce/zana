// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project } from '@zana-ai/zcc-domain/product';
import { product } from '../lib/product-client.js';
import { runHostInstallWithDrawer } from '../lib/host-install-run.js';
import { RemoteComposerConnection } from './RemoteComposerConnection.js';

const openDrawer = vi.hoisted(() => vi.fn());
vi.mock('../store.js', () => ({ useUi: { getState: () => ({ setHostInstallDrawerOpen: openDrawer }) } }));
vi.mock('../hooks/usePublicAppUrl.js', () => ({ usePublicAppUrl: () => 'https://machine.example' }));
vi.mock('../lib/product-client.js', () => ({ product: {
  hosts: { repair: vi.fn(), bootstrap: vi.fn(), updateSshIdentity: vi.fn() },
  relay: { renewJoinWindow: vi.fn() }
} }));
vi.mock('../lib/host-install-run.js', () => ({ runHostInstallWithDrawer: vi.fn() }));
vi.mock('./HostSshIdentityDialog.js', () => ({ HostSshIdentityDialog: ({ onSubmit, onClose }: any) => <>
  <button onClick={() => void onSubmit({ host: 'devbox' })}>Bind SSH</button>
  <button onClick={onClose}>Cancel SSH</button>
</> }));
const project = { id: 'remote-project', hostId: 'remote', remote: { host: 'devbox' } } as Project;
const hosts = [{ id: 'primary', status: 'connected', isPrimary: true }, { id: 'remote', name: 'Remote', status: 'disconnected', canRepairViaSsh: true }] as Host[];
function setup(target: Project = project, roster: Host[] = hosts) {
  vi.mocked(runHostInstallWithDrawer).mockImplementation(async input => { const events = await input.run(() => {}); await input.onSettled?.(events); return events; });
  vi.mocked(product.hosts.repair).mockResolvedValue([{ type: 'done', hostId: 'remote' }]);
  vi.mocked(product.hosts.bootstrap).mockResolvedValue([{ type: 'done', hostId: 'remote' }]);
  const onConnected = vi.fn(async () => {}), onError = vi.fn();
  render(<RemoteComposerConnection project={target} hosts={roster} onConnected={onConnected} onError={onError} />);
  return { onConnected, onError };
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('repairs only the bound remote and refreshes the project after successful connection', async () => {
  const f = setup();
  vi.mocked(product.relay.renewJoinWindow).mockRejectedValue(new Error('Legacy relay unconfigured'));
  fireEvent.click(screen.getByTestId('composer-host-action'));
  await waitFor(() => expect(f.onConnected).toHaveBeenCalledOnce());
  expect(product.hosts.repair).toHaveBeenCalledWith('remote', expect.any(Function));
  expect(f.onError.mock.calls.every(call => call[0] === null)).toBe(true);
});

it('installs a daemon for an unbound remote project', async () => {
  const f = setup({ ...project, hostId: undefined });
  fireEvent.click(screen.getByTestId('composer-host-action'));
  await waitFor(() => expect(f.onConnected).toHaveBeenCalledOnce());
  expect(product.hosts.bootstrap).toHaveBeenCalledWith(project.id, expect.any(Function));
});

it('hides repair for a connected machine', () => {
  setup(project, hosts.map(host => ({ ...host, status: 'connected' })));
  expect(screen.queryByTestId('composer-host-action')).toBeNull();
});

it('asks for a missing SSH binding and repairs after it is stored', async () => {
  const f = setup(project, hosts.map(host => ({ ...host, canRepairViaSsh: false })));
  fireEvent.click(screen.getByTestId('composer-host-action'));
  fireEvent.click(screen.getByText('Cancel SSH'));
  expect(screen.queryByText('Bind SSH')).toBeNull();
  fireEvent.click(screen.getByTestId('composer-host-action'));
  fireEvent.click(screen.getByText('Bind SSH'));
  await waitFor(() => expect(f.onConnected).toHaveBeenCalledOnce());
  expect(product.hosts.updateSshIdentity).toHaveBeenCalledWith('remote', { host: 'devbox' });
});

it('keeps the running log available and reports a repair failure', async () => {
  const f = setup();
  let release!: () => void;
  vi.mocked(product.hosts.repair).mockImplementation(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return [{ type: 'error', code: 'ssh_identity_required', message: 'Bind SSH first' }];
  });
  fireEvent.click(screen.getByTestId('composer-host-action'));
  await waitFor(() => expect(screen.getByTestId('composer-host-action').textContent).toBe('Reconnecting…'));
  fireEvent.click(screen.getByTestId('composer-host-action'));
  expect(openDrawer).toHaveBeenCalledWith(true);
  release();
  await waitFor(() => expect(f.onError).toHaveBeenCalledWith('Bind SSH first'));
  expect(f.onConnected).not.toHaveBeenCalled();
  expect(screen.getByText('Bind SSH')).toBeTruthy();
});

it.each([new Error('Network failed'), 'Network failed'])('reports transport errors and releases the busy state', async error => {
  const f = setup();
  vi.mocked(product.hosts.repair).mockRejectedValue(error);
  fireEvent.click(screen.getByTestId('composer-host-action'));
  await waitFor(() => expect(f.onError).toHaveBeenCalledWith(error instanceof Error ? error.message : 'Could not reconnect the remote machine'));
  expect(screen.getByTestId('composer-host-action').textContent).toBe('Fix connection');
});

it('reports a non-SSH failure without opening the SSH dialog', async () => {
  const f = setup();
  vi.mocked(product.hosts.repair).mockResolvedValue([{ type: 'error', code: 'daemon_down', message: 'Daemon is down' }]);
  fireEvent.click(screen.getByTestId('composer-host-action'));
  await waitFor(() => expect(f.onError).toHaveBeenCalledWith('Daemon is down'));
  expect(screen.queryByText('Bind SSH')).toBeNull();
});

it('does not open the SSH dialog for an unbound project even on ssh_identity_required', async () => {
  const f = setup({ ...project, hostId: undefined });
  vi.mocked(product.hosts.bootstrap).mockResolvedValue([{ type: 'error', code: 'ssh_identity_required', message: 'Bind first' }]);
  fireEvent.click(screen.getByTestId('composer-host-action'));
  await waitFor(() => expect(f.onError).toHaveBeenCalledWith('Bind first'));
  expect(screen.queryByText('Bind SSH')).toBeNull();
});

it('falls back to the project remote host name when the bound machine has no display name', async () => {
  const f = setup(project, [hosts[0]!, { ...hosts[1]!, name: undefined } as unknown as Host]);
  vi.mocked(product.hosts.repair).mockResolvedValue([{ type: 'error', code: 'ssh_identity_required', message: 'Bind first' }]);
  fireEvent.click(screen.getByTestId('composer-host-action'));
  await waitFor(() => expect(f.onError).toHaveBeenCalledWith('Bind first'));
  expect(screen.queryByText('Bind SSH')).not.toBeNull();
});
