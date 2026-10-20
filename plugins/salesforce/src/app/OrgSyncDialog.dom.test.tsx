/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrgSyncDialog, agentSelection, elapsed, initialSelection, memoryOf } from './OrgSyncDialog.js';
import type { SyncCheck, SyncComponent, SyncJob } from '../../lib/org-sync-contract.js';

const call = vi.fn();
const close = vi.fn();
const row = (fullName: string, state: SyncComponent['state'], extra: Partial<SyncComponent> = {}): SyncComponent => ({
  key: `ApexClass:${fullName}`, type: 'ApexClass', fullName, state, modifiedAt: '2026-10-01T10:00:00.000Z', modifiedBy: 'Ada', ...extra,
});
const counts = { changed: 1, conflict: 1, unknown: 1, new: 2, deleted: 1, current: 7 };
const check = (components: SyncComponent[], extra: Partial<SyncCheck> = {}): SyncCheck => ({
  org: { alias: 'dev', orgId: '00D1' }, scope: 'apex', checkedAt: 1, components, counts, truncated: false, ...extra,
});
const standard = check([
  row('Both', 'conflict'), row('Org', 'changed'),
  row('Agent_2', 'new', { key: 'AiAuthoringBundle:Agent_2', type: 'AiAuthoringBundle', latest: true }),
  row('Fresh', 'new', { modifiedAt: null, modifiedBy: null }), row('Never', 'unknown'), row('Gone', 'deleted'),
]);
const ready: SyncJob = {
  state: 'ready', org: { alias: 'dev', orgId: '00D1' }, components: 3, missing: ['ApexClass:Lost'],
  files: [
    { path: 'force-app/main/default/classes/Both.cls', key: 'ApexClass:Both', action: 'conflict', added: 1, removed: 1 },
    { path: 'force-app/main/default/classes/Org.cls', key: 'ApexClass:Org', action: 'update', added: 2, removed: 0 },
    { path: 'force-app/main/default/classes/New.cls', key: 'ApexClass:New', action: 'create' },
    { path: 'force-app/main/default/classes/Plain.cls', key: 'ApexClass:Plain', action: 'update' },
    { path: 'force-app/main/default/classes/Same.cls', key: 'ApexClass:Same', action: 'same' },
  ],
};
let status: SyncJob[];
const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {};
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
  status = [ready];
  Object.assign(handlers, {
    'sync.check': () => ({ ok: true, data: standard }),
    'sync.fetch.start': () => ({ ok: true, jobId: 'job1' }),
    'sync.fetch.status': () => ({ ok: true, data: status.length > 1 ? status.shift() : status[0] }),
    'sync.diff': () => ({ ok: true, data: { path: 'x', local: 'a\nlocal\nc', org: 'a\norg\nc' } }),
    'sync.apply': () => ({ ok: true, data: { state: 'applied', written: 4, kept: 0, skipped: [{ path: 'force-app/x.cls', reason: 'Changed after review' }] } }),
    'sync.cancel': () => ({ ok: true }),
  });
  call.mockReset(); close.mockReset();
  call.mockImplementation(async (method: string, args: Record<string, unknown> = {}) => handlers[method]!(args));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const show = (props: { agent?: string; rememberKey?: string } = {}) => render(<OrgSyncDialog call={call} onClose={close} {...props} />);
const calls = (method: string) => call.mock.calls.filter(([name]) => name === method).map(([, args]) => args);
const label = (n: number) => `Compare ${n.toLocaleString('en-US')} component${n === 1 ? '' : 's'} →`;
const compare = (n: number) => screen.findByRole('button', { name: label(n) });
const chip = (text: string, n: number) => new RegExp(`^${text} ?${n}$`);
const rail = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Metadata types' })).getByRole('button', { name: new RegExp(`^${name}`) }));

it('checks, fetches the chosen components, resolves a conflict with its diff and writes', async () => {
  show();
  expect(await compare(3)).toBeTruthy();
  expect(screen.getByText(/No longer in the org, kept locally: Gone/)).toBeTruthy();
  expect(calls('sync.check')).toEqual([{ scope: 'all', current: true }]);
  rail('Apex classes');
  fireEvent.click(screen.getByRole('button', { name: chip('Only in org', 1) }));
  fireEvent.click(screen.getByRole('button', { name: 'Select all 1 shown' }));
  fireEvent.click(screen.getByRole('button', { name: chip('All', 5) }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Org' }));
  fireEvent.click(await compare(3));
  expect(await screen.findByText(/Retrieving 3 components/)).toBeTruthy();
  await screen.findByText(/1 in conflict/);
  expect(calls('sync.fetch.start')).toEqual([{ components: ['AiAuthoringBundle:Agent_2', 'ApexClass:Both', 'ApexClass:Fresh'], orgId: '00D1' }]);
  expect(screen.getByRole('status').textContent).toBe('2 to update · 1 new · 1 in conflict · 1 already identical');
  expect(screen.getByText('+2 −0')).toBeTruthy();
  expect(screen.getByTitle('force-app/main/default/classes/New.cls').textContent).toBe('classes/New.cls');
  expect(screen.getByText('new')).toBeTruthy();
  expect(screen.getByText(/Not returned by the org: ApexClass:Lost/)).toBeTruthy();
  expect(screen.getByText('Write 3 files')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
  const diff = await screen.findByLabelText(/Local to org changes/);
  expect(diff.textContent).toContain('−local');
  expect(diff.textContent).toContain('+org');
  expect(calls('sync.diff')).toEqual([{ jobId: 'job1', path: 'force-app/main/default/classes/Both.cls' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
  expect(screen.queryByLabelText(/Local to org changes/)).toBeNull();
  handlers['sync.diff'] = () => ({ ok: true, data: { path: 'x', local: 'a', org: 'b', truncated: true } });
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
  expect(await screen.findByText(/only its start is compared/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));

  fireEvent.click(screen.getByRole('button', { name: 'Take org' }));
  expect(screen.getByRole('button', { name: 'Take org' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Write 4 files')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep local for all' }));
  expect(screen.getByText('Write 3 files')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Take org for all' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep local' }));
  fireEvent.click(screen.getByRole('button', { name: 'Take org' }));
  fireEvent.click(screen.getByText('Write 4 files'));
  await screen.findByText('Wrote 4 files.');
  expect(calls('sync.apply')).toEqual([{ jobId: 'job1', take: ['force-app/main/default/classes/Both.cls'] }]);
  expect(screen.getByText(/Changed after review/)).toBeTruthy();
  fireEvent.click(screen.getByText('Close'));
  expect(close).toHaveBeenCalledOnce();
  expect(calls('sync.cancel')).toEqual([]);
});

it('polls a running fetch and cancels it when the dialog closes', async () => {
  status = [{ state: 'running', phase: 'retrieve', done: 1, total: 3 }, ready];
  show();
  fireEvent.click(await compare(3));
  await screen.findByText(/^1 of 3 retrieved \(33%\) · \d+s$/, {}, { timeout: 2000 });
  expect(document.querySelector('.sf-sync-progress.is-waiting')).toBeNull();
  await screen.findByText(/1 in conflict/, {}, { timeout: 2500 });
  expect(calls('sync.fetch.status').length).toBe(2);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
  expect(calls('sync.cancel')).toEqual([{ jobId: 'job1' }]);
});

it('stops polling and releases the job when unmounted mid-fetch', async () => {
  status = [{ state: 'running', phase: 'retrieve', done: 0, total: 3 }];
  const mounted = show();
  fireEvent.click(await compare(3));
  await screen.findByText(/^0 of 3 retrieved · \d+s$/);
  expect(document.querySelector('.sf-sync-progress.is-waiting')).toBeTruthy();
  mounted.unmount();
  expect(calls('sync.cancel')).toEqual([{ jobId: 'job1' }]);
});

it('ticks elapsed time, explains large fetches and shows the compare step', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    status = [{ state: 'running', phase: 'retrieve', done: 0, total: 4726 }, { state: 'running', phase: 'compare', done: 4726, total: 4726 }];
    show();
    fireEvent.click(await compare(3));
    await screen.findByText(/^0 of 4,726 retrieved · 0s$/);
    expect(screen.getByText(/parallel batches/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    await screen.findByText('Comparing 4,726 components with your project…');
    expect(screen.getByText(/^All retrieved · [1-9]s$/)).toBeTruthy();
    expect(screen.queryByText(/parallel batches/)).toBeNull();
    expect(document.querySelector('.sf-sync-progress.is-waiting')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('formats elapsed time', () => {
  expect(elapsed(0)).toBe('0s');
  expect(elapsed(59)).toBe('59s');
  expect(elapsed(75)).toBe('1m 15s');
  expect(elapsed(600)).toBe('10m 00s');
});

it('reports check and fetch failures and the empty states', async () => {
  handlers['sync.check'] = () => ({ ok: false, error: 'Org expired' });
  const failed = show();
  expect(screen.getByRole('status').textContent).toBe('Comparing the org with this project…');
  expect(screen.getByRole('button', { name: 'Checking…' })).toHaveProperty('disabled', true);
  expect((await screen.findByRole('alert')).textContent).toBe('Org expired');
  failed.unmount();

  handlers['sync.check'] = () => ({ ok: true, data: check([], { truncated: true }) });
  const empty = show();
  expect(await screen.findByText('Nothing in the org to fetch.')).toBeTruthy();
  expect(screen.getByText('Showing the first results only.')).toBeTruthy();
  expect(screen.getByText(/Nothing selected yet/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Compare →' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('checkbox', { name: 'All Apex classes' })).toHaveProperty('disabled', true);
  rail('Flows');
  expect(screen.getByText('No flows in the org.')).toBeTruthy();
  empty.unmount();

  handlers['sync.check'] = () => ({ ok: true, data: standard });
  show();
  status = [{ state: 'failed', error: 'Retrieve failed: INVALID_SESSION' }];
  fireEvent.click(await compare(3));
  expect((await screen.findByRole('alert')).textContent).toBe('Retrieve failed: INVALID_SESSION');
  expect(screen.getByRole('button', { name: label(3) })).toHaveProperty('disabled', false);

  handlers['sync.fetch.start'] = () => { throw Error('Another fetch is running'); };
  fireEvent.click(screen.getByRole('button', { name: label(3) }));
  expect((await screen.findByRole('alert')).textContent).toBe('Another fetch is running');
  fireEvent.click(screen.getByText('Cancel'));
  expect(calls('sync.cancel')).toEqual([]);
});

it('ends a fetch that changes nothing and reports an expired apply', async () => {
  status = [{ ...ready, files: [{ path: 'a.cls', key: 'ApexClass:A', action: 'same' }], missing: [] } as SyncJob];
  const mounted = show();
  fireEvent.click(await compare(3));
  expect(await screen.findByText('Your project already matches the org for 3 components.')).toBeTruthy();
  expect(calls('sync.cancel')).toEqual([{ jobId: 'job1' }]);
  expect(screen.queryByText(/Write/)).toBeNull();
  mounted.unmount();

  status = [ready];
  handlers['sync.apply'] = () => ({ ok: true, data: { state: 'failed', error: 'Fetch expired' } });
  handlers['sync.diff'] = () => ({ ok: false, error: 'Diff unavailable' });
  show();
  fireEvent.click(await compare(3));
  fireEvent.click(await screen.findByRole('button', { name: 'Diff' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Diff unavailable');
  fireEvent.click(screen.getByText('Write 3 files'));
  await waitFor(() => expect(screen.getAllByRole('alert').map(node => node.textContent)).toContain('Fetch expired'));
  handlers['sync.apply'] = () => ({ ok: true, data: { state: 'running', phase: 'retrieve', done: 0, total: 1 } });
  fireEvent.click(screen.getByText('Write 3 files'));
  await waitFor(() => expect(calls('sync.apply')).toHaveLength(1));
  expect(screen.getByText('Write 3 files')).toHaveProperty('disabled', false);
});

it('caps long lists and shows the full diff fallback for very large files', async () => {
  const many = Array.from({ length: 205 }, (_, index) => row(`C${index}`, 'changed'));
  const deleted = Array.from({ length: 22 }, (_, index) => row(`D${index}`, 'deleted'));
  handlers['sync.check'] = () => ({ ok: true, data: check([...many, ...deleted]) });
  const files = Array.from({ length: 102 }, (_, index) => ({ path: `f${index}.cls`, key: `ApexClass:C${index}`, action: 'create' as const }));
  status = [{ ...ready, files: [{ path: 'big.cls', key: 'ApexClass:C0', action: 'conflict' }, ...files], missing: Array.from({ length: 21 }, (_, index) => `ApexClass:M${index}`) }];
  handlers['sync.diff'] = () => ({ ok: true, data: { path: 'big.cls', local: Array.from({ length: 2000 }, (_, i) => `l${i}`).join('\n'), org: Array.from({ length: 2000 }, (_, i) => `o${i}`).join('\n') } });
  handlers['sync.apply'] = () => ({ ok: true, data: { state: 'applied', written: 102, kept: 1, skipped: [] } });
  show();
  expect(await screen.findByText(/No longer in the org, kept locally: D0, .* and 2 more$/)).toBeTruthy();
  rail('Apex classes');
  expect(screen.getByText('and 27 more · filter to narrow')).toBeTruthy();
  fireEvent.click(await compare(205));
  expect(await screen.findByText('and 2 more')).toBeTruthy();
  expect(screen.getByText(/and 1 more$/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
  expect(await screen.findByText(/too many lines/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByText('Write 102 files')); });
  expect(await screen.findByText(/Kept 1 local file\./)).toBeTruthy();
});

it('blocks fetching more than the per-fetch maximum', async () => {
  handlers['sync.check'] = () => ({ ok: true, data: check(Array.from({ length: 5001 }, (_, index) => row(`C${index}`, 'changed'))) });
  show();
  expect(await compare(5001)).toHaveProperty('disabled', true);
  expect(screen.getByText('Fetch at most 5,000 components at a time.')).toBeTruthy();
});


it('picks whole types from the overview and the rail, and lists every component of a type', async () => {
  handlers['sync.check'] = () => ({ ok: true, data: { ...standard, current: [
    { key: 'ApexClass:Steady', type: 'ApexClass', fullName: 'Steady', modifiedAt: '2026-09-01T00:00:00.000Z', modifiedBy: 'Bo' },
    { key: 'Flow:Route', type: 'Flow', fullName: 'Route', modifiedAt: null, modifiedBy: null },
  ] } });
  show({ rememberKey: 'sync-test' });
  await compare(3);
  const cards = (name: string) => within(screen.getByRole('region', { name }));
  expect(screen.getAllByRole('region').map(node => node.getAttribute('aria-label'))).toEqual(['Agents', 'Apex classes', 'Flows']);
  expect(cards('Apex classes').getByText('1 edited in both · 1 changed · 1 only in org · 1 not compared · 1 up to date · 1 gone from org')).toBeTruthy();
  expect(cards('Flows').getByRole('button', { name: 'Changes' })).toHaveProperty('disabled', true);
  const tray = () => within(screen.getByLabelText('Selection'));
  expect(tray().getAllByRole('button').map(node => node.textContent)).toEqual(['Agents All 1', '×', 'Apex classes 2 picked', '×']);

  fireEvent.click(cards('Apex classes').getByRole('button', { name: 'Changes' }));
  expect(tray().getByRole('button', { name: 'Apex classes Changes · 3' })).toBeTruthy();
  fireEvent.click(cards('Apex classes').getByRole('button', { name: 'All 5' }));
  expect(await compare(6)).toBeTruthy();
  fireEvent.click(cards('Flows').getByRole('button', { name: 'All 1' }));
  fireEvent.click(tray().getByRole('button', { name: 'Clear Agents' }));
  expect(await compare(6)).toBeTruthy();
  fireEvent.click(cards('Agents').getByRole('button', { name: 'Latest versions' }));
  expect(tray().getByRole('button', { name: 'Agents All 1' })).toBeTruthy();

  const all = screen.getByRole('checkbox', { name: 'All Apex classes' }) as HTMLInputElement;
  expect(all.checked).toBe(true);
  fireEvent.click(all);
  expect(all.checked).toBe(false);
  fireEvent.click(all);
  expect(await compare(7)).toBeTruthy();

  fireEvent.click(tray().getByRole('button', { name: /^Apex classes/ }));
  expect(screen.getByRole('heading', { name: 'Apex classes' })).toBeTruthy();
  expect(screen.getByText('5 of 6 selected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Up to date', { selector: '.sf-pick-state' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Gone' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Changes' }));
  expect(screen.getByText('3 of 6 selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Never' }));
  expect(screen.getByLabelText('Selection').textContent).toContain('Apex classes 4 picked');
  fireEvent.click(screen.getByRole('button', { name: 'None' }));
  expect(screen.getByText('0 of 6 selected')).toBeTruthy();

  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Apex classes' }), { target: { value: 'zzz' } });
  expect(screen.getByText('No apex classes match.')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Apex classes' }), { target: { value: 'O' } });
  expect(screen.getByRole('status').textContent).toMatch(/^3 shown/);
  fireEvent.click(screen.getByRole('button', { name: 'Select all 2 shown' }));
  expect(screen.getByText('2 of 6 selected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Select all 2 shown' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear shown' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Apex classes' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: chip('Needs attention', 2) }));
  expect(screen.getAllByRole('checkbox').filter(node => node.closest('.sf-pick-list')).map(node => node.getAttribute('aria-label'))).toEqual(['Both', 'Org']);
  fireEvent.click(screen.getByRole('button', { name: chip('All', 6) }));

  // Shift-click selects the range between the last click and this one.
  const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
  fireEvent.click(box('Both'));
  fireEvent.click(box('Never'), { shiftKey: true });
  const order = screen.getAllByRole('checkbox').filter(node => node.closest('.sf-pick-list')).map(node => [node.getAttribute('aria-label'), (node as HTMLInputElement).checked]);
  expect(order.filter(([, on]) => on).length).toBeGreaterThanOrEqual(2);
  expect(box('Gone').checked).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: /^Overview/ }));
  fireEvent.click(screen.getByRole('button', { name: chip('Everything', 7) }));
  expect(await compare(7)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: chip('All changes', 3) }));
  fireEvent.click(cards('Apex classes').getByRole('button', { name: 'Choose…' }));
  expect(screen.getByRole('heading', { name: 'Apex classes' })).toBeTruthy();
});

it('groups agent versions under their agent with None, Latest and All', async () => {
  const agent = (name: string, state: SyncComponent['state'], at: string, extra: Partial<SyncComponent> = {}) =>
    row(name, state, { key: `AiAuthoringBundle:${name}`, type: 'AiAuthoringBundle', modifiedAt: at, ...extra });
  handlers['sync.check'] = () => ({ ok: true, data: check([
    agent('Btnet_Agent_180', 'new', '2026-10-08T00:00:00.000Z', { latest: true }), agent('Btnet_Agent_179', 'new', '2026-10-07T00:00:00.000Z'),
    agent('Btnet_Agent_176', 'changed', '2026-10-06T00:00:00.000Z'), agent('Billing', 'unknown', '2026-09-01T00:00:00.000Z'),
    agent('Voice_3', 'new', '2026-09-02T00:00:00.000Z'), agent('Voice_2', 'deleted', '2026-09-01T00:00:00.000Z'),
  ]) });
  show();
  await compare(2);
  expect(screen.getByText('3 agents · 6 versions')).toBeTruthy();
  rail('Agents');
  const group = (name: string) => within(screen.getByRole('group', { name }));
  expect(screen.getAllByRole('group').map(node => node.getAttribute('aria-label')).filter(name => name !== 'Quick picks' && !name?.startsWith('Versions') && !name?.startsWith('Select'))).toEqual(['Btnet_Agent', 'Voice', 'Billing']);
  expect(group('Btnet_Agent').getByText('v180 newest in org · project has v176 · 2 of 3 picked')).toBeTruthy();
  expect(group('Voice').getByText('v3 newest in org · project has v2 · 2 versions')).toBeTruthy();
  expect(group('Billing').getByText('working copy newest in org · project has the working copy · 1 version')).toBeTruthy();
  expect(group('Btnet_Agent').getAllByRole('checkbox').map(node => node.getAttribute('aria-label'))).toEqual(['All versions of Btnet_Agent', 'Btnet_Agent_180', 'Btnet_Agent_179', 'Btnet_Agent_176']);
  expect(group('Voice').getAllByRole('checkbox')).toHaveLength(1);

  fireEvent.click(group('Voice').getByRole('button', { name: 'Show versions of Voice' }));
  expect(group('Voice').getByRole('checkbox', { name: 'Voice_2' })).toHaveProperty('disabled', true);
  fireEvent.click(group('Voice').getByRole('button', { name: 'Hide versions of Voice' }));
  fireEvent.click(group('Voice').getByRole('button', { name: 'Latest' }));
  expect(group('Voice').getByRole('button', { name: 'Latest' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(group('Btnet_Agent').getByRole('button', { name: 'All' }));
  expect(group('Btnet_Agent').getByRole('checkbox', { name: 'All versions of Btnet_Agent' })).toHaveProperty('checked', true);
  fireEvent.click(group('Btnet_Agent').getByRole('checkbox', { name: 'All versions of Btnet_Agent' }));
  expect(group('Btnet_Agent').getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(group('Btnet_Agent').getByRole('checkbox', { name: 'All versions of Btnet_Agent' }));

  fireEvent.click(screen.getByRole('button', { name: 'Latest versions' }));
  expect(screen.getByRole('button', { name: 'Latest versions' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('Selection').textContent).toContain('Agents Latest of 3');
  fireEvent.click(screen.getByRole('button', { name: 'All versions' }));
  expect(screen.getByLabelText('Selection').textContent).toContain('Agents All 5');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Agents' }), { target: { value: '179' } });
  expect(screen.getAllByRole('checkbox').filter(node => node.closest('.sf-pick-list')).map(node => node.getAttribute('aria-label'))).toEqual(['All versions of Btnet_Agent', 'Btnet_Agent_179']);
});

it('remembers whole-type picks per project, and forgets them when Remember is off', async () => {
  localStorage.removeItem('sync-pick');
  const mounted = show({ rememberKey: 'sync-pick' });
  await compare(3);
  fireEvent.click(within(screen.getByRole('region', { name: 'Apex classes' })).getByRole('button', { name: 'All 4' }));
  fireEvent.click(await compare(5));
  await screen.findByText(/1 in conflict/);
  expect(JSON.parse(localStorage.getItem('sync-pick')!)).toEqual({ AiAuthoringBundle: 'all', ApexClass: 'all' });
  mounted.unmount();

  const again = show({ rememberKey: 'sync-pick' });
  expect(await compare(5)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remember for this project' }));
  fireEvent.click(screen.getByRole('button', { name: label(5) }));
  await screen.findByText(/1 in conflict/);
  expect(localStorage.getItem('sync-pick')).toBeNull();
  again.unmount();

  localStorage.setItem('sync-pick', 'not json');
  show({ rememberKey: 'sync-pick' });
  expect(await compare(3)).toBeTruthy();
});

it('opens on an agent and what it uses, with a quick pick back to it and what is missing', async () => {
  const agentCheck = check([
    row('Support_3', 'new', { key: 'AiAuthoringBundle:Support_3', type: 'AiAuthoringBundle', latest: true }),
    row('Offer', 'new', { key: 'LightningTypeBundle:Offer', type: 'LightningTypeBundle' }),
    row('Old', 'deleted'),
  ], { agent: { name: 'Support', current: [], missing: ['ApexClass:Ghost', 'LightningTypeBundle:GhostType'] } });
  handlers['sync.check'] = args => ({ ok: true, data: args.agent ? agentCheck : standard });
  expect([...agentSelection(agentCheck)]).toEqual(['AiAuthoringBundle:Support_3', 'LightningTypeBundle:Offer']);
  show({ agent: 'Support', rememberKey: 'ignored' });
  expect(screen.getByText(/Comparing the org with this project and what Support uses/)).toBeTruthy();
  expect(await compare(2)).toBeTruthy();
  expect(calls('sync.check')).toEqual([{ scope: 'all', current: true }, { agent: 'Support' }]);
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Fetch Support from org');
  expect(screen.getByText('Used by Support but not in the org: Ghost, GhostType')).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: 'Remember for this project' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: chip('All changes', 3) }));
  expect(await compare(3)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Support + what it uses' }));
  fireEvent.click(await compare(2));
  await screen.findByText(/1 in conflict/);
  expect(calls('sync.fetch.start')).toEqual([{ components: ['AiAuthoringBundle:Support_3', 'LightningTypeBundle:Offer'], orgId: '00D1' }]);
});

it('derives the opening selection and what to remember', () => {
  expect([...initialSelection(standard, null, null)]).toEqual(['AiAuthoringBundle:Agent_2', 'ApexClass:Both', 'ApexClass:Org']);
  expect([...initialSelection(standard, null, { ApexClass: 'changes' })]).toEqual(['ApexClass:Both', 'ApexClass:Org', 'ApexClass:Fresh']);
  const picked = new Set(['AiAuthoringBundle:Agent_2', 'ApexClass:Both']);
  expect(memoryOf(standard, picked)).toEqual({ AiAuthoringBundle: 'all' });
});
