// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Windows checkout: listDir joins entries with `\`, and the git-status keys
// use the same spelling. Explorer must match them in the Changes list, the
// active row, the git colour and the dirty-folder marker.
const ROOT = "C:\\work\\reveal test's repo";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  gitStatus: vi.fn(),
  discard: vi.fn(),
  toast: vi.fn(),
  tree: {} as Record<string, Array<{ name: string; kind: 'file' | 'dir' }>>
}));
vi.mock('@/lib/monacoSetup', () => ({}));
vi.mock('../../hooks/useHosts.js', () => ({
  useHosts: () => [{ id: 'a', name: 'Primary', isPrimary: true, status: 'connected' }]
}));
vi.mock('@/hooks/useMonacoTheme', () => ({ useMonacoTheme: () => 'dark' }));
vi.mock('@/hooks/useFileDrop', () => ({ useFileDrop: () => ({ dropOver: false, dropHandlers: {} }) }));
vi.mock('@/components/AiEnhanceSelection', () => ({
  useAiEnhanceSelection: () => ({ registerEditor: vi.fn(), modal: null })
}));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    fs: { listDir: mocks.list, readFile: mocks.read },
    git: { status: mocks.gitStatus, discard: mocks.discard, showHead: async () => ({ ok: true, content: '' }), listWorktrees: async () => [], listBranches: async () => [] },
    environments: { list: async () => [] }
  }
}));
vi.mock('@/store', async () => {
  const { create } = await import('zustand');
  const keyed = (field: string) => (id: string, value: unknown) =>
    useUi.setState((state: any) => ({ [field]: { ...state[field], [id]: value } }));
  const useUi = create<any>(() => ({
    explorerFile: {},
    explorerGoto: {},
    explorerTreeMode: {},
    explorerDiff: {},
    pushToast: mocks.toast,
    setProjectView: vi.fn(),
    selectTab: vi.fn(),
    setExplorerDiff: keyed('explorerDiff'),
    setExplorerTreeMode: keyed('explorerTreeMode'),
    setExplorerFile: keyed('explorerFile')
  }));
  const useData = create<any>(() => ({ gitStatus: {}, createTerminal: vi.fn(), loadGitStatus: vi.fn() }));
  return { useUi, useData };
});
vi.mock('@/components/explorer', async () => {
  const real = await import('../../components/explorer/index.js');
  return {
    WorktreeMenu: () => null,
    ExplorerGitFooter: () => null,
    ExplorerTreeHeader: () => null,
    ExplorerContextMenu: () => null,
    FileViewer: () => null,
    useFileOperations: () => ({}),
    TreeList: real.TreeList,
    ChangesList: real.ChangesList
  };
});
import { ExplorerView } from './ExplorerView.js';
import { useUi } from '@/store';

const project: any = { id: 'p', name: 'Project', path: ROOT, hostId: 'a', sources: [] };
const fileRow = (name: string) =>
  screen.queryByText(name, { selector: '.tree-name' })?.closest<HTMLElement>('.tree-row') ?? null;

const setTreeMode = (mode: 'files' | 'changes') =>
  act(async () => {
    useUi.getState().setExplorerTreeMode('p', mode);
  });

function fakeListDir(path: string) {
  return (mocks.tree[path] ?? []).map((entry) => ({ ...entry, path: `${path}\\${entry.name}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ explorerFile: {}, explorerGoto: {}, explorerTreeMode: {}, explorerDiff: {} });
  mocks.tree = {
    [ROOT]: [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }],
    [`${ROOT}\\src`]: [{ name: 'feature', kind: 'dir' }],
    [`${ROOT}\\src\\feature`]: [{ name: 'a05.ts', kind: 'file' }, { name: 'clean.ts', kind: 'file' }]
  };
  mocks.list.mockImplementation(async (path: string) => fakeListDir(path));
  mocks.read.mockResolvedValue({ ok: true, content: 'x' });
  mocks.gitStatus.mockResolvedValue({
    branch: 'main',
    detached: false,
    ahead: 0,
    behind: 0,
    dirty: true,
    toplevel: ROOT,
    files: { [`${ROOT}\\src\\feature\\a05.ts`]: 'M' }
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('lists Windows git changes, then marks the file opened from them as current and modified in the tree', async () => {
  render(<ExplorerView project={project} />);
  // Open the folders in the file tree first, then pick the file from Changes.
  fireEvent.click(await screen.findByText('src'));
  fireEvent.click(await screen.findByText('feature'));
  await screen.findByText('clean.ts');
  await setTreeMode('changes');

  // The Changes list shows the file with its folder relative to the root.
  const change = await screen.findByText('a05.ts', { selector: '.tree-name' });
  expect(change.textContent).toBe('a05.ts · src/feature');
  fireEvent.click(change);
  await waitFor(() => expect(fileRow('a05.ts')?.classList.contains('active')).toBe(true));

  await setTreeMode('files');
  await waitFor(() => expect(fileRow('a05.ts')?.getAttribute('aria-current')).toBe('true'));
  const row = fileRow('a05.ts')!;
  expect(row.classList.contains('active')).toBe(true);
  expect(row.classList.contains('git-m')).toBe(true);
  expect(row.dataset.path).toBe(`${ROOT}\\src\\feature\\a05.ts`);
  expect(fileRow('clean.ts')?.className).not.toMatch(/git-/);
  // Each ancestor folder under the root carries the dirty marker; the root itself doesn't.
  expect(fileRow('src')?.classList.contains('git-dir-dirty')).toBe(true);
  expect(fileRow('feature')?.classList.contains('git-dir-dirty')).toBe(true);
  expect(fileRow('README.md')?.className).not.toMatch(/git-/);
});

it('names a Windows change by its path under the root when discarding it', async () => {
  mocks.discard.mockResolvedValue({ ok: true });
  const confirm = vi.fn(() => true);
  vi.stubGlobal('confirm', confirm);
  useUi.setState({ explorerTreeMode: { p: 'changes' } });
  render(<ExplorerView project={project} />);
  await screen.findByText('a05.ts', { selector: '.tree-name' });
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Discarded src/feature/a05.ts'));
  expect(confirm).toHaveBeenCalledWith('Discard changes to src/feature/a05.ts? This cannot be undone.');
  expect(mocks.discard.mock.calls[0][0]).toBe(`${ROOT}\\src\\feature\\a05.ts`);
});

it('leaves out git keys outside the root and the root itself', async () => {
  mocks.gitStatus.mockResolvedValue({
    branch: 'main',
    detached: false,
    ahead: 0,
    behind: 0,
    dirty: true,
    toplevel: 'C:\\work',
    files: { 'C:\\work\\outside.ts': 'M', [`${ROOT}-two\\b.ts`]: 'M', [`${ROOT}\\README.md`]: '?' }
  });
  useUi.setState({ explorerTreeMode: { p: 'changes' } });
  render(<ExplorerView project={project} />);
  expect((await screen.findByText('README.md', { selector: '.tree-name' })).textContent).toBe('README.md');
  expect(screen.queryByText('outside.ts', { selector: '.tree-name' })).toBeNull();
  expect(screen.queryByText('b.ts', { selector: '.tree-name' })).toBeNull();
  await setTreeMode('files');
  await waitFor(() => expect(fileRow('README.md')?.classList.contains('git-untracked')).toBe(true));
  // The root's own row isn't listed, and no folder under it is marked dirty.
  expect(fileRow('src')?.classList.contains('git-dir-dirty')).toBe(false);
});
