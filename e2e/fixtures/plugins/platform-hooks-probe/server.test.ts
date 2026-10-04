import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin from './server.ts';

const PROJECT_ID = 'project-1';

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
    if (!row) throw new Error('not found');
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

  it('resetProbeState clears the marker and lifecycle log and restores proceed', async () => {
    const { harness } = await loaded();
    await harness.callAgentTool('platform_hooks_probe_marker', {}, { projectId: PROJECT_ID, threadId: 'thread-1' });
    await harness.callRpc('setDispatchSelection', { kind: 'reject', message: 'no' });

    await harness.callRpc('resetProbeState', { projectId: PROJECT_ID });

    await expect(harness.callRpc('markerGet', { projectId: PROJECT_ID })).resolves.toEqual(emptyMarkerFile());
    await expect(harness.callRpc('getDispatchSelection', undefined)).resolves.toEqual({ kind: 'proceed' });
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
    harness.sdk.stub('files.readProject', () => { throw new Error('not found'); });
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
