// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn(), write: vi.fn(), toast: vi.fn(), remoteRoot: vi.fn(), listRemote: vi.fn(), readRemote: vi.fn(), worktrees: vi.fn(), branches: vi.fn(), environments: vi.fn(), hosts: [] as any[], gitStatus: vi.fn(), hasDesktop: true }));
vi.mock('@/lib/monacoSetup', () => ({}));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => mocks.hosts }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => mocks.hasDesktop }));
vi.mock('@/hooks/useMonacoTheme', () => ({ useMonacoTheme: () => 'dark' }));
vi.mock('@/hooks/useFileDrop', () => ({ useFileDrop: () => ({ dropOver: false, dropHandlers: {} }) }));
vi.mock('@/components/AiEnhanceSelection', () => ({ useAiEnhanceSelection: () => ({ registerEditor: vi.fn(), modal: null }) }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  fs: { listDir: mocks.list, readFile: mocks.read, writeFile: mocks.write, remoteRoot: mocks.remoteRoot, listDirRemote: mocks.listRemote, readFileRemote: mocks.readRemote },
  git: { status: mocks.gitStatus, listWorktrees: mocks.worktrees, listBranches: mocks.branches },
  environments: { list: mocks.environments }
} }));
vi.mock('@/store', async () => {
  const { create } = await import('zustand');
  const useUi = create<any>((set: any) => ({ explorerFile: {}, explorerGoto: {}, explorerTreeMode: {}, explorerDiff: {},
    pushToast: mocks.toast, setProjectView: vi.fn(), selectTab: vi.fn(), setExplorerTreeMode: vi.fn(), setExplorerDiff: vi.fn(),
    setExplorerFile: (id: string, path: string) => set((state: any) => ({ explorerFile: { ...state.explorerFile, [id]: path } }))
  }));
  const useData = create<any>(() => ({ gitStatus: {}, createTerminal: vi.fn(), loadGitStatus: vi.fn() }));
  return { useUi, useData };
});
vi.mock('@/components/explorer', () => ({
  WorktreeMenu: ({ loading, error, onSelectWorktree, worktrees }: any) => <><span>{loading ? 'Loading checkouts' : 'Checkouts ready'}</span>{error && <p role="alert">{error}</p>}{worktrees?.map((wt: any) => <button key={wt.path} onClick={() => onSelectWorktree(wt.path)}>Switch to {wt.path}</button>)}</>,
  ExplorerGitFooter: ({ onToggleMenu, menu }: any) => <><button onClick={onToggleMenu}>Checkouts</button>{menu}</>,
  ExplorerTreeHeader: ({ onRefresh }: any) => <button onClick={onRefresh}>Refresh files</button>,
  ExplorerContextMenu: () => null, ChangesList: () => null, useFileOperations: () => ({}), DirectoryLoading: ({ label }: any) => <div className="tree-loading">{label ?? 'Loading files'}</div>,
  TreeList: ({ list, onFileClick, entries, onToggleDir }: any) => <>{list.map((row: any) => <React.Fragment key={row.path}><button onClick={() => (row.kind === 'dir' ? onToggleDir?.(row) : onFileClick(row))}>{row.name}</button>{entries?.get(row.path)?.map((child: any) => <button key={child.path} onClick={() => onFileClick(child)}>{child.name}</button>)}</React.Fragment>)}</>,
  FileViewer: ({ fileResult, editedContent, onContentChange, onSave, nativeFiles }: any) => <div>
    {fileResult?.ok && <textarea aria-label="File contents" value={editedContent ?? fileResult.content} onChange={event => onContentChange(event.target.value)} />}
    <button onClick={onSave}>Save fixture</button><span>{nativeFiles ? 'native openers' : 'no native openers'}</span>
  </div>
}));
import { ExplorerView } from './ExplorerView.js';
import { useUi } from '@/store';
const project: any = { id: 'p', name: 'Shared', path: '/a', hostId: 'a', sources: [{ id: 'source-b', hostId: 'b', path: '/b', createdAt: 1 }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.hosts = [{ id: 'a', name: 'Primary', isPrimary: true, status: 'connected' }, { id: 'b', name: 'Secondary', status: 'connected' }];
  useUi.setState({ explorerFile: {}, explorerGoto: {} });
  mocks.list.mockImplementation(async (path: string) => [{ name: 'owner.txt', path: `${path}/owner.txt`, kind: 'file' }]);
  mocks.read.mockImplementation(async (_path: string, scope: any) => ({ ok: true, content: `machine-${scope.hostId}`, sha256: 'revision' }));
  mocks.write.mockResolvedValue({ ok: true, sha256: 'next', bytes: 4 });
  mocks.gitStatus.mockResolvedValue({ branch: 'main', files: {} });
  mocks.remoteRoot.mockResolvedValue({ ok: true, root: '/remote' });
  mocks.worktrees.mockResolvedValue([]);
  mocks.branches.mockResolvedValue([]);
  mocks.environments.mockResolvedValue([]);
  mocks.listRemote.mockResolvedValue([{ name: 'owner.txt', path: '/remote/owner.txt', kind: 'file' }]);
  mocks.readRemote.mockResolvedValue({ ok: true, content: 'ssh-remote' });
  window.confirm = vi.fn().mockReturnValue(false);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('edits only the thread-pinned checkout with its read revision, without a machine selector', async () => {
  render(<ExplorerView project={project} embedded scope={{ projectId: 'p', hostId: 'b' }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'owner.txt' }));
  expect(await screen.findByDisplayValue('machine-b')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('File contents'), { target: { value: 'edit-b' } });
  fireEvent.click(screen.getByText('Save fixture'));
  await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('/b/owner.txt', 'edit-b', { projectId: 'p', hostId: 'b' }, 'revision'));
  expect(screen.getByText('no native openers')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('keeps the project target and dirty buffer when the machine roster changes', async () => {
  const view = render(<ExplorerView project={project} />);
  fireEvent.click(await screen.findByRole('button', { name: 'owner.txt' }));
  await screen.findByDisplayValue('machine-a');
  fireEvent.change(screen.getByLabelText('File contents'), { target: { value: 'unsaved' } });
  mocks.hosts.reverse();
  view.rerender(<ExplorerView project={project} />);
  expect(screen.getByDisplayValue('unsaved')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(mocks.list.mock.calls.every(([path]) => path === '/a')).toBe(true);
});
it('keeps existing project navigation working on the original source', async () => {
  render(<ExplorerView project={project} />);
  await act(async () => { useUi.getState().setExplorerFile('p', '/a/owner.txt'); });
  expect(await screen.findByDisplayValue('machine-a')).toBeTruthy();
});
it('pins a thread to its historical environment even after its source is removed', async () => {
  render(<ExplorerView project={{ ...project, sources: [] }} scope={{ projectId: 'p', hostId: 'b', environmentId: 'historical' }} checkoutPath="/old" />);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('/old', { projectId: 'p', hostId: 'b', environmentId: 'historical' }));
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('shows offline read failure without using the primary filesystem', async () => {
  mocks.hosts[1].status = 'disconnected'; mocks.list.mockRejectedValue(new Error('Machine unavailable'));
  render(<ExplorerView project={project} scope={{ projectId: 'p', hostId: 'b' }} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Machine unavailable');
  expect(screen.queryByText('Empty directory.')).toBeNull();
  expect(mocks.list).toHaveBeenCalledWith('/b', { projectId: 'p', hostId: 'b' });
  expect(mocks.list.mock.calls.every(([path]) => path === '/b')).toBe(true);
});
it('keeps a dirty buffer when a save conflicts or the host disconnects', async () => {
  render(<ExplorerView project={project} />);
  fireEvent.click(await screen.findByRole('button', { name: 'owner.txt' })); await screen.findByDisplayValue('machine-a');
  fireEvent.change(screen.getByLabelText('File contents'), { target: { value: 'unsaved' } });
  mocks.write.mockResolvedValueOnce({ ok: false, message: 'file changed' });
  fireEvent.click(screen.getByText('Save fixture'));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('file changed', 'error'));
  mocks.write.mockRejectedValueOnce(new Error('offline')); fireEvent.click(screen.getByText('Save fixture'));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('offline', 'error'));
  expect(screen.getByDisplayValue('unsaved')).toBeTruthy();
});
it('does not erase keystrokes entered while a save is pending', async () => {
  let finish!: (value: any) => void;
  mocks.write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ExplorerView project={project} />);
  fireEvent.click(await screen.findByRole('button', { name: 'owner.txt' })); await screen.findByDisplayValue('machine-a');
  fireEvent.change(screen.getByLabelText('File contents'), { target: { value: 'first edit' } });
  fireEvent.click(screen.getByText('Save fixture'));
  fireEvent.change(screen.getByLabelText('File contents'), { target: { value: 'newer edit' } });
  await act(async () => finish({ ok: true, sha256: 'next' }));
  expect(screen.getByDisplayValue('newer edit')).toBeTruthy();
  fireEvent.click(screen.getByText('Save fixture'));
  await waitFor(() => expect(mocks.write).toHaveBeenLastCalledWith('/a/owner.txt', 'newer edit', { projectId: 'p', hostId: 'a' }, 'next'));
});
it('does not select a sole connected foreign machine when primary identity is absent', () => {
  mocks.hosts = [{ id: 'b', name: 'Secondary', status: 'connected' }];
  render(<ExplorerView project={{ ...project, hostId: undefined }} />);
  expect(screen.getByRole('alert').textContent).toBe('Project checkout is unavailable.');
  expect(mocks.list).not.toHaveBeenCalled();
});
it('remounts the explorer when a source path changes on the same host', async () => {
  const scope = { projectId: 'p', hostId: 'b' };
  const view = render(<ExplorerView project={project} scope={scope} />);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('/b', scope));
  view.rerender(<ExplorerView project={{ ...project, sources: [{ ...project.sources[0], path: '/replacement' }] }} scope={scope} />);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('/replacement', scope));
});
it('shows no machine selector for local projects, including embedded explorers', async () => {
  const local = { ...project, sources: [] };
  const view = render(<ExplorerView project={local} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  expect(screen.queryByRole('combobox', { name: 'Explorer machine' })).toBeNull();
  view.rerender(<ExplorerView project={local} embedded scope={{ projectId: 'p', hostId: 'a' }} />);
  expect(screen.queryByRole('combobox', { name: 'Explorer machine' })).toBeNull();
  expect(view.container.querySelector('.explorer-view.is-embedded')).toBeTruthy();
});
it('uses a remote-host project target without a machine selector', async () => {
  render(<ExplorerView project={{ ...project, hostId: 'b', path: '/b', sources: [] }} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(mocks.list).toHaveBeenCalledWith('/b', { projectId: 'p', hostId: 'b' });
});
it('shows an offline project error without adding a machine selector', async () => {
  mocks.hosts[0].status = 'disconnected';
  mocks.list.mockRejectedValueOnce(new Error('Project is offline'));
  render(<ExplorerView project={{ ...project, sources: [] }} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Project is offline');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(mocks.list).toHaveBeenCalledWith('/a', { projectId: 'p', hostId: 'a' });
});
it('retains the registered target when its host is absent from the roster', async () => {
  mocks.hosts = [mocks.hosts[1]];
  render(<ExplorerView project={{ ...project, sources: [] }} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(mocks.list).toHaveBeenCalledWith('/a', { projectId: 'p', hostId: 'a' });
});
it('uses the primary target for legacy local projects without a recorded host', async () => {
  render(<ExplorerView project={{ ...project, hostId: undefined }} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  expect(mocks.list).toHaveBeenCalledWith('/a', { projectId: 'p', hostId: 'a' });
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('keeps an SSH project on its remote filesystem without a machine selector', async () => {
  render(<ExplorerView project={{ ...project, path: '/placeholder', remote: { host: 'ssh-host', remotePath: '/remote' } }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'owner.txt' }));
  await screen.findByDisplayValue('ssh-remote');
  expect(mocks.remoteRoot).toHaveBeenCalledWith('p');
  expect(mocks.listRemote).toHaveBeenCalledWith('p', '/remote');
  expect(mocks.listRemote).toHaveBeenCalledTimes(1);
  expect(mocks.readRemote).toHaveBeenCalledWith('p', '/remote/owner.txt');
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('defers checkout enumeration until the menu opens', async () => {
  render(<ExplorerView project={project} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  expect(mocks.worktrees).not.toHaveBeenCalled();
  expect(mocks.branches).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');
  expect(mocks.worktrees).toHaveBeenCalledTimes(1);
  expect(mocks.branches).toHaveBeenCalledTimes(1);
});

it('fetches fresh filenames on reopen instead of displaying the previous visit', async () => {
  const first = render(<ExplorerView project={project} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  first.unmount();
  mocks.list.mockImplementation(() => new Promise(() => {}));
  render(<ExplorerView project={project} />);
  expect(screen.queryByRole('button', { name: 'owner.txt' })).toBeNull();
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
});

it('keeps checkout metadata failures separate from directory listings', async () => {
  mocks.worktrees.mockRejectedValueOnce(new Error('Git unavailable'));
  mocks.branches.mockRejectedValueOnce(new Error('Git unavailable'));
  render(<ExplorerView project={project} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  fireEvent.click(await screen.findByRole('button', { name: 'Checkouts' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Git unavailable');
  expect(screen.getByRole('button', { name: 'owner.txt' })).toBeTruthy();
});

it('ignores checkout metadata that finishes after the menu closes', async () => {
  let finish!: (value: any) => void;
  mocks.worktrees.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ExplorerView project={project} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  fireEvent.click(await screen.findByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Loading checkouts');
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await act(async () => finish([]));
  expect(screen.queryByText('Checkouts ready')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');
});

it('loads the deepest parent when revealing a nested file and does not repeat cached requests', async () => {
  mocks.list.mockImplementation(async (path: string) => {
    if (path === '/a') return [{ name: 'src', path: '/a/src', kind: 'dir' }, { name: 'owner.txt', path: '/a/owner.txt', kind: 'file' }];
    if (path === '/a/src') return [{ name: 'deep', path: '/a/src/deep', kind: 'dir' }];
    if (path === '/a/src/deep') return [{ name: 'file.ts', path: '/a/src/deep/file.ts', kind: 'file' }];
    return [{ name: 'owner.txt', path: `${path}/owner.txt`, kind: 'file' }];
  });
  render(<ExplorerView project={project} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  await act(async () => { useUi.getState().setExplorerFile('p', '/a/src/deep/file.ts'); });
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('/a/src/deep', { projectId: 'p', hostId: 'a' }));
  expect(mocks.list.mock.calls.map(([path]) => path)).toEqual(['/a', '/a/src', '/a/src/deep']);
});

it('refresh supersedes pending results without retaining filenames', async () => {
  let finish!: (value: any) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ExplorerView project={project} />);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh files' }));
  await screen.findByRole('button', { name: 'owner.txt' });
  await act(async () => finish([{ name: 'stale.txt', path: '/a/stale.txt', kind: 'file' }]));
  expect(screen.queryByRole('button', { name: 'stale.txt' })).toBeNull();
});

it('shows an actual error rather than an empty directory or a retry button', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Offline'));
  render(<ExplorerView project={project} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Offline');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh files' }));
  await screen.findByRole('button', { name: 'owner.txt' });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps a slow root request alive until its files arrive without user intervention', async () => {
  vi.useFakeTimers();
  let finish!: (value: any) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ExplorerView project={project} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Taking longer than expected')).toBeTruthy();
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await act(async () => finish([{ name: 'recovered.txt', path: '/a/recovered.txt', kind: 'file' }]));
  expect(screen.getByRole('button', { name: 'recovered.txt' })).toBeTruthy();
  expect(screen.queryByText('Taking longer than expected')).toBeNull();
  vi.useRealTimers();
});

it('reports failed SSH root resolution without listing the placeholder or offering retry', async () => {
  mocks.remoteRoot.mockResolvedValueOnce({ ok: false, message: 'SSH unavailable' });
  render(<ExplorerView project={{ ...project, path: '/placeholder', remote: { host: 'ssh-host' } }} />);
  await screen.findByText('SSH unavailable');
  expect(mocks.listRemote).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(mocks.remoteRoot).toHaveBeenCalledTimes(1);
  expect(mocks.list).not.toHaveBeenCalled();
});

it('waits for a slow SSH root to recover without restarting its request', async () => {
  vi.useFakeTimers();
  let finish!: (value: any) => void;
  mocks.remoteRoot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ExplorerView project={{ ...project, path: '/placeholder', remote: { host: 'ssh-host' } }} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Taking longer than expected')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(mocks.remoteRoot).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: true, root: '/remote' }));
  expect(mocks.listRemote.mock.calls).toEqual([['p', '/remote']]);
  vi.useRealTimers();
});

it('reports rejected SSH root discovery and cancels it on unmount', async () => {
  mocks.remoteRoot.mockRejectedValueOnce(new Error('Connection refused'));
  const view = render(<ExplorerView project={{ ...project, remote: { host: 'ssh-host' } }} />);
  await screen.findByText('Connection refused');
  view.unmount();
  let finish!: (value: any) => void;
  mocks.remoteRoot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const next = render(<ExplorerView project={{ ...project, remote: { host: 'ssh-host' } }} />);
  next.unmount();
  await act(async () => finish({ ok: true, root: '/remote' }));
  expect(mocks.listRemote).not.toHaveBeenCalled();
});

it('does not continue a nested reveal after its selection is cancelled', async () => {
  let finish!: (value: any) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ExplorerView project={project} />);
  await act(async () => { useUi.getState().setExplorerFile('p', '/a/src/deep/file.ts'); });
  await act(async () => { useUi.getState().setExplorerFile('p', undefined); });
  await act(async () => finish([]));
  expect(mocks.list.mock.calls.map(([path]) => path)).toEqual(['/a']);
});

it('does not reset directory cache or blank expanded folders when opening the checkout menu on a non-native worktree', async () => {
  mocks.environments.mockResolvedValue([
    { id: 'env-b', hostId: 'b', path: '/b-worktree', status: 'ready', workspaceProvisionType: 'managed-worktree', branchName: 'feature' }
  ]);
  mocks.worktrees.mockResolvedValue([
    { path: '/b-worktree', head: '1234', branch: 'feature', detached: false, bare: false, isMain: false }
  ]);
  mocks.list.mockImplementation(async (path: string) => {
    if (path === '/b-worktree') return [{ name: 'subfolder', path: '/b-worktree/subfolder', kind: 'dir' }];
    if (path === '/b-worktree/subfolder') return [{ name: 'nested.txt', path: '/b-worktree/subfolder/nested.txt', kind: 'file' }];
    return [];
  });

  render(
    <ExplorerView
      project={{ ...project, sources: [] }}
      scope={{ projectId: 'p', hostId: 'b', environmentId: 'env-b' }}
      checkoutPath="/b-worktree"
    />
  );

  // Expand subfolder
  fireEvent.click(await screen.findByRole('button', { name: 'subfolder' }));
  expect(await screen.findByRole('button', { name: 'nested.txt' })).toBeTruthy();

  // Open checkout menu
  fireEvent.click(await screen.findByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');

  // The nested item remains present without getting wiped
  expect(screen.getByRole('button', { name: 'nested.txt' })).toBeTruthy();
});

it('shows loading and defers reveal until remote root is ready, and ignores checkout menu for remote projects', async () => {
  let finishRoot!: (val: any) => void;
  mocks.remoteRoot.mockImplementationOnce(() => new Promise((resolve) => { finishRoot = resolve; }));
  const remoteProject = { ...project, path: '/placeholder', remote: { host: 'ssh-host' } };
  useUi.getState().setExplorerFile('p', '/remote/owner.txt');
  const { container } = render(<ExplorerView project={remoteProject} />);
  expect(screen.queryByRole('button', { name: 'owner.txt' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Checkouts' })).toBeNull();
  expect(mocks.worktrees).not.toHaveBeenCalled();
  await act(async () => finishRoot({ ok: true, root: '/remote' }));
  await screen.findByRole('button', { name: 'owner.txt' });
});

it('reports SSH root failure with fallback message when error message is omitted or rejected with non-Error', async () => {
  mocks.remoteRoot.mockResolvedValueOnce({ ok: false });
  const { unmount } = render(<ExplorerView project={{ ...project, path: '/placeholder', remote: { host: 'ssh-host' } }} />);
  await screen.findByText('Could not reach the remote host');
  unmount();

  mocks.remoteRoot.mockRejectedValueOnce('raw network error');
  render(<ExplorerView project={{ ...project, path: '/placeholder', remote: { host: 'ssh-host' } }} />);
  await screen.findByText('Could not reach the remote host');
});

it('handles worktree and branch failures with non-Error, and environments rejection', async () => {
  mocks.worktrees.mockRejectedValueOnce('string error in worktrees');
  mocks.branches.mockRejectedValueOnce('string error in branches');
  render(<ExplorerView project={project} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Failed to load checkouts');
  cleanup();

  mocks.worktrees.mockResolvedValueOnce([{ path: '/wt-1', head: '111', branch: 'b1', detached: false, bare: false, isMain: false }]);
  mocks.branches.mockResolvedValueOnce([{ name: 'b1', isCurrent: false }]);
  mocks.environments.mockRejectedValueOnce(new Error('env list failed'));
  render(<ExplorerView project={project} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');
  cleanup();

  mocks.worktrees.mockResolvedValueOnce([]);
  mocks.branches.mockResolvedValueOnce([{ name: 'main', isCurrent: true }]);
  mocks.environments.mockResolvedValueOnce([]);
  render(<ExplorerView project={project} scope={{ projectId: 'p', hostId: 'a', environmentId: 'env-1' }} checkoutPath="/a" />);
  await screen.findByRole('button', { name: 'owner.txt' });
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');
});

it('resolves native scope when viewing a known native worktree', async () => {
  mocks.worktrees.mockResolvedValue([
    { path: '/a-worktree', head: '111', branch: 'feat', detached: false, bare: false, isMain: false }
  ]);
  mocks.environments.mockResolvedValue([]);
  mocks.list.mockImplementation(async (path: string) => [
    { name: 'wt-file.txt', path: `${path}/wt-file.txt`, kind: 'file' }
  ]);
  render(
    <ExplorerView
      project={project}
      nativeFiles={true}
      scope={{ projectId: 'p', hostId: 'a' }}
      checkoutPath="/a-worktree"
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');
  await waitFor(() => expect(screen.getByText('native openers')).toBeTruthy());
});

it('handles git status failure on non-main worktree without crashing', async () => {
  mocks.gitStatus.mockRejectedValueOnce(new Error('git status failed'));
  render(
    <ExplorerView
      project={project}
      scope={{ projectId: 'p', hostId: 'b', environmentId: 'env-1' }}
      checkoutPath="/b/other-checkout"
    />
  );
  await screen.findByRole('button', { name: 'owner.txt' });
});
it('switches view root to a native worktree and resolves scope accordingly', async () => {
  mocks.worktrees.mockResolvedValue([
    { path: '/a/worktree-1', head: '111', branch: 'feat-1', detached: false, bare: false, isMain: false }
  ]);
  mocks.environments.mockResolvedValue([]);
  mocks.list.mockImplementation(async (path: string) => [
    { name: path === '/a' ? 'owner.txt' : 'file-in-wt.txt', path: `${path}/${path === '/a' ? 'owner.txt' : 'file-in-wt.txt'}`, kind: 'file' }
  ]);
  render(<ExplorerView project={project} nativeFiles={true} scope={{ projectId: 'p', hostId: 'a' }} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to /a/worktree-1' }));
  await screen.findByRole('button', { name: 'file-in-wt.txt' });
});

it('switches view root to a managed environment and an unregistered worktree', async () => {
  mocks.worktrees.mockResolvedValue([
    { path: '/a/managed-wt', head: '222', branch: 'feat-2', detached: false, bare: false, isMain: false },
    { path: '/a/unreg-wt', head: '333', branch: 'feat-3', detached: false, bare: false, isMain: false }
  ]);
  mocks.environments.mockResolvedValue([
    { id: 'env-managed', hostId: 'a', path: '/a/managed-wt', status: 'ready', workspaceProvisionType: 'managed-worktree', branchName: 'feat-2' }
  ]);
  mocks.list.mockImplementation(async (path: string) => [
    { name: path === '/a' ? 'owner.txt' : 'wt-item.txt', path: `${path}/${path === '/a' ? 'owner.txt' : 'wt-item.txt'}`, kind: 'file' }
  ]);
  render(<ExplorerView project={project} nativeFiles={false} scope={{ projectId: 'p', hostId: 'a' }} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');

  // Switch to managed worktree
  fireEvent.click(screen.getByRole('button', { name: 'Switch to /a/managed-wt' }));
  await screen.findByRole('button', { name: 'wt-item.txt' });

  // Switch to unregistered worktree
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to /a/unreg-wt' }));
  await screen.findByRole('button', { name: 'wt-item.txt' });
});

it('loads open subfolders when viewRoot changes', async () => {
  mocks.worktrees.mockResolvedValue([
    { path: '/a/worktree-sub', head: '111', branch: 'feat-sub', detached: false, bare: false, isMain: false }
  ]);
  mocks.list.mockImplementation(async (path: string) => {
    if (path === '/a') return [{ name: 'folder1', path: '/a/folder1', kind: 'dir' }];
    if (path === '/a/folder1') return [{ name: 'file1.txt', path: '/a/folder1/file1.txt', kind: 'file' }];
    return [{ name: 'item.txt', path: `${path}/item.txt`, kind: 'file' }];
  });
  render(<ExplorerView project={project} />);
  fireEvent.click(await screen.findByRole('button', { name: 'folder1' }));
  await screen.findByRole('button', { name: 'file1.txt' });

  // Switch checkout while folder1 is open
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Checkouts ready');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to /a/worktree-sub' }));
  await screen.findByRole('button', { name: 'item.txt' });
});

it('ignores checkout metadata failures that finish after the menu closes', async () => {
  let rejectWorktrees!: (err: any) => void;
  mocks.worktrees.mockImplementationOnce(() => new Promise((_, reject) => { rejectWorktrees = reject; }));
  render(<ExplorerView project={project} />);
  await screen.findByRole('button', { name: 'owner.txt' });
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await screen.findByText('Loading checkouts');
  fireEvent.click(screen.getByRole('button', { name: 'Checkouts' }));
  await act(async () => rejectWorktrees(new Error('late failure')));
  expect(screen.queryByRole('alert')).toBeNull();
});

