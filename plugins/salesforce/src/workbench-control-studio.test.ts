import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI_COMMANDS, WorkbenchControl } from '../lib/workbench-control.js';
import { validateUiCommandInput } from '../lib/ui-command-input.js';

const sha = 'b'.repeat(64);
const proposal = { path: 'a.agent', expectedSha256: sha, content: 'new', summary: 'tidy' };
const accepted = { outcome: 'accepted', acceptedHunks: 2, rejectedHunks: 0 };
afterEach(() => { vi.useRealTimers(); });

function delivered(service: WorkbenchControl, command = 'editor.proposeEdit', input: Record<string, unknown> = proposal) {
  const { viewId } = service.register('p', { surface: 'agentforce', commands: [...UI_COMMANDS] });
  const { commandId } = service.request('p', { viewId, command, input });
  service.poll('p', { viewId, state: {} });
  return { viewId, commandId };
}

describe('Studio UI verbs on the control channel', () => {
  it('accepts the new verbs and rejects invalid input before queuing', () => {
    const service = new WorkbenchControl();
    const { viewId } = service.register('p', { surface: 'agentforce', commands: [...UI_COMMANDS] });
    for (const [command, input] of [['preview.start', { engine: 'rehearse' }], ['preview.send', { text: 'hi' }], ['trace.focus', { runId: 'r', turn: 1, step: 0 }], ['graph.focus', { node: 'topic.a' }], ['layout.set', { compact: false }], ['editor.proposeEdit', proposal]] as const) {
      expect(service.request('p', { viewId, command, input })).toMatchObject({ state: 'pending' });
      service.poll('p', { viewId, state: {} });
    }
    expect(() => service.request('p', { viewId, command: 'editor.proposeEdit', input: { ...proposal, expectedSha256: 'short' } })).toThrow('expectedSha256');
    expect(() => service.request('p', { viewId, command: 'editor.proposeEdit', input: { ...proposal, content: 'x'.repeat(180_001) } })).toThrow();
    expect(() => service.request('p', { viewId, command: 'editor.proposeEdit', input: { path: 'a', expectedSha256: sha, summary: 's' } })).toThrow('exactly one');
    expect(() => service.request('p', { viewId, command: 'editor.proposeEdit', input: { ...proposal, content: undefined, edits: Array.from({ length: 51 }, () => ({ startLine: 1, endLine: 1, text: '' })) } })).toThrow();
    expect(() => service.request('p', { viewId, command: 'layout.set', input: { compact: 'yes' } })).toThrow('boolean');
    service.dispose();
  });

  it('validates each verb', () => {
    expect(validateUiCommandInput('preview.start', { engine: 'x' })).toMatch(/engine/);
    expect(validateUiCommandInput('preview.start', { engine: 'live', extra: 1 })).toMatch(/only engine/);
    expect(validateUiCommandInput('preview.start', {})).toBeUndefined();
    expect(validateUiCommandInput('preview.send', { text: '' })).toMatch(/text/);
    expect(validateUiCommandInput('preview.send', { text: 'a'.repeat(4001) })).toMatch(/text/);
    expect(validateUiCommandInput('preview.send', { text: 'a', engine: 'z' })).toMatch(/engine/);
    expect(validateUiCommandInput('preview.send', { text: 'a', foo: 1 })).toMatch(/accepts only/);
    expect(validateUiCommandInput('preview.send', { text: 'a', engine: 'simulate' })).toBeUndefined();
    expect(validateUiCommandInput('trace.focus', {})).toBeUndefined();
    expect(validateUiCommandInput('trace.focus', { runId: '' })).toMatch(/runId/);
    expect(validateUiCommandInput('trace.focus', { runId: 5 })).toMatch(/runId/);
    expect(validateUiCommandInput('trace.focus', { turn: -1 })).toMatch(/integers/);
    expect(validateUiCommandInput('trace.focus', { step: 1.5 })).toMatch(/integers/);
    expect(validateUiCommandInput('trace.focus', { z: 1 })).toMatch(/accepts/);
    expect(validateUiCommandInput('graph.focus', { node: '' })).toMatch(/node/);
    expect(validateUiCommandInput('graph.focus', { node: 'n', x: 1 })).toMatch(/node/);
    expect(validateUiCommandInput('graph.focus', { node: 'n' })).toBeUndefined();
    expect(validateUiCommandInput('layout.set', { compact: true, x: 1 })).toMatch(/compact/);
    expect(validateUiCommandInput('file.open', {})).toBeUndefined();
  });

  it('wakes the target view when a command is queued and survives a throwing listener', () => {
    const service = new WorkbenchControl();
    const wake = vi.fn();
    service.setWakeListener(wake);
    const { viewId } = service.register('p', { surface: 'agentforce', commands: ['state'] });
    service.request('p', { viewId, command: 'state' });
    expect(wake).toHaveBeenCalledWith(viewId);
    service.setWakeListener(() => { throw Error('realtime down'); });
    expect(service.request('p', { viewId, command: 'state' })).toMatchObject({ state: 'pending' });
    service.dispose();
  });

  it('keeps view leases for 20s', () => {
    let now = 0; const service = new WorkbenchControl(() => now);
    const { viewId } = service.register('p', { surface: 'data', commands: [] });
    now = 19_999; expect(service.list('p')).toHaveLength(1);
    now = 20_001; expect(service.list('p')).toEqual([]);
    expect(() => service.poll('p', { viewId, state: {} })).toThrow('unavailable');
  });

  it('moves a proposal to awaiting_user, then completes with the outcome', () => {
    let now = 0; const service = new WorkbenchControl(() => now);
    const { viewId, commandId } = delivered(service);
    expect(service.acknowledge('p', { viewId, commandId, ok: true, pending: 'user', proposalId: 'prop-1', state: { path: 'a.agent' } })).toMatchObject({ state: 'awaiting_user' });
    expect(service.result('p', commandId)).toEqual({ state: 'awaiting_user', proposalId: 'prop-1' });
    for (now = 15_000; now <= 120_000; now += 15_000) service.poll('p', { viewId, state: {} }); // renderer keeps the lease alive
    expect(() => service.acknowledge('p', { viewId, commandId, ok: true })).toThrow('stale');
    service.outcome('p', { viewId, commandId, outcome: accepted });
    expect(service.result('p', commandId)).toEqual({ state: 'completed', ok: true, viewState: { path: 'a.agent' }, outcome: accepted });
    expect(() => service.outcome('p', { viewId, commandId, outcome: accepted })).toThrow('No proposal');
  });

  it('rejects malformed pending acks and outcomes', () => {
    const service = new WorkbenchControl();
    const { viewId, commandId } = delivered(service);
    expect(() => service.acknowledge('p', { viewId, commandId, ok: true, pending: 'user' })).toThrow('proposalId');
    expect(() => service.outcome('p', { viewId, commandId, outcome: accepted })).toThrow('No proposal');
    service.acknowledge('p', { viewId, commandId, ok: true, pending: 'user', proposalId: 'x', state: {} });
    expect(() => service.outcome('p', { viewId, commandId, outcome: { outcome: 'bogus' } })).toThrow('Invalid proposal outcome');
    const other = service.register('p', { surface: 'data', commands: [] });
    expect(() => service.outcome('p', { viewId: other.viewId, commandId, outcome: accepted })).toThrow('No proposal');
  });

  it('expires awaiting_user after 10 minutes without a response', () => {
    let now = 0; const service = new WorkbenchControl(() => now);
    const { viewId, commandId } = delivered(service);
    service.acknowledge('p', { viewId, commandId, ok: true, pending: 'user', proposalId: 'x', state: {} });
    for (now = 15_000; now <= 585_000; now += 15_000) service.poll('p', { viewId, state: {} });
    now = 599_000; expect(service.result('p', commandId).state).toBe('awaiting_user');
    now = 600_001;
    // prune drops the job entirely once its TTL elapses.
    expect(() => service.result('p', commandId)).toThrow('not found');
  });

  it('reports failed when the awaiting deadline passes before prune', () => {
    let now = 0; const service = new WorkbenchControl(() => now);
    const { viewId, commandId } = delivered(service);
    service.acknowledge('p', { viewId, commandId, ok: true, pending: 'user', proposalId: 'x', state: {} });
    const job = (service as any).jobs.get(commandId); job.touched = 599_999; job.awaiting.at = 0; now = 600_000; (service as any).views.get(viewId).at = now;
    expect(service.result('p', commandId)).toMatchObject({ state: 'failed', error: expect.stringContaining('did not respond') });
    expect(() => service.outcome('p', { viewId, commandId, outcome: accepted })).toThrow();
  });

  it('caps proposals awaiting the user per view', () => {
    const service = new WorkbenchControl();
    const { viewId } = service.register('p', { surface: 'agentforce', commands: [...UI_COMMANDS] });
    for (let i = 0; i < 4; i++) {
      const { commandId } = service.request('p', { viewId, command: 'editor.proposeEdit', input: proposal });
      service.poll('p', { viewId, state: {} });
      service.acknowledge('p', { viewId, commandId, ok: true, pending: 'user', proposalId: `p${i}`, state: {} });
    }
    const { commandId } = service.request('p', { viewId, command: 'editor.proposeEdit', input: proposal });
    service.poll('p', { viewId, state: {} });
    expect(() => service.acknowledge('p', { viewId, commandId, ok: true, pending: 'user', proposalId: 'p5', state: {} })).toThrow('Too many');
  });

  it('long-polls result: wakes on acknowledgement and on outcome, otherwise times out', async () => {
    vi.useFakeTimers();
    const service = new WorkbenchControl();
    const { viewId } = service.register('p', { surface: 'agentforce', commands: [...UI_COMMANDS] });
    const { commandId } = service.request('p', { viewId, command: 'editor.proposeEdit', input: proposal });
    expect(await service.resultWait('p', commandId, 0)).toMatchObject({ state: 'pending' });
    expect(await service.resultWait('p', commandId, 'nope')).toMatchObject({ state: 'pending' });
    service.poll('p', { viewId, state: {} });
    const first = service.resultWait('p', commandId, 99_999);
    service.acknowledge('p', { viewId, commandId, ok: true, pending: 'user', proposalId: 'x', state: {} });
    expect(await first).toMatchObject({ state: 'awaiting_user', proposalId: 'x' });
    const second = service.resultWait('p', commandId, 15_000);
    service.outcome('p', { viewId, commandId, outcome: accepted });
    expect(await second).toMatchObject({ state: 'completed', outcome: accepted });
    expect(await service.resultWait('p', commandId, 5000)).toMatchObject({ state: 'completed' });
    const third = service.request('p', { viewId, command: 'layout.set', input: { compact: true } });
    const timeout = service.resultWait('p', third.commandId, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await timeout).toMatchObject({ state: 'pending' });
    const capped = service.resultWait('p', third.commandId, 1e9);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await capped).toMatchObject({ state: 'failed' });
    service.dispose();
  });

  it('releases waiters and timers on dispose and bounds concurrent waiters', async () => {
    vi.useFakeTimers();
    const service = new WorkbenchControl();
    const { viewId } = service.register('p', { surface: 'agentforce', commands: ['state'] });
    const { commandId } = service.request('p', { viewId, command: 'state' });
    const waits = Array.from({ length: 101 }, () => service.resultWait('p', commandId, 20_000));
    service.dispose();
    expect((await Promise.allSettled(waits)).length).toBe(101);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wakes waiters when a pruned job disappears', async () => {
    let now = 0; vi.useFakeTimers();
    const service = new WorkbenchControl(() => now);
    const { viewId } = service.register('p', { surface: 'agentforce', commands: ['state'] });
    const { commandId } = service.request('p', { viewId, command: 'state' });
    const wait = service.resultWait('p', commandId, 20_000);
    const settled = expect(wait).rejects.toThrow('not found');
    now = 400_000;
    (service as any).prune();
    await settled;
  });
});
