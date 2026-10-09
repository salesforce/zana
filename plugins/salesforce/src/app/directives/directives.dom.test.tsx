/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PluginMessageDirectiveProps } from '@zana-ai/zcc-plugin-sdk/app';
import { registerStudioDirectives } from './index.js';
import { AgentCard } from './AgentCard.js';
import { PreviewCard } from './PreviewCard.js';
import { OperationCard, OPERATION_POLL_MS } from './OperationCard.js';
import { cleanAttr, parseLine, rpcFailure, isNotImplemented } from './card-kit.js';
import { takeQueuedAgentScriptOpen } from '../agent-script-open.js';
import { CONSTITUTION_INSTRUCTIONS } from '../../../lib/constitution.js';

const navigate = { openThreadPanel: vi.fn(() => true), toProject: vi.fn() };
let realtime: ((payload: unknown) => void) | null = null;
const rpc = vi.fn<(plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>>();
const message = { id: 'm1', threadId: 't1', turnId: null, projectId: 'p1' };
const props = (attributes: Record<string, string>): PluginMessageDirectiveProps => ({ pluginId: 'salesforce', attributes, source: '::x', message, openWorkspaceFile: null });
const nodes: Array<() => void> = [];

async function mount(component: (p: PluginMessageDirectiveProps) => unknown, attributes: Record<string, string>) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  nodes.push(() => { root.unmount(); el.remove(); });
  await act(async () => { root.render(createElement(component as never, props(attributes))); });
  return { el, unmount: () => act(() => root.unmount()) };
}
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  navigate.openThreadPanel.mockClear();
  navigate.toProject.mockClear();
  realtime = null;
  rpc.mockReset();
  Object.assign(globalThis, {
    __ZCC_PLUGIN_HOST__: { callRpc: rpc },
    __ZCC_PLUGIN_RUNTIME__: { useZccNavigate: () => navigate, useRealtime: (_c: string, h: (p: unknown) => void) => { realtime = h; } }
  });
});
afterEach(() => {
  for (const unmount of nodes.splice(0)) unmount();
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__;
  delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__;
});

describe('registration and helpers', () => {
  it('registers the three directive slots with matching ids', () => {
    const messageDirective = vi.fn();
    registerStudioDirectives({ slots: { messageDirective } } as never);
    expect(messageDirective.mock.calls.map(call => call[0].id)).toEqual(['sf-agent', 'sf-preview', 'sf-operation']);
  });
  it('parses attributes defensively', () => {
    expect(cleanAttr('  a ')).toBe('a');
    expect(cleanAttr('')).toBeNull();
    expect(cleanAttr(undefined)).toBeNull();
    expect(cleanAttr('x'.repeat(30), 10)).toBeNull();
    expect(parseLine('12')).toBe(12);
    expect(parseLine('0')).toBeNull();
    expect(parseLine('1e3')).toBeNull();
    expect(parseLine(undefined)).toBeNull();
    expect(rpcFailure(null)).toMatchObject({ message: expect.any(String) });
    expect(rpcFailure({ ok: true })).toBeNull();
    expect(rpcFailure({ ok: false })).toEqual({ message: 'Salesforce is unavailable.' });
    expect(isNotImplemented({ ok: false, code: 'not_implemented' })).toBe(true);
  });
  it('documents every card in the constitution', () => {
    for (const name of ['::sf-agent{', '::sf-preview{', '::sf-operation{']) expect(CONSTITUTION_INSTRUCTIONS).toContain(name);
    expect(CONSTITUTION_INSTRUCTIONS).toMatch(/own line/);
  });
});

describe('AgentCard', () => {
  const file = { ok: true, file: { path: 'force-app/Bot.agent', apiName: 'Bot', content: 'a\n  topic main:\nc', sha256: 's' } };
  it('shows file, excerpt and badges, and opens the playground at the line', async () => {
    rpc.mockImplementation(async (_p, method) => method === 'agentFiles.read' ? file
      : method === 'studio.comments.list' ? { ok: true, comments: [{ resolved: undefined }, { resolved: { at: 1 } }] }
        : { ok: true, state: { path: 'force-app/Bot.agent', diagnostics: [{ severity: 'error' }, { severity: 'hint' }] } });
    const { el } = await mount(AgentCard, { path: 'force-app/Bot.agent', line: '2' });
    expect(el.textContent).toContain('Bot');
    expect(el.textContent).toContain('line 2');
    expect(el.textContent).toContain('topic main:');
    expect(el.textContent).toContain('1 comment');
    expect(el.textContent).toContain('1 problem');
    await act(async () => (el.querySelector('.plugin-directive-card-main') as HTMLButtonElement).click());
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: 'playground', title: 'Playground', params: { path: 'force-app/Bot.agent', line: '2' }, threadId: 't1' });
    expect(takeQueuedAgentScriptOpen('p1')).toBe('force-app/Bot.agent');
    await act(async () => (el.querySelector('.plugin-directive-card-open') as HTMLButtonElement).click());
    expect(navigate.toProject).toHaveBeenCalledWith('p1', { tabId: 'salesforce' });
    takeQueuedAgentScriptOpen('p1');
  });
  it('tolerates not_implemented comments and view RPCs', async () => {
    rpc.mockImplementation(async (_p, method) => method === 'agentFiles.read' ? file : { ok: false, code: 'not_implemented', error: 'nope' });
    const { el } = await mount(AgentCard, { path: 'force-app/Bot.agent' });
    expect(el.textContent).toContain('Bot');
    expect(el.textContent).not.toContain('comment');
    await act(async () => (el.querySelector('.plugin-directive-card-main') as HTMLButtonElement).click());
    expect(navigate.openThreadPanel.mock.calls[0]![0]).toMatchObject({ params: { path: 'force-app/Bot.agent' } });
    takeQueuedAgentScriptOpen('p1');
  });
  it('tolerates rejected side RPCs and derives names without apiName', async () => {
    rpc.mockImplementation(async (_p, method) => {
      if (method === 'agentFiles.read') return { ok: true, file: { content: 'x' } };
      throw new Error('boom');
    });
    const { el } = await mount(AgentCard, { path: 'dir/Zed.agent', line: '99' });
    expect(el.textContent).toContain('Zed');
  });
  it('refetches on matching realtime events only', async () => {
    rpc.mockImplementation(async (_p, method) => method === 'agentFiles.read' ? file : { ok: false, code: 'not_implemented' });
    await mount(AgentCard, { path: 'force-app/Bot.agent' });
    const reads = () => rpc.mock.calls.filter(call => call[1] === 'agentFiles.read').length;
    expect(reads()).toBe(1);
    await act(async () => realtime!({ projectId: 'other' }));
    await act(async () => realtime!({ projectId: 'p1', path: 'other.agent' }));
    expect(reads()).toBe(1);
    await act(async () => realtime!({ projectId: 'p1', kind: 'comments' }));
    expect(reads()).toBe(2);
    await act(async () => realtime!(null));
  });
  it('renders error states', async () => {
    const missing = await mount(AgentCard, {});
    expect(missing.el.querySelector('[role=alert]')?.textContent).toContain('path is required');
    rpc.mockResolvedValue({ ok: false, error: 'Not found' });
    const unavailable = await mount(AgentCard, { path: 'x.agent' });
    expect(unavailable.el.querySelector('[role=alert]')?.textContent).toContain('Not found');
    rpc.mockResolvedValue({ ok: true, file: { content: 1 } });
    const bad = await mount(AgentCard, { path: 'y.agent' });
    expect(bad.el.querySelector('[role=alert]')?.textContent).toContain('Agent file not found');
    rpc.mockRejectedValue(new Error('offline'));
    const thrown = await mount(AgentCard, { path: 'z.agent' });
    expect(thrown.el.querySelector('[role=alert]')?.textContent).toContain('offline');
  });
});

describe('PreviewCard', () => {
  it('summarises an available trace and opens the preview panel', async () => {
    rpc.mockResolvedValue({ ok: true, data: { available: true, steps: [{ latencyMs: 10 }, { latencyMs: 5 }, {}] } });
    const { el } = await mount(PreviewCard, { runId: 'run-1', turn: '2' });
    expect(el.textContent).toContain('run-1');
    expect(el.textContent).toContain('turn 2');
    expect(el.textContent).toContain('3 steps');
    expect(el.textContent).toContain('15 ms');
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.trace', expect.objectContaining({ id: 'run-1', turn: 2, projectId: 'p1' }));
    await act(async () => (el.querySelector('button') as HTMLButtonElement).click());
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: 'preview', title: 'Preview', params: { runId: 'run-1', turn: '2' }, threadId: 't1' });
  });
  it('degrades when the trace is unavailable, not implemented, failing or empty', async () => {
    rpc.mockResolvedValue({ ok: true, trace: { available: false, reason: 'Approximation - no runtime trace', steps: [] } });
    expect((await mount(PreviewCard, { runid: 'r' })).el.textContent).toContain('Approximation');
    rpc.mockResolvedValue({ ok: true, data: { available: false, steps: [] } });
    expect((await mount(PreviewCard, { runId: 'r' })).el.textContent).toContain('No trace for this run');
    rpc.mockResolvedValue({ ok: false, code: 'not_implemented' });
    expect((await mount(PreviewCard, { runId: 'r' })).el.textContent).toContain('Run summary unavailable');
    rpc.mockResolvedValue({ ok: false, error: 'Session expired' });
    expect((await mount(PreviewCard, { runId: 'r' })).el.textContent).toContain('Session expired');
    rpc.mockResolvedValue({ ok: true });
    expect((await mount(PreviewCard, { runId: 'r' })).el.textContent).toContain('Run summary unavailable');
    rpc.mockRejectedValue(new Error('x'));
    expect((await mount(PreviewCard, { runId: 'r' })).el.textContent).toContain('Run summary unavailable');
  });
  it('subscribes to studio changes and rejects a missing runId', async () => {
    rpc.mockResolvedValue({ ok: true, data: { available: true, steps: [] } });
    await mount(PreviewCard, { runId: 'r' });
    await act(async () => realtime!({ projectId: 'p1', kind: 'comments' }));
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => realtime!({ projectId: 'p1', kind: 'suites' }));
    expect(rpc).toHaveBeenCalledTimes(2);
    await act(async () => realtime!({ kind: 'suites' }));
    expect(rpc).toHaveBeenCalledTimes(3);
    expect((await mount(PreviewCard, {})).el.querySelector('[role=alert]')?.textContent).toContain('runId is required');
  });
});

describe('OperationCard', () => {
  const op = (state: string) => ({ ok: true, operations: [{ id: 'op1', kind: 'deploy.start', title: 'Deploy Bot', state, org: { alias: 'dev' }, summary: '4 components' }] });
  it('polls every 3s while running, then stops when finished', async () => {
    rpc.mockResolvedValue(op('running'));
    const { el } = await mount(OperationCard, { id: 'op1' });
    expect(el.textContent).toContain('Deploy Bot');
    expect(el.textContent).toContain('Running');
    expect(el.textContent).toContain('dev');
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(OPERATION_POLL_MS); });
    await flush();
    expect(rpc).toHaveBeenCalledTimes(2);
    rpc.mockResolvedValue(op('succeeded'));
    await act(async () => { vi.advanceTimersByTime(OPERATION_POLL_MS); });
    await flush();
    expect(el.textContent).toContain('Succeeded');
    const calls = rpc.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(OPERATION_POLL_MS * 3); });
    expect(rpc).toHaveBeenCalledTimes(calls);
    await act(async () => (el.querySelector('button') as HTMLButtonElement).click());
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: 'sf-operations', title: 'Operations', params: { version: 1, operationId: 'op1', projectId: 'p1' }, threadId: 't1' });
  });
  it('stops polling on unmount', async () => {
    rpc.mockResolvedValue(op('running'));
    const view = await mount(OperationCard, { id: 'op1' });
    await view.unmount();
    const calls = rpc.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(OPERATION_POLL_MS * 2); });
    expect(rpc).toHaveBeenCalledTimes(calls);
  });
  it('renders failed and unavailable states', async () => {
    rpc.mockResolvedValue(op('failed'));
    expect((await mount(OperationCard, { id: 'op1' })).el.textContent).toContain('Failed');
    rpc.mockResolvedValue({ ok: true, operations: [] });
    expect((await mount(OperationCard, { id: 'nope' })).el.querySelector('[role=alert]')?.textContent).toContain('not found');
    rpc.mockResolvedValue({ ok: false, error: 'Offline' });
    expect((await mount(OperationCard, { id: 'op1' })).el.querySelector('[role=alert]')?.textContent).toContain('Offline');
    expect((await mount(OperationCard, {})).el.querySelector('[role=alert]')?.textContent).toContain('id is required');
  });
});
