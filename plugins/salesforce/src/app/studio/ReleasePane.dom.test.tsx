/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReleasePane, type ReleasePaneProps } from './ReleasePane.js';
import type { ReleaseState, ReleaseVersion } from '../../../lib/release-contract.js';

afterEach(cleanup);

const version = (versionNumber: number, extra: Partial<ReleaseVersion> = {}): ReleaseVersion => ({
  id: `0X9${versionNumber}`, versionNumber, active: false, modifiedAt: '2026-10-01T10:00:00.000Z', evidence: null, ...extra
});

const releaseState = (extra: Partial<ReleaseState> = {}, agent: Partial<ReleaseState['agent']> = {}): ReleaseState => ({
  org: { alias: 'dev', orgId: '00D1', kind: 'sandbox' },
  agent: { apiName: 'MyBot', path: 'force-app/main/default/aiAuthoringBundles/MyBot/MyBot.agent', revision: 'sha-1', versioned: false, lastPublish: null, ...agent },
  needsReadApproval: false,
  readUntil: null,
  versions: [version(2), version(1, { active: true })],
  ...extra
});

type Call = NonNullable<ReleasePaneProps['call']>;
type Approve = NonNullable<ReleasePaneProps['requestApproval']>;

function setup(overrides: Partial<ReleasePaneProps> = {}, states: ReleaseState[] = [releaseState()]) {
  let index = 0;
  const call = vi.fn<Call>(async (_plugin, method, args) => {
    if (method === 'release.state') return { ok: true, data: states[Math.min(index++, states.length - 1)] };
    if (method === 'release.prepare') {
      const { action } = args as { action: string };
      return { ok: true, data: { request: { binding: { action, target: '00D1', targetLabel: 'dev (sandbox)', subject: 'MyBot' }, title: `Do ${action}` } } };
    }
    return { ok: true, summary: `Ran ${(args as { action: string }).action}` };
  });
  const requestApproval = vi.fn<Approve>(async () => ({ approved: true, token: 'tok-1', expiresAt: 1 }));
  const props: ReleasePaneProps = {
    pluginId: 'salesforce', projectId: 'p1', path: 'force-app/main/default/aiAuthoringBundles/MyBot/MyBot.agent',
    visible: true, dirty: false, sha256: 'sha-1', compile: null, compileStale: false,
    onSave: vi.fn(), onCompile: vi.fn(), onAskAgent: vi.fn(), call, requestApproval, ...overrides
  };
  const view = render(<ReleasePane {...props} />);
  return { call, requestApproval, props, view };
}

const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;

it('asks for an open file when none is open', () => {
  const { call } = setup({ path: null });
  expect(screen.getByText(/Open an agent file/)).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
});

it('loads the lane, publishes through a signed approval and refreshes', async () => {
  const published = releaseState({}, { lastPublish: { revision: 'sha-1', at: Date.parse('2026-10-11T09:00:00Z') } });
  const { call, requestApproval } = setup({}, [releaseState(), published]);
  expect(await screen.findByTestId('release-org')).toHaveProperty('textContent', 'dev (sandbox)');
  expect(call).toHaveBeenCalledWith('salesforce', 'release.state', { projectId: 'p1', path: expect.stringContaining('MyBot.agent') });
  expect(screen.getByText('Uploads a new inactive version.')).toBeTruthy();
  expect(screen.getByText('Saved to disk.')).toBeTruthy();
  expect(screen.getByText('Not compiled yet.')).toBeTruthy();
  expect(screen.getByText('v2')).toBeTruthy();
  expect(screen.getAllByText('No eval')).toHaveLength(2);

  fireEvent.click(button('Publish…'));
  await screen.findByText('Ran agent.publish');
  expect(requestApproval).toHaveBeenCalledWith('salesforce', expect.objectContaining({ title: 'Do agent.publish' }));
  expect(call).toHaveBeenCalledWith('salesforce', 'release.run', expect.objectContaining({ action: 'agent.publish', token: 'tok-1', projectId: 'p1' }));
  expect(await screen.findByText(/No changes since\./)).toBeTruthy();
});

it('activates and deactivates versions with their own arguments', async () => {
  const { call } = setup();
  await screen.findByText('v2');
  fireEvent.click(button('Activate…'));
  await screen.findByText('Ran agent.activate');
  expect(call).toHaveBeenCalledWith('salesforce', 'release.prepare', expect.objectContaining({ action: 'agent.activate', versionNumber: 2 }));
  fireEvent.click(button('Deactivate…'));
  await screen.findByText('Ran agent.deactivate');
  expect(call).toHaveBeenCalledWith('salesforce', 'release.run', expect.objectContaining({ action: 'agent.deactivate', token: 'tok-1' }));
});

it('says why a sheet did not approve, and hands off to the agent when the host cannot draw it', async () => {
  const { requestApproval, call, props } = setup();
  await screen.findByText('v2');
  const reasons = ['cancelled', 'busy', 'invalid', 'unavailable'] as const;
  const texts = ['Cancelled. Nothing changed.', /Another approval is open/, 'Zana could not show this approval.', /Approvals need the Zana desktop app/];
  for (const [i, reason] of reasons.entries()) {
    requestApproval.mockResolvedValueOnce({ approved: false, reason });
    fireEvent.click(button('Publish…'));
    await screen.findByText(texts[i]!);
  }
  expect(call.mock.calls.filter(([, method]) => method === 'release.run')).toHaveLength(0);
  fireEvent.click(button('Ask the agent'));
  expect(props.onAskAgent).toHaveBeenCalledWith(expect.stringContaining('lifecycle.publish'));

  requestApproval.mockResolvedValueOnce({ approved: false, reason: 'unavailable' });
  fireEvent.click(button('Activate…'));
  await waitFor(() => expect(button('Ask the agent')).toBeTruthy());
  fireEvent.click(button('Ask the agent'));
  expect(props.onAskAgent).toHaveBeenLastCalledWith(expect.stringContaining('versionNumber 2'));

  requestApproval.mockResolvedValueOnce({ approved: false, reason: 'unavailable' });
  fireEvent.click(button('Deactivate…'));
  await waitFor(() => expect(props.onAskAgent).toHaveBeenCalledTimes(2));
  fireEvent.click(button('Ask the agent'));
  expect(props.onAskAgent).toHaveBeenLastCalledWith(expect.stringContaining('lifecycle.deactivate'));
});

it('gates production reads behind Load versions and untested activation behind eval evidence', async () => {
  const gated = releaseState({ org: { alias: 'prod', orgId: '00DP', kind: 'production' }, needsReadApproval: true, versions: [] });
  const read = releaseState({
    org: { alias: 'prod', orgId: '00DP', kind: 'production' },
    readUntil: 1,
    versions: [version(3, { evidence: { passed: true, at: 1 } }), version(2, { evidence: { passed: false, at: 1 } }), version(1, { active: true })]
  });
  const { call } = setup({}, [gated, read]);
  expect(await screen.findByText(/prod is a production org/)).toBeTruthy();
  expect(screen.getByTestId('release-org').className).toContain('is-risky');
  expect(screen.queryByText('No published versions yet.')).toBeNull();
  fireEvent.click(button('Load versions…'));
  await screen.findByText('v3');
  expect(call).toHaveBeenCalledWith('salesforce', 'release.run', expect.objectContaining({ action: 'org.read' }));
  const activates = screen.getAllByRole('button', { name: 'Activate…' }) as HTMLButtonElement[];
  expect(activates.map(node => node.disabled)).toEqual([false, true]);
  expect(activates[1]!.title).toContain('Run a passing eval for v2');
  expect(screen.getByText('Eval passed')).toBeTruthy();
  expect(screen.getByText('Eval failed')).toBeTruthy();
  expect(button('Publish…').className).toContain('is-danger');
});

it('blocks Publish on unsaved or retrieved sources and reflects compile state', async () => {
  const { props, view } = setup({ dirty: true, compile: { status: 'running', path: 'x' } });
  await screen.findByText('v2');
  expect(button('Publish…').disabled).toBe(true);
  expect(screen.getAllByText('Save your changes first.')).toHaveLength(1);
  expect(screen.getByText('Compiling…')).toBeTruthy();
  expect(button('Compile').disabled).toBe(true);
  fireEvent.click(button('Save'));
  expect(props.onSave).toHaveBeenCalled();

  view.rerender(<ReleasePane {...props} dirty={false} compile={{ status: 'passed', path: 'x', summary: 'ok' }} />);
  expect(screen.getByText('Compiled.')).toBeTruthy();
  fireEvent.click(button('Compile'));
  expect(props.onCompile).toHaveBeenCalled();
  view.rerender(<ReleasePane {...props} dirty={false} compile={{ status: 'failed', path: 'x', code: 'c', message: 'm' }} />);
  expect(screen.getByText('Failed. See Problems.')).toBeTruthy();
  view.rerender(<ReleasePane {...props} dirty={false} compileStale compile={{ status: 'failed', path: 'x', code: 'c', message: 'm' }} />);
  expect(screen.getByText('Out of date.')).toBeTruthy();
  cleanup();

  setup({}, [releaseState({ versions: [version(1)] }, { versioned: true, lastPublish: { revision: 'old', at: 1 } })]);
  await screen.findByText(/Retrieved versions cannot be published/);
  expect(button('Publish…').disabled).toBe(true);
  expect(screen.getByText(/No version is active/)).toBeTruthy();
});

it('shows changed-since-publish and an empty version list', async () => {
  setup({}, [releaseState({ versions: [] }, { lastPublish: { revision: 'old', at: Date.parse('2026-10-01T00:00:00Z') } })]);
  expect(await screen.findByText(/Changed since the last publish/)).toBeTruthy();
  expect(screen.getByText('No published versions yet.')).toBeTruthy();
});

it('reports server and transport failures', async () => {
  const { call } = setup();
  await screen.findByText('v2');
  call.mockResolvedValueOnce({ ok: false, error: 'versioned_source' });
  fireEvent.click(button('Publish…'));
  await screen.findByText('versioned_source');
  call.mockResolvedValueOnce(null);
  fireEvent.click(button('Publish…'));
  await screen.findByText('Could not prepare this step.');
  call.mockResolvedValueOnce({ ok: true, data: { request: { binding: {}, title: 't' } } }).mockResolvedValueOnce({ ok: false, error: 'approval_invalid' });
  fireEvent.click(button('Publish…'));
  await screen.findByText('approval_invalid');
  call.mockResolvedValueOnce({ ok: true, data: { request: { binding: {}, title: 't' } } }).mockResolvedValueOnce(null);
  fireEvent.click(button('Publish…'));
  await screen.findByText('The step failed.');
  call.mockRejectedValueOnce(new Error('rpc down'));
  fireEvent.click(button('Publish…'));
  await screen.findByText('rpc down');

  call.mockResolvedValueOnce({ ok: false, error: 'not_found' });
  fireEvent.click(button('Refresh release'));
  await screen.findByText('not_found');
  expect(screen.queryByText('v2')).toBeNull();
  call.mockResolvedValueOnce(null);
  fireEvent.click(button('Refresh release'));
  await screen.findByText('Could not read the release state.');
  call.mockResolvedValueOnce({ ok: true });
  fireEvent.click(button('Refresh release'));
  await waitFor(() => expect(call).toHaveBeenLastCalledWith('salesforce', 'release.state', expect.anything()));
  expect(screen.getByText('Could not read the release state.')).toBeTruthy();
  call.mockRejectedValueOnce('offline');
  fireEvent.click(button('Refresh release'));
  await screen.findByText('offline');
});

it('keeps the newest state when replies arrive out of order, and waits until visible', async () => {
  let resolveFirst: (value: unknown) => void = () => undefined;
  const call = vi.fn<Call>()
    .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockResolvedValueOnce({ ok: true, data: releaseState({ versions: [version(7)] }) });
  const { view, props } = setup({ call, visible: false });
  expect(call).not.toHaveBeenCalled();
  view.rerender(<ReleasePane {...props} visible />);
  view.rerender(<ReleasePane {...props} visible sha256="sha-2" />);
  await screen.findByText('v7');
  await act(async () => { resolveFirst({ ok: true, data: releaseState({ versions: [version(5)] }) }); });
  expect(screen.queryByText('v5')).toBeNull();
  expect(screen.getByText('v7')).toBeTruthy();
});

it('keeps a step that ends after the file changed from overwriting the new file', async () => {
  let finish!: (value: unknown) => void;
  const { call, view, props } = setup({}, [releaseState(), releaseState({ versions: [version(9)] })]);
  await screen.findByText('v2');
  const base = call.getMockImplementation()!;
  call.mockImplementation((plugin, method, args) => method === 'release.run' ? new Promise(resolve => { finish = resolve; }) as never : base(plugin, method, args));
  fireEvent.click(button('Publish…'));
  await waitFor(() => expect(call).toHaveBeenCalledWith('salesforce', 'release.run', expect.anything()));
  view.rerender(<ReleasePane {...props} path="force-app/main/default/aiAuthoringBundles/Other/Other.agent" />);
  await screen.findByText('v9');
  await act(async () => { finish({ ok: true, summary: 'Published MyBot' }); });
  expect(screen.queryByText('Published MyBot')).toBeNull();
  expect(call.mock.calls.filter(([, method]) => method === 'release.state')).toHaveLength(2);
  expect(button('Publish…').disabled).toBe(false);
});

it('reloads on an org change for this project and closes an open version', async () => {
  const { call } = setup({ source: 'x' }, [releaseState(), releaseState({ org: { alias: 'uat', orgId: '00D2', kind: 'sandbox' } })]);
  const base = call.getMockImplementation()!;
  call.mockImplementation(async (plugin, method, args) => method === 'release.versionSource'
    ? { ok: true, data: { apiName: 'MyBot', versionNumber: 1, active: true, fullName: 'MyBot_v1', content: 'x' } } as never : base(plugin, method, args));
  await screen.findByText('v2');
  fireEvent.click(button('View v1'));
  await screen.findByTestId('release-version-viewer');
  const change = (projectId: string | null) => act(async () => { window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId } })); });
  await change('another');
  expect(screen.getByTestId('release-version-viewer')).toBeTruthy();
  await change('p1');
  expect(screen.queryByTestId('release-version-viewer')).toBeNull();
  expect(await screen.findByTestId('release-org')).toHaveProperty('textContent', 'uat (sandbox)');
  expect(call.mock.calls.filter(([, method]) => method === 'release.state')).toHaveLength(2);
});

it('ignores replies after unmount', async () => {
  let resolveState: (value: unknown) => void = () => undefined;
  const call = vi.fn<Call>(() => new Promise(resolve => { resolveState = resolve; }));
  const { view } = setup({ call });
  view.unmount();
  await act(async () => { resolveState({ ok: true, data: releaseState() }); });
  expect(call).toHaveBeenCalledTimes(1);
});

describe('viewing a version', () => {
  const opened = (versionNumber: number, content: string) => ({ ok: true, data: { apiName: 'MyBot', versionNumber, active: versionNumber === 1, fullName: `MyBot_v${versionNumber}`, content } });
  function viewing(overrides: Partial<ReleasePaneProps> = {}, reply: (versionNumber: number) => unknown = n => opened(n, 'config:\n  name: "MyBot"\nold line')) {
    const { call, ...rest } = setup({ source: 'config:\n  name: "MyBot"\nnew line\nadded', ...overrides });
    const base = call.getMockImplementation()!;
    call.mockImplementation(async (plugin, method, args) => method === 'release.versionSource'
      ? reply((args as { versionNumber: number }).versionNumber) as never : base(plugin, method, args));
    return { call, ...rest };
  }

  it('opens one version read-only, diffs it against the draft and closes', async () => {
    const { call } = viewing({ dirty: true });
    await screen.findByText('v2');
    fireEvent.click(button('View v1'));
    const viewer = await screen.findByTestId('release-version-viewer');
    expect(call).toHaveBeenCalledWith('salesforce', 'release.versionSource', { projectId: 'p1', path: expect.stringContaining('MyBot.agent'), versionNumber: 1 });
    expect(viewer.textContent).toContain('MyBot_v1 · Read-only');
    expect(viewer.textContent).toContain('Active');
    expect(screen.getByTestId('release-version-source').textContent).toBe('1config:2  name: "MyBot"3old line');
    expect(button('View v1').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Diff with draft'));
    expect(screen.getByTestId('release-version-diff-stats').textContent).toBe('2 added and 1 removed in your draft (unsaved edits included), against v1.');
    const rows = [...screen.getByTestId('release-version-diff').querySelectorAll('.sf-rl-line')].map(row => `${row.className.replace('sf-rl-line', '').trim() || 'same'}:${row.textContent}`);
    expect(rows).toEqual(['same: config:', 'same:   name: "MyBot"', 'is-del:−old line', 'is-add:+new line', 'is-add:+added']);
    fireEvent.click(button('Source'));
    expect(screen.getByTestId('release-version-source')).toBeTruthy();
    fireEvent.click(button('Close'));
    expect(screen.queryByTestId('release-version-viewer')).toBeNull();
  });

  it('says when the draft matches, folds unchanged lines and gives up on huge diffs', async () => {
    const same = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n');
    // v2 comes back with Windows line endings and a final newline; neither counts as a change.
    const { view, props } = viewing({ source: same }, n => opened(n, n === 2 ? `${same.replaceAll('\n', '\r\n')}\r\n` : same.replace('line 10', 'old 10')));
    await screen.findByText('v2');
    fireEvent.click(button('View v2'));
    await screen.findByTestId('release-version-viewer');
    fireEvent.click(button('Diff with draft'));
    expect(screen.getByTestId('release-version-diff-stats').textContent).toBe('Your draft matches v2.');
    fireEvent.click(button('Source'));
    expect(screen.getByTestId('release-version-source').querySelectorAll('.sf-rl-line')).toHaveLength(20);
    fireEvent.click(button('View v1'));
    await waitFor(() => expect(screen.getByTestId('release-version-viewer').textContent).toContain('MyBot_v1'));
    // A new version opens on its source; the diff folds what did not change.
    fireEvent.click(button('Diff with draft'));
    expect(screen.getByTestId('release-version-diff').textContent).toContain('⋯ 7 unchanged lines');
    expect(screen.getByTestId('release-version-diff').textContent).toContain('⋯ 6 unchanged lines');
    view.rerender(<ReleasePane {...props} source={Array.from({ length: 1600 }, (_, index) => `new ${index}`).join('\n')} />);
    expect(screen.getByRole('status').textContent).toBe('These versions differ in too many lines to diff here.');
  });

  it('shows why a version did not open, and drops a late answer for another file', async () => {
    const { view } = viewing({}, () => ({ ok: false, code: 'version_unavailable', error: 'No authoring bundle published v2.' }));
    await screen.findByText('v2');
    fireEvent.click(button('View v2'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No authoring bundle published v2.');
    let finish!: (value: unknown) => void;
    const late = viewing({}, () => new Promise(resolve => { finish = resolve; }));
    view.unmount();
    await late.view.findByText('v2');
    fireEvent.click(late.view.getByRole('button', { name: 'View v1' }));
    expect(late.view.getByRole('button', { name: 'View v1' }).textContent).toBe('Opening…');
    late.view.rerender(<ReleasePane {...late.props} path="force-app/main/default/aiAuthoringBundles/Other/Other.agent" />);
    await act(async () => { finish(opened(1, 'late')); });
    expect(late.view.queryByTestId('release-version-viewer')).toBeNull();
  });

  it('turns a thrown read into a message and disables the diff without a draft', async () => {
    viewing({ source: undefined }, () => { throw new Error('CLI gone'); });
    await screen.findByText('v2');
    fireEvent.click(button('View v2'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'CLI gone');
    cleanup();
    viewing({ source: undefined });
    await screen.findByText('v2');
    fireEvent.click(button('View v2'));
    await screen.findByTestId('release-version-viewer');
    expect(button('Diff with draft').disabled).toBe(true);
  });
});
