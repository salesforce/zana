// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../lib/product-client.js';
import { AddLocalProjectDialog } from './AddLocalProjectDialog.js';

const mocks = vi.hoisted(() => ({ hosts: [] as Host[] }));
vi.mock('../hooks/useHosts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useHosts.js')>()),
  useHosts: () => mocks.hosts
}));
vi.mock('../lib/product-client.js', () => ({ product: { hosts: { directory: vi.fn() } } }));

afterEach(() => { cleanup(); mocks.hosts = []; });

function host(homeDir: string | null): Host {
  return {
    id: 'local', name: 'This machine', type: 'persistent', status: 'connected', maxPermissionMode: 'full',
    lastSeenAt: null, lastRejectedProtocolVersion: null, isPrimary: true, canRepairViaSsh: false,
    homeDir, createdAt: 0, updatedAt: 0
  } as Host;
}

function placeholder(): string {
  render(<AddLocalProjectDialog onClose={vi.fn()} onBrowse={vi.fn()} onSubmit={vi.fn()} />);
  return (screen.getByRole('textbox') as HTMLInputElement).placeholder;
}

describe('AddLocalProjectDialog folder-path placeholder', () => {
  it("uses a Windows path when this machine's home dir is on a drive", () => {
    mocks.hosts = [host('C:\\Users\\me')];
    expect(placeholder()).toBe('C:\\path\\to\\project');
  });

  it('keeps a POSIX path for a POSIX home dir', () => {
    mocks.hosts = [host('/Users/me')];
    expect(placeholder()).toBe('/path/to/project');
  });
});


describe('fixed machine project creation', () => {
  it('uses the native browser on the primary machine, including cancellation and failed browsing', async () => {
    mocks.hosts = [host('/Users/me')];
    const onBrowse = vi.fn().mockResolvedValueOnce('/native/project').mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('Picker unavailable')).mockRejectedValueOnce('unavailable');
    const onSubmit = vi.fn().mockRejectedValueOnce('denied');
    render(<AddLocalProjectDialog fixedHostId="local" onBrowse={onBrowse} onSubmit={onSubmit} onClose={vi.fn()} />);
    const browse = screen.getByRole('button', { name: 'Browse for folder' });
    fireEvent.click(browse);
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('/native/project'));
    fireEvent.click(browse);
    await waitFor(() => expect(onBrowse).toHaveBeenCalledTimes(2));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('/native/project');
    fireEvent.click(browse);
    await waitFor(() => expect(screen.getByText('Picker unavailable')).toBeTruthy());
    fireEvent.click(browse);
    await waitFor(() => expect(screen.getByText('Could not browse folders')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add project', exact: true }));
    await waitFor(() => expect(screen.getByText('Could not add project')).toBeTruthy());
    expect(onSubmit).toHaveBeenCalledWith('/native/project', undefined);
  });

  it('browses the remote filesystem, survives roster refresh and submits the fixed target', async () => {
    const remote = { ...host('/home/me'), id: 'remote', isPrimary: false, name: 'Devbox' };
    mocks.hosts = [host('/Users/me'), remote];
    vi.mocked(product.hosts.directory).mockResolvedValue({ directory: '/srv', parent: '/', entries: [{ kind: 'directory', name: 'app', path: '/srv/app' }, { kind: 'file', name: 'ignored', path: '/srv/ignored' }] });
    const onSubmit = vi.fn().mockResolvedValue({ id: 'created' }), onBrowse = vi.fn(), onClose = vi.fn();
    const props = { fixedHostId: 'remote', fixedMachineName: 'Devbox', onSubmit, onBrowse, onClose };
    const view = render(<AddLocalProjectDialog {...props} />);
    expect(screen.queryByRole('button', { name: 'Machine' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Browse for folder' }));
    await waitFor(() => expect(screen.getByRole('textbox').getAttribute('value')).toBe('/srv'));
    expect(onBrowse).not.toHaveBeenCalled();
    expect(screen.queryByText('ignored')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'app', exact: true }));
    await waitFor(() => expect(product.hosts.directory).toHaveBeenLastCalledWith('remote', '/srv/app'));
    mocks.hosts = [...mocks.hosts].reverse(); view.rerender(<AddLocalProjectDialog {...props} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' /srv/app ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project', exact: true }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('/srv/app', 'remote'));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('never falls back to the local browser or target when the fixed machine disappears', async () => {
    mocks.hosts = [host('/Users/me')]; const onBrowse = vi.fn(), onSubmit = vi.fn();
    render(<AddLocalProjectDialog fixedHostId="gone" fixedMachineName="Gone" onBrowse={onBrowse} onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse for folder' }));
    expect(screen.getByText('This machine is no longer registered.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/repo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project', exact: true }));
    expect(onBrowse).not.toHaveBeenCalled(); expect(onSubmit).not.toHaveBeenCalled();
  });
  it('reports submission and browsing failures and keeps the dialog open', async () => {
    mocks.hosts = [{ ...host('/home/me'), id: 'remote', isPrimary: false }];
    vi.mocked(product.hosts.directory).mockRejectedValueOnce(new Error('Offline'));
    const onClose = vi.fn(), onSubmit = vi.fn().mockRejectedValueOnce(new Error('Folder denied')).mockResolvedValueOnce(null);
    render(<AddLocalProjectDialog fixedHostId="remote" onBrowse={vi.fn()} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse for folder' }));
    await waitFor(() => expect(screen.getByText('Offline')).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/repo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add project', exact: true }));
    await waitFor(() => expect(screen.getByText('Folder denied')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add project', exact: true }));
    await waitFor(() => expect(screen.getByText('Could not add project')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });
});
