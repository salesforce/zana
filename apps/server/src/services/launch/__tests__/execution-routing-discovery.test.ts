import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Persona } from '@zana-ai/zcc-domain/product';
import { OpenCodeProvider } from '@zana-ai/zcc-host-daemon/harness/opencode/provider';
import {
  clearLiveModelTargets,
  launchScopedProvider,
  liveModelTargetsFor,
  recordLiveModelTargets
} from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { resolveModelTarget } from '@zana-ai/zcc-host-daemon/harness/target-resolution';
import { preflightTerminalExecution } from '../execution-routing.js';

/**
 * OC1 regression: the OpenCode provider is a process-wide singleton. Live model
 * inventories used to be applied onto it (and cleared) around awaits, so
 * interleaved launches for different projects — or one whose probe failed —
 * resolved portable levels through another project's inventory, and the spawn
 * re-mapped from whatever the singleton held last. These launches interleave on
 * ONE shared provider instance and assert each project resolves (and spawns)
 * through its own inventory only.
 */

const CONFIG = { version: 1, theme: 'dark', harnessOpenCodeEnabled: true } as AppConfig;
const LOW: Persona = { id: 'low', name: 'Low', modelLevel: 'low' };
const SNAPSHOT_LOW = 'llmgw/gpt-6-luna';
const A_INVENTORY = ['llmgw/gpt-7-luna', 'llmgw/gpt-7-terra', 'llmgw/gpt-7-sol'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deps(provider: OpenCodeProvider) {
  return {
    consentStore: { reserve: vi.fn(async () => ({ outcome: 'denied' as const })) },
    installedVersion: vi.fn(async () => '1.18.10'),
    provider
  };
}

function launch(provider: OpenCodeProvider, projectId: string, projectPath: string, persona: Persona = LOW) {
  return preflightTerminalExecution({
    config: CONFIG, profile: 'opencode', persona, projectId, projectPath,
    scope: 'local', mode: 'interactive', idempotencyKey: `${projectId}-${Math.random()}`
  }, deps(provider));
}

/** The model a spawn in `cwd` resolves — exactly what PtyManager.create() does. */
function spawnModel(provider: OpenCodeProvider, cwd: string, persona: Persona = LOW) {
  return resolveModelTarget(launchScopedProvider(provider, cwd), {
    config: CONFIG, persona, profile: 'opencode', extraArgs: [], scope: 'local'
  }).targetId;
}

describe('execution routing live-model discovery is launch-scoped (OC1)', () => {
  afterEach(() => clearLiveModelTargets());

  it('interleaved launches across two projects with one failing probe never cross-contaminate', async () => {
    const shared = new OpenCodeProvider();
    const snapshot = shared.adapter;
    const probeA = deferred<readonly string[] | undefined>();
    const probeB = deferred<readonly string[] | undefined>();
    shared.discoverModelTargets = vi.fn(({ cwd }: { cwd: string }) => (cwd === '/proj/a' ? probeA.promise : probeB.promise));

    // A starts and parks on its probe; B starts, its probe FAILS (unavailable),
    // and B completes while A is still in flight; then A's probe lands.
    const a = launch(shared, 'a', '/proj/a');
    const b = launch(shared, 'b', '/proj/b');
    await flush();
    probeB.resolve(undefined);
    await expect(b).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(shared.adapter).toBe(snapshot);
    probeA.resolve(A_INVENTORY);
    // A was validated against ITS inventory: had it re-mapped through the
    // snapshot (B's fallback), `gpt-6-luna` would be absent from A's live set.
    await expect(a).resolves.toEqual({ decision: 'allowed', scope: 'local' });

    expect(shared.adapter).toBe(snapshot);
    expect(shared.discoverModelTargets).toHaveBeenCalledTimes(2);
    expect(spawnModel(shared, '/proj/a')).toBe('llmgw/gpt-7-luna');
    expect(spawnModel(shared, '/proj/b')).toBe(SNAPSHOT_LOW);

    // A later launch of B whose probe fails again leaves A's record untouched.
    shared.discoverModelTargets = vi.fn(async ({ cwd }: { cwd: string }) => (cwd === '/proj/a' ? A_INVENTORY : undefined));
    await expect(launch(shared, 'b', '/proj/b')).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(spawnModel(shared, '/proj/a')).toBe('llmgw/gpt-7-luna');
    expect(liveModelTargetsFor('opencode', '/proj/b')).toBeUndefined();
  });

  it('a project whose inventory lacks the tier is blocked without affecting a concurrent project', async () => {
    const shared = new OpenCodeProvider();
    const probeA = deferred<readonly string[] | undefined>();
    shared.discoverModelTargets = vi.fn(({ cwd }: { cwd: string }) => (
      cwd === '/proj/a' ? probeA.promise : Promise.resolve(['llmgw/grok-4.6'])
    ));
    const a = launch(shared, 'a', '/proj/a');
    await expect(launch(shared, 'c', '/proj/c')).resolves.toEqual({
      decision: 'blocked', reason: 'OpenCode does not support low model level.'
    });
    probeA.resolve(A_INVENTORY);
    await expect(a).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(spawnModel(shared, '/proj/a')).toBe('llmgw/gpt-7-luna');
  });

  it('a stale record from an earlier launch is replaced, not merged, when the probe becomes unavailable', async () => {
    const shared = new OpenCodeProvider();
    recordLiveModelTargets('opencode', '/proj/a', A_INVENTORY);
    shared.discoverModelTargets = vi.fn(async () => undefined);
    await expect(launch(shared, 'a', '/proj/a')).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(spawnModel(shared, '/proj/a')).toBe(SNAPSHOT_LOW);
  });

  it('a rejected probe blocks only its own launch and records nothing for it', async () => {
    const shared = new OpenCodeProvider();
    const probeA = deferred<readonly string[] | undefined>();
    shared.discoverModelTargets = vi.fn(({ cwd }: { cwd: string }) => (
      cwd === '/proj/a' ? probeA.promise : Promise.reject(new Error('gateway offline'))
    ));
    const a = launch(shared, 'a', '/proj/a');
    await expect(launch(shared, 'b', '/proj/b')).resolves.toEqual({ decision: 'blocked', reason: 'gateway offline' });
    probeA.resolve(A_INVENTORY);
    await expect(a).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(liveModelTargetsFor('opencode', '/proj/b')).toBeUndefined();
    expect(spawnModel(shared, '/proj/a')).toBe('llmgw/gpt-7-luna');
  });

  it('probes once per launch and records machine-supplied discovery for the spawn', async () => {
    const shared = new OpenCodeProvider();
    shared.discoverModelTargets = vi.fn(async () => { throw new Error('wrong machine'); });
    const discovery = { roles: vi.fn(async () => []), models: vi.fn(async () => A_INVENTORY) };
    await expect(preflightTerminalExecution({
      config: CONFIG, profile: 'opencode', persona: LOW, projectId: 'r', projectPath: '/proj/remote',
      scope: 'remote', mode: 'interactive', idempotencyKey: 'remote-level'
    }, { ...deps(shared), discovery })).resolves.toEqual({ decision: 'allowed', scope: 'remote' });
    // Level resolution and model validation share one probe.
    expect(discovery.models).toHaveBeenCalledTimes(1);
    expect(shared.discoverModelTargets).not.toHaveBeenCalled();
    expect(liveModelTargetsFor('opencode', '/proj/remote')).toEqual(A_INVENTORY);
  });

  it('an explicit model id validates through the same single probe', async () => {
    const shared = new OpenCodeProvider();
    shared.discoverModelTargets = vi.fn(async () => A_INVENTORY);
    const pinned = { schemaVersion: 1 as const, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-7-sol' } } };
    await expect(preflightTerminalExecution({
      config: CONFIG, profile: 'opencode', projectId: 'a', projectPath: '/proj/a', scope: 'local',
      mode: 'interactive', idempotencyKey: 'pinned', harnessRouting: pinned
    }, deps(shared))).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(shared.discoverModelTargets).toHaveBeenCalledTimes(1);
  });

  it('launches without a project path never probe', async () => {
    const shared = new OpenCodeProvider();
    shared.discoverModelTargets = vi.fn(async () => A_INVENTORY);
    await expect(preflightTerminalExecution({
      config: CONFIG, profile: 'opencode', persona: LOW, projectId: 'a', scope: 'local',
      mode: 'interactive', idempotencyKey: 'no-path'
    }, deps(shared))).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(shared.discoverModelTargets).not.toHaveBeenCalled();
  });
});
