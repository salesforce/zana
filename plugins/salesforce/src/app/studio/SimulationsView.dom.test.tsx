/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SimulationsView, improvePrompt, type SimulationsViewProps } from './SimulationsView.js';
import { clearStudioRunWorkspaces } from './run-workspaces.js';
import { LAB_SCENARIOS } from '../../../lib/agentforce-lab-contract.js';
import { simulationCounts, type SimulationBatch, type SimulationLane } from '../../../lib/simulation-contract.js';

const PATH = 'force-app/main/default/aiAuthoringBundles/MyBot/MyBot.agent';
let realtime: ((payload: unknown) => void) | null = null;
let channels: Record<string, (payload: unknown) => void>;
beforeEach(() => {
  clearStudioRunWorkspaces();
  realtime = null;
  channels = {};
  (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__ = { useRealtime: (channel: string, h: (p: unknown) => void) => { channels[channel] = h; if (channel === 'sf.studio.changed') realtime = h; } };
});
afterEach(() => { cleanup(); delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__; vi.restoreAllMocks(); });

const scenario = { persona: 'An angry customer', goal: 'Get a refund', opening: 'I want my money back', criteria: 'Offers a refund', maxTurns: 2 };
const lane = (id: string, status: SimulationLane['status'], extra: Partial<SimulationLane> = {}): SimulationLane => ({ id, name: `Lane ${id}`, repeat: 1, scenario, status, turns: [], ...extra });
const batch = (id: string, status: SimulationBatch['status'], lanes: SimulationLane[], extra: Partial<SimulationBatch> = {}): SimulationBatch => ({
  id, agentPath: PATH, sourceHash: 'h', candidate: false, engine: 'preview', orgAlias: 'dev', parallel: 4, plannedCalls: 4, status, startedAt: 1_700_000_000_000,
  startedBy: 'studio', counts: simulationCounts(lanes), lanes, ...extra,
});

type Call = NonNullable<SimulationsViewProps['call']>;
type Handler = (args: Record<string, unknown>) => unknown;
function setup(overrides: Partial<SimulationsViewProps> = {}, handlers: Record<string, Handler> = {}) {
  const table: Record<string, Handler> = {
    'studio.simulations.list': () => ({ ok: true, batches: [] }),
    'agentPreview.context': () => ({ ok: true, fields: [] }),
    'agentPreview.presets.list': () => ({ ok: true, presets: [] }),
    ...handlers,
  };
  const call = vi.fn<Call>(async (_p, method, args) => {
    const handler = table[method];
    return handler ? handler(args as Record<string, unknown>) : { ok: false, error: `unexpected ${method}` };
  });
  const props: SimulationsViewProps = { pluginId: 'salesforce', projectId: 'p1', threadId: 't1', path: PATH, source: 'agent source', dirty: false, visible: true, onAskAgent: vi.fn(), call, pollMs: 15, ...overrides };
  const view = render(<SimulationsView {...props} />);
  return { call, props, view, table };
}
const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const calls = (call: ReturnType<typeof setup>['call'], method: string) => call.mock.calls.filter(([, m]) => m === method).map(([, , a]) => a as Record<string, unknown>);

it('copies shared presets into individual scenarios and pins both scenario and batch values on refresh', async () => {
  const original = [{ name: 'verified', type: 'Boolean', value: false }, { name: 'count', type: 'Number', value: 0 }];
  let preset = { id: 'customer', name: 'Customer', revision: 1, fields: [], values: original };
  const { call } = setup({}, {
    'agentPreview.presets.list': () => ({ ok: true, presets: [preset] }),
    'studio.simulations.start': () => ({ ok: false, error: 'Test stop' }),
  });
  await within(screen.getByLabelText('Simulation context preset')).findByRole('option', { name: 'Customer · revision 1' });
  await waitFor(() => expect((screen.getByLabelText('Variable preset') as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Simulation context preset'), { target: { value: 'customer' } });
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: 'customer' } });
  fireEvent.change(screen.getByLabelText('count value'), { target: { value: '2' } });
  fireEvent.click(button('Edit Missing details'));
  expect(screen.queryByLabelText('count value')).toBeNull();
  fireEvent.click(button('Edit Happy path'));
  preset = { ...preset, revision: 2, values: [{ name: 'count', type: 'Number', value: 9 }] };
  await act(async () => channels['salesforce.context-presets.changed']({ projectId: 'p1' }));
  await within(screen.getByLabelText('Variable preset')).findByRole('option', { name: 'Customer · revision 2' });
  expect((screen.getByLabelText('count value') as HTMLInputElement).value).toBe('2');
  expect(within(screen.getByLabelText('Simulation context preset')).getByRole('option', { name: 'Customer · copied values' })).toBeTruthy();
  fireEvent.click(button('Run 3 conversations')); await screen.findByText('Test stop');
  const sent = calls(call, 'studio.simulations.start')[0] as any;
  expect(sent.contextVariables).toEqual(original);
  expect(sent.scenarios[0].contextVariables).toEqual([original[0], { name: 'count', type: 'Number', value: 2 }]);
  expect(sent.scenarios[1].contextVariables).toBeUndefined();
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: 'customer' } });
  expect((screen.getByLabelText('count value') as HTMLInputElement).value).toBe('9');
});

it('keeps scenario overrides across selections, blocks invalid values and submits typed context per scenario', async () => {
  const { call } = setup({}, { 'agentPreview.context': () => ({ ok: true, fields: [{ name: 'count', label: 'Count', type: 'Number' }] }), 'studio.simulations.start': () => ({ ok: false, error: 'Test stop' }) });
  await screen.findByText(/No simulations yet/);
  fireEvent.click(button('Add variable'));
  fireEvent.change(screen.getByLabelText('New scenario variable name'), { target: { value: 'count' } });
  fireEvent.click(button('Add override'));
  fireEvent.change(screen.getByLabelText('count value'), { target: { value: 'invalid' } });
  fireEvent.click(button('Edit Missing details')); fireEvent.click(button('Edit Happy path'));
  expect((screen.getByLabelText('count value') as HTMLInputElement).value).toBe('invalid');
  fireEvent.click(button('Run 3 conversations'));
  await screen.findByText(/Happy path: Enter a number/);
  expect(calls(call, 'studio.simulations.start')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('count value'), { target: { value: '0' } });
  fireEvent.click(button('Run 3 conversations'));
  await screen.findByText('Test stop');
  const submitted = calls(call, 'studio.simulations.start')[0].scenarios as any[];
  expect(submitted[0].contextVariables).toEqual([{ name: 'count', type: 'Number', value: 0 }]);
  expect(submitted[1].contextVariables).toBeUndefined(); expect(submitted[0].contextEntries).toBeUndefined();
});

it('shows applied lane variables and restores batch defaults plus scenario overrides for reuse', async () => {
  const done = batch('context', 'done', [lane('1', 'pass', { scenario: { ...scenario, contextVariables: [{ name: 'verified', type: 'Boolean', value: false }] }, contextVariables: [{ name: 'locale', type: 'Text', value: 'fr' }, { name: 'verified', type: 'Boolean', value: false }] })], { contextVariables: [{ name: 'locale', type: 'Text', value: 'fr' }] });
  const { call } = setup({}, { 'studio.simulations.list': () => ({ ok: true, batches: [done] }), 'studio.simulations.get': () => ({ ok: true, batch: done }), 'studio.simulations.start': () => ({ ok: false, error: 'Test stop' }) });
  await screen.findByText('Lane 1'); fireEvent.click(button(/Lane 1/));
  expect(screen.getByText('Starting variables · 2')).toBeTruthy();
  expect(screen.getByText('false')).toBeTruthy();
  fireEvent.click(button('Use scenarios from this batch'));
  expect((screen.getByLabelText('verified value') as HTMLSelectElement).value).toBe('false');
  expect(screen.getByText(/1 variable inherited/)).toBeTruthy();
  fireEvent.click(button('Run 1 conversation')); await screen.findByText('Test stop');
  expect(calls(call, 'studio.simulations.start')[0]).toMatchObject({ contextVariables: done.contextVariables, scenarios: [{ name: 'Lane 1', ...done.lanes[0].scenario }] });
});

it('asks for an agent file first', () => {
  setup({ path: null });
  expect(screen.getByText(/Open an agent file/)).toBeTruthy();
});

it('starts a batch of the selected presets on the editor source', async () => {
  const started = batch('b1', 'running', [lane('1', 'running'), lane('2', 'queued')]);
  const { call } = setup({ dirty: true }, {
    'studio.simulations.start': () => ({ ok: true, batch: started }),
    'studio.simulations.list': args => ({ ok: true, batches: calls(call, 'studio.simulations.start').length ? [started] : [], args }),
    'studio.simulations.get': () => ({ ok: true, batch: started }),
  });
  await screen.findByText(/No simulations yet/);
  expect(screen.getByText(/including unsaved changes/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText(LAB_SCENARIOS[0]!.name));
  fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Engine'), { target: { value: 'rehearsal' } });
  expect(screen.getByText(/AI approximation/)).toBeTruthy();
  const lanes = (LAB_SCENARIOS.length - 1) * 2;
  fireEvent.click(button(`Run ${lanes} conversations`));
  await screen.findByText('Lane 1');
  const [args] = calls(call, 'studio.simulations.start');
  expect(args).toMatchObject({ projectId: 'p1', agentPath: PATH, source: 'agent source', repeats: 2, engine: 'rehearsal', startedByUser: true, threadId: 't1' });
  expect((args!.scenarios as unknown[]).length).toBe(LAB_SCENARIOS.length - 1);
  expect(calls(call, 'studio.simulations.list')[0]).toMatchObject({ agentPath: PATH, projectId: 'p1' });
  expect(screen.getByText(/Running · 0\/2/)).toBeTruthy();
  expect(screen.getByText('Waiting for a free slot.')).toBeTruthy();
  expect(screen.getByText('Turn 0 of 2')).toBeTruthy();
  // The poll reconciles while running.
  await waitFor(() => expect(calls(call, 'studio.simulations.get').length).toBeGreaterThan(1));
});

it('reports a refused start', async () => {
  setup({}, { 'studio.simulations.start': () => ({ ok: false, error: 'Operator declined the simulate run.' }) });
  await screen.findByText(/No simulations yet/);
  fireEvent.click(button(/Run \d+ conversations/));
  expect((await screen.findByRole('alert')).textContent).toBe('Operator declined the simulate run.');
});

it('shows a finished batch, its lane detail and hands failures to the agent', async () => {
  const done = batch('b2', 'done', [
    lane('1', 'pass', { turns: [{ role: 'user', text: 'hello' }, { role: 'agent', text: 'hi there', latencyMs: 1500 }], verdict: { outcome: 'pass', reason: 'Refund offered', evidence: ['turn 2'] } }),
    lane('2', 'fail', { repeat: 2, verdict: { outcome: 'fail', reason: 'Never offered a refund', evidence: ['turn 1', 'turn 2'] } }),
    lane('3', 'error', { error: 'Session expired' }),
    lane('4', 'stopped'),
  ], { engine: 'rehearsal', candidate: true, startedBy: 'thread' });
  const old = batch('b1', 'stopped', [lane('1', 'pass')]);
  const { props, call } = setup({}, {
    'studio.simulations.list': () => ({ ok: true, batches: [done, old] }),
    'studio.simulations.get': args => ({ ok: true, batch: args.batchId === 'b1' ? old : done }),
  });
  await screen.findByText('Lane 1');
  expect(screen.getByLabelText('1 of 4 pass')).toBeTruthy();
  expect(screen.getByText(/Rehearse · dev · draft · started by the agent/)).toBeTruthy();
  expect(screen.getByText('Stopped before it finished.')).toBeTruthy();
  expect(screen.getByText('Session expired').className).toBe('is-bad');
  expect(screen.getByText('Agent: hi there')).toBeTruthy();

  fireEvent.click(screen.getByText('Lane 2 #2'));
  const detail = screen.getByRole('region', { name: 'Conversation Lane 2' });
  expect(detail.textContent).toMatch(/Judge: Fail.*Never offered a refund/);
  expect(detail.textContent).toMatch(/No turns yet/);
  fireEvent.click(screen.getByText('Lane 1'));
  expect(screen.getByRole('region', { name: 'Conversation Lane 1' }).textContent).toMatch(/Agent · 1\.5 s/);
  fireEvent.click(screen.getByText('Lane 3'));
  expect(screen.getByRole('region', { name: 'Conversation Lane 3' }).textContent).toMatch(/Error Session expired/);

  fireEvent.click(button('Ask assistant to investigate'));
  const prompt = (props.onAskAgent as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
  expect(prompt).toMatch(/batch b2 \(1\/4 pass\)/);
  expect(prompt).toMatch(/Failing: Lane 2 #2, Lane 3\./);
  expect(prompt).toMatch(/Do not save, deploy, publish/);

  fireEvent.change(screen.getByLabelText('Simulation batch'), { target: { value: 'b1' } });
  await waitFor(() => expect(screen.getByLabelText('1 of 1 pass')).toBeTruthy());
  expect(calls(call, 'studio.simulations.get').at(-1)).toMatchObject({ batchId: 'b1' });
  expect(screen.queryByRole('button', { name: 'Ask assistant to investigate' })).toBeNull();
});

it('opens the batch the agent asked to show and follows realtime changes', async () => {
  let current = batch('b1', 'running', [lane('1', 'running', { turns: [{ role: 'user', text: 'hey' }] })]);
  const other = batch('b9', 'done', [lane('1', 'pass')]);
  const onFocusHandled = vi.fn();
  const { call, view, props } = setup({ onFocusHandled, pollMs: 60_000 }, {
    'studio.simulations.list': () => ({ ok: true, batches: [current, other] }),
    'studio.simulations.get': args => ({ ok: true, batch: args.batchId === 'b9' ? other : current }),
  });
  await screen.findByText('Customer: hey');
  view.rerender(<SimulationsView {...props} focus={{ batchId: 'b9', seq: 3 }} />);
  await waitFor(() => expect(screen.getByLabelText('1 of 1 pass')).toBeTruthy());
  expect(onFocusHandled).toHaveBeenCalledWith(3);
  fireEvent.click(button(/^Batch setup/));
  view.rerender(<SimulationsView {...props} focus={{ batchId: 'b9', seq: 4 }} />);
  await waitFor(() => expect(button(/^Results/).getAttribute('aria-pressed')).toBe('true'));
  expect(onFocusHandled).toHaveBeenCalledWith(4);

  // A change on the batch on screen reloads it; other kinds and projects are ignored.
  const before = calls(call, 'studio.simulations.get').length;
  act(() => { realtime?.({ kind: 'orgTests', projectId: 'p1', batchId: 'b9' }); realtime?.({ kind: 'simulations', projectId: 'p2', batchId: 'b9' }); });
  expect(calls(call, 'studio.simulations.get').length).toBe(before);
  act(() => { realtime?.({ kind: 'simulations', projectId: 'p1', batchId: 'b9' }); });
  await waitFor(() => expect(calls(call, 'studio.simulations.get').length).toBe(before + 1));
  // A batch the agent just started is picked up and shown.
  current = batch('b5', 'done', [lane('1', 'fail')]);
  act(() => { realtime?.({ kind: 'simulations', projectId: 'p1', batchId: 'b5' }); });
  await waitFor(() => expect(screen.getByLabelText('0 of 1 pass')).toBeTruthy());
});

it('stops a running batch', async () => {
  const running = batch('b1', 'running', [lane('1', 'running')]);
  const { call } = setup({ pollMs: 60_000 }, {
    'studio.simulations.list': () => ({ ok: true, batches: [running] }),
    'studio.simulations.get': () => ({ ok: true, batch: running }),
    'studio.simulations.stop': () => ({ ok: true, batch: { ...running, status: 'stopped', lanes: [lane('1', 'stopped')], counts: simulationCounts([lane('1', 'stopped')]) } }),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
  await screen.findByRole('button', { name: /Run \d+ conversations/ });
  expect(calls(call, 'studio.simulations.stop')[0]).toMatchObject({ batchId: 'b1' });
  expect(screen.getByText('Stopped', { selector: '.sf-tp-summary .sf-tp-chip' })).toBeTruthy();
});

it.each([false, true])('keeps another agent’s realtime batch out of this history (existing history: %s)', async hasHistory => {
  const own = batch('own', 'done', [lane('own', 'pass')]);
  const foreign = batch('foreign', 'running', [lane('foreign', 'running')], { agentPath: 'Other.agent' });
  const { call } = setup({}, {
    'studio.simulations.list': () => ({ ok: true, batches: hasHistory ? [own] : [] }),
    'studio.simulations.get': args => ({ ok: true, batch: args.batchId === 'foreign' ? foreign : own }),
  });
  await waitFor(() => expect(hasHistory ? screen.getByText('Lane own') : screen.getByText(/No simulations yet/)).toBeTruthy());
  await act(async () => { realtime?.({ kind: 'simulations', projectId: 'p1', batchId: 'foreign' }); });
  expect(calls(call, 'studio.simulations.get').some(args => args.batchId === 'foreign')).toBe(false);
  expect(screen.queryByText('Lane foreign')).toBeNull();
  expect(hasHistory ? screen.getByText('Lane own') : screen.getByText(/No simulations yet/)).toBeTruthy();
});

it('reports list, read and stop failures', async () => {
  setup({}, { 'studio.simulations.list': () => ({ ok: false }) });
  expect((await screen.findByRole('alert')).textContent).toBe('Could not list simulation batches.');
  cleanup();
  setup({}, { 'studio.simulations.list': () => ({ ok: true, batches: [batch('b1', 'done', [])] }), 'studio.simulations.get': () => ({ ok: false }) });
  expect((await screen.findByRole('alert')).textContent).toBe('Could not read the simulation batch.');
  cleanup();
  const running = batch('b1', 'running', [lane('1', 'running')]);
  setup({ pollMs: 60_000 }, {
    'studio.simulations.list': () => ({ ok: true, batches: [running] }),
    'studio.simulations.get': () => ({ ok: true, batch: running }),
    'studio.simulations.stop': () => { throw new Error('offline'); },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
  expect((await screen.findByRole('alert')).textContent).toBe('offline');
});

it('builds an improve prompt without a failing list when nothing failed', () => {
  expect(improvePrompt(batch('b', 'done', [lane('1', 'pass')]))).not.toMatch(/Failing:/);
});

it.each(['path', 'projectId'] as const)('ignores a late history response after switching %s', async field => {
  let finish!: (value: unknown) => void;
  const old = batch('old', 'done', [lane('old', 'fail')]);
  const { props, view, call } = setup({}, {
    'studio.simulations.list': () => new Promise(resolve => { finish = resolve; }),
    'studio.simulations.get': () => ({ ok: true, batch: old }),
  });
  const pending = finish;
  call.mockImplementation(async (_plugin, method) => method === 'studio.simulations.list' ? { ok: true, batches: [] } : { ok: true, batch: old });
  view.rerender(<SimulationsView {...props} {...{ [field]: field === 'path' ? 'other.agent' : 'p2' }} />);
  await screen.findByText(/No simulations yet/);
  await act(async () => { pending({ ok: true, batches: [old] }); });
  expect(screen.queryByText('Lane old')).toBeNull();
  expect(screen.getByText(/No simulations yet/)).toBeTruthy();
});

it('ignores an old start response when the user has moved to another agent', async () => {
  let finish!: (value: unknown) => void;
  const { props, view } = setup({}, {
    'studio.simulations.start': () => new Promise(resolve => { finish = resolve; }),
    'studio.simulations.get': () => ({ ok: true, batch: batch('old', 'running', [lane('old', 'running')]) }),
  });
  await screen.findByText(/No simulations yet/);
  fireEvent.click(button(/Run \d+ conversations/));
  view.rerender(<SimulationsView {...props} path="other.agent" />);
  expect(button(/Run \d+ conversations/).disabled).toBe(false);
  await act(async () => { finish({ ok: true, batch: batch('old', 'running', [lane('old', 'running')]) }); });
  expect(screen.queryByText('Lane old')).toBeNull();
});

it('edits scenarios, adds/removes custom cases, validates and applies a typed context preset', async () => {
  const done = batch('custom', 'done', [lane('1', 'pass')]);
  const { call, table } = setup({}, {
    'agentPreview.presets.list': () => ({ ok: true, presets: [{ id: 'fr', name: 'French customer', revision: 2, values: [{ name: 'locale', type: 'Text', value: 'fr' }] }] }),
    'studio.simulations.start': () => ({ ok: true, batch: done }),
    'studio.simulations.list': () => ({ ok: true, batches: [] }),
  });
  await screen.findByText(/No simulations yet/);
  await within(screen.getByLabelText('Simulation context preset')).findByRole('option', { name: 'French customer · revision 2' });
  fireEvent.change(screen.getByLabelText('Scenario 1 name'), { target: { value: 'Return policy' } });
  fireEvent.change(screen.getByLabelText('Scenario 1 opening'), { target: { value: 'Can I return this?' } });
  fireEvent.change(screen.getByLabelText('Simulation context preset'), { target: { value: 'fr' } });
  fireEvent.click(button('Add scenario'));
  fireEvent.click(button('Run 4 conversations'));
  expect((await screen.findByRole('alert')).textContent).toContain('Persona');
  expect(calls(call, 'studio.simulations.start')).toHaveLength(0);
  fireEvent.click(button('Remove scenario 4'));
  table['studio.simulations.list'] = () => ({ ok: true, batches: [done] });
  table['studio.simulations.get'] = () => ({ ok: true, batch: done });
  fireEvent.click(button('Run 3 conversations'));
  await screen.findByText('Lane 1');
  expect(calls(call, 'studio.simulations.start')[0]).toMatchObject({ scenarios: [expect.objectContaining({ name: 'Return policy', opening: 'Can I return this?' }), expect.anything(), expect.anything()], contextVariables: [{ name: 'locale', type: 'Text', value: 'fr' }] });
  fireEvent.click(button('Use scenarios from this batch'));
  expect((screen.getByLabelText('Scenario 1 name') as HTMLTextAreaElement).value).toBe('Lane 1');
  expect(button('Run 1 conversation')).toBeTruthy();
});

it('explains conversation limits before starting any work', async () => {
  setup();
  await screen.findByText(/No simulations yet/);
  fireEvent.click(button('Add scenario'));
  fireEvent.click(button('Add scenario'));
  fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: '3' } });
  expect(screen.getByRole('alert').textContent).toContain('at most 12');
  expect(button('Run 15 conversations').disabled).toBe(true);
});

it('switches between setup and results, and dismisses run settings with Escape or outside focus', async () => {
  const done = batch('b1', 'done', [lane('1', 'pass')]);
  setup({}, { 'studio.simulations.list': () => ({ ok: true, batches: [done] }), 'studio.simulations.get': () => ({ ok: true, batch: done }) });
  await screen.findByText('Lane 1');
  fireEvent.click(button(/^Batch setup/));
  expect(button(/^Batch setup/).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('list', { name: 'Conversations' })).toBeNull();
  fireEvent.click(button(/^Results/));
  expect(screen.getByRole('list', { name: 'Conversations' })).toBeTruthy();
  const summary = screen.getByText('Run settings');
  const settings = summary.closest('details')!;
  settings.open = true;
  fireEvent.keyDown(settings, { key: 'Escape' });
  expect(settings.open).toBe(false);
  expect(document.activeElement).toBe(summary);
  settings.open = true;
  fireEvent.pointerDown(screen.getByLabelText('Engine'));
  expect(settings.open).toBe(true);
  fireEvent.pointerDown(document.body);
  expect(settings.open).toBe(false);
  settings.open = true;
  fireEvent.focusIn(button(/^Batch setup/));
  expect(settings.open).toBe(false);
});

it('keeps custom scenario identities distinct after deleting a middle scenario', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  setup();
  await screen.findByText(/No simulations yet/);
  fireEvent.click(button('Add scenario'));
  fireEvent.click(button('Add scenario'));
  fireEvent.change(screen.getByLabelText('Scenario 5 name'), { target: { value: 'Keep me' } });
  fireEvent.click(button('Edit Custom scenario'));
  fireEvent.click(button('Remove scenario 4'));
  fireEvent.click(button('Add scenario'));
  fireEvent.change(screen.getByLabelText('Scenario 5 name'), { target: { value: 'New one' } });
  expect((screen.getByLabelText('Scenario 5 name') as HTMLInputElement).value).toBe('New one');
  fireEvent.click(button('Edit Keep me'));
  expect((screen.getByLabelText('Scenario 4 name') as HTMLInputElement).value).toBe('Keep me');
  expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
});

it('refreshes presets and clears selected context when this project changes org', async () => {
  const { call } = setup({}, { 'agentPreview.presets.list': () => ({ ok: true, presets: [{ id: 'fr', name: 'French', revision: 1, values: [] }] }) });
  await within(screen.getByLabelText('Simulation context preset')).findByRole('option', { name: 'French · revision 1' });
  fireEvent.change(screen.getByLabelText('Simulation context preset'), { target: { value: 'fr' } });
  const before = calls(call, 'agentPreview.presets.list').length;
  await act(async () => { channels['context.changed']!({ projectId: 'other' }); });
  expect(calls(call, 'agentPreview.presets.list')).toHaveLength(before);
  await act(async () => { channels['context.changed']!({ projectId: 'p1' }); });
  expect((screen.getByLabelText('Simulation context preset') as HTMLSelectElement).value).toBe('');
  expect(calls(call, 'agentPreview.presets.list')).toHaveLength(before + 1);
  await act(async () => { channels['salesforce.context-presets.changed']!({ projectId: 'p1' }); });
  expect(calls(call, 'agentPreview.presets.list')).toHaveLength(before + 2);
});


it('isolates draft and project pane sizes for both scenario editing and result inspection', async () => {
  const key = (kind: string, project = 'draft') => `salesforce:studio:simulation-${kind}:${project}:columns`;
  for (const [kind, value] of [['scenarios', '30'], ['results', '44']]) localStorage.setItem(key(kind!), value!);
  localStorage.setItem(key('scenarios', 'p1'), '62'); localStorage.setItem(key('results', 'p1'), '55');
  try {
    const done = batch('resize-batch', 'done', [lane('1', 'pass')]);
    const { props, view } = setup({ projectId: undefined }, {
      'studio.simulations.list': () => ({ ok: true, batches: [done] }),
      'studio.simulations.get': () => ({ ok: true, batch: done }),
    });
    await screen.findByText('Lane 1');
    const results = () => screen.getByRole('separator', { name: 'Resize conversations and result details' });
    expect(results().getAttribute('aria-valuenow')).toBe('44');
    fireEvent.keyDown(results(), { key: 'ArrowRight' });
    expect(localStorage.getItem(key('results'))).toBe('48');
    fireEvent.click(button(/^Batch setup/));
    const scenarios = () => screen.getByRole('separator', { name: 'Resize scenario catalogue and editor' });
    expect(scenarios().getAttribute('aria-valuenow')).toBe('30');
    fireEvent.keyDown(scenarios(), { key: 'ArrowRight' });
    expect(localStorage.getItem(key('scenarios'))).toBe('34');
    view.rerender(<SimulationsView {...props} projectId="p1" />);
    await waitFor(() => expect(scenarios().getAttribute('aria-valuenow')).toBe('62'));
    fireEvent.click(button(/^Results/));
    expect(results().getAttribute('aria-valuenow')).toBe('55');
    expect(localStorage.getItem(key('results'))).toBe('48');
  } finally {
    for (const kind of ['scenarios', 'results']) for (const project of ['draft', 'p1']) localStorage.removeItem(key(kind, project));
  }
});

it('selects shared copies, preserves batch edits and pins their source revisions and variables', async () => {
  const { starterScenarios } = await import('../../../lib/scenario-library-contract.js'); const rows = starterScenarios(); rows[0].contextVariables = [{ name: 'count', type: 'Number', value: 0 }];
  const shared = { scenarios: rows, loading: false, error: '', reload: vi.fn(), save: vi.fn(), remove: vi.fn(), onManage: vi.fn() };
  const { call, view, props: current } = setup({ scenarioLibrary: shared }, { 'studio.simulations.start': () => ({ ok: true, batch: batch('new', 'done', []) }) });
  await screen.findByRole('checkbox', { name: 'Happy path', exact: true });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Missing details', exact: true })); fireEvent.click(screen.getByRole('checkbox', { name: 'Stay in scope', exact: true }));
  fireEvent.click(screen.getByText('Adjust for this batch')); fireEvent.change(screen.getByLabelText('Scenario 1 goal'), { target: { value: 'Local batch goal' } });
  view.rerender(<SimulationsView {...current} scenarioLibrary={{ ...shared, scenarios: rows.map(row => ({ ...row, revision: 2, goal: 'Shared update' })) }} />);
  expect((screen.getByLabelText('Scenario 1 goal') as HTMLInputElement).value).toBe('Local batch goal');
  fireEvent.click(screen.getByRole('button', { name: 'Run 1 conversation' }));
  await waitFor(() => expect(call.mock.calls.some(([, method]) => method === 'studio.simulations.start')).toBe(true));
  const input = call.mock.calls.find(([, method]) => method === 'studio.simulations.start')![2] as any;
  expect(input.scenarios).toEqual([expect.objectContaining({ name: 'Happy path', goal: 'Local batch goal', origin: { id: rows[0].id, name: 'Happy path', revision: 1 }, contextVariables: [{ name: 'count', type: 'Number', value: 0 }] })]);
});
it('adds an explicitly selected library scenario and sends management back to the shared tab', async () => {
  const { starterScenarios } = await import('../../../lib/scenario-library-contract.js'); const rows = starterScenarios();
  const extra = { ...rows[0], id: 'new', name: 'Custom shared', goal: 'Shared goal' };
  const shared = { scenarios: rows, loading: false, error: '', reload: vi.fn(), save: vi.fn(), remove: vi.fn(), onManage: vi.fn() };
  const { view, props: current } = setup({ scenarioLibrary: shared });
  await screen.findByRole('checkbox', { name: 'Happy path', exact: true });
  view.rerender(<SimulationsView {...current} scenarioLibrary={{ ...shared, selection: { scenario: extra, seq: 1 } }} />);
  await screen.findByRole('checkbox', { name: 'Custom shared', exact: true });
  fireEvent.click(screen.getByRole('button', { name: 'Manage scenarios' })); expect(shared.onManage).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Add shared scenario to batch'), { target: { value: rows[1].id } }); fireEvent.click(screen.getByRole('button', { name: 'Copy into batch' }));
  fireEvent.click(screen.getByText('Adjust for this batch')); expect((screen.getByLabelText('Scenario 4 goal') as HTMLInputElement).value).toBe(rows[1].goal);
});

it('keeps an explicitly copied scenario visible when previous batch history arrives later', async () => {
  const { starterScenarios } = await import('../../../lib/scenario-library-contract.js'); const rows = starterScenarios();
  let resolveHistory!: (value: unknown) => void;
  const history = new Promise(resolve => { resolveHistory = resolve; });
  const shared = { scenarios: rows, loading: false, error: '', reload: vi.fn(), save: vi.fn(), remove: vi.fn(), onManage: vi.fn(), selection: { scenario: rows[0], seq: 1 } };
  setup({ scenarioLibrary: shared }, {
    'studio.simulations.list': () => history,
    'studio.simulations.get': () => ({ ok: true, batch: batch('previous', 'done', []) }),
  });
  await screen.findByRole('checkbox', { name: 'Happy path', exact: true });
  await act(async () => resolveHistory({ ok: true, batches: [batch('previous', 'done', [])] }));
  expect(screen.getByRole('button', { name: 'Batch setup 3' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('checkbox', { name: 'Happy path', exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Results/ }));
  expect(screen.getByRole('button', { name: /Results/ }).getAttribute('aria-pressed')).toBe('true');
});
