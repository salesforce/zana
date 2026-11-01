// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), remoteRoot: vi.fn(), listRemote: vi.fn(), readRemote: vi.fn(), toast: vi.fn(), viewer: {} as any, tree: {} as Record<string, Array<{ name: string; kind: 'file' | 'dir' }>> }));
vi.mock('@/lib/monacoSetup', () => ({}));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [{ id: 'a', name: 'Primary', isPrimary: true, status: 'connected' }] }));
vi.mock('@/hooks/useMonacoTheme', () => ({ useMonacoTheme: () => 'dark' }));
vi.mock('@/hooks/useFileDrop', () => ({ useFileDrop: () => ({ dropOver: false, dropHandlers: {} }) }));
vi.mock('@/components/AiEnhanceSelection', () => ({ useAiEnhanceSelection: () => ({ registerEditor: vi.fn(), modal: null }) }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  fs: { listDir: mocks.list, readFile: mocks.read, remoteRoot: mocks.remoteRoot, listDirRemote: mocks.listRemote, readFileRemote: mocks.readRemote },
  git: { status: async () => null, listWorktrees: async () => [], listBranches: async () => [] },
  environments: { list: async () => [] }
} }));
vi.mock('@/store', async () => {
  const { create } = await import('zustand');
  const useUi = create<any>((set: any) => ({ explorerFile: {}, explorerGoto: {}, explorerTreeMode: {}, explorerDiff: {},
    pushToast: mocks.toast, setProjectView: vi.fn(), selectTab: vi.fn(), setExplorerDiff: vi.fn(),
    setExplorerTreeMode: (id: string, mode: string) => set((state: any) => ({ explorerTreeMode: { ...state.explorerTreeMode, [id]: mode } })),
    setExplorerFile: (id: string, path: string) => set((state: any) => ({ explorerFile: { ...state.explorerFile, [id]: path } }))
  }));
  const useData = create<any>(() => ({ gitStatus: {}, createTerminal: vi.fn(), loadGitStatus: vi.fn() }));
  return { useUi, useData };
});
vi.mock('@/components/explorer', async () => ({
  WorktreeMenu: () => null, ExplorerGitFooter: () => null, ExplorerTreeHeader: () => null,
  ExplorerContextMenu: () => null, ChangesList: () => null, useFileOperations: () => ({}), FileViewer: (props: any) => { mocks.viewer = props; return null; },
  TreeList: (await import('../../components/explorer/TreeList.js')).TreeList
}));
import { ExplorerView } from './ExplorerView.js';
import { useUi } from '@/store';

const project: any = { id: 'p', name: 'Project', path: '/a', hostId: 'a', sources: [] };
const open = (path: string) => act(async () => { useUi.getState().setExplorerFile('p', path); });
const row = (name: string) => screen.queryByText(name, { selector: '.tree-name' })?.closest<HTMLElement>('.tree-row') ?? null;
const listed = () => mocks.list.mock.calls.map(([path]) => path);

// A fake tree keyed by directory path; separator follows the path it's given
// so the same fixture serves POSIX and Windows-style roots.
function fakeListDir(path: string) {
  const sep = path.includes('\\') ? '\\' : '/';
  return (mocks.tree[path] ?? []).map(entry => ({ ...entry, path: `${path}${sep}${entry.name}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ explorerFile: {}, explorerGoto: {}, explorerTreeMode: {} });
  mocks.tree = {
    // listDir never returns denied folders such as node_modules.
    '/a': [{ name: 'src', kind: 'dir' }, { name: 'zz', kind: 'dir' }, { name: 'README.md', kind: 'file' }],
    '/a/src': [{ name: 'deep', kind: 'dir' }, { name: 'index.ts', kind: 'file' }],
    '/a/src/deep': [{ name: 'nested', kind: 'dir' }],
    '/a/src/deep/nested': [{ name: 'leaf.ts', kind: 'file' }],
    '/a/zz': [{ name: 'other.ts', kind: 'file' }]
  };
  mocks.list.mockImplementation(async (path: string) => fakeListDir(path));
  mocks.read.mockResolvedValue({ ok: true, content: 'x' });
  mocks.readRemote.mockResolvedValue({ ok: true, content: 'x' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Lays the tree pane out as 100px tall with rows 20px apart in DOM order, so a
// row deep in a long list sits below the visible area.
function layOutRows() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const body = this.closest('.explorer-tree-body') as HTMLElement | null;
    if (this.classList.contains('explorer-tree-body')) return { top: 0, bottom: 100, height: 100 } as DOMRect;
    if (!body || !this.classList.contains('tree-row')) return { top: 0, bottom: 0, height: 0 } as DOMRect;
    const index = Array.from(body.querySelectorAll('.tree-row')).indexOf(this);
    const top = index * 20 - body.scrollTop;
    return { top, bottom: top + 20, height: 20 } as DOMRect;
  });
}

it('expands every lazily loaded ancestor of a deep file, selects it, and scrolls it into the tree pane', async () => {
  mocks.tree['/a/src/deep/nested'] = Array.from({ length: 30 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}.ts`, kind: 'file' as const }));
  layOutRows();
  const view = render(<ExplorerView project={project} />);
  await screen.findByText('README.md');
  const body = view.container.querySelector<HTMLElement>('.explorer-tree-body')!;
  await open('/a/src/deep/nested/f29.ts');
  await waitFor(() => expect(row('f29.ts')?.getAttribute('aria-current')).toBe('true'));
  expect(listed()).toEqual(['/a', '/a/src', '/a/src/deep', '/a/src/deep/nested']);
  expect(row('f29.ts')!.classList.contains('active')).toBe(true);
  // f29 is row index 32 (src, deep, nested, f00…f29): 32*20 - (100-20)/2 = 600.
  await waitFor(() => expect(body.scrollTop).toBe(600));
  // Siblings outside the path stay collapsed and unloaded.
  expect(listed()).not.toContain('/a/zz');
  // Focus stays where it was; revealing never moves it into the tree.
  expect(document.activeElement).toBe(document.body);
});

it('reveals Windows paths that use backslash separators', async () => {
  mocks.tree = { 'C:\\proj': [{ name: 'src', kind: 'dir' }], 'C:\\proj\\src': [{ name: 'app.ts', kind: 'file' }] };
  render(<ExplorerView project={{ ...project, path: 'C:\\proj' }} />);
  await screen.findByText('src');
  await open('C:\\proj\\src\\app.ts');
  await waitFor(() => expect(row('app.ts')?.getAttribute('aria-current')).toBe('true'));
  expect(listed()).toEqual(['C:\\proj', 'C:\\proj\\src']);
});

it('reveals a file deeper than 64 folders', async () => {
  let dir = '/a';
  mocks.tree = {};
  for (let i = 0; i < 70; i++) {
    mocks.tree[dir] = [{ name: `d${i}`, kind: 'dir' }];
    dir = `${dir}/d${i}`;
  }
  mocks.tree[dir] = [{ name: 'bottom.ts', kind: 'file' }];
  render(<ExplorerView project={project} />);
  await screen.findByText('d0');
  await open(`${dir}/bottom.ts`);
  await waitFor(() => expect(row('bottom.ts')?.getAttribute('aria-current')).toBe('true'));
  expect(listed()).toHaveLength(71);
});

it('drops a pending scroll when the user collapses the folder before the row renders', async () => {
  layOutRows();
  mocks.tree['/a/src'] = Array.from({ length: 20 }, (_, i) => ({ name: `s${String(i).padStart(2, '0')}.ts`, kind: 'file' as const }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mocks.list.mockImplementation(async (path: string) => {
    if (path === '/a/src') await gate;
    return fakeListDir(path);
  });
  const view = render(<ExplorerView project={project} />);
  await screen.findByText('README.md');
  await open('/a/src/s19.ts');
  await waitFor(() => expect(listed()).toContain('/a/src'));
  // The walk already expanded src; collapse it while its listing is in flight.
  fireEvent.click(screen.getByText('src'));
  await act(async () => { release(); await gate; });
  expect(row('s19.ts')).toBeNull();
  // Expanding it later shows the highlighted row but doesn't jump to it.
  fireEvent.click(screen.getByText('src'));
  await waitFor(() => expect(row('s19.ts')?.getAttribute('aria-current')).toBe('true'));
  expect(view.container.querySelector<HTMLElement>('.explorer-tree-body')!.scrollTop).toBe(0);
});

it('leaves an already visible file in place without re-listing its folder', async () => {
  layOutRows();
  const view = render(<ExplorerView project={project} />);
  fireEvent.click(await screen.findByText('src'));
  fireEvent.click(await screen.findByText('index.ts'));
  await waitFor(() => expect(row('index.ts')?.getAttribute('aria-current')).toBe('true'));
  expect(view.container.querySelector<HTMLElement>('.explorer-tree-body')!.scrollTop).toBe(0);
  expect(listed()).toEqual(['/a', '/a/src']);
});

it('lists the root once when the explorer mounts with a file already open', async () => {
  useUi.setState({ explorerFile: { p: '/a/src/index.ts' } });
  render(<ExplorerView project={project} />);
  await waitFor(() => expect(row('index.ts')?.getAttribute('aria-current')).toBe('true'));
  expect(listed()).toEqual(['/a', '/a/src']);
});

it('does not expand anything for files outside the tree or under folders the listing hides', async () => {
  render(<ExplorerView project={project} />);
  await screen.findByText('README.md');
  await open('/elsewhere/file.ts');
  await open('/a/node_modules/pkg/index.js');
  await open('/a/src/missing/gone.ts');
  await waitFor(() => expect(listed()).toEqual(['/a', '/a/src']));
  expect(screen.queryByText('deep')).not.toBeNull();
  expect(screen.queryByText('nested')).toBeNull();
  expect(document.querySelector('[aria-current]')).toBeNull();
});

it('keeps a folder the user collapses after a reveal collapsed while other folders load', async () => {
  render(<ExplorerView project={project} />);
  await screen.findByText('README.md');
  await open('/a/src/index.ts');
  await screen.findByText('index.ts');
  fireEvent.click(screen.getByText('src'));
  expect(screen.queryByText('index.ts')).toBeNull();
  fireEvent.click(screen.getByText('zz'));
  await screen.findByText('other.ts');
  expect(screen.queryByText('index.ts')).toBeNull();
  // Opening a file inside it again re-expands it.
  await open('/a/src/deep/nested/leaf.ts');
  await waitFor(() => expect(row('leaf.ts')?.getAttribute('aria-current')).toBe('true'));
  expect(screen.queryByText('index.ts')).not.toBeNull();
});

it('drops a slower reveal once a newer file is opened', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mocks.list.mockImplementation(async (path: string) => {
    if (path === '/a/src/deep') await gate;
    return fakeListDir(path);
  });
  render(<ExplorerView project={project} />);
  await screen.findByText('README.md');
  await open('/a/src/deep/nested/leaf.ts');
  await waitFor(() => expect(listed()).toContain('/a/src/deep'));
  await open('/a/zz/other.ts');
  await waitFor(() => expect(row('other.ts')?.getAttribute('aria-current')).toBe('true'));
  await act(async () => { release(); await gate; });
  // The stale walk stops at the folder it was listing: nested stays closed.
  expect(screen.queryByText('leaf.ts')).toBeNull();
  expect(listed()).not.toContain('/a/src/deep/nested');
});

it('scrolls to the file once the Changes list switches back to the file tree', async () => {
  layOutRows();
  mocks.tree['/a/zz'] = Array.from({ length: 20 }, (_, i) => ({ name: `z${String(i).padStart(2, '0')}.ts`, kind: 'file' as const }));
  useUi.setState({ explorerTreeMode: { p: 'changes' } });
  const view = render(<ExplorerView project={project} />);
  await open('/a/zz/z19.ts');
  await waitFor(() => expect(listed()).toEqual(['/a', '/a/zz']));
  expect(row('z19.ts')).toBeNull();
  await act(async () => { useUi.getState().setExplorerTreeMode('p', 'files'); });
  await waitFor(() => expect(row('z19.ts')?.getAttribute('aria-current')).toBe('true'));
  // z19 is row index 21 (src, zz, z00…z19): 21*20 - 40 = 380.
  expect(view.container.querySelector<HTMLElement>('.explorer-tree-body')!.scrollTop).toBe(380);
});

it('reveals files in a remote project through the remote listing', async () => {
  mocks.remoteRoot.mockResolvedValue({ ok: true, root: '/remote' });
  mocks.listRemote.mockImplementation(async (_id: string, path: string) => ({ '/remote': [{ name: 'lib', kind: 'dir', path: '/remote/lib' }], '/remote/lib': [{ name: 'x.py', kind: 'file', path: '/remote/lib/x.py' }] } as any)[path] ?? []);
  render(<ExplorerView project={{ ...project, path: '/placeholder', remote: { host: 'ssh-host', remotePath: '/remote' } }} />);
  await screen.findByText('lib');
  await open('/remote/lib/x.py');
  await waitFor(() => expect(row('x.py')?.getAttribute('aria-current')).toBe('true'));
  // (The root is listed twice on mount on main already; the reveal adds only lib.)
  expect(mocks.listRemote.mock.calls.map(([, path]) => path).filter(path => path !== '/remote')).toEqual(['/remote/lib']);
  expect(mocks.list).not.toHaveBeenCalled();
});

it('opens linked documents through the existing file reader and forwards their heading', async () => {
  render(<ExplorerView project={project} />);
  await open('/a/README.md');
  await waitFor(() => expect(mocks.viewer.fileLoading).toBe(false));
  await act(async () => { mocks.viewer.onOpenDocument({ path: '/a/src/guide.md', fragment: 'section-2' }); });
  await waitFor(() => expect(mocks.read).toHaveBeenLastCalledWith('/a/src/guide.md', { projectId: 'p', hostId: 'a' }));
  expect(useUi.getState().explorerFile.p).toBe('/a/src/guide.md');
  expect(mocks.viewer.fragment).toBe('section-2');
  expect(mocks.viewer.showPreview).toBe(true);
});

it('keeps unsaved Explorer changes when link navigation is cancelled', async () => {
  const previousConfirm = window.confirm;
  const confirm = vi.fn(() => false);
  window.confirm = confirm;
  try {
    render(<ExplorerView project={project} />);
    await open('/a/README.md');
    await waitFor(() => expect(mocks.viewer.fileLoading).toBe(false));
    act(() => mocks.viewer.onContentChange('unsaved changes'));
    act(() => mocks.viewer.onOpenDocument({ path: '/a/src/guide.md', fragment: '' }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(useUi.getState().explorerFile.p).toBe('/a/README.md');
    expect(mocks.viewer.editedContent).toBe('unsaved changes');
    confirm.mockReturnValue(true);
    await act(async () => { mocks.viewer.onOpenDocument({ path: '/a/src/guide.md', fragment: '' }); });
    expect(useUi.getState().explorerFile.p).toBe('/a/src/guide.md');
  } finally { window.confirm = previousConfirm; }
});
