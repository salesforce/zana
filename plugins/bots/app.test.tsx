// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
  rpc: { call: vi.fn() },
  navigate: { toThread: vi.fn(), openPanelAgent: vi.fn((_options: unknown) => true) as ReturnType<typeof vi.fn> | undefined },
  realtime: [] as Array<(payload?: unknown) => void>,
  registered: [] as unknown[]
}));

vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({
  definePluginApp: (setup: (app: unknown) => void) =>
    setup({ slots: { navPanel: (row: unknown) => state.registered.push(row) } }),
  callPluginRpc: (...args: unknown[]) => memoryRpc(...args),
  useRpc: () => state.rpc,
  useZccNavigate: () => state.navigate,
  useRealtime: (_channel: string, handler: (payload?: unknown) => void) => { state.realtime.push(handler); }
}));

import { BasicBots, BotAvatar, BotsPanel, botState, cronFor } from './app.tsx';

const memoryRpc = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const scout = {
  id: 'scout', name: 'Scout', color: '#10b981', personality: 'Terse', projectId: 'p1', routines: [
    { id: 'digest', name: 'Digest', cron: '0 9 * * 1,2,3,4,5', prompt: 'summarize', enabled: true, lastRunAt: 5 },
    { id: 'off', name: 'Off', cron: '*/15 * * * *', prompt: 'x', enabled: false }
  ],
  mainThreadId: 't1', mainThreadStatus: 'idle', activeJobs: 0, createdAt: 0, updatedAt: 0
};
const fresh = { ...scout, id: 'fresh', name: 'Fresh', color: undefined, personality: '', routines: [], mainThreadId: undefined, mainThreadStatus: null, activeJobs: 0 };

function route(handlers: Record<string, (args: any) => unknown>) {
  state.rpc.call.mockImplementation(async (method: string, args: unknown) => {
    const handler = handlers[method] ?? (method === 'jobs' ? () => [] : method === 'nextRuns' ? () => ({digest: 1795509000000}) : undefined) ?? (method === 'catalog' ? () => ({ projects: [], providers: [], models: [], modelError: null }) : undefined);
    if (!handler) throw new Error(`unexpected ${method}`);
    return handler(args);
  });
}

beforeEach(() => { memoryRpc.mockReset().mockResolvedValue({ memories: [], hasMore: false }); state.realtime.length = 0; state.navigate.openPanelAgent = vi.fn(() => true); });
afterEach(() => { cleanup(); state.rpc.call.mockReset(); state.navigate.toThread.mockReset(); });

it('registers the Bots nav panel', () => {
  expect(state.registered).toEqual([expect.objectContaining({ id: 'bots', title: 'Bots', icon: 'Bot' })]);
});

it('derives bot state and routine crons', () => {
  expect(botState(fresh as never)).toBe('new');
  expect(botState({ ...scout, mainThreadStatus: null } as never)).toBe('missing');
  expect(botState({ ...scout, mainThreadStatus: 'unknown' } as never)).toBe('unknown');
  expect(botState({ ...scout, mainThreadStatus: 'active' } as never)).toBe('working');
  expect(botState({ ...scout, activeJobs: 2 } as never)).toBe('working');
  expect(botState(scout as never)).toBe('asleep');
  expect(cronFor('weekdays', '08:30', '1', '')).toBe('30 8 * * 1-5');
  expect(cronFor('daily', '07:00', '1', '')).toBe('0 7 * * *');
  expect(cronFor('weekly', '16:00', '5', '')).toBe('0 16 * * 5');
  expect(cronFor('hourly', '', '1', '', '5')).toBe('5 * * * *');
  expect(cronFor('hourly', '', '1', '', '75')).toBe('0 * * * *');
  expect(cronFor('hourly', '', '1', '')).toBe('0 * * * *');
  expect(cronFor('custom', '', '1', ' 0 9 * * * ')).toBe('0 9 * * *');
  expect(cronFor('daily', '', '1', '')).toBe('0 9 * * *');
});

it('shows the create form when there are no bots and creates one with a color', async () => {
  let bots: unknown[] = [];
  route({ list: () => bots, create: (args) => { bots = [{ ...fresh, name: args.name, id: 'ada' }]; return { id: 'ada' }; } });
  render(<BotsPanel />);
  await screen.findByText('Create a bot');
  expect(screen.queryByLabelText(/emoji/i)).toBeNull();
  expect(screen.queryByText('Cancel')).toBeNull();
  fireEvent.change(screen.getByPlaceholderText('Release Scout'), { target: { value: 'Ada' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Purple' }));
  fireEvent.click(screen.getByText('Create bot'));
  await screen.findByText(/Ada has no thread yet/);
  expect(state.rpc.call).toHaveBeenCalledWith('create', { name: 'Ada', color: '#a855f7', personality: '' });
});

it('reports create and list errors', async () => {
  route({ list: () => [], create: () => { throw new Error('name taken'); } });
  render(<BotsPanel />);
  fireEvent.change(await screen.findByPlaceholderText('Release Scout'), { target: { value: 'X' } });
  fireEvent.click(screen.getByText('Create bot'));
  expect((await screen.findByRole('alert')).textContent).toBe('name taken');
  cleanup();
  route({ list: () => { throw 'offline'; } });
  render(<BotsPanel />);
  expect((await screen.findAllByRole('alert'))[0]!.textContent).toBe('offline');
});

it('opens the main thread in the host side panel and starts a fresh bot there', async () => {
  route({ list: () => [scout, fresh], send: () => ({ threadId: 't9' }) });
  render(<BotsPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Chat' }));
  expect(state.navigate.openPanelAgent).toHaveBeenCalledWith({ threadId: 't1', title: 'Scout' });
  expect(state.navigate.toThread).not.toHaveBeenCalled();
  expect(screen.getAllByText('Terse').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Asleep').length).toBeGreaterThan(0);
  expect(screen.getByText('Full access')).toBeTruthy();
  expect(screen.queryByLabelText(/^Message /)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /^Fresh/ }));
  const box = await screen.findByLabelText('Message Fresh');
  expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
  fireEvent.change(box, { target: { value: 'hi' } });
  fireEvent.click(screen.getByText('Start conversation'));
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('send', { bot: 'fresh', message: 'hi' }));
  await waitFor(() => expect(state.navigate.openPanelAgent).toHaveBeenCalledWith({ threadId: 't9', title: 'Fresh' }));
  state.rpc.call.mockRejectedValueOnce(new Error('spawn failed'));
  fireEvent.change(box, { target: { value: 'again' } });
  fireEvent.click(screen.getByText('Start conversation'));
  expect((await screen.findByRole('alert')).textContent).toBe('spawn failed');
  fireEvent.click(screen.getByText('＋ New bot'));
  await screen.findByText('Create a bot');
  fireEvent.click(screen.getByText('Cancel'));
  await screen.findByLabelText('Message Fresh');
  state.realtime[0]!();
});

it('falls back to the thread page without a side panel', async () => {
  route({ list: () => [scout], jobs: () => [{ threadId: 'j1', botId: 'scout', title: 'Sweep', startedAt: 1, status: 'idle', archived: false }] });
  state.navigate.openPanelAgent = vi.fn(() => false);
  render(<BotsPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Chat' }));
  expect(state.navigate.toThread).toHaveBeenCalledWith('t1');
  state.navigate.openPanelAgent = undefined;
  fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
  fireEvent.click(await screen.findByRole('button', { name: /Sweep/ }));
  expect(state.navigate.toThread).toHaveBeenLastCalledWith('j1');
});

it('ignores a start result without a thread id', async () => {
  route({ list: () => [fresh], send: () => null });
  render(<BotsPanel />);
  fireEvent.change(await screen.findByLabelText('Message Fresh'), { target: { value: 'hi' } });
  fireEvent.click(screen.getByText('Start conversation'));
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('send', { bot: 'fresh', message: 'hi' }));
  expect(state.navigate.openPanelAgent).not.toHaveBeenCalled();
});

it('wakes the bot and recolors it from settings', async () => {
  route({ list: () => [scout], send: () => ({ threadId: 't1' }), update: () => scout });
  render(<BotsPanel />);
  await screen.findByRole('button', { name: 'Chat' });
  expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeTruthy();
  fireEvent.click(screen.getByText('Wake'));
  expect((await screen.findByRole('status')).textContent).toBe('Scout is waking up');
  expect(state.rpc.call).toHaveBeenCalledWith('send', expect.objectContaining({ bot: 'scout' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
  expect(screen.queryByLabelText(/emoji/i)).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Red' }));
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('update', { bot: 'scout', patch: { color: '#ef4444' } }));
});

it('hides wake while working and names provider and project in the chips', async () => {
  route({
    list: () => [{ ...scout, mainThreadStatus: 'active', activeJobs: 1, providerId: 'claude-code', model: 'opus' }],
    catalog: () => ({ projects: [{ id: 'p1', name: 'Zana' }], providers: [{ id: 'claude-code', name: 'Claude Code' }], models: [], modelError: null })
  });
  render(<BotsPanel />);
  await screen.findByText(/Zana ·/);
  expect(screen.queryByText('Claude Code · opus')).toBeNull();
  expect(screen.queryByText('Wake')).toBeNull();
  expect(screen.getByText('Working · 1 background job')).toBeTruthy();
});

it('edits routines with human-readable schedules, confirmations and switches', async () => {
  route({ list: () => [scout], addRoutine: () => scout, updateRoutine: () => scout, removeRoutine: () => scout, runRoutine: () => ({ threadId: 't1' }) });
  render(<BotsPanel />);
  const digest = await screen.findByRole('group', { name: 'Digest' });
  expect(digest.textContent).toContain('Weekdays around 9:00 AM');
  expect(screen.getByRole('group', { name: 'Off' }).textContent).toContain('Every 15 minutes · never run');
  fireEvent.click(within(digest).getByText('Run now'));
  expect((await within(digest).findByRole('status')).textContent).toBe('Ran Digest');
  const off = screen.getByRole('switch', { name: 'Enable Off' });
  expect(off.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(off);
  expect(off.getAttribute('aria-checked')).toBe('true');
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('updateRoutine', { bot: 'scout', routineId: 'off', patch: { enabled: true } }));
  // A failed toggle snaps back.
  state.rpc.call.mockRejectedValueOnce(new Error('store down'));
  fireEvent.click(off);
  expect((await within(screen.getByRole('group', { name: 'Off' })).findByRole('alert')).textContent).toBe('store down');
  await waitFor(() => expect(off.getAttribute('aria-checked')).toBe('true'));

  fireEvent.click(within(digest).getByRole('button', {name: 'More actions for Digest'}));
  fireEvent.click(within(digest).getByText('Keep'));
  expect(state.rpc.call).not.toHaveBeenCalledWith('removeRoutine', expect.anything());
  fireEvent.click(within(digest).getByRole('button', {name: 'More actions for Digest'}));
  fireEvent.click(within(digest).getByText('Delete Digest'));
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('removeRoutine', { bot: 'scout', routineId: 'digest' }));

  fireEvent.click(screen.getByText('＋ Add routine'));
  fireEvent.click(screen.getByText('Cancel'));
  fireEvent.click(screen.getByText('＋ Add routine'));
  const form = screen.getByRole('form', { name: 'Add routine' });
  fireEvent.change(within(form).getByPlaceholderText('Morning digest'), { target: { value: 'New' } });
  fireEvent.change(within(form).getByPlaceholderText(/Summarize what changed/), { target: { value: 'go' } });
  expect(within(form).getByText(/Runs: Weekdays around 8:00 AM/)).toBeTruthy();
  function pick(field: string, choice: string) {
    fireEvent.click(within(form).getByRole('button', { name: field }));
    fireEvent.click(screen.getByRole('option', { name: choice }));
  }
  pick('When', 'Weekly');
  pick('Day', 'Friday');
  expect(within(form).getByText(/Runs: Fridays around 8:00 AM/)).toBeTruthy();
  pick('When', 'Hourly');
  fireEvent.change(within(form).getByLabelText('Minute past the hour'), { target: { value: '20' } });
  expect(within(form).getByText(/Runs: Every hour at :20/)).toBeTruthy();
  pick('When', 'Custom cron');
  fireEvent.change(within(form).getByDisplayValue('0 9 * * 1-5'), { target: { value: '0 8 * * *' } });
  expect(within(form).getByText(/Runs: Every day around 8:00 AM/)).toBeTruthy();
  pick('When', 'Every day');
  fireEvent.change(within(form).getByDisplayValue('08:00'), { target: { value: '07:15' } });
  state.rpc.call.mockRejectedValueOnce(new Error('routines can run at most every 15 minutes'));
  fireEvent.click(within(form).getByText('Add routine', { selector: 'button' }));
  expect((await within(form).findByRole('alert')).textContent).toContain('15 minutes');
  fireEvent.change(within(form).getByPlaceholderText('Morning digest'), { target: { value: 'Newer' } });
  expect(within(form).queryByRole('alert')).toBeNull();
  fireEvent.click(within(form).getByText('Add routine', { selector: 'button' }));
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('addRoutine', { bot: 'scout', routine: { name: 'Newer', cron: '15 7 * * *', prompt: 'go' } }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Add routine' })).toBeNull());
});

it('ignores double clicks while an action is running and clears notices', async () => {
  let release: (value: unknown) => void = () => {};
  route({ list: () => [scout], runRoutine: () => new Promise((resolve) => { release = resolve; }) });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    render(<BotsPanel />);
    await vi.waitFor(() => screen.getByRole('group', { name: 'Digest' }));
    const run = within(screen.getByRole('group', { name: 'Digest' })).getByText('Run now');
    fireEvent.click(run);
    fireEvent.click(run);
    expect(state.rpc.call.mock.calls.filter(([method]) => method === 'runRoutine')).toHaveLength(1);
    expect((run as HTMLButtonElement).disabled).toBe(true);
    release({ threadId: 't1' });
    await vi.waitFor(() => screen.getByText('Ran Digest'));
    vi.advanceTimersByTime(4_000);
    await vi.waitFor(() => expect(screen.queryByText('Ran Digest')).toBeNull());
  } finally {
    vi.useRealTimers();
  }
});

it('lists jobs and memory in the library tab', async () => {
  let jobs: unknown[] = [
    { threadId: 'j1', botId: 'scout', title: 'Sweep', startedAt: 1, status: 'active', archived: false },
    { threadId: 'j2', botId: 'scout', title: 'Old', startedAt: 0, status: 'idle', archived: true }
  ];
  route({ list: () => [scout], jobs: () => jobs });
  render(<BotsPanel />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Library' }));
  await screen.findByText('Sweep');
  expect(screen.getByText(/archived ·/)).toBeTruthy();
  expect(screen.getByText(/zcc memory search bot:scout/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Sweep/ }));
  expect(state.navigate.openPanelAgent).toHaveBeenCalledWith({ threadId: 'j1', title: 'Sweep' });
  jobs = [];
  state.realtime.at(-1)!();
  await screen.findByText('No background jobs yet.');
  state.rpc.call.mockRejectedValueOnce(new Error('jobs down'));
  state.realtime.at(-1)!();
  expect((await screen.findByRole('alert')).textContent).toBe('jobs down');
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
  screen.getByText('Routines');
});

it('saves only changed settings, resyncs untouched fields and deletes the bot', async () => {
  let bots: any[] = [scout, { ...scout, id: 'other', name: 'Other', providerId: 'codex', model: 'm' }];
  route({
    list: () => bots,
    update: () => scout,
    remove: (args) => { bots = bots.filter((row: any) => row.id !== args.bot); return { id: args.bot }; }
  });
  render(<BotsPanel />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
  const save = () => screen.getByText('Save') as HTMLButtonElement;
  await screen.findByDisplayValue('Terse');
  expect(save().disabled).toBe(true);
  fireEvent.change(screen.getByDisplayValue('Terse'), { target: { value: 'Chatty' } });
  // Someone renames the bot elsewhere: the untouched name field follows, the edited personality is kept.
  bots = [{ ...scout, name: 'Scout II', personality: 'Remote edit' }, bots[1]];
  state.realtime[0]!();
  await screen.findByDisplayValue('Scout II');
  expect(screen.getByDisplayValue('Chatty')).toBeTruthy();
  fireEvent.click(save());
  expect((await screen.findByRole('status')).textContent).toBe('Saved. Applies from the next turn.');
  expect(state.rpc.call).toHaveBeenCalledWith('update', { bot: 'scout', patch: { personality: 'Chatty' } });
  fireEvent.change(screen.getByDisplayValue('Chatty'), { target: { value: 'Calm' } });
  state.rpc.call.mockRejectedValueOnce(new Error('nope'));
  fireEvent.click(save());
  expect((await screen.findByRole('alert')).textContent).toBe('nope');
  fireEvent.change(screen.getByDisplayValue('Calm'), { target: { value: 'Remote edit' } });
  expect(save().disabled).toBe(true);

  fireEvent.click(screen.getByText('Delete bot…'));
  fireEvent.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByText('Cancel'));
  fireEvent.click(screen.getByText('Delete bot…'));
  state.rpc.call.mockRejectedValueOnce(new Error('locked'));
  fireEvent.click(screen.getByText('Delete, keep threads'));
  expect((await within(screen.getByRole('group', { name: 'Confirm delete' })).findByRole('alert')).textContent).toBe('locked');
  fireEvent.click(screen.getByText('Delete and archive its threads'));
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('remove', { bot: 'scout', archiveThreads: true }));
  await screen.findByRole('heading', { name: 'Other' });
  expect(screen.queryByRole('button', { name: /^Scout/ })).toBeNull();
});

it('picks provider, model and project from the host catalog', async () => {
  const catalog = vi.fn((args: { providerId: string }) => ({
    projects: [{ id: 'p1', name: 'Default Project' }, { id: 'p2', name: 'zcc' }],
    providers: [{ id: 'claude-code', name: 'Claude Code' }],
    models: args.providerId === 'claude-code' ? ['opus', 'sonnet'] : [],
    modelError: args.providerId === 'claude-code' ? null : null
  }));
  route({ list: () => [{ ...scout, providerId: 'gone' }], catalog, update: () => scout });
  render(<BotsPanel />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
  const provider = await screen.findByRole('button', {name: 'Provider'});
  await screen.findByText('gone (unavailable)');
  expect(screen.getByRole('button', {name: 'Project'}).textContent).toBe('Default Project');
  fireEvent.click(provider);
  fireEvent.click(screen.getByRole('option', { name: 'Claude Code' }));
  await waitFor(() => expect(catalog).toHaveBeenCalledWith({ providerId: 'claude-code' }));
  fireEvent.click(screen.getByRole('button', {name:'Model'}));
  fireEvent.click(await screen.findByRole('option', {name:'sonnet'}));
  fireEvent.click(screen.getByRole('button', {name: 'Project'}));
  const search = screen.getByRole('textbox', {name: 'Search projects'});
  fireEvent.change(search, {target: {value: 'unknown'}});
  expect(screen.getByText('No matching projects')).toBeTruthy();
  fireEvent.keyDown(search, {key: 'Escape'});
  expect(screen.getByRole('button', {name: 'Project'}).textContent).toBe('Default Project');
  fireEvent.click(screen.getByRole('button', {name: 'Project'}));
  fireEvent.change(screen.getByRole('textbox', {name: 'Search projects'}), {target: {value: 'ZCC'}});
  expect(screen.queryByRole('option', {name: 'Default Project'})).toBeNull();
  fireEvent.keyDown(screen.getByRole('textbox', {name: 'Search projects'}), {key: 'Enter'});
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('update', {
    bot: 'scout', patch: { providerId: 'claude-code', model: 'sonnet', projectId: 'p2' }
  }));
  expect((await screen.findByRole('status')).textContent).toContain('when a new main thread is created');
});

it('shows model load errors from the catalog', async () => {
  route({ list: () => [{ ...scout, providerId: 'codex' }], catalog: () => ({ projects: [], providers: [], models: [], modelError: 'auth_required' }) });
  render(<BotsPanel />);
  await screen.findByText('Models unavailable: auth_required');
  expect(screen.getByLabelText('Model').textContent).toBe('Default');
  expect(screen.getByLabelText('Project').textContent).toContain('p1 (unavailable)');
});

it('accepts a custom model ID when the catalog is unavailable', async () => {
  route({ list: () => [{ ...scout, providerId: 'codex', model: 'gpt-x' }], catalog: () => { throw new Error('host offline'); }, update: () => scout });
  render(<BotsPanel />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Couldn’t load providers: host offline'.replace('’', "'"));
  fireEvent.click(screen.getByRole('button', {name:'Model'}));
  fireEvent.click(screen.getByRole('option', {name:'Custom model…'}));
  const model = screen.getByLabelText('Model ID') as HTMLInputElement;
  expect(model.value).toBe('gpt-x');
  fireEvent.change(model, {target: {value:'custom/model'}});
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(state.rpc.call).toHaveBeenCalledWith('update', {bot:'scout', patch:{model:'custom/model'}}));
  fireEvent.click(screen.getByRole('button', {name: 'Model'}));
  fireEvent.click(screen.getByRole('option', {name: 'Default'}));
  expect(screen.queryByLabelText('Model ID')).toBeNull();
});

it('handles missing and unreachable main threads', async () => {
  route({ list: () => [{ ...scout, mainThreadStatus: null }, { ...scout, id: 'lost', name: 'Lost', mainThreadStatus: 'unknown' }] });
  render(<BotsPanel />);
  await screen.findByText(/main thread was deleted/);
  expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
  expect(screen.queryByText('Wake')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Lost/ }));
  await screen.findByText(/Can't reach Lost/);
  expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
});

it('keeps tab panels mounted and supports arrow keys', async () => {
  route({ list: () => [scout], jobs: () => [] });
  render(<BotsPanel />);
  const details = await screen.findByRole('tab', { name: 'Overview' });
  fireEvent.change(screen.getByDisplayValue('Terse'), { target: { value: 'Draft' } });
  fireEvent.keyDown(details, { key: 'ArrowRight' });
  const library = screen.getByRole('tab', { name: 'Library' });
  expect(library.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(library);
  await screen.findByText('No background jobs yet.');
  fireEvent.keyDown(library, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByDisplayValue('Draft')).toBeTruthy();
});

it('refreshes the library only for its own bot', async () => {
  const jobs = vi.fn(() => []);
  route({ list: () => [scout], jobs });
  render(<BotsPanel />);
  await waitFor(() => expect(jobs).toHaveBeenCalledTimes(1));
  fireEvent.click(await screen.findByRole('tab', { name: 'Library' }));
  await waitFor(() => expect(jobs).toHaveBeenCalledTimes(1));
  const handler = state.realtime.at(-1)! as (payload: unknown) => void;
  handler({ botId: 'other' });
  handler({ botId: 'scout' });
  await waitFor(() => expect(jobs).toHaveBeenCalledTimes(2));
});

it('animates avatars only in the hero or on list hover, with a stable per-bot shape', () => {
  const { container } = render(
    <>
      <BotAvatar bot={fresh as never} size={30} />
      <BotAvatar bot={fresh as never} size={64} live />
      <BotAvatar bot={{ ...scout, mainThreadStatus: 'active' } as never} size={30} />
    </>
  );
  const [still, live, busy] = Array.from(container.querySelectorAll<HTMLElement>('.bt-av'));
  expect(still!.classList.contains('is-live')).toBe(false);
  expect(live!.classList.contains('is-live')).toBe(true);
  expect(still!.dataset.shape).toBe(live!.dataset.shape);
  expect(busy!.dataset.state).toBe('working');
  expect(still!.querySelector('.bt-look > .bt-blink')).not.toBeNull();
  expect(live!.textContent).toBe('');
  expect(still!.textContent).toBe('');
});

it('keeps closed eyes attached to the breathing body without looking or blinking', () => {
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'scout', 'owl', 'x1', 'zz']) {
    const { container, unmount } = render(<BotAvatar bot={{ ...scout, id, mainThreadStatus: 'idle' } as never} live />);
    const av = container.querySelector<HTMLElement>('.bt-av')!;
    expect(av.dataset.state).toBe('asleep');
    expect(av.querySelector('.bt-look, .bt-blink')).toBeNull();
    expect(av.querySelector('.bt-body > path[fill="none"]')).not.toBeNull();
    unmount();
  }
});

it('scopes the inline code style to the Bots panel', async () => {
  route({ list: () => [] });
  const { container } = render(<><code>Host</code><BotsPanel /></>);
  await screen.findByText('Create a bot');
  const rules = container.querySelector('style')!.sheet!.cssRules;
  const codeRules = Array.from(rules).filter((rule): rule is CSSStyleRule =>
    'selectorText' in rule && /\bcode$/.test(String(rule.selectorText)));
  expect(codeRules.map(rule => rule.selectorText)).toEqual(['.bt-root code']);
});

it('opens real paged bot memories from Overview and recovers after Memory is unavailable', async () => {
  memoryRpc.mockRejectedValueOnce(new Error('disabled')).mockResolvedValueOnce({
    memories: [{id:'m1', name:'Branch preferences', summary:'Release instructions', details:'Include hashes.'}], hasMore:true
  }).mockResolvedValueOnce({memories:[], hasMore:false});
  route({list: () => [scout]});
  render(<BotsPanel />);
  expect(await screen.findByText('Next run')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: 'Open library →'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Memory plugin');
  fireEvent.click(screen.getByText('Retry'));
  fireEvent.click(await screen.findByText('Branch preferences'));
  expect(screen.getByText('Include hashes.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Next'}));
  await screen.findByText('No memories on this page.');
  expect(memoryRpc).toHaveBeenCalledWith('memory','listTagged',{tag:'bot:scout',projectId:'p1',offset:20});
  fireEvent.click(screen.getByRole('button', {name:'Previous'}));
  await waitFor(() => expect(memoryRpc).toHaveBeenLastCalledWith('memory','listTagged',{tag:'bot:scout',projectId:'p1',offset:0}));
});

it('shows each scoped bot’s avatar and live status, opens its thread and filters by name', async () => {
  let rows = [scout, fresh, { ...scout, id: 'other', name: 'Remote', projectId: 'p2' }];
  route({ list: () => rows });
  const cleanupIds = vi.fn();
  const props = { searchQuery: '', activeThreadId: 't1', projectIds: ['p1'], openThread: vi.fn(), registerThreads: vi.fn(() => cleanupIds) };
  const view = render(<BasicBots {...props} />);
  const row = await screen.findByRole('button', { name: 'Scout', exact: true });
  expect(row.getAttribute('aria-current')).toBe('page');
  expect(row.querySelector('.bt-av[data-state="asleep"] svg')).toBeTruthy();
  const status = within(row).getByText('Asleep');
  expect(row.getAttribute('aria-describedby')).toBe(status.id);
  expect(within(screen.getByRole('button', { name: 'Fresh', exact: true })).getByText('Not started')).toBeTruthy();
  rows = [{ ...scout, mainThreadStatus: 'active' }, ...rows.slice(1)];
  state.realtime.at(-1)?.();
  await within(row).findByText('Working');
  expect(row.querySelector('.bt-av[data-state="working"]')).toBeTruthy();
  expect(screen.queryByText('Remote')).toBeNull();
  expect(props.registerThreads).toHaveBeenCalledWith(['t1']);
  fireEvent.click(row);
  expect(props.openThread).toHaveBeenCalledWith('t1');
  view.rerender(<BasicBots {...props} searchQuery="  fre " />);
  expect(screen.queryByRole('button', { name: 'Scout', exact: true })).toBeNull();
  expect(screen.getByRole('button', { name: 'Fresh', exact: true })).toBeTruthy();
  rows = [];
  state.realtime.at(-1)?.();
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Bots' })).toBeNull());
  expect(cleanupIds).toHaveBeenCalled();
});

it('retries a failed load and starts a new chat only after the user submits', async () => {
  route({ list: () => { throw Error('offline'); } });
  const props = { searchQuery: '', activeThreadId: null, projectIds: ['p1'], openThread: vi.fn(), registerThreads: vi.fn() };
  render(<BasicBots {...props} />);
  await screen.findByRole('alert');
  route({ list: () => [fresh], send: () => ({ threadId: 'new-id' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  const row = await screen.findByRole('button', { name: 'Fresh', exact: true });
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(row);
  expect(screen.queryByLabelText('Message Fresh')).toBeNull();
  fireEvent.click(row);
  expect(state.rpc.call.mock.calls.some(([method]) => method === 'send')).toBe(false);
  fireEvent.change(screen.getByLabelText('Message Fresh'), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  await waitFor(() => expect(props.openThread).toHaveBeenCalledWith('new-id'));
});

it('shows five bots, puts the newest pins first, and searches beyond the collapsed list', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ ...fresh, id: String(i), name: `Bot ${i}`,
    pinnedAt: i === 6 ? 20 : i === 5 ? 10 : undefined }));
  route({ list: () => [...rows] });
  const props = { searchQuery: '', activeThreadId: null, projectIds: ['p1'], openThread: vi.fn(), registerThreads: vi.fn() };
  const view = render(<BasicBots {...props} />);
  const names = () => Array.from(view.container.querySelectorAll('.bt-basic-row .bt-name'), node => node.textContent);
  const more = await screen.findByRole('button', { name: 'Show more' });
  expect(names()).toEqual(['Bot 6', 'Bot 5', 'Bot 0', 'Bot 1', 'Bot 2']);
  expect(screen.getByRole('button', { name: 'Unpin Bot 6' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(more);
  expect(names()).toHaveLength(7);
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  expect(names()).toHaveLength(5);
  view.rerender(<BasicBots {...props} searchQuery="Bot 4" />);
  expect(names()).toEqual(['Bot 4']);
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  rows.splice(5);
  state.realtime.at(-1)?.();
  view.rerender(<BasicBots {...props} />);
  await waitFor(() => expect(names()).toEqual(['Bot 0', 'Bot 1', 'Bot 2', 'Bot 3', 'Bot 4']));
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
});

it('reports failed pin updates without opening a chat or changing the pin', async () => {
  route({ list: () => [scout], update: () => { throw Error('Cannot save pin'); } });
  const props = { searchQuery: '', activeThreadId: null, projectIds: ['p1'], openThread: vi.fn(), registerThreads: vi.fn() };
  render(<BasicBots {...props} />);
  const pin = await screen.findByRole('button', { name: 'Pin Scout' });
  fireEvent.click(pin);
  expect((await screen.findByRole('alert')).textContent).toBe('Cannot save pin');
  expect(state.rpc.call).toHaveBeenCalledWith('update', { bot: 'scout', patch: { pinned: true } });
  expect(pin.getAttribute('aria-pressed')).toBe('false');
  expect(props.openThread).not.toHaveBeenCalled();
});


it('creates the first bot from the Basic header within the current project', async () => {
  let bots: typeof fresh[] = [];
  route({ list: () => bots, create: ({ name }) => {
    const bot = { ...fresh, id: 'new-bot', name };
    bots = [bot];
    return bot;
  } });
  const props = { searchQuery: '', activeThreadId: null, projectIds: ['p1'], openThread: vi.fn(), registerThreads: vi.fn() };
  render(<BasicBots {...props} />);
  const add = await screen.findByRole('button', { name: /New bot/ });
  fireEvent.click(add);
  const first = screen.getByRole('dialog', { name: 'New bot' });
  fireEvent(first, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(add);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(add);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Guide' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create bot' }));
  expect(await screen.findByLabelText('Message Guide')).toBeTruthy();
  expect(state.rpc.call).toHaveBeenCalledWith('create', expect.objectContaining({ name: 'Guide', projectId: 'p1' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(props.openThread).not.toHaveBeenCalled();
});
