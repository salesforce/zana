import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * LIFECYCLE-FIXTURE net (W1-8).
 *
 * Two tiers:
 *  - LIVE: the synthetic lifecycle fixture's manifest is DISCOVERABLE through the
 *    real pipeline (proves a lifecycle-declaring, main+renderer manifest validates
 *    — the precondition for any lifecycle behavior). No source edit; seeded from
 *    the fixture dir into a temp ZCC_EXTENSIONS_DIR.
 *  - FIXTURE-CONTRACT: the fixture's main.mjs is itself a faithful driver — it
 *    exports all four MainModule lifecycle verbs and records each call onto
 *    `globalThis.__conformanceLifecycle` in call order. This net OWNS that proof;
 *    the HOST-side firing (setup/teardown per activation, onInstall/onUninstall
 *    exactly-once, mark semantics, dead-child isolation) is proven end-to-end
 *    against the RPC endpoint in `../process-host.test.ts` — we cross-reference it
 *    rather than re-spawn a utilityProcess here (W1-4/5/6/7 have all landed).
 */
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lifecycle-ext');
const FIXTURE_ID = 'conformance.lifecycle';

let extDir: string;
let prevEnv: string | undefined;

describe('W1-8 lifecycle fixture — discovery (LIVE)', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-conformance-lc-'));
    await cp(FIXTURE_DIR, join(extDir, FIXTURE_ID), { recursive: true });
    prevEnv = process.env.ZCC_EXTENSIONS_DIR;
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.ZCC_EXTENSIONS_DIR;
    else process.env.ZCC_EXTENSIONS_DIR = prevEnv;
    await rm(extDir, { recursive: true, force: true });
  });

  it('validates + discovers the lifecycle-declaring manifest (main + renderer)', async () => {
    const { discoverExtensions } = await import('../../discovery.js');
    const found = await discoverExtensions();
    const e = found.find((x) => x.id === FIXTURE_ID);
    expect(e).toBeDefined();
    expect(e?.manifest?.entry?.main).toBe('main.mjs');
    expect(e?.manifest?.entry?.renderer).toBe('renderer.js');
    expect(e?.error).toBeUndefined();
  });
});

describe('W1-8 lifecycle fixture — driver contract (FIXTURE-CONTRACT)', () => {
  type LifecycleModule = {
    id?: string;
    setup: (ctx?: unknown) => unknown;
    teardown: () => unknown;
    onInstall: (ctx?: unknown) => unknown;
    onUninstall: (ctx?: unknown) => unknown;
  };
  type LifecycleGlobal = typeof globalThis & { __conformanceLifecycle?: string[] };

  let mod: LifecycleModule;

  beforeEach(async () => {
    delete (globalThis as LifecycleGlobal).__conformanceLifecycle;
    // Import the SAME main.mjs the discovery/host path loads — no source edit,
    // no re-implemented stub. What this file records IS what the host would see.
    const imported = (await import(join(FIXTURE_DIR, 'main.mjs'))) as { default: LifecycleModule };
    mod = imported.default;
  });
  afterEach(() => {
    delete (globalThis as LifecycleGlobal).__conformanceLifecycle;
  });

  const recorded = () => (globalThis as LifecycleGlobal).__conformanceLifecycle ?? [];

  it('exports all four MainModule lifecycle verbs as functions', () => {
    expect(typeof mod.setup).toBe('function');
    expect(typeof mod.teardown).toBe('function');
    expect(typeof mod.onInstall).toBe('function');
    expect(typeof mod.onUninstall).toBe('function');
  });

  it('records setup→teardown in call order (per-activation ordering the host drives)', () => {
    // Mirrors the host activation path proven in ../process-host.test.ts
    // ("teardown sends a teardown RPC then kills"): setup on spawn, teardown on
    // shutdown. Here we assert the FIXTURE faithfully reports that ordering.
    mod.setup({});
    mod.teardown();
    expect(recorded()).toEqual(['setup', 'teardown']);
  });

  it('records onInstall exactly once per invocation (host fires it once via the pending mark)', () => {
    // The exactly-once guarantee lives in the host's markPendingInstall/ready
    // consumption (proven in ../process-host.test.ts:
    // "markPendingInstall → fires onInstall exactly once on the next ready" +
    // "an ordinary spawn (no mark) never fires onInstall"). The fixture's job is
    // to record each host-driven call verbatim — one call, one record.
    mod.onInstall({});
    expect(recorded()).toEqual(['onInstall']);
  });

  it('records onUninstall before teardown (the uninstall ordering host guarantees)', () => {
    // Host contract (../process-host.test.ts "dispatchLifecycle(onUninstall) posts
    // the hook"): onUninstall fires while the child is still alive, BEFORE
    // teardown. The fixture records that order faithfully.
    mod.onUninstall({});
    mod.teardown();
    expect(recorded()).toEqual(['onUninstall', 'teardown']);
  });
});
