// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MachineProjectGroup } from '../lib/machine-projects.js';
import { CreateProjectFolderDialog } from './CreateProjectFolderDialog.js';
const h = vi.hoisted(() => ({ create: vi.fn(), directory: vi.fn(), pickDirectory: vi.fn(), loadProjects: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { hosts: { directory: h.directory }, projects: { pickDirectory: h.pickDirectory } } }));
vi.mock('../lib/machine-project-client.js', () => ({ createProjectFolder: h.create }));
vi.mock('../store.js', () => ({ useData: (select: (s: any) => unknown) => select(h) }));
const group = { hostId: 'remote', name: 'Dev', primary: false, projects: [] } as unknown as MachineProjectGroup;
beforeEach(() => {
  h.directory.mockResolvedValue({ directory: '/remote', parent: '/', entries: [{ name: 'repos', path: '/remote/repos', kind: 'directory' }, { name: 'file', path: '/remote/file', kind: 'file' }] });
  h.create.mockResolvedValue({ id: 'created' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function setup(target = group) {
  const onAdded = vi.fn(), onClose = vi.fn();
  const view = render(<CreateProjectFolderDialog group={target} onAdded={onAdded} onClose={onClose} />);
  return { onAdded, onClose, ...view };
}
it('uses remote HOME, browses the fixed host and creates with a stable request ID', async () => {
  const { onAdded, onClose } = setup();
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Parent folder' }) as HTMLInputElement).value).toBe('/remote'));
  fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'repos' }));
  expect(h.directory).toHaveBeenLastCalledWith('remote', '/remote/repos');
  fireEvent.click(screen.getByRole('button', { name: '..' }));
  expect(h.directory).toHaveBeenLastCalledWith('remote', '/');
  fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), { target: { value: 'api' } });
  h.create.mockRejectedValueOnce(new Error('network interrupted'));
  fireEvent.click(screen.getByRole('button', { name: 'Create & add' }));
  expect((await screen.findByRole('alert')).textContent).toContain('network interrupted');
  const request = h.create.mock.calls[0][0];
  expect(request).toMatchObject({ hostId: 'remote', parentPath: '/remote', name: 'api', operationId: expect.any(String) });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Folder name' }), { key: 'Enter' });
  await waitFor(() => expect(onAdded).toHaveBeenCalledWith({ id: 'created' }));
  expect(h.create.mock.calls[1][0]).toEqual(request);
  expect(h.loadProjects).toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce();
});
it('keeps typed paths during late initialization and preserves errors and inputs', async () => {
  let resolve!: (value: any) => void;
  h.directory.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  setup();
  fireEvent.change(screen.getByRole('textbox', { name: 'Parent folder' }), { target: { value: '/typed' } });
  await act(async () => resolve({ directory: '/home' }));
  expect((screen.getByRole('textbox', { name: 'Parent folder' }) as HTMLInputElement).value).toBe('/typed');
  h.directory.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
  expect((await screen.findByRole('alert')).textContent).toBe('offline');
});
it('uses the native picker only for the primary and blocks duplicate submissions and close while pending', async () => {
  const { onClose } = setup({ ...group, primary: true });
  h.pickDirectory.mockResolvedValueOnce('/local');
  fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Parent folder' }) as HTMLInputElement).value).toBe('/local'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), { target: { value: 'api' } });
  let resolve!: (value: any) => void; h.create.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Create & add' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Folder name' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  expect(onClose).not.toHaveBeenCalled(); expect(h.create).toHaveBeenCalledOnce();
  await act(async () => resolve({ id: 'done' })); expect(onClose).toHaveBeenCalledOnce();
});
it('shows initialization failures and never enables creation without an enrolled host', async () => {
  h.directory.mockRejectedValueOnce(new Error('Machine offline')); setup();
  expect((await screen.findByRole('alert')).textContent).toBe('Machine offline'); cleanup();
  setup({ ...group, hostId: undefined });
  fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), { target: { value: 'api' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Parent folder' }), { target: { value: '/remote' } });
  expect((screen.getByRole('button', { name: 'Create & add' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
});
