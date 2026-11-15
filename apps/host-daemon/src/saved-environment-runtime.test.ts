import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION, type HostBridgeLaunch } from '@zana-ai/zcc-contracts/host-rpc';
import { createAgentRuntimeWithAdapters, createFakeAdapter, fakeProviderScriptPath } from '@zana-ai/zcc-agent-runtime/test';
import { createAgentRuntimeAdapter } from './agent-runtime-adapter.js';
import { createCommandRuntime } from './command-dispatch.js';
import { handleHostRpcRequest } from './command-router.js';
import { SavedMachineEnvironment } from './saved-machine-environment.js';
import { MachineEnvironment } from './machine-environment.js';

it('uses a new bridge generation for new threads and retains existing conversations after key changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-env-runtime-'));
  let revision: string | undefined;
  const launches: any[] = [];
  const events: any[] = [];
  const adapter = createAgentRuntimeAdapter({ dataDir: root, getEnvironmentRevision: () => revision, emit: event => events.push(event),
    createRuntime: options => createAgentRuntimeWithAdapters({ ...options, adapterFactory: (_id, context) => {
      launches.push(context.bridgeLaunch); return createFakeAdapter({ scriptPath: fakeProviderScriptPath });
    } }),
  });
  const bridgeLaunch: HostBridgeLaunch = { pluginId: 'provider-fixture', source: { kind: 'daemon-bundled', id: 'fake' }, capabilities: { supportsServiceTier: false, permissionModes: ['full'], supportsThreadArchive: false, supportsThreadRename: false, fork: 'checkpoint' } };
  const start = (threadId: string) => adapter.startWork({ threadId, projectId: 'p', environmentId: 'e', cwd: root, providerId: 'fake', input: [], bridgeLaunch });
  try {
    await start('first'); await start('shared'); expect(launches).toHaveLength(1); expect(launches[0]).not.toHaveProperty('environmentRevision');
    revision = 'saved-revision'; await start('second'); expect(launches).toHaveLength(2); expect(launches[1].environmentRevision).toBe(revision);
    await adapter.submitTurn({ threadId: 'first', input: [{ type: 'text', text: 'original conversation still works', mentions: [] }], clientRequestId: 'creq_2222222272' });
    expect(launches).toHaveLength(2);
    await adapter.stopWork({ threadId: 'first' }); await adapter.stopWork({ threadId: 'shared' }); await adapter.stopWork({ threadId: 'second' });
  } finally { await adapter.dispose(); rmSync(root, { recursive: true, force: true }); }
});

it('routes saved settings through validated host RPC and redacts success and error responses', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-env-rpc-'));
  const target: NodeJS.ProcessEnv = {};
  const savedEnvironment = new SavedMachineEnvironment(root, target);
  await savedEnvironment.initialize();
  const runtime = createCommandRuntime({ dataDir: root, savedEnvironment, machineEnvironment: new MachineEnvironment(target) });
  const call = (command: unknown) => handleHostRpcRequest(runtime, { type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'one', command });
  try {
    const read = await call({ type: 'host.environment.settings' }); expect(read.ok).toBe(true);
    const saved = await call({ type: 'host.environment.save', name: 'EXAMPLE_API_KEY', value: 'fake-private-key', expectedRevision: savedEnvironment.status().revision });
    expect(saved.ok).toBe(true); expect(JSON.stringify(saved)).not.toContain('fake-private-key');
    expect((await call({ type: 'host.environment.replace', entries: [{ name: 'EXAMPLE_API_KEY', value: 'gateway-key' }] })).ok).toBe(true);
    expect(target.EXAMPLE_API_KEY).toBe('gateway-key');
    expect(savedEnvironment.status().variables[0]?.overriddenByEnvironment).toBe(true);
    expect((await call({ type: 'host.environment.save', name: 'EXAMPLE_API_KEY', value: null, expectedRevision: 'old' })).ok).toBe(false);
    expect((await call({ type: 'host.environment.save', name: 'PATH', value: 'fake-private-key', expectedRevision: 'old' })).ok).toBe(false);
    delete runtime.savedEnvironment;
    expect((await call({ type: 'host.environment.settings' })).ok).toBe(false);
    expect((await call({ type: 'host.environment.save', name: 'KEY', value: 'x', expectedRevision: 'old' })).ok).toBe(false);
  } finally { await savedEnvironment.clear(); rmSync(root, { recursive: true, force: true }); }
});
