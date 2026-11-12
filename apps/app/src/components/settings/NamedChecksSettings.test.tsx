// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NamedCheck } from '@zana-ai/zcc-contracts/project-settings';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), desktop: true,
  onChanged: vi.fn(() => () => {})
}));

vi.mock('../../lib/product-client.js', () => ({ product: { namedChecks: { get: h.get, set: h.set, onChanged: h.onChanged } } }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));

beforeEach(() => {
  vi.clearAllMocks();
  h.desktop = true;
  h.get.mockImplementation(async (scope) => scope.kind === 'global' ? [{ name: 'lint', command: 'pnpm lint' }] : []);
  h.set.mockImplementation(async (_scope, checks) => checks);
});

afterEach(cleanup);

async function mount(projectId?: string) {
  const module = await import('./NamedChecksSettings.js');
  expect(module).toHaveProperty('NamedChecksSettings', expect.any(Function));
  return render(<module.NamedChecksSettings projectId={projectId} />);
}

async function edit(name = 'lint') {
  const button = await screen.findByRole('button', { name: `Edit ${name}` });
  fireEvent.click(button);
  return screen.findByLabelText(/^Check name \d+$/);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

it.each([undefined, 'p1'])('exposes named checks search target for scope %s', async (projectId) => {
  const view = await mount(projectId);
  await screen.findByRole('button', { name: 'Save checks' });
  expect(view.container.querySelector(`[data-settings-target="${projectId ? 'project' : 'global'}.named-checks"]`)).not.toBeNull();
});

it('keeps checks compact initially and opens only one editor at a time', async () => {
  h.get.mockResolvedValueOnce([{ name: 'lint', command: 'pnpm lint' }, { name: 'test', command: 'pnpm test' }]);
  await mount();
  await screen.findByRole('button', { name: 'Edit lint' });
  expect(screen.queryByLabelText('Check name 1')).toBeNull();
  expect(screen.queryByLabelText('Command 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit lint' }));
  expect(await screen.findByLabelText('Command 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit test' }));
  expect(screen.queryByLabelText('Command 1')).toBeNull();
  expect(await screen.findByLabelText('Command 2')).toBeTruthy();
});

it('adds a focused new editor and saves only persisted check fields', async () => {
  await mount();
  await screen.findByRole('button', { name: 'Add check' });
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  const name = await screen.findByLabelText('Check name 2');
  await waitFor(() => expect(document.activeElement).toBe(name));
  fireEvent.change(name, { target: { value: 'test' } });
  fireEvent.change(screen.getByLabelText('Command 2'), { target: { value: 'pnpm test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save checks' }));
  await waitFor(() => expect(h.set).toHaveBeenCalledWith({ kind: 'global' }, [
    { name: 'lint', command: 'pnpm lint' }, { name: 'test', command: 'pnpm test' }
  ]));
});

it('done editing closes without saving and returns focus to Edit', async () => {
  await mount();
  const name = await edit();
  fireEvent.change(name, { target: { value: 'format' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(screen.queryByLabelText('Check name 1')).toBeNull();
  expect(h.set).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit format' })));
  expect((screen.getByRole('button', { name: 'Save checks' }) as HTMLButtonElement).disabled).toBe(false);
});

it('gates save until dirty and valid, with collapsed Needs attention copy', async () => {
  await mount();
  const save = await screen.findByRole('button', { name: 'Save checks' });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  const name = await edit();
  fireEvent.change(name, { target: { value: '2bad' } });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(screen.getByText('Needs attention')).toBeTruthy();
  expect(screen.getByText('Review checks marked Needs attention before saving.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit 2bad' }));
  fireEvent.change(await screen.findByLabelText('Check name 1'), { target: { value: 'format' } });
  expect((save as HTMLButtonElement).disabled).toBe(false);
});

it.each(['_tests-2', 'lint-fast', 'A_b-2', 'a'.repeat(100)])('admits portable check name %s in editor', async (name) => {
  await mount();
  fireEvent.change(await edit(), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save checks' }));
  await waitFor(() => expect(h.set).toHaveBeenCalledWith({ kind: 'global' }, [{ name, command: 'pnpm lint' }]));
});

it.each(['2bad', 'a.b', 'a'.repeat(101)])('rejects incompatible check name %s before owner mutation', async (name) => {
  await mount();
  fireEvent.change(await edit(), { target: { value: name } });
  const input = screen.getByLabelText('Check name 1');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect((screen.getByRole('button', { name: 'Save checks' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save checks' }));
  expect(h.set).not.toHaveBeenCalled();
});

it('marks invalid command field independently', async () => {
  await mount();
  await edit();
  const command = screen.getByLabelText('Command 1');
  fireEvent.change(command, { target: { value: '' } });
  expect(command.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByLabelText('Check name 1').getAttribute('aria-invalid')).toBe('false');
});

it('shows inherited name and scope separately, saves an override, then removes it', async () => {
  await mount('p1');
  expect((await screen.findByText('lint')).textContent).toContain('lint');
  expect(screen.getByText('Inherited')).toBeTruthy();
  expect(screen.queryByText('lint — inherited')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Override lint' }));
  const name = await screen.findByLabelText('Check name 1');
  await waitFor(() => expect(document.activeElement).toBe(name));
  fireEvent.change(screen.getByLabelText('Command 1'), { target: { value: 'project lint' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save checks' }));
  await waitFor(() => expect(h.set).toHaveBeenCalledWith({ kind: 'project', projectId: 'p1' }, [{ name: 'lint', command: 'project lint' }]));
  fireEvent.click(screen.getByRole('button', { name: 'Remove check 1' }));
  expect(await screen.findByText('Inherited')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save checks' }));
  await waitFor(() => expect(h.set).toHaveBeenLastCalledWith({ kind: 'project', projectId: 'p1' }, []));
});

it('writes project checks only, excluding inherited global checks', async () => {
  h.get.mockImplementation(async (scope) => scope.kind === 'project'
    ? [{ name: 'test', command: 'pnpm test' }]
    : [{ name: 'lint', command: 'pnpm lint' }]);
  await mount('p1');
  fireEvent.change(await edit('test'), { target: { value: 'project-test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save checks' }));
  await waitFor(() => expect(h.set).toHaveBeenCalledWith({ kind: 'project', projectId: 'p1' }, [{ name: 'project-test', command: 'pnpm test' }]));
});

it('round-trips multiline commands and previews first line', async () => {
  await mount();
  await edit();
  fireEvent.change(screen.getByLabelText('Command 1'), { target: { value: 'pnpm lint\npnpm test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(screen.getByText('pnpm lint [multiline]').textContent).toContain('pnpm lint [multiline]');
  fireEvent.click(screen.getByRole('button', { name: 'Edit lint' }));
  expect((await screen.findByLabelText('Command 1') as HTMLTextAreaElement).value).toBe('pnpm lint\npnpm test');
});

it('keeps editor attached to stable check after removing another row', async () => {
  h.get.mockResolvedValueOnce([{ name: 'lint', command: 'pnpm lint' }, { name: 'test', command: 'pnpm test' }]);
  await mount();
  await edit('test');
  fireEvent.click(screen.getByRole('button', { name: 'Remove check 1' }));
  expect((await screen.findByLabelText('Check name 1') as HTMLInputElement).value).toBe('test');
  expect((screen.getByLabelText('Command 1') as HTMLTextAreaElement).value).toBe('pnpm test');
});

it('enforces editor limits and shows empty state', async () => {
  h.get.mockResolvedValueOnce([]);
  await mount();
  expect(await screen.findByText('No named checks yet. Add a check to reference it in a Squad plan.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  expect((await screen.findByLabelText('Check name 1')).getAttribute('maxLength')).toBe('100');
  expect(screen.getByLabelText('Command 1').getAttribute('maxLength')).toBe('16384');
});

it('preserves unsaved draft on persistence failure and rejects duplicate names locally', async () => {
  await mount();
  h.set.mockRejectedValueOnce(new Error('disk full'));
  fireEvent.change(await edit(), { target: { value: 'format' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save checks' }));
  expect((await screen.findByRole('alert')).textContent).toContain('disk full');
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  fireEvent.change(await screen.findByLabelText('Check name 2'), { target: { value: 'format' } });
  fireEvent.change(screen.getByLabelText('Command 2'), { target: { value: 'other format' } });
  expect((screen.getByRole('button', { name: 'Save checks' }) as HTMLButtonElement).disabled).toBe(true);
});

it.each([
  ['succeeds', (pending: ReturnType<typeof deferred<NamedCheck[]>>) => pending.resolve([{ name: 'a-check', command: 'pnpm a' }])],
  ['fails', (pending: ReturnType<typeof deferred<NamedCheck[]>>) => pending.reject(new Error('A save failed'))]
])('does not apply late project A save feedback after switching to project B when save %s', async (_outcome, settle) => {
  const aSave = deferred<NamedCheck[]>();
  h.get.mockImplementation(async (scope) => {
    if (scope.kind === 'project') return scope.projectId === 'p1'
      ? [{ name: 'a-check', command: 'pnpm a' }]
      : [{ name: 'b-check', command: 'pnpm b' }];
    return [];
  });
  h.set.mockImplementation(() => aSave.promise);
  const view = await mount('p1');
  const { NamedChecksSettings } = await import('./NamedChecksSettings.js');
  await screen.findByRole('button', { name: 'Edit a-check' });
  fireEvent.change(await edit('a-check'), { target: { value: 'a-updated' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save checks' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();

  view.rerender(<NamedChecksSettings projectId="p2" />);
  expect(await screen.findByRole('button', { name: 'Edit b-check' })).toBeTruthy();
  const save = screen.getByRole('button', { name: 'Save checks' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);

  settle(aSave);
  await Promise.resolve();
  await Promise.resolve();

  expect(screen.getByRole('button', { name: 'Edit b-check' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Save checks' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Checks saved.')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('fails closed on load errors and does not expose writes outside desktop', async () => {
  h.get.mockRejectedValueOnce(new Error('owner unavailable'));
  const view = await mount();
  expect((await screen.findByRole('alert')).textContent).toContain('owner unavailable');
  expect(screen.queryByRole('button', { name: 'Save checks' })).toBeNull();
  view.unmount();
  h.desktop = false;
  h.get.mockClear();
  await mount();
  expect(screen.getByText('Manage named checks in the owner desktop window.')).toBeTruthy();
  expect(h.get).not.toHaveBeenCalled();
});
