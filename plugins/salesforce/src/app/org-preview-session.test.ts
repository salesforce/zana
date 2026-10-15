import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callOrgPreview } from './org-preview-session.js';

const rpc = vi.fn();
const args = { projectId: 'p', threadId: 't', orgAlias: 'dev', path: 'force-app/Employee.agent', sessionId: 's', utterance: 'Hello' };
beforeEach(() => {
  rpc.mockReset();
  (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
});
afterEach(() => { delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__; });

describe('org preview session routing', () => {
  it('simulates the saved source without a default agent user and preserves the welcome', async () => {
    const source = 'config:\n  agent_type: AgentforceEmployeeAgent';
    rpc.mockResolvedValueOnce({ ok: true, file: { content: source } }).mockResolvedValueOnce({ ok: true, data: { id: 'new', turns: [{ role: 'agent', text: 'Welcome' }] } });
    expect(await callOrgPreview('salesforce', 'start', args, true)).toEqual({ ok: true, data: { sessionId: 'new', response: 'Welcome' } });
    expect(rpc).toHaveBeenNthCalledWith(1, 'salesforce', 'agentFiles.read', { projectId: 'p', path: args.path });
    expect(rpc).toHaveBeenNthCalledWith(2, 'salesforce', 'agentLab.start', expect.objectContaining({ projectId: 'p', orgAlias: 'dev', engine: 'preview', source, threadId: 't', path: args.path }));
  });

  it.each(['start', 'send', 'end'] as const)('keeps %s on the CLI for Live and published agents', async action => {
    rpc.mockResolvedValue({ ok: true, data: { sessionId: 'cli' } });
    expect(await callOrgPreview('salesforce', action, args, false)).toMatchObject({ ok: true, data: { sessionId: 'cli' } });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('salesforce', `agentPreview.${action}`, args);
  });

  it('sends the user text to the same simulation and returns its last agent response', async () => {
    rpc.mockResolvedValue({ ok: true, data: { id: 's', turns: [{ role: 'agent', text: 'Welcome' }, { role: 'user', text: 'Hello' }, { role: 'agent', text: 'Reply' }] } });
    expect(await callOrgPreview('salesforce', 'send', args, true)).toMatchObject({ ok: true, data: { sessionId: 's', response: 'Reply' } });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('salesforce', 'agentLab.send', expect.objectContaining({ id: 's', text: 'Hello', projectId: 'p' }));
  });

  it('ends the simulation without repeating its last response', async () => {
    rpc.mockResolvedValue({ ok: true, data: { id: 's', turns: [{ role: 'agent', text: 'Last reply' }] } });
    expect(await callOrgPreview('salesforce', 'end', args, true)).toEqual({ ok: true, data: { sessionId: 's', response: undefined } });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', expect.objectContaining({ id: 's' }));
  });

  it.each([undefined, { ok: true }, { ok: true, file: {} }, { ok: false, error: 'File access denied' }])('stops when the source cannot be read: %j', async read => {
    rpc.mockResolvedValue(read);
    expect(await callOrgPreview('salesforce', 'start', args, true)).toEqual({ ok: false, error: read?.error || 'Could not read the selected agent.' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not start a session after the panel closes while reading', async () => {
    rpc.mockResolvedValue({ ok: true, file: { content: 'source' } });
    expect(await callOrgPreview('salesforce', 'start', args, true, () => false)).toEqual({ ok: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, { ok: false, error: 'Salesforce unavailable', code: 'failed' }, { ok: true, data: {} }])('surfaces missing sessions and remote failures: %j', async result => {
    rpc.mockResolvedValue(result);
    expect(await callOrgPreview('salesforce', 'send', args, true)).toMatchObject({ ok: false, error: result?.error || 'The preview returned no session.' });
  });

  it.each([[], [{ role: 'user', text: 'Unanswered' }], undefined])('never presents a user turn as an agent reply: %j', async turns => {
    rpc.mockResolvedValue({ ok: true, data: { id: 's', turns } });
    expect((await callOrgPreview('salesforce', 'send', args, true)).data?.response).toBeUndefined();
  });
});
