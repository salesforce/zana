/** @vitest-environment happy-dom */
/** @vitest-environment-options {"settings":{"enableIframePageLoading":true}} */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { actionTabs, AgentActionExplorer, AgentActionPanel, contractRows, sourceDrift } from './AgentActionPanel.js';
import { ActionCodePreview } from './ActionCodePreview.js';
import { ActionFlowMap } from './ActionFlowMap.js';
import { flowModel } from './action-flow.js';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { ACTION_AGENT, ACTION_APEX, ACTION_FLOW_XML, ACTION_FLOW } from '../action-fixtures.js';
import type { PublicOrgView } from '../../lib/types.js';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';
const rpc = vi.fn();
const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
const org = { alias: 'dev', orgId: '1', username: 'u' } as PublicOrgView;
const props = { pluginId: 'salesforce', projectId: 'p', org, action: actions[0], onReveal: vi.fn(), onOpenTarget: vi.fn() };
const ok = (data: Record<string, unknown> = {}) => ({ ok: true, data: { origin: 'project', target: actions[0].target, status: 'ready', label: 'classes/OrderLookup.cls', language: 'apex', content: ACTION_APEX, ...data } });
beforeEach(() => { rpc.mockReset().mockResolvedValue(ok()); props.onReveal.mockClear(); props.onOpenTarget.mockClear(); (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__ = { callRpc: rpc }; });
afterEach(() => { cleanup(); delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__; vi.restoreAllMocks(); });

describe('Agent action explorer', () => {
  it('keeps same-named actions scoped and supports empty and unsupported targets', () => {
    const onOpen = vi.fn(); const view = render(<AgentActionExplorer actions={actions} selected={actions[0].id} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect lookup in subagent.returns' }));
    expect(onOpen).toHaveBeenCalledWith(actions[2]);
    view.rerender(<AgentActionExplorer actions={[]} onOpen={onOpen} />);
    expect(screen.getByText(/Actions declared/)).toBeTruthy();
    view.rerender(<AgentActionExplorer actions={[{ ...actions[0], target: '' }]} onOpen={onOpen} />);
    expect(screen.getByText('Action')).toBeTruthy();
  });
});
describe('action implementation panel', () => {
  it('keeps successful source scan information beside the path instead of above the canvas', async () => {
    const message = 'Opened from the standard source path. The project is too large to rule out another copy elsewhere.';
    rpc.mockResolvedValue(ok({ language: 'xml', content: ACTION_FLOW_XML, label: 'flows/CheckReturn.flow-meta.xml', message }));
    render(<AgentActionPanel {...props} action={actions[1]} />);
    await screen.findByLabelText('Flow implementation map');
    const info = screen.getByLabelText('Source information');
    const disclosure = info.closest('details')!;
    expect(disclosure.closest('.af-action-glance')?.textContent).toContain('flows/CheckReturn.flow-meta.xml');
    expect(disclosure.open).toBe(false);
    fireEvent.click(info);
    expect(disclosure.open).toBe(true);
    expect(disclosure.textContent).toContain(message);
    expect(document.querySelector('.af-action-content')?.textContent).not.toContain(message);
  });
  it('loads project source, checks org parameters, and reveals actual call-site bindings', async () => {
    render(<AgentActionPanel {...props} />);
    await screen.findByText('classes/OrderLookup.cls');
    expect(screen.getByTitle('Action implementation source')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentActions.source', { projectId: 'p', target: 'apex://OrderLookup', origin: 'project' });
    fireEvent.click(screen.getByRole('button', { name: 'Contract' }));
    expect(screen.getAllByText('Unverified')).toHaveLength(2);
    rpc.mockResolvedValue(ok({ origin: 'org', label: 'dev · Deployed Apex', inputs: [{ name: 'orderId', type: 'String', required: true }, { name: 'extra', type: 'Boolean' }], outputs: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Org · dev' }));
    await screen.findByText('Deployed');
    expect(screen.getByText(/Name matched/)).toBeTruthy(); expect(screen.getByText('Missing in target')).toBeTruthy(); expect(screen.getByText('Not declared')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Contract 2 mismatches' })).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentActions.source', expect.objectContaining({ origin: 'org', orgAlias: 'dev' }));
    fireEvent.click(screen.getByRole('button', { name: /^Used by/ }));
    expect(screen.getByText(/set @variables.status = @outputs.status/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Go to action definition/ })); expect(props.onReveal).toHaveBeenCalledWith(actions[0].line);
    fireEvent.click(screen.getByRole('button', { name: /Explicit run/ })); expect(props.onReveal).toHaveBeenCalledWith(actions[0].uses[0].line);
    expect(screen.queryByRole('button', { name: 'Last preview' })).toBeNull();
  });
  it('shows only the tabs a target has content for', async () => {
    const view = render(<AgentActionPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^Used by/ }));
    view.rerender(<AgentActionPanel {...props} action={{ ...actions[0], id: 'dependency:apex://OrderLookup', inputs: [], outputs: [], uses: [] }} />);
    await screen.findByTitle('Action implementation source');
    expect(screen.queryByRole('navigation', { name: 'Action details' })).toBeNull();
    expect(actionTabs({ ...actions[1], id: 'dependency:flow://CheckReturn', inputs: [], outputs: [] }, 'flow').map(([, label]) => label)).toEqual(['Map', 'Source', 'Contract']);
    expect(actionTabs({ ...actions[0], inputs: [], outputs: [] }, 'apex').map(([, label]) => label)).toEqual(['Source', 'Used by']);
    expect(actionTabs({ ...actions[0], target: 'prompt://p', inputs: [], outputs: [] }, undefined).map(([, label]) => label)).toEqual(['Implementation', 'Used by']);
  });
  it('ignores late results from an old org and refreshes the selected snapshot', async () => {
    let release!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(r => { release = r; }));
    const view = render(<AgentActionPanel {...props} initialOrigin="org" />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    view.rerender(<AgentActionPanel {...props} org={{ ...org, alias: 'new', orgId: '2' }} initialOrigin="org" />);
    await screen.findByText('Deployed');
    await act(async () => release(ok({ status: 'missing', message: 'OLD ORG SOURCE' })));
    expect(screen.queryByText('OLD ORG SOURCE')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh implementation' }));
    await waitFor(() => expect(rpc.mock.calls.filter(call => call[2].origin === 'org' && call[2].orgAlias === 'new')).toHaveLength(2));
  });
  it('requires choosing an ambiguous project match and presents source failures without a fake editor', async () => {
    rpc.mockResolvedValueOnce(ok({ status: 'ambiguous', content: undefined, message: 'Choose a package.', candidates: ['one/A.cls', 'two/A.cls'] }));
    render(<AgentActionPanel {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'two/A.cls →' }));
    await screen.findByText('classes/OrderLookup.cls');
    expect(rpc.mock.calls.some(call => call[2].candidate === 'two/A.cls')).toBe(true);
    rpc.mockImplementation((_plugin, _method, args: { origin: string }) =>
      Promise.resolve(args.origin === 'project' ? { ok: false, error: 'Forbidden' } : ok()));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh implementation' }));
    await screen.findByRole('alert'); expect(screen.queryByTitle('Action implementation source')).toBeNull();
    rpc.mockImplementation((_plugin, _method, args: { origin: string }) =>
      args.origin === 'project' ? Promise.reject(new Error('Network down')) : Promise.resolve(ok()));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh implementation' }));
    await screen.findByText('Network down');
    fireEvent.click(screen.getByRole('button', { name: 'Contract' })); expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('renders Flow decisions and fault paths, opens dependencies and can switch to source', async () => {
    rpc.mockResolvedValue(ok({ language: 'xml', content: ACTION_FLOW_XML, label: 'flows/CheckReturn.flow-meta.xml' }));
    render(<AgentActionPanel {...props} action={actions[1]} />);
    await screen.findByLabelText('Flow implementation map');
    expect(screen.getByText('Within 30 days')).toBeTruthy(); expect(screen.getByText('Fault')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Subflow: Create return' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open flow://CreateReturn ↗' }));
    expect(props.onOpenTarget).toHaveBeenCalledWith('flow://CreateReturn', 'project');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Action: Log lookup failure' }), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Open apex://OrderLookup ↗' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close step details' }));
    expect(screen.queryByLabelText('Flow step details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in Flow' })); expect(screen.getByText('120%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out Flow' })); fireEvent.click(screen.getByRole('button', { name: 'Reset Flow zoom' }));
    const viewport = document.querySelector('.af-flow-viewport')!;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ width: 500, height: 350 } as DOMRect);
    fireEvent.click(screen.getByRole('button', { name: 'Fit Flow to view' }));
    expect(screen.queryByText('100%')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true })); expect(screen.getByTitle('Action implementation source')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Map', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Contract' })); expect(screen.getAllByText('Name matched')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /^Used by/ })); expect(screen.getByRole('button', { name: /Available to the model/ })).toBeTruthy();
  });
  it('handles missing source, malformed/empty Flow metadata, unsupported targets and no org', async () => {
    rpc.mockResolvedValueOnce(ok({ status: 'missing', message: 'No source found', content: undefined, contractMessage: 'Describe unavailable' }));
    const view = render(<AgentActionPanel {...props} />);
    await screen.findByText('No source found');
    fireEvent.click(screen.getByRole('button', { name: 'Contract' })); expect(screen.getByText('Describe unavailable')).toBeTruthy();
    view.unmount();
    const missing = render(<AgentActionPanel {...props} org={null} initialOrigin="org" />);
    expect(screen.getByText(/Connect an org/)).toBeTruthy(); missing.unmount();
    const unsupported = render(<AgentActionPanel {...props} action={{ ...actions[2], target: 'prompt://p' }} />);
    expect(screen.getByText(/no implementation viewer/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Used by/ })); expect(screen.getByText(/No direct calls/)).toBeTruthy(); unsupported.unmount();
    rpc.mockResolvedValue(ok({ language: 'xml', content: '<Wrong/>' }));
    const invalid = render(<AgentActionPanel {...props} action={actions[1]} />);
    await screen.findByText('The source is not valid Salesforce Flow XML.');
    rpc.mockResolvedValue(ok({ flow: {}, version: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh implementation' }));
    await screen.findByText(/No drawable steps/);
    fireEvent.click(screen.getByRole('button', { name: 'Contract 2 mismatches' }));
    expect(screen.getAllByText('Missing in target')).toHaveLength(2); invalid.unmount();
    rpc.mockResolvedValue(ok({ flow: { ...ACTION_FLOW, assignments: Array.from({ length: 125 }, (_, i) => ({ name: 'x' + i })) } }));
    render(<AgentActionPanel {...props} action={actions[1]} />); await screen.findByText(/Showing the first 120/);
  });
});
describe('dependency header, drift and contract rail', () => {
  const flowSource = { origin: 'project' as const, target: 'flow://CheckReturn', status: 'ready' as const, label: 'flows/CheckReturn.flow-meta.xml', language: 'xml', content: ACTION_FLOW_XML };
  it('compares sources structurally for Flows and textually for Apex', () => {
    const orgFlow = { ...flowSource, origin: 'org' as const, content: undefined, flow: ACTION_FLOW };
    expect(sourceDrift('flow', flowSource, orgFlow)).toBe('same');
    expect(sourceDrift('flow', flowSource, { ...orgFlow, flow: { ...ACTION_FLOW, assignments: [] } })).toBe('differs');
    expect(sourceDrift('flow', flowSource, { ...orgFlow, flow: undefined, content: '<Wrong/>' })).toBeUndefined();
    expect(sourceDrift('flow', flowSource, { ...orgFlow, status: 'missing' })).toBeUndefined();
    expect(sourceDrift('flow', undefined, orgFlow)).toBeUndefined();
    const apex = { ...flowSource, target: 'apex://A', content: 'class A {}\r\n' };
    expect(sourceDrift('apex', apex, { ...apex, origin: 'org', content: 'class A {}  ' })).toBe('same');
    expect(sourceDrift('apex', apex, { ...apex, origin: 'org', content: 'class B {}' })).toBe('differs');
    expect(sourceDrift('apex', apex, { ...apex, origin: 'org', content: undefined })).toBeUndefined();
  });
  it('classifies contract rows', () => {
    const p = (name: string) => ({ name, type: 'String' });
    expect(contractRows([p('a'), p('b')]).map(row => row.status)).toEqual(['unverified', 'unverified']);
    expect(contractRows([p('a'), p('b')], [p('a'), p('c')]).map(row => [row.name, row.status])).toEqual([['a', 'matched'], ['b', 'missing'], ['c', 'not-declared']]);
  });
  it('links back to the agent, flags org drift and shows what the Flow touches', async () => {
    rpc.mockImplementation((_plugin: string, _method: string, args: { origin: string }) => Promise.resolve(args.origin === 'org'
      ? { ok: true, data: { ...flowSource, origin: 'org', content: undefined, version: 4, flow: { ...ACTION_FLOW, status: 'Active', assignments: [], runInMode: 'SystemModeWithSharing' } } }
      : { ok: true, data: flowSource }));
    const onOpen = vi.fn();
    const action = { ...actions[1], id: 'dependency:flow://CheckReturn' };
    render(<AgentActionPanel {...props} action={action} context={{ label: 'Orders.agent · 2 actions', title: 'a/Orders.agent', onOpen }} />);
    await screen.findByRole('img', { name: 'differs from org' });
    expect(screen.getByRole('button', { name: /^Project/ }).getAttribute('title')).toBe('Project copy differs from the org (v4): elements, connectors or variables changed');
    expect(screen.getByText('Autolaunched')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Used by/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '← Orders.agent · 2 actions' })); expect(onOpen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show contract panel' }));
    const rail = screen.getByRole('complementary', { name: 'Flow contract' });
    expect(rail.textContent).toContain('Order'); expect(rail.textContent).toContain('Nothing');
    fireEvent.click(screen.getByRole('button', { name: 'CreateReturn ↗' }));
    expect(props.onOpenTarget).toHaveBeenCalledWith('flow://CreateReturn', 'project');
    fireEvent.click(screen.getByRole('button', { name: 'Contract' }));
    expect(screen.queryByText('Not declared')).toBeNull();
    expect(screen.getAllByRole('columnheader', { name: 'Project implementation' })).toHaveLength(2);
    expect(screen.getByText(/Open an action in the agent to compare/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Map', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: /^Org · dev/ }));
    await screen.findByText('Active · v4');
    expect(screen.getByRole('complementary', { name: 'Flow contract' }).textContent).toContain('System context with sharing');
    fireEvent.click(screen.getByRole('button', { name: 'Hide contract panel' }));
    expect(screen.queryByRole('complementary', { name: 'Flow contract' })).toBeNull();
  });
  it('reports matching copies and keeps working when the other side fails', async () => {
    rpc.mockImplementation((_plugin: string, _method: string, args: { origin: string }) => args.origin === 'org' ? Promise.resolve({ ok: true, data: { ...flowSource, origin: 'org', content: undefined, flow: ACTION_FLOW } }) : Promise.resolve({ ok: true, data: flowSource }));
    const view = render(<AgentActionPanel {...props} action={actions[1]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Project/ }).getAttribute('title')).toBe('Project copy matches the org'));
    expect(screen.queryByRole('img', { name: 'differs from org' })).toBeNull(); view.unmount();
    rpc.mockImplementation((_plugin: string, _method: string, args: { origin: string }) => Promise.resolve({ ok: true, data: args.origin === 'org' ? { ...flowSource, origin: 'org', inactive: true, version: 5 } : flowSource }));
    const draft = render(<AgentActionPanel {...props} action={actions[1]} initialOrigin="org" />);
    await screen.findByText('Inactive · v5'); draft.unmount();
    rpc.mockImplementation((_plugin: string, _method: string, args: { origin: string }) => args.origin === 'org' ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true, data: flowSource }));
    render(<AgentActionPanel {...props} action={actions[1]} />);
    await screen.findByRole('button', { name: 'Show contract panel' });
    await waitFor(() => expect(rpc.mock.calls.some(call => call[2].origin === 'org')).toBe(true));
    expect(screen.queryByRole('img', { name: 'differs from org' })).toBeNull();
  });
});
describe('read-only source bridge', () => {
  it('renders cyclic Flow connectors and lets keyboard users inspect long-named steps', () => {
    const label = 'A long decision label with useful context';
    const model = flowModel({ assignments: [{ name: 'a', label, connector: { targetReference: 'b' } }, { name: 'b', connector: { targetReference: 'a' }, faultConnector: { targetReference: 'missing' } }] });
    render(<ActionFlowMap model={model} onOpenTarget={props.onOpenTarget} />);
    expect(document.querySelectorAll('.af-flow-edge')).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole('button', { name: `Assignment: ${label}` }), { key: ' ' });
    expect(screen.getByLabelText('Flow step details').textContent).toContain(label);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Assignment: b' }), { key: 'Tab' });
    expect(screen.getByLabelText('Flow step details').textContent).toContain(label);
  });
  it('waits for the actual frame, applies latest content and theme, and locates the invocable method', async () => {
    const view = render(<ActionCodePreview content={ACTION_APEX} language="apex" />);
    const frame = screen.getByTitle('Action implementation source') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const message = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' };
    fireEvent(window, new MessageEvent('message', { origin: location.origin, source: window, data: message })); expect(post).not.toHaveBeenCalled();
    fireEvent(window, new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data: message }));
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'reference', content: ACTION_APEX, language: 'apex', line: 10 });
    view.rerender(<ActionCodePreview content="<Flow/>" language="xml" />);
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ language: 'xml', content: '<Flow/>' });
    await act(async () => { document.documentElement.dataset.theme = 'light'; await new Promise(r => setTimeout(r, 0)); });
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'setTheme', theme: 'light' });
  });
});
