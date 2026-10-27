import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Persona, ProjectRemote } from '@zana-ai/zcc-domain/product';

const spawns: Array<{ command: string; args: string[] }> = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[]) => {
    spawns.push({ command, args });
    return { pid: 4000, write() {}, onData() {}, onExit() {}, resize() {}, kill() {} };
  }
}));
vi.mock('@zana-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProjectSync: () => '/tmp/proj1/.mcp.json',
  alwaysOnPluginMcpAllowlist: () => []
}));
vi.mock('@zana-ai/zcc-host-daemon/tmux', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTmuxAvailable: () => false
}));

import { OpenCodeProvider } from '@zana-ai/zcc-host-daemon/harness/opencode/provider';
import type { TrustedHarnessAdapter } from '@zana-ai/zcc-host-daemon/harness/adapter-contract';
import { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import { preflightTerminalExecution } from '../execution-routing.js';
import { finalizeLaunchPreflight, preflightLaunch, type ExecutionPreflightDecision } from '../preflight.js';

/**
 * OC1 regression: the OpenCode provider is a process-wide singleton, and squad
 * slots share ONE worktree cwd (and two enrolled machines can share a checkout
 * path). A synthetic trusted adapter explicitly declares its portable tier
 * mapping for each fixture inventory; real OpenCode inventories declare none.
 * Each launch's resolved id rides in the decision (`modelPin`), is bound
 * into the authorized digest, and the spawn uses it verbatim — no keyed record a
 * sibling launch could overwrite, no re-mapping, no re-probe at spawn.
 */

const CONFIG = { version: 1, theme: 'dark', harnessOpenCodeEnabled: true } as AppConfig;
const LOW: Persona = { id: 'low', name: 'Low', modelLevel: 'low' };
const SNAPSHOT_LOW = 'fixture-provider/gpt-6-luna';
const A_INVENTORY = ['fixture-provider/gpt-7-luna', 'fixture-provider/gpt-7-terra', 'fixture-provider/gpt-7-sol'];
const B_INVENTORY = ['fixture-provider/gpt-8-luna', 'fixture-provider/gpt-8-sol'];
const SHARED_CWD = '/zcc-worktrees/squad-1';

const pin = (targetId: string) => ({ adapterId: 'opencode', level: 'low', targetId });

/** Exercise generic tier authorization with explicit test-owned capability data. */
function tieredFixtureProvider() {
  const provider = new OpenCodeProvider();
  const withLow = (adapter: TrustedHarnessAdapter, targetId: string | undefined): TrustedHarnessAdapter => ({
    ...adapter, descriptor: { ...adapter.descriptor, targets: {
      ...adapter.descriptor.targets!, modelLevelMapping: {
        low: targetId, medium: undefined, high: undefined, 'extra-high': undefined
      }
    } }
  });
  const snapshot = withLow(provider.adapter, SNAPSHOT_LOW);
  Object.defineProperty(provider, 'adapter', { value: snapshot });
  const liveAdapter = provider.liveModelAdapter.bind(provider);
  vi.spyOn(provider, 'liveModelAdapter').mockImplementation(ids => withLow(liveAdapter(ids),
    [A_INVENTORY[0], B_INVENTORY[0]].find(id => ids.includes(id))));
  return provider;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
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

function allowed(decision: ExecutionPreflightDecision) {
  if (decision.decision !== 'allowed') throw new Error(`blocked: ${decision.reason}`);
  return decision;
}

/** Spawn exactly as host.ts does: the authorized plan's pin, verbatim. */
function spawnArgs(decision: ExecutionPreflightDecision, cwd = SHARED_CWD, remote?: ProjectRemote): string {
  new PtyManager().create({
    projectId: 'p', profile: 'opencode', persona: LOW, cwd, cols: 80, rows: 24, config: CONFIG,
    authorizedModel: allowed(decision).modelPin,
    ...(remote ? { remote } : {})
  });
  return spawns.at(-1)!.args.join(' ');
}

describe('execution routing pins the resolved model id per launch (OC1)', () => {
  beforeEach(() => { spawns.length = 0; });

  it('two slots sharing one cwd with different probe results never cross-contaminate', async () => {
    const shared = tieredFixtureProvider();
    const snapshot = shared.adapter;
    const probes = [deferred<readonly string[] | undefined>(), deferred<readonly string[] | undefined>()];
    let call = 0;
    shared.discoverModelTargets = vi.fn(() => probes[call++].promise);

    // Slot A parks on its probe; slot B (same cwd) probes a different gateway
    // inventory and completes first; then A's probe lands.
    const a = launch(shared, 'squad', SHARED_CWD);
    const b = launch(shared, 'squad', SHARED_CWD);
    await flush();
    probes[1].resolve(B_INVENTORY);
    const bDecision = await b;
    probes[0].resolve(A_INVENTORY);
    const aDecision = await a;

    expect(aDecision).toEqual({ decision: 'allowed', scope: 'local', modelPin: pin('fixture-provider/gpt-7-luna') });
    expect(bDecision).toEqual({ decision: 'allowed', scope: 'local', modelPin: pin('fixture-provider/gpt-8-luna') });
    expect(shared.adapter).toBe(snapshot);

    // Each spawn's argv carries ITS OWN resolved id, in either spawn order.
    expect(spawnArgs(bDecision)).toContain('--model fixture-provider/gpt-8-luna');
    expect(spawnArgs(aDecision)).toContain('--model fixture-provider/gpt-7-luna');
    expect(spawnArgs(aDecision)).not.toContain('gpt-8');
    // Spawns never probe.
    expect(shared.discoverModelTargets).toHaveBeenCalledTimes(2);
  });

  it('a sibling slot whose probe fails cannot change the id an earlier slot authorized', async () => {
    const shared = tieredFixtureProvider();
    shared.discoverModelTargets = vi.fn(async () => A_INVENTORY);
    const aDecision = await launch(shared, 'squad', SHARED_CWD);
    // B: same cwd, probe unavailable ⇒ snapshot mapping for B only.
    shared.discoverModelTargets = vi.fn(async () => undefined);
    const bDecision = await launch(shared, 'squad', SHARED_CWD);
    expect(allowed(bDecision).modelPin).toEqual(pin(SNAPSHOT_LOW));
    // A spawns after B's failed probe: still A's live-resolved id (the old
    // per-cwd record was deleted here and A re-mapped to the snapshot id).
    expect(spawnArgs(aDecision)).toContain('--model fixture-provider/gpt-7-luna');
    expect(spawnArgs(bDecision)).toContain(`--model ${SNAPSHOT_LOW}`);
  });

  it('binds the pin into the authorized launch digest', async () => {
    const shared = tieredFixtureProvider();
    shared.discoverModelTargets = vi.fn(async () => A_INVENTORY);
    const plan = preflightLaunch({ projectId: 'p' }, {
      principal: () => ({ kind: 'interactive-user', id: 'interactive:local' }),
      sessionId: () => 'session-1',
      idempotencyKey: () => 'idem-1',
      resolve: () => ({ project: { id: 'p' }, storeRevision: 'rev' }),
      now: () => 1
    });
    const decision = allowed(await launch(shared, 'p', SHARED_CWD));
    const authorized = finalizeLaunchPreflight(plan, decision);
    const swapped = finalizeLaunchPreflight(plan, { ...decision, modelPin: pin('fixture-provider/gpt-8-luna') });
    const unpinned = finalizeLaunchPreflight(plan, { decision: 'allowed', scope: 'local' });
    expect(authorized.digest).not.toBe(swapped.digest);
    expect(authorized.digest).not.toBe(unpinned.digest);
    expect(authorized.executionAuthorization.modelPin).toEqual(pin('fixture-provider/gpt-7-luna'));
    expect(Object.isFrozen(authorized.executionAuthorization.modelPin)).toBe(true);
  });

  it('a project whose inventory lacks the tier is blocked without affecting a concurrent launch', async () => {
    const shared = tieredFixtureProvider();
    const probeA = deferred<readonly string[] | undefined>();
    shared.discoverModelTargets = vi.fn(({ cwd }: { cwd: string }) => (
      cwd === '/proj/a' ? probeA.promise : Promise.resolve(['fixture-provider/grok-4.6'])
    ));
    const a = launch(shared, 'a', '/proj/a');
    await expect(launch(shared, 'c', '/proj/c')).resolves.toEqual({
      decision: 'blocked', reason: 'OpenCode does not support low model level.'
    });
    probeA.resolve(A_INVENTORY);
    expect(spawnArgs(await a, '/proj/a')).toContain('--model fixture-provider/gpt-7-luna');
  });

  it('a rejected probe blocks only its own launch', async () => {
    const shared = tieredFixtureProvider();
    const probeA = deferred<readonly string[] | undefined>();
    shared.discoverModelTargets = vi.fn(({ cwd }: { cwd: string }) => (
      cwd === '/proj/a' ? probeA.promise : Promise.reject(new Error('gateway offline'))
    ));
    const a = launch(shared, 'a', '/proj/a');
    await expect(launch(shared, 'b', '/proj/b')).resolves.toEqual({ decision: 'blocked', reason: 'gateway offline' });
    probeA.resolve(A_INVENTORY);
    await expect(a).resolves.toEqual({ decision: 'allowed', scope: 'local', modelPin: pin('fixture-provider/gpt-7-luna') });
  });

  it('remote/host-discovery launches pin the id from the machine that owns the checkout', async () => {
    const shared = tieredFixtureProvider();
    shared.discoverModelTargets = vi.fn(async () => { throw new Error('wrong machine'); });
    const hostA = { roles: vi.fn(async () => []), models: vi.fn(async () => A_INVENTORY) };
    const hostB = { roles: vi.fn(async () => []), models: vi.fn(async () => B_INVENTORY) };
    const remoteLaunch = (discovery: typeof hostA) => preflightTerminalExecution({
      config: CONFIG, profile: 'opencode', persona: LOW, projectId: 'r', projectPath: '/same/checkout',
      scope: 'remote', mode: 'interactive', idempotencyKey: `remote-${Math.random()}`
    }, { ...deps(shared), discovery });
    // Two machines, same checkout path: each launch carries its own machine's id.
    const onA = await remoteLaunch(hostA);
    const onB = await remoteLaunch(hostB);
    expect(onA).toEqual({ decision: 'allowed', scope: 'remote', modelPin: pin('fixture-provider/gpt-7-luna') });
    expect(onB).toEqual({ decision: 'allowed', scope: 'remote', modelPin: pin('fixture-provider/gpt-8-luna') });
    // Level resolution and model validation share one probe per launch.
    expect(hostA.models).toHaveBeenCalledTimes(1);
    expect(shared.discoverModelTargets).not.toHaveBeenCalled();
    // The SSH argv carries the pinned id verbatim.
    const remote = { host: 'box', remotePath: '/same/checkout' } as ProjectRemote;
    expect(spawnArgs(onA, '/same/checkout', remote)).toContain('fixture-provider/gpt-7-luna');
    expect(spawnArgs(onB, '/same/checkout', remote)).toContain('fixture-provider/gpt-8-luna');
  });

  it('an explicit model id needs no pin and validates through the same single probe', async () => {
    const shared = new OpenCodeProvider();
    shared.discoverModelTargets = vi.fn(async () => A_INVENTORY);
    const explicit = { schemaVersion: 1 as const, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-7-sol' } } };
    await expect(preflightTerminalExecution({
      config: CONFIG, profile: 'opencode', projectId: 'a', projectPath: '/proj/a', scope: 'local',
      mode: 'interactive', idempotencyKey: 'explicit', harnessRouting: explicit
    }, deps(shared))).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(shared.discoverModelTargets).toHaveBeenCalledTimes(1);
  });

  it('a synthetic declared tier can resolve without a project probe', async () => {
    const shared = tieredFixtureProvider();
    shared.discoverModelTargets = vi.fn(async () => A_INVENTORY);
    await expect(preflightTerminalExecution({
      config: CONFIG, profile: 'opencode', persona: LOW, projectId: 'a', scope: 'local',
      mode: 'interactive', idempotencyKey: 'no-path'
    }, deps(shared))).resolves.toEqual({ decision: 'allowed', scope: 'local', modelPin: pin(SNAPSHOT_LOW) });
    expect(shared.discoverModelTargets).not.toHaveBeenCalled();
  });
});
