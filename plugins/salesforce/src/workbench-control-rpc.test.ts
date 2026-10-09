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
  it('leaves local-only commands alone', () => {
    expect(uiCommandReadsOrg('view.open', { view: 'agentforce' })).toBe(false);
    expect(uiCommandReadsOrg('panel.open', { tool: 'graph' })).toBe(false);
    expect(uiCommandReadsOrg('panel.open', undefined)).toBe(false);
    for (const command of ['state', 'file.open', 'editor.reveal', undefined]) expect(uiCommandReadsOrg(command, {})).toBe(false);
  });
});

describe('registerControlRpc', () => {
  it('registers the control.* RPCs scoped to the current project', () => {
    const handlers = new Map<string, (args: unknown) => any>();
    const control = new WorkbenchControl();
    let project: string | undefined = 'p';
    const contexts = { current: () => project ? { projectId: project, settings: { defaultOrg: 'dev' } } : undefined } as any;
    registerControlRpc({ registerRpc: (name, handler) => { handlers.set(name, handler); }, control, contexts });
    expect([...handlers.keys()]).toEqual(['control.register', 'control.poll', 'control.close', 'control.ack', 'control.views', 'control.command', 'control.result']);
    const { viewId } = handlers.get('control.register')!({ surface: 'agentforce', commands: ['state'] });
    expect(handlers.get('control.views')!({}).views).toHaveLength(1);
    expect(handlers.get('control.poll')!({ viewId, state: {} })).toMatchObject({ ok: true, commands: [] });
    const { commandId } = handlers.get('control.command')!({ viewId, command: 'state' });
    expect(handlers.get('control.result')!({ commandId })).toMatchObject({ ok: true, state: 'pending' });
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
