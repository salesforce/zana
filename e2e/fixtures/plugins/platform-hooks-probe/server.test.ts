import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin from './server.ts';

const PROJECT_ID = 'project-1';
const MARKER_PATH = '.zcc-hooks-probe/tool-marker.json';
const JOURNAL_PATH = '.zcc-hooks-probe/mcp-invocations.jsonl';

function emptyMarkerFile() {
  return { count: 0, history: [] };
}

async function loaded(stubFiles?: Record<string, { content: string; sha256: string | null }>) {
  const { zcc, harness } = createFakePluginHost({ pluginId: 'platform-hooks-probe' });
  const store = new Map<string, { content: string; sha256: string }>(
    Object.entries(stubFiles ?? {}).map(([path, value]) => [path, { content: value.content, sha256: value.sha256 ?? 'sha-0' }])
  );
  let writeCounter = 0;
  harness.sdk.stub('files.readProject', (args: unknown) => {
    const { path } = args as { path: string };
    const row = store.get(path);
    if (!row) throw Object.assign(new Error(`Path does not exist: ${path}`), { code: 'path_not_found' });
    return { content: row.content, sha256: row.sha256 };
  });
  harness.sdk.stub('files.writeProject', (args: unknown) => {
    const { path, content, expectedSha256 } = args as { path: string; content: string; expectedSha256: string | null };
    const current = store.get(path);
    if ((current?.sha256 ?? null) !== (expectedSha256 ?? null)) {
      return { outcome: 'conflict' as const };
    }
    writeCounter += 1;
    const sha256 = `sha-${writeCounter}`;
    store.set(path, { content, sha256 });
    return { outcome: 'written' as const, sha256 };
  });
  await plugin(zcc);
  return { zcc, harness, store };
}

describe('platform-hooks-probe server', () => {
  it('getEnabled/setEnabled round-trip through the project file', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('getEnabled', { projectId: PROJECT_ID })).resolves.toEqual({ enabled: false });

    await expect(harness.callRpc('setEnabled', { projectId: PROJECT_ID, enabled: true })).resolves.toEqual({ enabled: true });
    await expect(harness.callRpc('getEnabled', { projectId: PROJECT_ID })).resolves.toEqual({ enabled: true });
    expect(harness.published.some((entry) => entry.event === 'hooks-probe-availability-changed')).toBe(true);
  });

  it('getEnabled requires a projectId', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('getEnabled', {})).rejects.toThrow('projectId is required');
  });

  it('markerGet starts empty and markerClear resets after writes', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).resolves.toEqual(emptyMarkerFile());

    await harness.callAgentTool('platform_hooks_probe_marker', {}, { projectId: PROJECT_ID, threadId: 'thread-1' });
    const afterOne = await harness.callRpc('markerGet', { projectId: PROJECT_ID });
    expect(afterOne).toMatchObject({ count: 1 });

    await harness.callRpc('markerClear', { projectId: PROJECT_ID });
    await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).resolves.toEqual(emptyMarkerFile());
  });

  it('merges MCP journal entries without losing modern tool writes, then clears at the journal offset', async () => {
    const { harness, store } = await loaded();
    const mcpEntry = (id: string) => JSON.stringify({ source: 'mcp-tool', invocationId: id, at: Date.now() }) + '\n';
    store.set(JOURNAL_PATH, { content: mcpEntry('mcp-1'), sha256: 'sha-j1' });
    await harness.callAgentTool('platform_hooks_probe_marker', {}, { projectId: PROJECT_ID, threadId: 'thread-1' });
    store.set(JOURNAL_PATH, { content: mcpEntry('mcp-1') + mcpEntry('mcp-2'), sha256: 'sha-j2' });
    await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).resolves.toMatchObject({ count: 3 });
    await harness.callRpc('markerClear', { projectId: PROJECT_ID });
    await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).resolves.toEqual(emptyMarkerFile());
    store.set(JOURNAL_PATH, { content: mcpEntry('mcp-1') + mcpEntry('mcp-2') + mcpEntry('mcp-3'), sha256: 'sha-j3' });
    await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).resolves.toMatchObject({
      count: 1, history: [expect.objectContaining({ invocationId: 'mcp-3' })]
    });
  });

  it.each(['markerClear', 'resetProbeState'])('%s retries a conflict and reports failure without publishing when retries exhaust', async (method) => {
    const { harness, store } = await loaded();
    store.set(MARKER_PATH, { content: JSON.stringify({ count: 2, history: [] }), sha256: 'sha-current' });
    const write = vi.fn(() => ({ outcome: 'conflict' as const }));
    harness.sdk.stub('files.writeProject', write);
    await harness.callRpc('setDispatchSelection', { kind: 'reject', message: 'still set' });
    await expect(harness.callRpc(method, { projectId: PROJECT_ID })).rejects.toThrow('tool marker clear did not converge after retries');
    expect(write).toHaveBeenCalledTimes(5);
    expect(harness.published.filter((row) => row.event === 'hooks-probe-tool-marker-changed')).toHaveLength(0);
    expect(store.get(MARKER_PATH)?.content).toContain('"count":2');
    await expect(harness.callRpc('getDispatchSelection', undefined)).resolves.toMatchObject({ kind: 'reject' });
  });

  it('retries a clear against refreshed state before claiming success', async () => {
    const { harness, store } = await loaded();
    store.set(MARKER_PATH, { content: JSON.stringify({ count: 1, history: [] }), sha256: 'sha-first' });
    let calls = 0;
    harness.sdk.stub('files.writeProject', (args: unknown) => {
      const { content, expectedSha256 } = args as { content: string; expectedSha256: string };
      calls++;
      if (calls === 1) {
        store.set(MARKER_PATH, { content: JSON.stringify({ count: 2, history: [] }), sha256: 'sha-second' });
        return { outcome: 'conflict' as const };
      }
      expect(expectedSha256).toBe('sha-second');
      store.set(MARKER_PATH, { content, sha256: 'sha-cleared' });
      return { outcome: 'written' as const, sha256: 'sha-cleared' };
    });
    await expect(harness.callRpc('markerClear', { projectId: PROJECT_ID })).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(harness.published.filter((row) => row.event === 'hooks-probe-tool-marker-changed')).toHaveLength(1);
  });

  it.each(['not json', '{"count":"wrong","history":[]}', '{"count":1,"history":{}}'])(
    'rejects corrupt marker %s rather than resetting count', async (content) => {
      const { harness, store } = await loaded({ [MARKER_PATH]: { content, sha256: 'sha-corrupt' } });
      await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).rejects.toThrow('tool marker is corrupt');
      await expect(harness.callRpc('markerClear', { projectId: PROJECT_ID })).rejects.toThrow('tool marker is corrupt');
      await expect(harness.callAgentTool('platform_hooks_probe_marker', {}, { projectId: PROJECT_ID, threadId: 'thread-1' })).rejects.toThrow('tool marker is corrupt');
      expect(store.get(MARKER_PATH)?.content).toBe(content);
    }
  );

  it('does not mistake a non-missing read failure for an empty marker', async () => {
    const { harness } = await loaded();
    harness.sdk.stub('files.readProject', () => { throw new Error('host offline'); });
    await expect(harness.callRpc('markerClear', { projectId: PROJECT_ID })).rejects.toThrow('host offline');
  });

  it('rejects corrupt MCP journal instead of clearing or hiding its records', async () => {
    const { harness, store } = await loaded({ [JOURNAL_PATH]: { content: '{bad json}\n', sha256: 'sha-bad' } });
    await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).rejects.toThrow('MCP marker journal is corrupt');
    await expect(harness.callRpc('markerClear', { projectId: PROJECT_ID })).rejects.toThrow('MCP marker journal is corrupt');
    expect(store.has(MARKER_PATH)).toBe(false);
  });

  it('records simultaneous calls from separate MCP processes without losing journal lines', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'hooks-probe-mcp-'));
    const transports = Array.from({ length: 2 }, () => new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./mcp-server.js', import.meta.url))],
      cwd
    }));
    const clients = transports.map(() => new Client({ name: 'probe-test', version: '1.0.0' }));
    try {
      await Promise.all(clients.map((client, index) => client.connect(transports[index])));
      const results = await Promise.all(Array.from({ length: 24 }, (_, index) =>
        clients[index % clients.length].callTool({ name: 'platform-hooks-probe', arguments: {} })
      ));
      expect(results.every((result) => !result.isError)).toBe(true);
      const lines = (await readFile(join(cwd, JOURNAL_PATH), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(lines).toHaveLength(24);
      expect(new Set(lines.map((entry) => entry.invocationId)).size).toBe(24);
      expect(lines.every((entry) => entry.source === 'mcp-tool')).toBe(true);
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await rm(cwd, { recursive: true, force: true });
    }
  }, 20_000);

  it('registers the platform_hooks_probe_marker agent tool and records a modern-tool entry', async () => {
    const { harness } = await loaded();
    const result = await harness.callAgentTool('platform_hooks_probe_marker', {}, { projectId: PROJECT_ID, threadId: 'thread-1' }) as {
      ok: boolean;
      marker: { count: number; history: Array<{ source: string }> };
    };
    expect(result.ok).toBe(true);
    expect(result.marker.count).toBe(1);
    expect(result.marker.history[0]?.source).toBe('modern-tool');
    expect(harness.published.some((entry) => entry.event === 'hooks-probe-tool-marker-changed')).toBe(true);
  });

  it('setDispatchSelection/getDispatchSelection round-trip each selection kind', async () => {
    const { harness } = await loaded();
    await harness.callRpc('setDispatchSelection', { kind: 'wait', overrideable: true, reason: 'because' });
    await expect(harness.callRpc('getDispatchSelection', undefined)).resolves.toEqual({
      kind: 'wait',
      overrideable: true,
      reason: 'because'
    });

    await harness.callRpc('setDispatchSelection', { kind: 'reject', message: 'no' });
    await expect(harness.callRpc('getDispatchSelection', undefined)).resolves.toEqual({ kind: 'reject', message: 'no' });

    await harness.callRpc('setDispatchSelection', { kind: 'proceed' });
    await expect(harness.callRpc('getDispatchSelection', undefined)).resolves.toEqual({ kind: 'proceed' });

    await expect(harness.callRpc('setDispatchSelection', { foo: 'bar' })).rejects.toThrow('invalid dispatch selection');
  });

  it('lists observed dispatches and clears them on reset', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'platform-hooks-probe' });
    let admission!: (request: { dispatchId: string; threadId: string; projectId: string; generation: number }) => unknown;
    zcc.hooks.on = ((handler: typeof admission) => { admission = handler; }) as never;
    harness.sdk.stub('files.readProject', () => { throw Object.assign(new Error('Path does not exist: marker'), { code: 'path_not_found' }); });
    harness.sdk.stub('files.writeProject', () => ({ outcome: 'written' as const, sha256: 'sha-1' }));
    await plugin(zcc);
    await harness.callRpc('setDispatchSelection', { kind: 'wait', overrideable: true, reason: 'test wait' });
    await admission({ dispatchId: 'dispatch-1', threadId: 'thread-1', projectId: PROJECT_ID, generation: 1 });
    await expect(harness.callRpc('dispatchEventsList', undefined)).resolves.toEqual([{
      dispatchId: 'dispatch-1', generation: 1, decision: { action: 'wait', overrideable: true, reason: 'test wait' }
    }]);
    for (let index = 2; index <= 23; index++) {
      await admission({ dispatchId: `dispatch-${index}`, threadId: 'thread-1', projectId: PROJECT_ID, generation: index });
    }
    const recent = await harness.callRpc('dispatchEventsList', undefined) as Array<{ dispatchId: string }>;
    expect(recent).toHaveLength(20);
    expect(recent[0]?.dispatchId).toBe('dispatch-4');
    await harness.callRpc('resetProbeState', { projectId: PROJECT_ID });
    await expect(harness.callRpc('dispatchEventsList', undefined)).resolves.toEqual([]);
  });

  it('resetProbeState clears the marker and lifecycle log and restores proceed', async () => {
    const { harness } = await loaded();
    await harness.callAgentTool('platform_hooks_probe_marker', {}, { projectId: PROJECT_ID, threadId: 'thread-1' });
    await harness.callRpc('setDispatchSelection', { kind: 'reject', message: 'no' });
    await harness.callRpc('setToolPolicySelection', { selection: 'deny' });

    await harness.callRpc('resetProbeState', { projectId: PROJECT_ID });

    await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).resolves.toEqual(emptyMarkerFile());
    await expect(harness.callRpc('getDispatchSelection', undefined)).resolves.toEqual({ kind: 'proceed' });
    await expect(harness.callRpc('getToolPolicySelection', undefined)).resolves.toBe('allow');
    await expect(harness.callRpc('lifecycleList', undefined)).resolves.toEqual([]);
  });

  it('interactionUpsert creates a pending interaction scoped to the project and correlationId', async () => {
    const { harness } = await loaded();
    const row = await harness.callRpc('interactionUpsert', { projectId: PROJECT_ID, correlationId: 'c1' }) as { id: string; status: string };
    expect(row.status).toBe('pending');
    await expect(harness.callRpc('interactionGet', { interactionId: row.id })).resolves.toMatchObject({ id: row.id });
  });

  it('interactionUpsert requires both projectId and correlationId', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('interactionUpsert', { projectId: PROJECT_ID })).rejects.toThrow(
      'projectId and correlationId are required'
    );
  });

  it('interactionAcknowledge and interactionCancel require an interactionId and operate on a prior upsert', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('interactionAcknowledge', {})).rejects.toThrow('interactionId is required');
    await expect(harness.callRpc('interactionCancel', {})).rejects.toThrow('interactionId is required');

    const row = await harness.callRpc('interactionUpsert', { projectId: PROJECT_ID, correlationId: 'c2' }) as {
      id: string;
      generation: number;
    };
    await expect(
      harness.callRpc('interactionAcknowledge', { interactionId: row.id, generation: row.generation })
    ).resolves.toMatchObject({ status: 'acknowledged' });

    const row2 = await harness.callRpc('interactionUpsert', { projectId: PROJECT_ID, correlationId: 'c3' }) as {
      id: string;
      generation: number;
    };
    await expect(
      harness.callRpc('interactionCancel', { interactionId: row2.id, generation: row2.generation })
    ).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('requestPendingInteraction requires a threadId and requests input via zcc.ui', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('requestPendingInteraction', {})).rejects.toThrow('threadId is required');

    const pending = harness.callRpc('requestPendingInteraction', { threadId: 'thread-1' });
    harness.submitInteraction({ confirmed: true });
    await expect(pending).resolves.toEqual({ outcome: 'submitted', value: { confirmed: true } });
  });

  it('hostCancelSlowProbe reports cancelled:false for an unknown probeId', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('hostCancelSlowProbe', { probeId: 'does-not-exist' })).resolves.toEqual({ cancelled: false });
  });

  it('cancels an in-flight slow probe before the host responds', async () => {
    const spy = vi.fn((_call: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      _call.signal?.addEventListener('abort', () => reject(new Error('slowProbe cancelled')));
    }));
    const { zcc, harness } = createFakePluginHost({ pluginId: 'platform-hooks-probe', experimental_callHostRpc: spy });
    harness.sdk.stub('system.defaultHost', () => ({ id: 'host-1' }));
    await plugin(zcc);
    const pending = harness.callRpc('hostSlowProbe', { delayMs: 3000, probeId: 'p1' });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    await expect(harness.callRpc('hostCancelSlowProbe', { probeId: 'p1' })).resolves.toEqual({ cancelled: true });
    await expect(pending).resolves.toEqual({ cancelled: true });
  });

  it('does not report genuine host failures as cancellation', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'platform-hooks-probe' });
    harness.sdk.stub('system.defaultHost', () => ({ id: 'host-1' }));
    zcc.host.experimental_client = (() => Promise.resolve({ call: () => Promise.reject(new Error('host unavailable')) })) as never;
    await plugin(zcc);
    await expect(harness.callRpc('hostSlowProbe', { delayMs: 10, probeId: 'p1' })).rejects.toThrow('host unavailable');
    await expect(harness.callRpc('hostCancelSlowProbe', { probeId: 'p1' })).resolves.toEqual({ cancelled: false });
  });

  it('hostSlowProbe requires a probeId and a default host', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('hostSlowProbe', { delayMs: 10 })).rejects.toThrow('probeId is required');
    await expect(harness.callRpc('hostSlowProbe', { delayMs: 10, probeId: 'p1' })).rejects.toThrow(
      'no enrolled host is available for this probe'
    );
  });

  it('hostInspectContext requires a projectId', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('hostInspectContext', {})).rejects.toThrow('projectId is required');
  });

  it('lifecycle events append through zcc.events.on and are listable/clearable', async () => {
    const { harness } = await loaded();
    await harness.emitThreadEvent('thread.created', {
      thread: { id: 'thr-1', projectId: PROJECT_ID, hostId: 'host-1', environmentId: null, providerId: 'claude', status: 'idle', visibility: 'visible' } as never
    });
    const rows = await harness.callRpc('lifecycleList', undefined) as unknown[];
    expect(rows.length).toBe(1);
    await harness.callRpc('lifecycleClear', undefined);
    await expect(harness.callRpc('lifecycleList', undefined)).resolves.toEqual([]);
  });

  it('capabilitiesForThread/-Execution require ids and delegate to zcc.sdk.capabilities', async () => {
    const { harness } = await loaded();
    await expect(harness.callRpc('capabilitiesForThread', {})).rejects.toThrow('threadId is required');
    await expect(harness.callRpc('capabilitiesForThread', { threadId: 'thread-1' })).resolves.toEqual({ capabilities: [] });
    await expect(harness.callRpc('capabilitiesForExecution', {})).rejects.toThrow('executionId is required');
    await expect(harness.callRpc('capabilitiesForExecution', { executionId: 'exec-1' })).resolves.toEqual({ capabilities: [] });
  });

  it('registers project-tab availability that reflects the enabled marker', async () => {
    const { harness } = await loaded();
    const registration = harness.projectTabAvailability.find((row) => row.tabId === 'hooks-probe');
    expect(registration).toBeDefined();

    await expect(registration!.evaluate({ projectId: PROJECT_ID })).resolves.toEqual({
      available: false,
      reason: 'Hooks Probe is not enabled for this project'
    });

    await harness.callRpc('setEnabled', { projectId: PROJECT_ID, enabled: true });
    await expect(registration!.evaluate({ projectId: PROJECT_ID })).resolves.toEqual({ available: true });
  });

  it('recordToolMarker throws after exhausting retries on a persistently conflicting write', async () => {
    const { harness } = await loaded();
    harness.sdk.stub('files.writeProject', () => ({ outcome: 'conflict' as const }));
    await expect(
      harness.callAgentTool('platform_hooks_probe_marker', {}, { projectId: PROJECT_ID, threadId: 'thread-1' })
    ).rejects.toThrow('tool marker write did not converge after retries');
  });

  it('hostInspectContext and hostSlowProbe delegate to zcc.host and support cancellation', async () => {
    const spy = vi.fn(async (call: { method: string }) => {
      if (call.method === 'inspectContext') return { workspaceKind: 'workspace', rootBasename: 'repo', pid: 1 };
      if (call.method === 'slowProbe') return { completed: true, elapsedMs: 10 };
      throw new Error('unexpected method');
    });
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'platform-hooks-probe',
      experimental_callHostRpc: spy
    });
    harness.sdk.stub('files.readProject', () => { throw Object.assign(new Error('Path does not exist: marker'), { code: 'path_not_found' }); });
    harness.sdk.stub('files.writeProject', () => ({ outcome: 'written' as const, sha256: 'sha-1' }));
    harness.sdk.stub('system.defaultHost', () => ({ id: 'host-1' }));
    await plugin(zcc);

    await expect(harness.callRpc('hostInspectContext', { projectId: PROJECT_ID })).resolves.toEqual({
      workspaceKind: 'workspace',
      rootBasename: 'repo',
      pid: 1
    });
    await expect(harness.callRpc('hostSlowProbe', { delayMs: 10, probeId: 'p1' })).resolves.toEqual({ completed: true, elapsedMs: 10 });
  });
});
