/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { AgentforceLabPanel, elapsed, labExchanges, labSteps } from './AgentforceLabPanel.js';
import type { LabSnapshot } from '../../lib/agentforce-lab-contract.js';

let session: LabSnapshot;
const rpc = vi.fn();
const props = { pluginId: 'salesforce', projectId: 'p1', source: 'config: Helper', fileLabel: 'Helper.agent', mode: 'rehearse' as const };
const defaultRpc = async (_plugin: string, method: string, args: Record<string, unknown>) => {
  if (method === 'agentPreview.context') return { ok: true, fields: [] };
  if (method === 'agentLab.start') { session = { id: 'one', sourceHash: 'abcdef123456', orgAlias: 'dev', engine: args.engine as LabSnapshot['engine'], model: 'model', turns: [], closed: false, failed: false }; return { ok: true, data: session }; }
  if (method === 'agentLab.send') { session = { ...session, turns: [...session.turns, { role: 'user', text: String(args.text) }, { role: 'agent', text: 'Let me help with your order.', latencyMs: 800, planId: 'plan-one' }] }; return { ok: true, data: session }; }
  if (method === 'agentLab.next') return { ok: true, data: { text: 'What information do you need?' } };
  if (method === 'agentLab.evaluate') return { ok: true, data: { verdict: { outcome: 'pass', reason: 'The agent clarified the request.', evidence: ['Turn 1 offered help.'] } } };
  if (method === 'agentLab.end') { session = { ...session, closed: true }; return { ok: true, data: session }; }
  return { ok: false, error: 'Unexpected request' };
};
beforeEach(() => {
  rpc.mockReset().mockImplementation(defaultRpc);
  (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
});
afterEach(() => { cleanup(); delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__; vi.restoreAllMocks(); });

async function startRun(name: RegExp) {
  const button = screen.getByRole('button', { name }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe('Agentforce rehearsal UI', () => {
  const fields = [
    { name: '$Context.sessionId', label: 'Session', type: 'Text' },
    { name: 'verified', label: 'Verified', type: 'Boolean' },
    { name: 'count', label: 'Count', type: 'Number' },
    { name: 'details', label: 'Details', type: 'Json' },
  ];
  const openVariables = () => fireEvent.click(screen.getByText('Initial variables'));

  it.each(['preview', 'rehearsal'] as const)('starts %s role-play with typed variables and preserves its snapshot when saved or exported', async engine => {
    const contextVariables = [
      { name: '$Context.sessionId', type: 'Text', value: '' },
      { name: 'verified', type: 'Boolean', value: false },
      { name: 'count', type: 'Number', value: 0 },
      { name: 'details', type: 'Json', value: null },
    ];
    rpc.mockImplementation(async (plugin, method, args) => {
      if (method === 'agentPreview.context') return { ok: true, fields };
      if (method === 'studio.suites.list') return { ok: true, suites: [] };
      if (method === 'studio.suites.save') return { ok: true, suite: { path: 'tests/Helper.scenario.json' } };
      return defaultRpc(plugin, method, args);
    });
    render(<AgentforceLabPanel {...props} mode="test" agentPath="Helper.agent" />);
    if (engine === 'rehearsal') fireEvent.click(screen.getByRole('button', { name: /AI rehearsal/ }));
    openVariables();
    await screen.findByLabelText('Session value');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set Session' }));
    fireEvent.change(screen.getByLabelText('Verified value'), { target: { value: 'false' } });
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '0' } });
    fireEvent.click(screen.getByLabelText('Options for Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Set Details to null' }));
    fireEvent.change(screen.getByLabelText('Conversation budget'), { target: { value: '1' } });
    await startRun(/Run AI role-play/);
    await screen.findByText('Run complete');
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ engine, path: 'Helper.agent', contextVariables }));
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '2' } });
    expect(screen.getByText('These edits will apply when you start a new run.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save as test case' }));
    await screen.findByText(/Saved “Role-play/);
    expect(rpc.mock.calls.find(c => c[1] === 'studio.suites.save')![2].cases[0].contextVariables).toEqual(contextVariables);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:run');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByText('Export run'));
    expect(JSON.parse(await (create.mock.calls[0][0] as Blob).text()).contextVariables).toEqual(contextVariables);
    await startRun(/Run again/);
    await screen.findByText('Run complete');
    expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.start').at(-1)![2].contextVariables[2].value).toBe(2);
  });

  it('reuses saved presets, blocks invalid values, and resets overrides when the agent or org changes', async () => {
    const preset = { id: 'customer', name: 'Existing customer', revision: 1, fields: fields.map(f => ({ ...f, declared: true })), values: [{ name: 'count', type: 'Number', value: 0 }] };
    rpc.mockImplementation(async (plugin, method, args) => {
      if (method === 'agentPreview.context') return { ok: true, fields };
      if (method === 'agentPreview.presets.list') return { ok: true, scopeKey: 'scope', orgLabel: 'dev', presets: [preset] };
      return defaultRpc(plugin, method, args);
    });
    const view = render(<AgentforceLabPanel {...props} mode="test" agentPath="Helper.agent" orgAlias="dev" />);
    openVariables();
    await screen.findByRole('option', { name: 'Existing customer' });
    fireEvent.change(screen.getByLabelText('Context preset'), { target: { value: 'customer' } });
    expect((screen.getByLabelText('Count value') as HTMLInputElement).value).toBe('0');
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '-' } });
    fireEvent.blur(screen.getByLabelText('Count value'));
    expect(screen.getByRole('alert').textContent).toContain('Enter a number');
    expect((screen.getByRole('button', { name: /Run AI role-play/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(rpc.mock.calls.some(c => c[1] === 'agentLab.start')).toBe(false);
    fireEvent.change(screen.getByLabelText('Context preset'), { target: { value: 'customer' } });
    fireEvent.change(screen.getByLabelText('Conversation budget'), { target: { value: '1' } });
    await startRun(/Run AI role-play/);
    await screen.findByText('Run complete');
    expect(rpc.mock.calls.find(c => c[1] === 'agentLab.start')![2].contextVariables).toEqual(preset.values);
    view.rerender(<AgentforceLabPanel {...props} mode="test" agentPath="Helper.agent" orgAlias="other" />);
    await waitFor(() => expect((screen.getByLabelText('Count value') as HTMLInputElement).value).toBe(''));
    fireEvent.change(screen.getByLabelText('Count value'), { target: { value: '5' } });
    view.rerender(<AgentforceLabPanel {...props} mode="test" agentPath="Other.agent" orgAlias="other" />);
    await waitFor(() => expect((screen.getByLabelText('Count value') as HTMLInputElement).value).toBe(''));
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentPreview.presets.list', expect.objectContaining({ path: 'Other.agent', orgAlias: 'other' }));
  });

  it('allows manual variables after discovery fails and omits overrides after reset', async () => {
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentPreview.context' ? { ok: false, error: 'Parse failed' } : defaultRpc(plugin, method, args));
    render(<AgentforceLabPanel {...props} />);
    openVariables();
    await screen.findByText(/Could not discover variables: Parse failed/);
    fireEvent.click(screen.getByRole('button', { name: '+ Add variable' }));
    fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'locale' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    fireEvent.change(screen.getByLabelText('locale value'), { target: { value: 'fr' } });
    await startRun(/Start conversation/);
    await screen.findByText('Conversation ready');
    expect(rpc.mock.calls.find(c => c[1] === 'agentLab.start')![2].contextVariables).toEqual([{ name: 'locale', type: 'Text', value: 'fr' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear overrides' }));
    expect(screen.getByText(/current conversation keeps its original context/)).toBeTruthy();
    await startRun(/New conversation/);
    await waitFor(() => expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.start')).toHaveLength(2));
    expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.start').at(-1)![2]).not.toHaveProperty('contextVariables');
  });

  it('starts the current draft, sends a message, flags stale source, exports and restarts', async () => {
    const view = render(<AgentforceLabPanel {...props} />);
    expect(screen.getByRole('button', { name: /Salesforce Preview/ }).getAttribute('aria-pressed')).toBe('true');
    await startRun(/Start conversation/);
    await screen.findByText('Conversation ready');
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ source: props.source, engine: 'preview', projectId: 'p1' }));
    expect(rpc.mock.calls.find(c => c[1] === 'agentLab.start')![2]).not.toHaveProperty('threadId');
    fireEvent.change(screen.getByLabelText('Rehearsal message'), { target: { value: 'Find my order' } });
    fireEvent.submit(screen.getByLabelText('Rehearsal message').closest('form')!);
    await screen.findByText('Let me help with your order.');
    expect(screen.getByText('0.8s')).toBeTruthy();
    expect(screen.getByText('Plan plan-one')).toBeTruthy();
    view.rerender(<AgentforceLabPanel {...props} source="Changed draft" />);
    expect(screen.getByText(/Your script changed/)).toBeTruthy();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:run');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByText('Export run'));
    expect(create).toHaveBeenCalledWith(expect.any(Blob)); expect(click).toHaveBeenCalled();
    await startRun(/New conversation/);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ source: 'Changed draft' })));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByText('Stopped · partial conversation');
    expect(screen.queryByRole('region', { name: 'AI evaluation' })).toBeNull();
  });
  it('runs bounded AI role-play, retains the scenario and labels the assessment as advisory', async () => {
    render(<AgentforceLabPanel {...props} threadId="owner" mode="test" />);
    fireEvent.click(screen.getByRole('button', { name: /AI rehearsal/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Missing details' }));
    fireEvent.change(screen.getByLabelText('Customer persona'), { target: { value: 'A busy buyer' } });
    fireEvent.change(screen.getByLabelText('Customer goal'), { target: { value: 'Find an order' } });
    fireEvent.change(screen.getByLabelText('Opening message'), { target: { value: 'Where is my order?' } });
    fireEvent.change(screen.getByLabelText('Success criteria'), { target: { value: 'Ask for the order ID' } });
    fireEvent.change(screen.getByLabelText('Conversation budget'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Salesforce model API name'), { target: { value: 'CustomModel' } });
    await startRun(/Run AI role-play/);
    await screen.findByText('Run complete');
    expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.send')).toHaveLength(2);
    expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.next')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ model: 'CustomModel', engine: 'rehearsal', threadId: 'owner', scenario: { persona: 'A busy buyer', goal: 'Find an order', opening: 'Where is my order?', criteria: 'Ask for the order ID', maxTurns: 2 } }));
    expect(screen.getByText('Criteria met')).toBeTruthy();
    expect(screen.getByText('Advisory result · not release approval')).toBeTruthy();
  });
  it('stops during session startup and closes the late session without sending a turn', async () => {
    let release!: (value: unknown) => void;
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.start' ? new Promise(r => { release = r; }) : defaultRpc(plugin, method, args));
    render(<AgentforceLabPanel {...props} mode="test" />);
    await startRun(/Run AI role-play/);
    await screen.findByText('Compiling draft in Salesforce…');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => release(await defaultRpc('salesforce', 'agentLab.start', { engine: 'preview' })));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', { projectId: 'p1', id: 'one' }));
    expect(rpc.mock.calls.some(c => c[1] === 'agentLab.send')).toBe(false);
    expect(screen.queryByText('Criteria met')).toBeNull();
  });
  it('stops after an in-flight turn without generating more AI work and cleans up on unmount', async () => {
    let release!: (value: unknown) => void;
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.send' ? new Promise(r => { release = r; }) : defaultRpc(plugin, method, args));
    const view = render(<AgentforceLabPanel {...props} mode="test" />);
    await startRun(/Run AI role-play/);
    await screen.findByText('Turn 1 of 4 · Agent replying…');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => release(await defaultRpc('salesforce', 'agentLab.send', { text: 'hello' })));
    expect(rpc.mock.calls.some(c => c[1] === 'agentLab.evaluate' || c[1] === 'agentLab.next')).toBe(false);
    view.unmount();
    rpc.mockImplementation(defaultRpc);
    const second = render(<AgentforceLabPanel {...props} />);
    await startRun(/Start conversation/);
    await screen.findByText('Conversation ready');
    second.unmount();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', expect.objectContaining({ id: 'one' }));
  });
  it('fails visibly on RPC/AI failures and never reports a pass for invalid criteria', async () => {
    render(<AgentforceLabPanel {...props} mode="test" />);
    fireEvent.change(screen.getByLabelText('Success criteria'), { target: { value: '' } });
    await startRun(/Run AI role-play/);
    await screen.findByRole('alert');
    expect(rpc.mock.calls.some(c => c[1] === 'agentLab.start')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Stay in scope' }));
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.evaluate' ? { ok: false, error: 'Models API unavailable' } : defaultRpc(plugin, method, args));
    await startRun(/Run AI role-play/);
    await screen.findByText('Models API unavailable');
    expect(screen.getByText('Run incomplete')).toBeTruthy();
    expect(screen.queryByText('Criteria met')).toBeNull();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', expect.objectContaining({ id: 'one' }));
  });
  it('keeps a failed manual message available for retry and distinguishes inconclusive and failed judgments', async () => {
    const view = render(<AgentforceLabPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /AI rehearsal/ }));
    fireEvent.click(screen.getByRole('button', { name: /Salesforce Preview/ }));
    await startRun(/Start conversation/);
    await screen.findByText('Conversation ready');
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.send' ? Promise.reject(new Error('Network offline')) : defaultRpc(plugin, method, args));
    fireEvent.change(screen.getByLabelText('Rehearsal message'), { target: { value: 'Keep this draft' } });
    fireEvent.submit(screen.getByLabelText('Rehearsal message').closest('form')!);
    await screen.findByText('Network offline');
    expect((screen.getByLabelText('Rehearsal message') as HTMLInputElement).value).toBe('Keep this draft');
    view.unmount();
    for (const [outcome, label] of [['fail', 'Needs attention'], ['inconclusive', 'More evidence needed']]) {
      rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.evaluate' ? { ok: true, data: { verdict: { outcome, reason: 'Needs review', evidence: ['Missing detail'] } } } : defaultRpc(plugin, method, args));
      const test = render(<AgentforceLabPanel {...props} mode="test" />);
      fireEvent.change(screen.getByLabelText('Conversation budget'), { target: { value: '1' } });
      await startRun(/Run AI role-play/);
      await screen.findByText(label);
      test.unmount();
    }
  });

  async function startAndSend(extra: { agentPath?: string } = {}) {
    const view = render(<AgentforceLabPanel {...props} {...extra} />);
    await startRun(/Start conversation/);
    await screen.findByText('Conversation ready');
    fireEvent.change(screen.getByLabelText('Rehearsal message'), { target: { value: 'Find my order' } });
    fireEvent.submit(screen.getByLabelText('Rehearsal message').closest('form')!);
    await screen.findByText('Let me help with your order.');
    return view;
  }
  const evidence = () => screen.getByTestId('agentforce-lab-evidence');
  const traceBody = { ok: true, data: { runId: 'one', turn: 1, planId: 'plan-one', available: true, steps: [{ kind: 'topic', label: 'Orders' }, { kind: 'action', label: 'Lookup', latencyMs: 40 }] } };

  it('loads each Preview reply trace once into the evidence column and tags the bubble with its topic', async () => {
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.trace' ? traceBody : defaultRpc(plugin, method, args));
    await startAndSend();
    await waitFor(() => expect(evidence().textContent).toContain('Lookup'));
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.trace', { projectId: 'p1', id: 'one', planId: 'plan-one' });
    expect(evidence().textContent).toContain('Turn 1');
    expect(screen.getByText('Plan plan-one')).toBeTruthy();
    expect(screen.getByTestId('agentforce-lab-transcript').querySelector('.af-chip.is-topic')?.textContent).toBe('Orders');
    fireEvent.click(screen.getByRole('button', { name: 'Raw JSON' }));
    expect(evidence().querySelector('pre')?.textContent).toContain('"planId": "plan-one"');
    fireEvent.click(screen.getAllByRole('button', { name: 'Show evidence for turn 1' })[1]!);
    expect(evidence().querySelector('.af-ev-turn.is-selected')?.getAttribute('data-turn')).toBe('1');
    expect(document.querySelector('.af-message.is-selected')).toBeTruthy();
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.trace')).toHaveLength(1);
  });

  it('shows the failure reason when the trace request is rejected or returns an error', async () => {
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.trace' ? { ok: false, error: 'Trace expired' } : defaultRpc(plugin, method, args));
    await startAndSend();
    await waitFor(() => expect(evidence().textContent).toContain('Trace expired'));
  });

  it('falls back to a generic reason for an empty trace response', async () => {
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.trace' ? { ok: true } : defaultRpc(plugin, method, args));
    await startAndSend();
    await waitFor(() => expect(evidence().textContent).toContain('Trace request failed.'));
  });

  it('reports thrown trace errors, including non-Error values, and does not trace rehearsal sessions', async () => {
    rpc.mockImplementation(async (plugin, method, args) => { if (method === 'agentLab.trace') throw new Error('Socket closed'); return defaultRpc(plugin, method, args); });
    const view = await startAndSend();
    await waitFor(() => expect(evidence().textContent).toContain('Socket closed'));
    view.unmount();
    rpc.mockImplementation(async (plugin, method, args) => { if (method === 'agentLab.trace') throw 'string failure'; return defaultRpc(plugin, method, args); });
    const second = await startAndSend();
    await waitFor(() => expect(evidence().textContent).toContain('string failure'));
    second.unmount();
    rpc.mockClear();
    render(<AgentforceLabPanel {...props} />);
    expect(evidence().textContent).toContain('Evidence appears here');
    fireEvent.click(screen.getByRole('button', { name: /AI rehearsal/ }));
    await startRun(/Start conversation/);
    await screen.findByText('Conversation ready');
    fireEvent.change(screen.getByLabelText('Rehearsal message'), { target: { value: 'hi' } });
    fireEvent.submit(screen.getByLabelText('Rehearsal message').closest('form')!);
    await screen.findByText('Let me help with your order.');
    expect(rpc.mock.calls.some(c => c[1] === 'agentLab.trace')).toBe(false);
    expect(evidence().textContent).toContain('Approximation');
  });

  it('a new conversation clears cached traces and requests them again', async () => {
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.trace' ? traceBody : defaultRpc(plugin, method, args));
    await startAndSend();
    await waitFor(() => expect(evidence().textContent).toContain('Orders'));
    await startRun(/New conversation/);
    await waitFor(() => expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.start')).toHaveLength(2));
    await screen.findByText('Conversation ready');
    expect(evidence().textContent).not.toContain('Orders');
    fireEvent.change(screen.getByLabelText('Rehearsal message'), { target: { value: 'again' } });
    fireEvent.submit(screen.getByLabelText('Rehearsal message').closest('form')!);
    await waitFor(() => expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.trace')).toHaveLength(2));
  });

  it('shows a reply without a plan id and a stepper, typing, ghost turns and pending evidence while a scripted run is in flight', async () => {
    let release!: (value: unknown) => void;
    let sends = 0;
    rpc.mockImplementation(async (plugin, method, args) => {
      if (method === 'agentLab.send' && ++sends === 2) return new Promise(r => { release = r; });
      if (method === 'agentLab.send') { session = { ...session, turns: [...session.turns, { role: 'user', text: String(args.text) }, { role: 'agent', text: 'No plan here.' }] }; return { ok: true, data: session }; }
      return defaultRpc(plugin, method, args);
    });
    render(<AgentforceLabPanel {...props} mode="test" />);
    await startRun(/Run AI role-play/);
    await screen.findByText('Turn 2 of 4 · Agent replying…');
    const steps = [...document.querySelectorAll('.af-step')].map(step => step.className.replace('af-step ', ''));
    expect(steps).toEqual(['is-done', 'is-cur', 'is-todo', 'is-todo']);
    expect(screen.getByText('1 · Opening')).toBeTruthy(); expect(screen.getByText('4 · Wrap-up')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Agent is replying' })).toBeTruthy();
    expect(screen.getByText('What information do you need?')).toBeTruthy();
    expect(document.querySelectorAll('.af-message.is-ghost')).toHaveLength(2);
    expect(evidence().textContent).toContain('No plan id was returned for this reply.');
    expect(evidence().querySelectorAll('.af-ev-turn.is-todo')).toHaveLength(2);
    expect(evidence().querySelector('.af-ev-pending')?.textContent).toBe('Agent replying…');
    expect(screen.queryByText('Save as test case')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => release(await defaultRpc('salesforce', 'agentLab.send', { text: 'x' })));
  });

  it('marks the next turn as the customer writing while the AI customer drafts it', async () => {
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.next' ? new Promise(() => undefined) : defaultRpc(plugin, method, args));
    render(<AgentforceLabPanel {...props} mode="test" />);
    await startRun(/Run AI role-play/);
    await screen.findByText('Turn 2 of 4 · Customer thinking…');
    expect(screen.getByRole('status', { name: 'Customer is writing' })).toBeTruthy();
    expect(evidence().querySelector('[data-turn="2"] .af-ev-pending')?.textContent).toBe('Customer is writing…');
  });

  it('saves a finished role-play as a scenario case with the routing it showed', async () => {
    rpc.mockImplementation(async (plugin, method, args) => {
      if (method === 'agentLab.trace') return traceBody;
      if (method === 'studio.suites.list') return { ok: true, suites: [{ path: 'tests/Helper.scenario.json', sha256: 'abc', cases: [{ id: 'old', name: 'Old', utterances: ['hi'], expect: {} }] }] };
      if (method === 'studio.suites.save') return { ok: true, suite: { path: 'tests/Helper.scenario.json' } };
      return defaultRpc(plugin, method, args);
    });
    render(<AgentforceLabPanel {...props} mode="test" agentPath="aiAuthoringBundles/Helper/Helper.agent" />);
    fireEvent.change(screen.getByLabelText('Conversation budget'), { target: { value: '1' } });
    await startRun(/Run AI role-play/);
    await screen.findByText('Run complete');
    await waitFor(() => expect(evidence().textContent).toContain('Orders'));
    fireEvent.click(screen.getByRole('button', { name: 'Save as test case' }));
    await screen.findByText('Saved “Role-play · Happy path” to tests/Helper.scenario.json');
    const saved = rpc.mock.calls.find(c => c[1] === 'studio.suites.save')![2] as { cases: Array<{ name: string; utterances: string[]; expect: Record<string, unknown> }>; expectedSha256: string; agentPath: string };
    expect(saved.expectedSha256).toBe('abc');
    expect(saved.agentPath).toBe('aiAuthoringBundles/Helper/Helper.agent');
    expect(saved.cases).toHaveLength(2);
    expect(saved.cases[1]).toMatchObject({ name: 'Role-play · Happy path', utterances: ['Hi! What can you help me with?'], expect: { topic: 'Orders', actions: ['Lookup'] } });
    expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();
  });

  it('names a manual conversation after its first message and surfaces save failures', async () => {
    rpc.mockImplementation(async (plugin, method, args) => {
      if (method === 'agentLab.trace') return traceBody;
      if (method === 'studio.suites.list') return { ok: true, suites: [] };
      if (method === 'studio.suites.save') return { ok: false, error: 'Suite changed on disk' };
      return defaultRpc(plugin, method, args);
    });
    const view = render(<AgentforceLabPanel {...props} agentPath="Helper.agent" />);
    await startRun(/Start conversation/);
    await screen.findByText('Conversation ready');
    fireEvent.change(screen.getByLabelText('Rehearsal message'), { target: { value: 'Find my order' } });
    fireEvent.submit(screen.getByLabelText('Rehearsal message').closest('form')!);
    await screen.findByText('Let me help with your order.');
    fireEvent.click(screen.getByRole('button', { name: 'Save as test case' }));
    await screen.findByText('Suite changed on disk');
    expect((rpc.mock.calls.find(c => c[1] === 'studio.suites.save')![2] as { cases: Array<{ name: string }>; expectedSha256?: string }).cases[0]!.name).toBe('Find my order');
    view.unmount();
    rpc.mockImplementation(async (plugin, method, args) => method === 'studio.suites.list' ? { ok: false, error: 'No suite access' } : method === 'agentLab.trace' ? traceBody : defaultRpc(plugin, method, args));
    await startAndSend({ agentPath: 'Helper.agent' });
    fireEvent.click(screen.getByRole('button', { name: 'Save as test case' }));
    expect(await screen.findByText('No suite access')).toBeTruthy();
  });
});

describe('role-play helpers', () => {
  it('groups turns into exchanges with a welcome slot', () => {
    const rows = labExchanges([{ role: 'agent', text: 'Hi' }, { role: 'user', text: 'a' }, { role: 'agent', text: 'b' }, { role: 'agent', text: 'c' }, { role: 'user', text: 'd' }]);
    expect(rows.map(row => [row.index, row.user?.at, row.agents.map(a => a.at)])).toEqual([[0, undefined, [0]], [1, 1, [2, 3]], [2, 4, []]]);
    expect(labExchanges([])).toEqual([]);
  });
  it('derives step states and elapsed time', () => {
    const rows = labExchanges([{ role: 'user', text: 'a' }, { role: 'agent', text: 'b' }]);
    expect(labSteps(rows, 3, true)).toEqual(['done', 'cur', 'todo']);
    expect(labSteps(rows, 3, false)).toEqual(['done', 'todo', 'todo']);
    expect(elapsed(1000, 1500)).toBe('');
    expect(elapsed(1000, 7400)).toBe('6 s');
  });
});


it('keeps role-play pane sizes separate for a draft and a selected project', async () => {
  const draft = 'salesforce:studio:lab:draft:columns';
  const project = 'salesforce:studio:lab:p1:columns';
  localStorage.setItem(draft, '32'); localStorage.setItem(project, '68');
  try {
    const view = render(<AgentforceLabPanel {...props} projectId={undefined} />);
    const handle = () => screen.getByRole('separator', { name: 'Resize conversation and evidence' });
    expect(handle().getAttribute('aria-valuenow')).toBe('32');
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(localStorage.getItem(draft)).toBe('36');
    view.rerender(<AgentforceLabPanel {...props} />);
    await waitFor(() => expect(handle().getAttribute('aria-valuenow')).toBe('68'));
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(localStorage.getItem(project)).toBe('64');
    expect(localStorage.getItem(draft)).toBe('36');
  } finally { localStorage.removeItem(draft); localStorage.removeItem(project); }
});
