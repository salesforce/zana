// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { ComposerProjectPicker } from './ComposerProjectPicker.js';
const h = vi.hoisted(() => ({ remember: vi.fn(), hosts: [] as Host[], compact: false }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => h.compact }));
vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => h.hosts }));
vi.mock('../store.js', () => ({ useData: (select: (s: unknown) => unknown) => select({ rememberLastProjectId: h.remember }) }));
vi.mock('./AddMachineProjectDialog.js', () => ({ AddMachineProjectDialog: ({ group, onAdded, onClose }: any) => <div role="dialog" aria-label={`Add on ${group.name}`}><button onClick={() => onAdded({ id: 'created' })}>Create</button><button onClick={onClose}>Cancel</button></div> }));
const scratch = { id: 'default', name: 'Default Project', quickAgent: true, path: '/scratch' } as Project;
const repo = { id: 'repo', name: 'API', hostId: 'remote', path: '/api' } as Project;
const hosts = [{ id: 'local', name: 'Laptop', isPrimary: true, status: 'connected' }, { id: 'remote', name: 'Devbox', status: 'connected' }, { id: 'offline', name: 'Offline box', status: 'disconnected' }] as Host[];
afterEach(() => { cleanup(); vi.clearAllMocks(); h.compact = false; });
function setup(props: Partial<React.ComponentProps<typeof ComposerProjectPicker>> = {}) {
  h.hosts = hosts;
  const change = vi.fn(), hostChange = vi.fn();
  render(<ComposerProjectPicker projects={[scratch, repo]} value="default" hostId="local" onChange={change} onHostChange={hostChange} {...props} />);
  return { change, hostChange };
}
function open() { fireEvent.click(screen.getByRole('button', { name: 'Machine and project' })); return screen.getByRole('listbox', { name: 'Machine and project' }); }
describe('composer machine and project picker', () => {
  it('uses the mobile scrollable dialog and selects the complete machine location', () => {
    h.compact = true;
    const { change, hostChange } = setup();
    const trigger = screen.getByRole('button', { name: 'Machine and project' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Choose project' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close project picker' }));
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'Devbox' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Devbox › Default Project General tasks on Devbox' }));
    expect(change).toHaveBeenCalledWith('default');
    expect(hostChange).toHaveBeenCalledWith('remote');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('keeps the add-project action available in an empty mobile search', () => {
    h.compact = true;
    setup({ value: 'repo', hostId: 'remote' });
    fireEvent.click(screen.getByRole('button', { name: 'Machine and project' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unmatched' } });
    expect(screen.getByRole('status').textContent).toBe('No matching machines or projects');
    fireEvent.click(screen.getByRole('button', { name: 'Add project on Devbox' }));
    expect(screen.getByRole('dialog', { name: 'Add on Devbox' })).toBeTruthy();
  });
  it('shows a combined location and searches project and machine names', () => {
    setup(); expect(screen.getByRole('button', { name: 'Machine and project' }).textContent).toContain('Default Project');
    const list = open(); expect(within(list).getAllByRole('option')).toHaveLength(5);
    fireEvent.change(screen.getByPlaceholderText('Search machines or projects…'), { target: { value: 'Devbox' } });
    expect(within(list).getAllByRole('option')).toHaveLength(3); // two matches and the pinned Add project action
    fireEvent.change(screen.getByPlaceholderText('Search machines or projects…'), { target: { value: 'unmatched' } });
    expect(screen.getByText('No matching machines or projects')).toBeTruthy();
  });
  it('selects the whole location including a remote default and remembers the project', () => {
    const { change, hostChange } = setup(); open();
    fireEvent.click(screen.getByRole('option', { name: 'Devbox › Default Project General tasks on Devbox' }));
    expect(change).toHaveBeenCalledWith('default'); expect(hostChange).toHaveBeenCalledWith('remote'); expect(h.remember).toHaveBeenCalledWith('default');
  });
  it('selects named projects only on their registered target', () => {
    const { change, hostChange } = setup(); open(); fireEvent.click(screen.getByRole('option', { name: 'Devbox › API /api' }));
    expect(change).toHaveBeenCalledWith('repo'); expect(hostChange).toHaveBeenCalledWith('remote');
  });
  it('keeps an existing thread fixed and starts a new draft explicitly', () => {
    const start = vi.fn(); const { change } = setup({ value: 'repo', hostId: 'remote', onStartNewThread: start });
    fireEvent.click(screen.getByRole('button', { name: 'Thread location — start a new thread elsewhere' }));
    fireEvent.click(screen.getByRole('option', { name: 'Devbox › Default Project New thread on Devbox' }));
    expect(start).toHaveBeenCalledWith({ projectId: 'default', hostId: 'remote' }); expect(change).not.toHaveBeenCalled();
  });
  it('shows the recorded host for older threads even when the project binding has changed', () => {
    setup({ value: 'repo', hostId: 'local', onStartNewThread: vi.fn() });
    expect(screen.getByRole('button', { name: 'Thread location — start a new thread elsewhere' }).textContent).toContain('API');
    fireEvent.click(screen.getByRole('button', { name: 'Thread location — start a new thread elsewhere' }));
    expect(screen.getByRole('option', { name: /Current thread location/ }).getAttribute('aria-disabled')).toBe('true');
  });
  it('adds a folder on the selected machine and chooses the new project', () => {
    const { change, hostChange } = setup({ value: 'repo', hostId: 'remote' }); open();
    fireEvent.click(screen.getByRole('option', { name: 'Add project on Devbox' }));
    expect(screen.getByRole('dialog', { name: 'Add on Devbox' })).toBeTruthy(); fireEvent.click(screen.getByText('Create'));
    expect(change).toHaveBeenCalledWith('created'); expect(hostChange).toHaveBeenCalledWith('remote');
  });
  it('supports a locked project and Escape without changing the location', () => {
    setup({ disabled: true }); fireEvent.click(screen.getByRole('button', { name: 'Machine and project' })); expect(screen.queryByRole('listbox')).toBeNull();
    cleanup(); const { change } = setup(); open(); fireEvent.keyDown(document, { key: 'Escape' }); expect(change).not.toHaveBeenCalled();
  });
  it('does not offer foreign default targets to callers that cannot pass a host', () => {
    setup({ onHostChange: undefined }); const list = open(); expect(within(list).getAllByRole('option')).toHaveLength(3);
  });
});
