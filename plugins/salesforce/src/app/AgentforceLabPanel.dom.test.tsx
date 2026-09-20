/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { AgentforceLabPanel } from './AgentforceLabPanel.js';
import type { LabSnapshot } from '../../lib/agentforce-lab-contract.js';

let session: LabSnapshot;
const rpc = vi.fn();
const props = { pluginId: 'salesforce', projectId: 'p1', source: 'config: Helper', fileLabel: 'Helper.agent', mode: 'rehearse' as const };
const defaultRpc = async (_plugin: string, method: string, args: Record<string, unknown>) => {
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

describe('Agentforce rehearsal UI', () => {
  it('starts the current draft, sends a message, flags stale source, exports and restarts', async () => {
    const view = render(<AgentforceLabPanel {...props} />);
    expect(screen.getByRole('button', { name: /Salesforce Preview/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Start conversation/ }));
    await screen.findByText('Conversation ready');
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ source: props.source, engine: 'preview', projectId: 'p1' }));
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
    fireEvent.click(screen.getByRole('button', { name: /New conversation/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ source: 'Changed draft' })));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByText('Stopped · partial conversation');
    expect(screen.queryByRole('region', { name: 'AI evaluation' })).toBeNull();
  });
  it('runs bounded AI role-play, retains the scenario and labels the assessment as advisory', async () => {
    render(<AgentforceLabPanel {...props} mode="test" />);
    fireEvent.click(screen.getByRole('button', { name: /AI rehearsal/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Missing details' }));
    fireEvent.change(screen.getByLabelText('Customer persona'), { target: { value: 'A busy buyer' } });
    fireEvent.change(screen.getByLabelText('Customer goal'), { target: { value: 'Find an order' } });
    fireEvent.change(screen.getByLabelText('Opening message'), { target: { value: 'Where is my order?' } });
    fireEvent.change(screen.getByLabelText('Success criteria'), { target: { value: 'Ask for the order ID' } });
    fireEvent.change(screen.getByLabelText('Conversation budget'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Salesforce model API name'), { target: { value: 'CustomModel' } });
    fireEvent.click(screen.getByRole('button', { name: /Run AI role-play/ }));
    await screen.findByText('Run complete');
    expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.send')).toHaveLength(2);
    expect(rpc.mock.calls.filter(c => c[1] === 'agentLab.next')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ model: 'CustomModel', engine: 'rehearsal', scenario: { persona: 'A busy buyer', goal: 'Find an order', opening: 'Where is my order?', criteria: 'Ask for the order ID', maxTurns: 2 } }));
    expect(screen.getByText('Criteria met')).toBeTruthy();
    expect(screen.getByText('Advisory result · not release approval')).toBeTruthy();
  });
  it('stops during session startup and closes the late session without sending a turn', async () => {
    let release!: (value: unknown) => void;
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.start' ? new Promise(r => { release = r; }) : defaultRpc(plugin, method, args));
    render(<AgentforceLabPanel {...props} mode="test" />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI role-play/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Run AI role-play/ }));
    await screen.findByText('Turn 1 of 4 · Agent replying…');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => release(await defaultRpc('salesforce', 'agentLab.send', { text: 'hello' })));
    expect(rpc.mock.calls.some(c => c[1] === 'agentLab.evaluate' || c[1] === 'agentLab.next')).toBe(false);
    view.unmount();
    rpc.mockImplementation(defaultRpc);
    const second = render(<AgentforceLabPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Start conversation/ }));
    await screen.findByText('Conversation ready');
    second.unmount();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', expect.objectContaining({ id: 'one' }));
  });
  it('fails visibly on RPC/AI failures and never reports a pass for invalid criteria', async () => {
    render(<AgentforceLabPanel {...props} mode="test" />);
    fireEvent.change(screen.getByLabelText('Success criteria'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Run AI role-play/ }));
    await screen.findByRole('alert');
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stay in scope' }));
    rpc.mockImplementation(async (plugin, method, args) => method === 'agentLab.evaluate' ? { ok: false, error: 'Models API unavailable' } : defaultRpc(plugin, method, args));
    fireEvent.click(screen.getByRole('button', { name: /Run AI role-play/ }));
    await screen.findByText('Models API unavailable');
    expect(screen.getByText('Run incomplete')).toBeTruthy();
    expect(screen.queryByText('Criteria met')).toBeNull();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', expect.objectContaining({ id: 'one' }));
  });
  it('keeps a failed manual message available for retry and distinguishes inconclusive and failed judgments', async () => {
    const view = render(<AgentforceLabPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /AI rehearsal/ }));
    fireEvent.click(screen.getByRole('button', { name: /Salesforce Preview/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start conversation/ }));
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
      fireEvent.click(screen.getByRole('button', { name: /Run AI role-play/ }));
      await screen.findByText(label);
      test.unmount();
    }
  });
});
