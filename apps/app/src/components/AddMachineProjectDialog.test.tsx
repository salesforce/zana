// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MachineProjectGroup } from '../lib/machine-projects.js';
import { AddMachineProjectDialog } from './AddMachineProjectDialog.js';

const h = vi.hoisted(() => ({ addProjectByPath: vi.fn(), addRemoteProject: vi.fn(), cloneProject: vi.fn(), pick: vi.fn(), props: {} as any }));
vi.mock('../store.js', () => ({ useData: (select: (s: unknown) => unknown) => select(h) }));
vi.mock('../lib/product-client.js', () => ({ product: { projects: { pickDirectory: h.pick } } }));
vi.mock('./AddLocalProjectDialog.js', () => ({ AddLocalProjectDialog: (props: any) => {
  h.props = props; return <button onClick={() => void props.onSubmit('/repo', props.fixedHostId)}>Submit local</button>;
} }));
vi.mock('./AddRemoteProjectDialog.js', () => ({ AddRemoteProjectDialog: (props: any) => {
  h.props = props; return <button onClick={() => props.onSuccess('ssh-project')}>Submit SSH</button>;
} }));
vi.mock('./CreateProjectFolderDialog.js', () => ({ CreateProjectFolderDialog: (props: any) => {
  h.props = props; return <button onClick={() => props.onAdded({ id: 'created' })}>Create folder</button>;
} }));
vi.mock('./AddGitProjectDialog.js', () => ({ AddGitProjectDialog: (props: any) => {
  h.props = props; return <button onClick={() => void props.onClone({ url: 'owner/repo' })}>Clone</button>;
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('add a project from a machine', () => {
  it.each(['remote', undefined])('keeps the daemon target %s and chooses the created project', async hostId => {
    const onAdded = vi.fn(), onClose = vi.fn(); h.addProjectByPath.mockResolvedValueOnce({ id: 'new' });
    render(<AddMachineProjectDialog group={{ id: 'm', name: 'Machine', hostId, projects: [] } as MachineProjectGroup} onAdded={onAdded} onClose={onClose} />);
    expect((screen.getByRole('button', { name: /Create new folder/ }) as HTMLButtonElement).disabled).toBe(!hostId);
    fireEvent.click(screen.getByRole('button', { name: /Open existing folder/ }));
    expect(h.props.fixedMachineName).toBe('Machine'); expect(h.props.fixedHostId).toBe(hostId);
    fireEvent.click(screen.getByText('Submit local'));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith({ id: 'new' }));
    expect(h.addProjectByPath).toHaveBeenCalledWith('/repo', hostId ? { hostId } : undefined);
    await h.props.onBrowse(); expect(h.pick).toHaveBeenCalledOnce();
  });
  it('keeps an unbound SSH identity and does not choose a failed project', async () => {
    const remote = { host: 'dev', user: 'me', proxyJump: 'jump' }, onAdded = vi.fn();
    const view = render(<AddMachineProjectDialog group={{ id: 'ssh', name: 'Dev', remote, projects: [] } as MachineProjectGroup} onAdded={onAdded} onClose={vi.fn()} />);
    expect(h.props.fixedTarget).toBe(remote); expect(h.props.onSubmit).toBe(h.addRemoteProject);
    fireEvent.click(screen.getByText('Submit SSH')); expect(onAdded).toHaveBeenCalledWith({ id: 'ssh-project' });
    onAdded.mockClear(); h.addProjectByPath.mockResolvedValueOnce(null);
    view.rerender(<AddMachineProjectDialog group={{ id: 'm', name: 'Machine', projects: [] } as MachineProjectGroup} onAdded={onAdded} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Open existing folder/ }));
    fireEvent.click(screen.getByText('Submit local')); await waitFor(() => expect(h.addProjectByPath).toHaveBeenCalled());
    expect(onAdded).not.toHaveBeenCalled();
  });
  it('binds create and clone to the selected machine', async () => {
    const onAdded = vi.fn(), group = { id: 'remote', hostId: 'remote', name: 'Dev', projects: [] } as MachineProjectGroup;
    const view = render(<AddMachineProjectDialog group={group} onAdded={onAdded} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create new folder/ }));
    expect(h.props.group).toBe(group); fireEvent.click(screen.getByText('Create folder'));
    expect(onAdded).toHaveBeenCalledWith({ id: 'created' });
    view.unmount();
    render(<AddMachineProjectDialog group={group} onAdded={onAdded} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Clone repository/ }));
    expect(h.props.fixedHostId).toBe('remote'); expect(h.props.fixedMachineName).toBe('Dev');
    fireEvent.click(screen.getByText('Clone'));
    expect(h.cloneProject).toHaveBeenCalledWith({ url: 'owner/repo', hostId: 'remote' });
    h.props.onSuccess('cloned'); expect(onAdded).toHaveBeenCalledWith({ id: 'cloned' });
  });
});
