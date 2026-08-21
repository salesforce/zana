import { describe, it, expect } from 'vitest';
import {
  HostCommandRelay,
  HOST_LAUNCH_QUEUE_CAP,
  type HostCommand,
  type HostLaunchSpec
} from '../host-command-relay.js';

/**
 * W1-4 trust inversion — the park-by-default contract lives in
 * `HostCommandRelay.requestLaunch`. These tests pin the load-bearing security
 * rule: a DISK-tier module can never issue an immediate launch (its `autoLaunch`
 * is downgraded to park), only a BUILT-IN may; and every parked launch is
 * durable (drained on demand, never silently dropped).
 */

/** A relay wired to a spy `send` + a fixed built-in set, deterministic ids/time. */
function makeRelay(opts?: { builtins?: string[]; maxPerModule?: number }) {
  const sent: HostCommand[] = [];
  let n = 0;
  const builtins = new Set(opts?.builtins ?? []);
  const relay = new HostCommandRelay({
    send: (cmd) => sent.push(cmd),
    isBuiltin: (id) => builtins.has(id),
    genId: () => `req-${++n}`,
    now: () => '2026-07-21T00:00:00.000Z',
    maxPerModule: opts?.maxPerModule
  });
  return { relay, sent };
}

const SPEC = (over?: Partial<HostLaunchSpec>): HostLaunchSpec => ({
  projectId: 'proj-1',
  ...over
});

describe('HostCommandRelay — park-by-default', () => {
  it('a disk-tier requestLaunch PARKS (no immediate launch) and nudges the renderer', () => {
    const { relay, sent } = makeRelay(); // no built-ins
    const res = relay.requestLaunch('disk-ext', SPEC({ title: 'Do the thing' }));

    expect(res).toEqual({ parked: true, requestId: 'req-1' });
    // Pushed a content-free `launchParked` nudge — NEVER a `launch` command.
    expect(sent.map((c) => c.kind)).toEqual(['launchParked']);
    expect(sent[0]).toMatchObject({ moduleId: 'disk-ext', kind: 'launchParked', payload: { requestId: 'req-1' } });

    // The launch is durable — drained on demand with the full advisory spec.
    const drained = relay.drainParked();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({
      requestId: 'req-1',
      moduleId: 'disk-ext',
      spec: { projectId: 'proj-1', title: 'Do the thing' }
    });
  });

  it('a disk-tier autoLaunch:true is DOWNGRADED to park (ext cannot bypass the human)', () => {
    const { relay, sent } = makeRelay(); // disk-ext is NOT a built-in
    const res = relay.requestLaunch('disk-ext', SPEC({ autoLaunch: true }));

    // autoLaunch is ignored for a disk ext — still parked, still only a nudge.
    expect(res.parked).toBe(true);
    expect(sent.map((c) => c.kind)).toEqual(['launchParked']);
    expect(relay.drainParked()).toHaveLength(1);
  });

  it('a BUILT-IN with autoLaunch:true issues an IMMEDIATE launch (no park, no nudge)', () => {
    const { relay, sent } = makeRelay({ builtins: ['slack'] });
    const res = relay.requestLaunch('slack', SPEC({ autoLaunch: true, title: 'now' }));

    expect(res).toEqual({ parked: false, requestId: 'req-1' });
    // Pushed the `launch` command directly, carrying the spec + correlation id.
    expect(sent.map((c) => c.kind)).toEqual(['launch']);
    expect(sent[0]).toMatchObject({
      moduleId: 'slack',
      kind: 'launch',
      payload: { requestId: 'req-1', spec: { projectId: 'proj-1', title: 'now' } }
    });
    // Nothing parked — the built-in's launch didn't queue.
    expect(relay.drainParked()).toHaveLength(0);
  });

  it('a BUILT-IN WITHOUT autoLaunch still parks (immediate requires an explicit opt-in)', () => {
    const { relay, sent } = makeRelay({ builtins: ['slack'] });
    const res = relay.requestLaunch('slack', SPEC()); // no autoLaunch

    expect(res.parked).toBe(true);
    expect(sent.map((c) => c.kind)).toEqual(['launchParked']);
  });
});

describe('HostCommandRelay — durability + bounds', () => {
  it('drainParked returns FIFO across modules and CLEARS the queue', () => {
    const { relay } = makeRelay();
    relay.requestLaunch('a', SPEC({ title: 'first' }));
    relay.requestLaunch('b', SPEC({ title: 'second' }));
    relay.requestLaunch('a', SPEC({ title: 'third' }));

    const drained = relay.drainParked();
    expect(drained.map((p) => p.spec.title)).toEqual(['first', 'second', 'third']);
    // Cleared — a second drain re-delivers nothing (no double-delivery).
    expect(relay.drainParked()).toEqual([]);
  });

  it('a launch parked while no panel listened is delivered on the next drain', () => {
    const { relay } = makeRelay();
    // No renderer drains between these — they accumulate rather than drop.
    relay.requestLaunch('a', SPEC({ title: 'x' }));
    relay.requestLaunch('a', SPEC({ title: 'y' }));
    expect(relay.drainParked().map((p) => p.spec.title)).toEqual(['x', 'y']);
  });

  it('the per-module park queue is bounded (drop-oldest past the cap, Rule 5)', () => {
    const { relay } = makeRelay({ maxPerModule: 2 });
    relay.requestLaunch('a', SPEC({ title: '1' }));
    relay.requestLaunch('a', SPEC({ title: '2' }));
    relay.requestLaunch('a', SPEC({ title: '3' })); // evicts '1'
    const drained = relay.drainParked();
    expect(drained.map((p) => p.spec.title)).toEqual(['2', '3']);
  });

  it('closeForModule drops a dead module’s parked launches (Rule 3)', () => {
    const { relay } = makeRelay();
    relay.requestLaunch('a', SPEC());
    relay.requestLaunch('b', SPEC());
    relay.closeForModule('a');
    const drained = relay.drainParked();
    expect(drained.map((p) => p.moduleId)).toEqual(['b']);
  });

  it('default cap is HOST_LAUNCH_QUEUE_CAP', () => {
    const { relay } = makeRelay();
    for (let i = 0; i < HOST_LAUNCH_QUEUE_CAP + 5; i++) relay.requestLaunch('a', SPEC({ title: String(i) }));
    expect(relay.drainParked()).toHaveLength(HOST_LAUNCH_QUEUE_CAP);
  });
});

describe('HostCommandRelay — ephemeral nudges', () => {
  it('toast/navigate/selectProject push straight through (no park)', () => {
    const { relay, sent } = makeRelay();
    relay.toast('a', 'hello', 'error');
    relay.navigate('a', 'inbox');
    relay.selectProject('a', 'proj-9');
    expect(sent).toEqual([
      { moduleId: 'a', kind: 'toast', payload: { message: 'hello', kind: 'error' } },
      { moduleId: 'a', kind: 'navigate', payload: { target: 'inbox' } },
      { moduleId: 'a', kind: 'selectProject', payload: { projectId: 'proj-9' } }
    ]);
    expect(relay.drainParked()).toEqual([]);
  });

  it('toast/navigate ignore empty input (best-effort guard)', () => {
    const { relay, sent } = makeRelay();
    relay.toast('a', '');
    relay.navigate('a', '');
    expect(sent).toEqual([]);
  });
});

/**
 * W1-5 main-reachable dialogs — `ctx.host.confirm` / `ctx.host.alert` for a
 * HEADLESS main module. These pin: the answer round-trips via `resolveDialog`
 * off the authenticated moduleId; a windowless host fails CLOSED immediately
 * (confirm→false, alert→null) rather than hanging; a per-module flood is
 * bounded (drop-oldest fails the evicted dialog closed with its own value); and
 * a dead child's in-flight dialogs are failed-closed on `closeForModule`.
 */
function makeDialogRelay(opts?: { canDeliver?: boolean; maxPerModule?: number }) {
  const sent: HostCommand[] = [];
  let n = 0;
  const relay = new HostCommandRelay({
    send: (cmd) => sent.push(cmd),
    isBuiltin: () => false,
    genId: () => `req-${++n}`,
    now: () => '2026-07-21T00:00:00.000Z',
    maxPerModule: opts?.maxPerModule,
    // Default deliverable so tests can drive the reply directly; opt into
    // windowless with `canDeliver: false`.
    canDeliverDialog: opts?.canDeliver === undefined ? undefined : () => opts.canDeliver!
  });
  return { relay, sent };
}

it('uses native main confirmation when supplied and ignores renderer dialog replies', async () => {
  const sent: HostCommand[] = [];
  const relay = new HostCommandRelay({
    send: (cmd) => sent.push(cmd),
    isBuiltin: () => false,
    genId: () => 'renderer-request',
    showConfirm: async (moduleId, spec) => moduleId === 'trusted-child' && spec.title === 'Proceed?'
  });
  await expect(relay.confirm('trusted-child', { title: 'Proceed?' })).resolves.toBe(true);
  relay.resolveDialog('renderer-request', false);
  expect(sent).toEqual([]);
});

describe('HostCommandRelay — W1-5 main-reachable dialogs', () => {
  it('confirm round-trips the human answer via resolveDialog off the authenticated id', async () => {
    const { relay, sent } = makeDialogRelay();
    const p = relay.confirm('watcher-ext', { title: 'Delete 3 files?', danger: true });

    // A `confirm` command was pushed to the shell with the correlation id + spec.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      moduleId: 'watcher-ext',
      kind: 'confirm',
      payload: { requestId: 'req-1', spec: { title: 'Delete 3 files?', danger: true } }
    });

    // Human says yes → the awaited Promise resolves true.
    relay.resolveDialog('req-1', true);
    await expect(p).resolves.toBe(true);
  });

  it('alert round-trips the picked action id (and null on dismiss)', async () => {
    const { relay, sent } = makeDialogRelay();
    const picked = relay.alert('watcher-ext', {
      title: 'Build finished',
      actions: [{ id: 'open', label: 'Open' }]
    });
    expect(sent[0]).toMatchObject({ kind: 'alert', payload: { requestId: 'req-1' } });
    relay.resolveDialog('req-1', 'open');
    await expect(picked).resolves.toBe('open');

    const dismissed = relay.alert('watcher-ext', { title: 'Heads up' });
    relay.resolveDialog('req-2', null);
    await expect(dismissed).resolves.toBeNull();
  });

  it('fails CLOSED immediately when no renderer can receive the dialog (windowless host)', async () => {
    const { relay, sent } = makeDialogRelay({ canDeliver: false });
    // Confirm → false, alert → null, WITHOUT pushing anything or parking a resolver.
    await expect(relay.confirm('watcher-ext', { title: 'Proceed?' })).resolves.toBe(false);
    await expect(relay.alert('watcher-ext', { title: 'FYI' })).resolves.toBeNull();
    expect(sent).toEqual([]);
  });

  it('resolveDialog is a no-op for an unknown / already-settled requestId', async () => {
    const { relay } = makeDialogRelay();
    // Unknown id — must not throw.
    expect(() => relay.resolveDialog('nope', true)).not.toThrow();
    const p = relay.confirm('watcher-ext', { title: 'Once?' });
    relay.resolveDialog('req-1', true);
    // A second late reply is ignored (the Promise already settled to true).
    relay.resolveDialog('req-1', false);
    await expect(p).resolves.toBe(true);
  });

  it('bounds in-flight dialogs per module — drop-oldest fails the evicted one closed', async () => {
    const { relay } = makeDialogRelay({ maxPerModule: 2 });
    const a = relay.confirm('watcher-ext', { title: 'A' }); // req-1
    const b = relay.confirm('watcher-ext', { title: 'B' }); // req-2
    const c = relay.confirm('watcher-ext', { title: 'C' }); // req-3 → evicts req-1

    // The oldest (A) was failed-closed with ITS OWN value (confirm → false).
    await expect(a).resolves.toBe(false);
    // B and C are still live and answerable.
    relay.resolveDialog('req-2', true);
    relay.resolveDialog('req-3', true);
    await expect(b).resolves.toBe(true);
    await expect(c).resolves.toBe(true);
  });

  it('the per-module cap is independent — one module cannot evict another', async () => {
    const { relay } = makeDialogRelay({ maxPerModule: 1 });
    const a = relay.confirm('ext-a', { title: 'A' }); // req-1
    const b = relay.alert('ext-b', { title: 'B' }); // req-2 — different module, does NOT evict A
    relay.resolveDialog('req-1', true);
    relay.resolveDialog('req-2', 'ok');
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe('ok');
  });

  it('closeForModule fails-close a dead child\'s in-flight dialogs (Rule 3), leaving peers untouched', async () => {
    const { relay } = makeDialogRelay();
    const dying = relay.confirm('ext-a', { title: 'A' }); // req-1
    const other = relay.alert('ext-b', { title: 'B' }); // req-2

    relay.closeForModule('ext-a');
    // The dead module's confirm resolved to its fail-closed value (false).
    await expect(dying).resolves.toBe(false);
    // A late reply for the dead module's dialog is now a no-op.
    relay.resolveDialog('req-1', true);

    // The surviving module's dialog is still answerable.
    relay.resolveDialog('req-2', 'ok');
    await expect(other).resolves.toBe('ok');
  });
});
