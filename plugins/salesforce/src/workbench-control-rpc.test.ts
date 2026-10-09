import { describe, expect, it, vi } from 'vitest';
import { WorkbenchControl } from '../lib/workbench-control.js';
import { registerControlRpc, uiCommandReadsOrg } from '../lib/workbench-control-rpc.js';

describe('uiCommandReadsOrg', () => {
  it('flags commands that read the org', () => {
    for (const command of ['object.select', 'record.open', 'log.open']) expect(uiCommandReadsOrg(command, {})).toBe(true);
    expect(uiCommandReadsOrg('view.open', { view: 'soql' })).toBe(true);
    expect(uiCommandReadsOrg('view.open', undefined)).toBe(true);
    expect(uiCommandReadsOrg('panel.open', { tool: 'agents' })).toBe(true);
    expect(uiCommandReadsOrg('panel.open', { tool: 'org-preview' })).toBe(true);
  });
  it('treats preview.start/send as org reads unless the engine is rehearse', () => {
    for (const command of ['preview.start', 'preview.send']) {
      expect(uiCommandReadsOrg(command, { engine: 'simulate' })).toBe(true);
      expect(uiCommandReadsOrg(command, { engine: 'live' })).toBe(true);
      expect(uiCommandReadsOrg(command, undefined)).toBe(true);
      expect(uiCommandReadsOrg(command, { engine: 'rehearse' })).toBe(false);
    }
    for (const command of ['editor.proposeEdit', 'trace.focus', 'graph.focus', 'layout.set']) expect(uiCommandReadsOrg(command, {})).toBe(false);
  });
  it('leaves local-only commands alone', () => {
    expect(uiCommandReadsOrg('view.open', { view: 'agentforce' })).toBe(false);
    expect(uiCommandReadsOrg('panel.open', { tool: 'graph' })).toBe(false);
    expect(uiCommandReadsOrg('panel.open', undefined)).toBe(false);
    for (const command of ['state', 'file.open', 'editor.reveal', undefined]) expect(uiCommandReadsOrg(command, {})).toBe(false);
  });
});

describe('registerControlRpc', () => {
  it('registers the control.* RPCs scoped to the current project', async () => {
    const handlers = new Map<string, (args: unknown) => any>();
    const control = new WorkbenchControl();
    let project: string | undefined = 'p';
    const contexts = { current: () => project ? { projectId: project, settings: { defaultOrg: 'dev' } } : undefined } as any;
    registerControlRpc({ registerRpc: (name, handler) => { handlers.set(name, handler); }, control, contexts });
    expect([...handlers.keys()]).toEqual(['control.register', 'control.poll', 'control.close', 'control.ack', 'control.views', 'control.command', 'control.outcome', 'control.result']);
    const { viewId } = handlers.get('control.register')!({ surface: 'agentforce', commands: ['state'] });
    expect(handlers.get('control.views')!({}).views).toHaveLength(1);
    expect(handlers.get('control.poll')!({ viewId, state: {} })).toMatchObject({ ok: true, commands: [] });
    const { commandId } = handlers.get('control.command')!({ viewId, command: 'state' });
    expect(await handlers.get('control.result')!({ commandId })).toMatchObject({ ok: true, state: 'pending' });
    const polled = handlers.get('control.poll')!({ viewId, state: {} });
    expect(polled.commands).toHaveLength(1);
    expect(handlers.get('control.ack')!({ viewId, commandId, ok: true, state: {} })).toMatchObject({ ok: true });
    expect(handlers.get('control.close')!({ viewId })).toEqual({ ok: true });
    project = undefined;
    expect(handlers.get('control.views')!({})).toEqual({ ok: true, views: [] });
    control.dispose();
    vi.restoreAllMocks();
  });
});

describe('registerControlRpc realtime wake and human-paced results', () => {
  function setup() {
    const handlers = new Map<string, (args: unknown) => any>();
    const control = new WorkbenchControl();
    const publish = vi.fn();
    const contexts = { current: () => ({ projectId: 'p', settings: { defaultOrg: '' } }) } as any;
    registerControlRpc({ registerRpc: (name, handler) => { handlers.set(name, handler); }, control, contexts, zcc: { realtime: { publish } } as any });
    return { handlers, control, publish };
  }
  it('publishes only the viewId on UI_WAKE_CHANNEL when a command is queued', () => {
    const { handlers, publish, control } = setup();
    const { viewId } = handlers.get('control.register')!({ surface: 'agentforce', commands: ['layout.set'] });
    handlers.get('control.command')!({ viewId, command: 'layout.set', input: { compact: true } });
    expect(publish).toHaveBeenCalledWith('sf.ui.wake', { viewId });
    control.dispose();
  });
  it('completes a proposal through control.outcome and long-polls control.result', async () => {
    const { handlers, control } = setup();
    const { viewId } = handlers.get('control.register')!({ surface: 'agentforce', commands: ['editor.proposeEdit'] });
    const input = { path: 'a.agent', expectedSha256: 'a'.repeat(64), content: 'x', summary: 's' };
    const { commandId } = handlers.get('control.command')!({ viewId, command: 'editor.proposeEdit', input });
    handlers.get('control.poll')!({ viewId, state: {} });
    handlers.get('control.ack')!({ viewId, commandId, ok: true, pending: 'user', proposalId: 'pp', state: {} });
    const waiting = handlers.get('control.result')!({ commandId, waitMs: 20_000 });
    handlers.get('control.outcome')!({ viewId, commandId, outcome: { outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0 } });
    expect(await waiting).toMatchObject({ ok: true, state: 'completed', outcome: { outcome: 'accepted' } });
    control.dispose();
  });
});
