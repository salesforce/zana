/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { LocalSuiteDetail, type LocalSuiteDetailProps } from './LocalSuiteDetail.js';
import type { TestsPaneProps } from './TestsPane.js';

afterEach(cleanup);
const suite = { id: 'Support', path: 'tests/Support.scenario.json', cases: [{ id: 'refund', name: 'Refund', utterances: ['Refund please', 'Order 42'], expect: {} }] };
const path = 'force-app/Support.agent';
function setup(handlers: Record<string, unknown> = {}, overrides: Partial<TestsPaneProps> = {}) {
  const call = vi.fn<NonNullable<TestsPaneProps['call']>>(async (_p, method) => {
    const result = handlers[method];
    if (result instanceof Error) throw result;
    return result ?? (method === 'agentFiles.list' ? { ok: true, files: [{ path }] } : { ok: true, file: { path, content: 'saved source' } });
  });
  const Cases = vi.fn((props: TestsPaneProps) => <div data-testid="cases" data-source={props.source} data-path={props.path} data-dirty={String(props.dirty)} />);
  const editor: TestsPaneProps = { pluginId: 'salesforce', projectId: 'p1', threadId: 't1', path, source: 'unsaved editor', dirty: true, visible: true, proposalSource: 'proposal', roleplay: null, onShowPath: vi.fn(), call, ...overrides };
  const props: LocalSuiteDetailProps = { suite, editor, Cases };
  const view = render(<LocalSuiteDetail {...props} />);
  return { call, Cases, props, view };
}

it('uses the current editor, including unsaved source and proposals, without reading disk', () => {
  const { call, Cases } = setup();
  expect(screen.getByTestId('cases').dataset).toMatchObject({ source: 'unsaved editor', dirty: 'true', path });
  expect(Cases.mock.calls.at(-1)![0]).toMatchObject({ casesOnly: true, proposalSource: 'proposal' });
  expect(call).not.toHaveBeenCalled();
});

it('loads another agent through confined project RPCs and clears editor-only actions', async () => {
  const { call, Cases } = setup({}, { path: 'force-app/Other.agent' });
  expect(await screen.findByTestId('cases')).toBeTruthy();
  expect(call.mock.calls.map(([, method, args]) => [method, args])).toEqual([
    ['agentFiles.list', { projectId: 'p1' }], ['agentFiles.read', { projectId: 'p1', path }]
  ]);
  expect(Cases.mock.calls.at(-1)![0]).toMatchObject({ path, source: 'saved source', dirty: false, proposalSource: null, onShowPath: undefined, casesOnly: true });
  expect(screen.getByText(/Simulate uses the saved source/)).toBeTruthy();
});

it.each([
  [{ ok: true, files: [] }, /No local agent file matches/],
  [{ ok: true, files: [{ path }, { path: 'drafts/Support.agent' }] }, /Open the agent file to choose/],
  [{ ok: false, error: 'Cannot list files' }, /Cannot list files/],
  [null, /Could not find the local agent/],
  [new Error('Network failed'), /Network failed/]
])('keeps suite cases visible when the source is unavailable: %j', async (listed, message) => {
  const { call } = setup({ 'agentFiles.list': listed ?? { ok: true } }, { path: null });
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByText('Refund')).toBeTruthy();
  expect(screen.getByText('Refund please / Order 42')).toBeTruthy();
  expect(screen.queryByTestId('cases')).toBeNull();
  expect(call.mock.calls.some(([, m]) => m === 'agentFiles.read')).toBe(false);
});

it.each([{ ok: false, error: 'Read refused' }, { ok: true }])('shows a read failure without running cases: %j', async reply => {
  setup({ 'agentFiles.read': reply }, { path: null });
  expect(await screen.findByText(reply.error ?? 'Could not read the local agent file.')).toBeTruthy();
  expect(screen.queryByTestId('cases')).toBeNull();
});

it('does not read while hidden and ignores stale replies after unmount', async () => {
  const { call, props, view } = setup({}, { path: null, visible: false, projectId: undefined });
  expect(call).not.toHaveBeenCalled();
  let resolve!: (value: unknown) => void;
  call.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  view.rerender(<LocalSuiteDetail {...props} editor={{ ...props.editor, visible: true }} />);
  await waitFor(() => expect(call).toHaveBeenCalledWith('salesforce', 'agentFiles.list', {}));
  view.unmount();
  await act(async () => resolve({ ok: true, files: [{ path }] }));
  expect(call).toHaveBeenCalledTimes(1);
});

it('ignores a source read completed after the selected suite is closed', async () => {
  const { call, props, view } = setup({}, { path: null, visible: false });
  let resolve!: (value: unknown) => void;
  call.mockImplementation(async (_p, method) => method === 'agentFiles.list' ? { ok: true, files: [{ path }] } : new Promise(r => { resolve = r; }));
  view.rerender(<LocalSuiteDetail {...props} editor={{ ...props.editor, visible: true }} />);
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  view.unmount();
  await act(async () => resolve({ ok: true, file: { path, content: 'late' } }));
});
