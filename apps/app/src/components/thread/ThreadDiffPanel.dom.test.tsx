/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThreadDiffPanel } from './ThreadDiffPanel.js';
import { ThreadDiffFileNavigator, DiffFileIcon } from './ThreadDiffFileNavigator.js';
import { ThreadDiffCommit } from './ThreadDiffCommit.js';

const api = vi.hoisted(() => ({ diffFiles: vi.fn(), diffPatch: vi.fn(), status: vi.fn(), action: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { environments: api } }));
vi.mock('../ui/PopoverPicklist.js', () => ({
  PopoverPicklist: ({ ariaLabel, value, options, onChange }: any) => <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
    {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>
}));

const file = (path: string, overrides = {}) => ({ path, previousPath: null, changeKind: 'modified' as const, additions: 2, deletions: 1, binary: false, loadMode: 'auto' as const, origin: 'tracked' as const, ...overrides });
const files = [file('src/components/Button.tsx'), file('src/styles/main.css'), file('README.md', { changeKind: 'added', deletions: 0 })];
const patch = '@@ -12,3 +12,3 @@\n const value = 1;\n-before\n+after\n end';
const response = (entries = files, overrides = {}) => ({ files: entries, truncated: false, initialPatches: entries.map(({ path }) => ({ path, patch, truncated: false })), ...overrides });
const panel = (overrides = {}) => <ThreadDiffPanel environmentId="env-1" path={null} onClose={vi.fn()} embedded {...overrides} />;

beforeEach(() => {
  vi.resetAllMocks();
  api.diffFiles.mockResolvedValue(response());
  api.status.mockResolvedValue({ branchName: 'feature/changes-panel', dirty: true });
  api.diffPatch.mockResolvedValue({ patches: [{ path: files[0].path, patch, truncated: false }] });
  api.action.mockResolvedValue({ ok: true });
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Changes workbench', () => {
  it('shows scope, branch, totals and a continuous diff with a toggleable searchable navigator', async () => {
    render(panel());
    expect(screen.getByTestId('thread-diff-skeleton')).toBeTruthy();
    await screen.findByTestId('thread-diff-toolbar');
    expect(screen.getByTitle('On branch feature/changes-panel')).toBeTruthy();
    expect(screen.getByTestId('thread-diff-toolbar-summary').textContent).toContain('+6');
    expect(screen.getAllByTestId('thread-diff-card')).toHaveLength(3);
    expect(screen.queryByRole('navigation')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show changed files' }));
    const nav = screen.getByRole('navigation', { name: 'Changed files' });
    expect(within(nav).getByText('3 files changed')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'button' } });
    expect(screen.getAllByTestId('thread-diff-card')).toHaveLength(1);
    expect(within(nav).getByText('1 of 3 files changed')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(screen.getAllByText('No matching files.')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Hide changed files' }));
    expect(screen.getAllByTestId('thread-diff-card')).toHaveLength(3);
  });

  it('expands and scrolls to a file from the tree, collapses files, wraps and splits the diff', async () => {
    render(panel());
    await screen.findByTestId('thread-diff-toolbar');
    const options = screen.getByLabelText('Diff display options');
    fireEvent.click(options);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all files' }));
    expect(screen.queryAllByTestId('thread-diff-hunks')).toHaveLength(0);
    fireEvent.keyDown(options, { key: 'Escape' });
    expect(options.parentElement?.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show changed files' }));
    fireEvent.click(screen.getByRole('button', { name: 'View diff for src/styles/main.css' }));
    expect(screen.getByRole('button', { name: 'View diff for src/styles/main.css' }).getAttribute('aria-current')).toBe('true');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(screen.getAllByTestId('thread-diff-hunks')).toHaveLength(1);
    fireEvent.click(options);
    fireEvent.click(screen.getByRole('button', { name: 'Wrap diff lines' }));
    fireEvent.click(screen.getByRole('button', { name: 'Split diff view' }));
    expect(screen.getByTestId('thread-diff-hunks').className).toContain('is-wrap is-split');
    fireEvent.click(screen.getByRole('button', { name: 'Stacked diff view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable diff line wrap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand all files' }));
    expect(screen.getAllByTestId('thread-diff-hunks')).toHaveLength(3);
    fireEvent.blur(options.parentElement!, { relatedTarget: document.body });
    expect(options.parentElement?.hasAttribute('open')).toBe(false);
  });

  it('selects real diff targets and can render without branch status', async () => {
    api.status.mockRejectedValue(new Error('offline'));
    render(panel());
    await screen.findByTestId('thread-diff-toolbar');
    expect(screen.queryByText('Commit')).toBeNull();
    fireEvent.change(screen.getByLabelText('Diff scope'), { target: { value: 'uncommitted' } });
    await waitFor(() => expect(api.diffFiles).toHaveBeenLastCalledWith('env-1', { type: 'uncommitted' }));
    await screen.findByTestId('thread-diff-toolbar');
    fireEvent.change(screen.getByLabelText('Diff scope'), { target: { value: 'all' } });
    await waitFor(() => expect(api.diffFiles).toHaveBeenLastCalledWith('env-1', undefined));
  });

  it('reports errors and empty and capped results', async () => {
    api.diffFiles.mockRejectedValueOnce(new Error('Git is unavailable'));
    const view = render(panel());
    await screen.findByText('Git is unavailable');
    api.diffFiles.mockResolvedValueOnce(response([]));
    view.rerender(panel({ environmentId: 'env-2' }));
    await screen.findByText('No changes.');
    api.diffFiles.mockResolvedValue(response(files, { truncated: true }));
    view.rerender(panel({ environmentId: 'env-3' }));
    await screen.findByText('Showing the first 3 changed files. Additional changes are omitted.');
    expect(screen.getByTestId('thread-diff-toolbar-summary').textContent).toContain('shown');
  });

  it('loads deferred patches, retries failures and ignores responses from an old environment', async () => {
    api.diffFiles.mockResolvedValue(response([file('large.ts', { loadMode: 'on_demand' })], { initialPatches: [] }));
    api.diffPatch.mockRejectedValueOnce(new Error('Patch failed'));
    const view = render(panel({ path: 'large.ts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load diff' }));
    await screen.findByText('Patch failed');
    let resolvePatch!: (value: unknown) => void;
    api.diffPatch.mockImplementationOnce(() => new Promise((resolve) => { resolvePatch = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    api.diffFiles.mockResolvedValue(response([file('large.ts')], { initialPatches: [{ path: 'large.ts', patch: '@@ -1 +1 @@\n-old\n+new environment', truncated: false }] }));
    view.rerender(panel({ environmentId: 'env-2', path: 'large.ts' }));
    await waitFor(() => expect(screen.getByTestId('thread-diff-hunks').textContent).toContain('new environment'));
    await act(async () => resolvePatch({ patches: [{ path: 'large.ts', patch: '@@ -1 +1 @@\n+stale', truncated: false }] }));
    expect(screen.queryByText('stale')).toBeNull();
    expect(screen.getByTestId('thread-diff-hunks').textContent).toContain('new environment');
  });

  it('polls while mounted and clears the timer on unmount', async () => {
    vi.useFakeTimers();
    const view = render(panel());
    await act(async () => {});
    expect(api.diffFiles).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(api.diffFiles).toHaveBeenCalledTimes(2);
    view.unmount();
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.diffFiles).toHaveBeenCalledTimes(2);
  });
});

describe('Changed file navigation', () => {
  it('compresses directories, collapses folders, switches to a list and keeps rename context', () => {
    const onSelect = vi.fn();
    const renamed = file('apps/app/src/Button.tsx', { previousPath: 'old.tsx', changeKind: 'renamed' });
    const props = { files: [renamed, file('README.md')], total: 2, truncated: true, query: '', onQueryChange: vi.fn(), activePath: null, onSelect };
    const view = render(<ThreadDiffFileNavigator {...props} />);
    const folder = screen.getByRole('button', { name: 'apps / app / src' });
    fireEvent.click(folder);
    expect(screen.queryByRole('button', { name: 'View diff for apps/app/src/Button.tsx' })).toBeNull();
    fireEvent.click(folder);
    fireEvent.click(screen.getByRole('button', { name: 'View diff for apps/app/src/Button.tsx' }));
    expect(onSelect).toHaveBeenCalledWith('apps/app/src/Button.tsx');
    expect(screen.getByTitle('old.tsx -> apps/app/src/Button.tsx')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View as list' }));
    expect(screen.getByText('apps/app/src/Button.tsx')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View as tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'apps / app / src' }));
    view.rerender(<ThreadDiffFileNavigator {...props} query="button" />);
    expect(screen.getByRole('button', { name: 'View diff for apps/app/src/Button.tsx' })).toBeTruthy();
  });

  it.each(['file.ts', 'file.js', 'file.tsx', 'file.jsx', 'file.scss', 'file.json', 'README.md', 'notes.txt', 'file.py', 'LICENSE'])('renders a decorative file type for %s', (path) => {
    const { container } = render(<DiffFileIcon path={path} />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Commit from the diff', () => {
  it('requires a message, sends only on submit, shows failures and supports a retry', async () => {
    const onCommitted = vi.fn();
    api.action.mockRejectedValueOnce(new Error('Commit hook failed'));
    render(<ThreadDiffCommit environmentId="env-1" onCommitted={onCommitted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expect((screen.getByRole('button', { name: 'Commit changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.action).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: '  Improve changes panel  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit changes' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe('Commit hook failed');
    fireEvent.click(screen.getByRole('button', { name: 'Commit changes' }));
    await waitFor(() => expect(onCommitted).toHaveBeenCalledOnce());
    expect(api.action).toHaveBeenLastCalledWith('env-1', { action: 'commit', message: 'Improve changes panel' });
    expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel commit' }));
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('refreshes the panel after committing', async () => {
    render(panel());
    fireEvent.click(await screen.findByRole('button', { name: 'Commit' }));
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'New message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit changes' }));
    await waitFor(() => expect(api.diffFiles).toHaveBeenCalledTimes(2));
  });
});
