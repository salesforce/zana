import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionSourceError, createExecutionSourceRegistry } from '../source-registry.js';

let keys = 0;
const W = 7;
const P = 'project-1';

async function fixture(run: (dir: string, clock: { t: number }) => Promise<void>): Promise<void> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-execution-reissue-')));
  try { await run(dir, { t: 1_000_000 }); } finally { await rm(dir, { recursive: true, force: true }); }
}

function make(dir: string, clock: { t: number }, over: Parameters<typeof createExecutionSourceRegistry>[0]['limits'] = {}) {
  let n = 0;
  return createExecutionSourceRegistry({ rootDir: join(dir, 'store'), now: () => clock.t, id: () => `cap-${++n}`, limits: over });
}

const issue = (r: ReturnType<typeof make>, paths: string[], over = {}) => r.issue({ windowId: W, projectId: P, paths, ...over });
const reissue = (r: ReturnType<typeof make>, ids: string[], over = {}) => r.reissue({ windowId: W, projectId: P, capabilityIds: ids, ...over });
const resolve = (r: ReturnType<typeof make>, ids: string[]) => r.resolve({ windowId: W, projectId: P, capabilityIds: ids, snapshotKey: `k${++keys}` });
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as ExecutionSourceError).code; } return undefined; };

describe('execution source registry reissue', () => {
  it('renews a capability consumed by a successful resolve', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [file]);
    await resolve(r, [cap.id]);
    const out = await reissue(r, [cap.id]);
    expect(out.dropped).toEqual([]);
    expect(out.renewed).toHaveLength(1);
    expect(out.renewed[0].previousId).toBe(cap.id);
    expect(out.renewed[0].source.id).not.toBe(cap.id);
    expect(out.renewed[0].changed).toBe(false);
    expect(await code(resolve(r, [cap.id]))).toBe('REPLAYED_CAPABILITY');
    await expect(resolve(r, [out.renewed[0].source.id])).resolves.toBeTruthy();
  }));

  it('gives nothing back for ids a successful launch consumed once they are discarded', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [file]);
    await resolve(r, [cap.id]);
    r.discardRetired({ windowId: 99, projectId: P, capabilityIds: [cap.id] }); // other window: ignored
    r.discardRetired({ windowId: W, projectId: P, capabilityIds: [cap.id, 'never-issued'] });
    expect(await reissue(r, [cap.id])).toEqual({ renewed: [], dropped: [{ previousId: cap.id, reason: 'unknown' }] });
  }));

  it('renews the first file and drops the second when resolve threw half way', async () => fixture(async (dir, clock) => {
    const a = join(dir, 'a.txt'); const b = join(dir, 'b.txt');
    await writeFile(a, 'alpha'); await writeFile(b, 'beta');
    const r = make(dir, clock);
    const caps = await issue(r, [a, b]);
    await unlink(b);
    expect(await code(resolve(r, caps.map(({ id }) => id)))).toBe('SOURCE_CHANGED');
    const out = await reissue(r, caps.map(({ id }) => id));
    expect(out.renewed.map(({ previousId }) => previousId)).toEqual([caps[0].id]);
    expect(out.dropped).toEqual([{ previousId: caps[1].id, name: 'b.txt', reason: 'moved' }]);
  }));

  it('retires an expired capability in its own prune, with no issue call in between', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [file]);
    clock.t += 11 * 60 * 1000;
    const out = await reissue(r, [cap.id]);
    expect(out.renewed[0].source.id).not.toBe(cap.id);
    expect(out.renewed[0].source.expiresAt).toBeGreaterThan(clock.t);
    expect(out.renewed[0].changed).toBe(false);
  }));

  it('returns a live unused capability as it is', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [file]);
    const out = await reissue(r, [cap.id, cap.id]);
    expect(out.renewed).toEqual([{ previousId: cap.id, source: cap, changed: false }]);
  }));

  it('reuses a capability attached again after the failure, so resolve raises no DUPLICATE_SOURCE', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [old] = await issue(r, [file]);
    await resolve(r, [old.id]);
    const [again] = await issue(r, [file]);
    const out = await reissue(r, [old.id]);
    expect(out.renewed[0].source.id).toBe(again.id);
    await expect(resolve(r, [again.id])).resolves.toBeTruthy();
    // The record is gone once renewed.
    expect((await reissue(r, [old.id])).dropped[0].reason).toBe('unknown');
  }));

  it('drops foreign window, foreign project and unknown ids as unknown without a name', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [file]);
    await resolve(r, [cap.id]);
    const win = await reissue(r, [cap.id], { windowId: 99 });
    const proj = await reissue(r, [cap.id], { projectId: 'other' });
    const unk = await reissue(r, ['nope']);
    expect(win.dropped).toEqual([{ previousId: cap.id, reason: 'unknown' }]);
    expect(proj.dropped).toEqual([{ previousId: cap.id, reason: 'unknown' }]);
    expect(unk.dropped).toEqual([{ previousId: 'nope', reason: 'unknown' }]);
    expect(win.dropped[0]).not.toHaveProperty('name');
  }));

  it('flags a changed file', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [file]);
    await resolve(r, [cap.id]);
    await writeFile(file, 'alpha edited');
    const out = await reissue(r, [cap.id]);
    expect(out.renewed[0].changed).toBe(true);
    expect(out.renewed[0].source.byteSize).toBe(12);
  }));

  it('drops a file that is now over the limit as too-large', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock, { maxFileBytes: 10 });
    const [cap] = await issue(r, [file]);
    await resolve(r, [cap.id]);
    await writeFile(file, 'x'.repeat(50));
    expect((await reissue(r, [cap.id])).dropped).toEqual([{ previousId: cap.id, name: 'a.txt', reason: 'too-large' }]);
  }));

  it('drops a path that became a directory as moved', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [file]);
    await resolve(r, [cap.id]);
    await unlink(file);
    await mkdir(file);
    expect((await reissue(r, [cap.id])).dropped[0].reason).toBe('moved');
  }));

  it('drops a file whose read fails as unreadable', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    let fail = false;
    let n = 0;
    const r = createExecutionSourceRegistry({
      rootDir: join(dir, 'store'), now: () => clock.t, id: () => `cap-${++n}`,
      readBytes: async () => { if (fail) throw new Error('boom'); return Buffer.from('alpha'); }
    });
    const [cap] = await issue(r, [file]);
    await resolve(r, [cap.id]);
    fail = true;
    expect((await reissue(r, [cap.id])).dropped[0].reason).toBe('unreadable');
  }));

  it('drops a path whose parent was swapped for a symlink as moved (realpath no longer equals the issued path)', async () => fixture(async (dir, clock) => {
    const root = join(dir, 'root'); const outside = join(dir, 'outside');
    await mkdir(join(root, 'sub'), { recursive: true }); await mkdir(outside);
    await writeFile(join(root, 'sub', 'a.txt'), 'alpha');
    await writeFile(join(outside, 'a.txt'), 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [join(root, 'sub', 'a.txt')], { withinRoot: root });
    await resolve(r, [cap.id]);
    await rm(join(root, 'sub'), { recursive: true });
    await symlink(outside, join(root, 'sub'));
    expect((await reissue(r, [cap.id])).dropped).toEqual([{ previousId: cap.id, name: 'a.txt', reason: 'moved' }]);
  }));

  it('fails the old id on resolve and resolves the new one', async () => fixture(async (dir, clock) => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'alpha');
    const r = make(dir, clock);
    const [cap] = await issue(r, [file]);
    clock.t += 11 * 60 * 1000;
    const out = await reissue(r, [cap.id]);
    expect(await code(resolve(r, [cap.id]))).toMatch(/REPLAYED_CAPABILITY|INVALID_CAPABILITY/);
    await expect(resolve(r, [out.renewed[0].source.id])).resolves.toBeTruthy();
  }));

  it('caps retention by count and by age', async () => fixture(async (dir, clock) => {
    const r = make(dir, clock, { maxOutstandingCapabilities: 2 });
    const caps = [];
    for (const name of ['a', 'b', 'c']) {
      const f = join(dir, `${name}.txt`);
      await writeFile(f, name);
      const [c] = await issue(r, [f]);
      await resolve(r, [c.id]);
      caps.push(c);
    }
    const byCount = await reissue(r, caps.map(({ id }) => id));
    expect(byCount.dropped.map(({ previousId }) => previousId)).toEqual([caps[0].id]);
    expect(byCount.renewed.map(({ previousId }) => previousId)).toEqual([caps[1].id, caps[2].id]);

    const f = join(dir, 'd.txt');
    await writeFile(f, 'd');
    const r2 = make(dir, clock);
    const [d] = await issue(r2, [f]);
    await resolve(r2, [d.id]);
    clock.t += 61 * 60 * 1000;
    expect((await reissue(r2, [d.id])).dropped[0].reason).toBe('unknown');
  }));

  it('drops the rest as unreadable once outstanding capabilities are at the limit', async () => fixture(async (dir, clock) => {
    const r = make(dir, clock, { maxOutstandingCapabilities: 2 });
    const ids: string[] = [];
    for (const name of ['a', 'b']) {
      const f = join(dir, `${name}.txt`);
      await writeFile(f, name);
      const [c] = await issue(r, [f]);
      await resolve(r, [c.id]);
      ids.push(c.id);
    }
    for (const name of ['x', 'y']) { const f = join(dir, `${name}.txt`); await writeFile(f, name); await issue(r, [f]); }
    expect((await reissue(r, ids)).dropped.map(({ reason }) => reason)).toEqual(['unreadable', 'unreadable']);
  }));

  it('throws TOO_MANY_SOURCES above maxFiles', async () => fixture(async (dir, clock) => {
    const r = make(dir, clock, { maxFiles: 2 });
    expect(await code(reissue(r, ['a', 'b', 'c']))).toBe('TOO_MANY_SOURCES');
  }));
});
