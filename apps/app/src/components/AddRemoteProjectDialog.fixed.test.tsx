// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddRemoteProjectDialog } from './AddRemoteProjectDialog.js';
import { SetupPageContext } from './setup/SetupFrame.js';
const h = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { ssh: { listHosts: h.list } } }));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => false }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('fixed SSH machine', () => {
  it('keeps a page-hosted SSH draft open on Escape and reports its pending registration', async () => {
    let resolve!: (project: { id: string }) => void;
    const onSubmit = vi.fn(() => new Promise<{ id: string }>(done => { resolve = done; }));
    const onClose = vi.fn(), onSuccess = vi.fn(), setBusy = vi.fn();
    render(<SetupPageContext.Provider value={{ active: true, setBusy }}>
      <AddRemoteProjectDialog fixedTarget={{ host: 'dev' }} onSubmit={onSubmit} onSuccess={onSuccess} onClose={onClose} />
    </SetupPageContext.Provider>);
    expect(screen.getByRole('region', { name: 'Add project on dev' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    await waitFor(() => expect(setBusy).toHaveBeenLastCalledWith(true));
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ id: 'remote-page-project' });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('remote-page-project'));
    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('explains when SSH discovery is unavailable for an unbound machine', async () => {
    render(<AddRemoteProjectDialog onSubmit={vi.fn()} onSuccess={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('SSH binding not loaded — quit (⌘Q) and relaunch the app.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.list).not.toHaveBeenCalled();
  });

  it('keeps the SSH identity without discovering hosts again and adds another checkout', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ id: 'created' }), onSuccess = vi.fn(), onClose = vi.fn();
    render(<AddRemoteProjectDialog fixedTarget={{ host: 'dev', user: 'alice', proxyJump: 'bastion' }} onSubmit={onSubmit} onSuccess={onSuccess} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Add project on dev' })).toBeTruthy();
    expect(h.list).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Filter hosts')).toBeNull();
    expect((screen.getByLabelText('User (optional)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Jump host (optional)') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'API' } });
    fireEvent.change(screen.getByLabelText('Start path (optional)'), { target: { value: ' /srv/api ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('created'));
    expect(onSubmit).toHaveBeenCalledWith({ host: 'dev', user: 'alice', proxyJump: 'bastion', remotePath: '/srv/api', name: 'API' });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('reports rejected and failed adds and allows closing with Escape', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('SSH unavailable')).mockResolvedValueOnce(null), onClose = vi.fn(), onSuccess = vi.fn();
    render(<AddRemoteProjectDialog fixedTarget={{ host: 'dev' }} onSubmit={onSubmit} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    await waitFor(() => expect(screen.getByText('SSH unavailable')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    await waitFor(() => expect(screen.getByText('Could not add remote project')).toBeTruthy());
    expect(onSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Add', exact: true }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  });
});
