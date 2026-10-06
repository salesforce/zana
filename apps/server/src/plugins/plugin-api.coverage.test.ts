import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi, type PluginHandle } from './plugin-api.js';

const handles: PluginHandle[] = [];
const dirs: string[] = [];

function makeApi(options?: Parameters<typeof createPluginApi>[2]) {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-api-coverage-'));
  dirs.push(dir);
  const handle = createPluginApi('fixture', dir, options);
  handles.push(handle);
  return handle;
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.dispose()));
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});

describe('plugin host registration contracts', () => {
  it('accepts one admission and tool policy handler, rejects duplicates and invalid handlers', () => {
    const handle = makeApi();
    expect(() => handle.api.hooks.on(null as never)).toThrow('dispatch admission handler must be a function');
    expect(() => handle.api.hooks.onToolPolicy(null as never)).toThrow('tool policy handler must be a function');
    const admission = vi.fn();
    const policy = vi.fn();
    handle.api.hooks.on(admission);
    handle.api.hooks.onToolPolicy(policy);
    expect(handle.dispatchAdmissionHandlers).toEqual([admission]);
    expect(handle.toolPolicyHandlers).toEqual([policy]);
    expect(() => handle.api.hooks.on(vi.fn())).toThrow('only one dispatch admission handler');
    expect(() => handle.api.hooks.onToolPolicy(vi.fn())).toThrow('only one tool policy handler');
  });

  it('keeps project tab registrations scoped and replaces matching tab IDs', () => {
    const handle = makeApi();
    expect(() => handle.api.ui.registerProjectTabAvailability({ tabId: '', evaluate: () => true })).toThrow('requires tabId and evaluate');
    expect(() => handle.api.ui.registerProjectTabAvailability({ tabId: 'tab', evaluate: null } as never)).toThrow('requires tabId and evaluate');
    const first = vi.fn(() => true);
    const second = vi.fn(() => false);
    handle.api.ui.registerProjectTabAvailability({ tabId: 'tab', evaluate: first });
    handle.api.ui.registerProjectTabAvailability({ tabId: 'other', evaluate: first });
    handle.api.ui.registerProjectTabAvailability({ tabId: 'tab', evaluate: second });
    expect(handle.projectTabAvailability).toHaveLength(2);
    expect(handle.projectTabAvailability[0]).toMatchObject({ tabId: 'tab', pluginId: 'fixture', evaluate: second });
  });

  it('passes project-host identity and normalizes empty results', async () => {
    const hostCall = vi.fn(async () => undefined);
    const handle = makeApi({ hostCall });
    await expect(handle.api.host.projectCall({ projectId: '  ', method: 'read' })).rejects.toThrow('invalid project host call');
    await expect(handle.api.host.projectCall({ projectId: 'project', method: ' ' })).rejects.toThrow('invalid project host call');
    await expect(handle.api.host.projectCall({ projectId: 'project', method: 'read', input: { x: 1 }, hostId: 'host' })).resolves.toEqual({ result: null });
    expect(hostCall).toHaveBeenCalledWith('read', { x: 1 }, 'host', undefined, undefined, 'project');
    await expect(makeApi().api.host.projectCall({ projectId: 'project', method: 'read' })).rejects.toThrow('invalid project host call');
  });

  it('derives capability availability from host wiring rather than caller identity', async () => {
    const handle = makeApi();
    await expect(handle.api.sdk.capabilities.forThread({ threadId: ' ' })).rejects.toThrow('threadId is required');
    await expect(handle.api.sdk.capabilities.forExecution({ executionId: '' })).rejects.toThrow('executionId is required');
    const { capabilities } = await handle.api.sdk.capabilities.forThread({ threadId: 'unknown' });
    expect(capabilities).toContainEqual({ id: 'tool-before-native', available: false, reason: 'no thread resolved' });
    expect(capabilities).toContainEqual({ id: 'project-rpc', available: false });
    expect(capabilities).toContainEqual({ id: 'interactions', available: false });
    expect((await handle.api.sdk.capabilities.forExecution({ executionId: 'exec' })).capabilities).toEqual(capabilities);
  });

  it('validates durable interactions before calling server-owned backends', async () => {
    const getInteraction = vi.fn(async () => null);
    const upsertInteraction = vi.fn(async () => ({ id: 'i1' }));
    const acknowledgeInteraction = vi.fn(async () => ({ id: 'i1', status: 'acknowledged' }));
    const cancelInteraction = vi.fn(async () => ({ id: 'i1', status: 'cancelled' }));
    const handle = makeApi({ getInteraction, upsertInteraction, acknowledgeInteraction, cancelInteraction } as never);
    const ui = handle.api.ui.interactions;
    await expect(ui.get(' ')).rejects.toThrow('requires interactionId');
    await expect(ui.upsert({ projectId: '', correlationId: 'c', kind: 'prompt', payload: {} })).rejects.toThrow('requires projectId');
    await expect(ui.upsert({ projectId: 'p', correlationId: '', kind: 'prompt', payload: {} })).rejects.toThrow('requires correlationId');
    await expect(ui.upsert({ projectId: 'p', correlationId: 'c', kind: '', payload: {} })).rejects.toThrow('requires kind');
    await expect(ui.acknowledge({ interactionId: '', generation: 1 })).rejects.toThrow('requires interactionId');
    await expect(ui.cancel({ interactionId: '', generation: 1 })).rejects.toThrow('requires interactionId');
    await ui.get('i1');
    await ui.upsert({ projectId: 'p', correlationId: 'c', kind: 'prompt', payload: {} });
    await ui.acknowledge({ interactionId: 'i1', generation: 1 });
    await ui.cancel({ interactionId: 'i1', generation: 1 });
    expect(getInteraction).toHaveBeenCalledWith({ pluginId: 'fixture', interactionId: 'i1' });
    expect(upsertInteraction).toHaveBeenCalledWith({ pluginId: 'fixture', projectId: 'p', correlationId: 'c', kind: 'prompt', payload: {} });
    expect(acknowledgeInteraction).toHaveBeenCalledWith({ pluginId: 'fixture', interactionId: 'i1', generation: 1 });
    expect(cancelInteraction).toHaveBeenCalledWith({ pluginId: 'fixture', interactionId: 'i1', generation: 1 });
  });
});
