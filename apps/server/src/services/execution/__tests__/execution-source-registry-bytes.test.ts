import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionSourceError, createExecutionSourceRegistry, type ExecutionSourceBinding } from '../source-registry.js';
import { sha256Hex } from '../launch-items.js';

const P = 'project-1';
const A: ExecutionSourceBinding = { kind: 'session', sessionId: 'session-a' };
const B: ExecutionSourceBinding = { kind: 'session', sessionId: 'session-b' };
let keys = 0;

async function fixture(run: (dir: string, clock: { t: number }) => Promise<void>): Promise<void> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-execution-bytes-')));
  try { await run(dir, { t: 1_000_000 }); } finally { await rm(dir, { recursive: true, force: true }); }
}

function make(dir: string, clock: { t: number }) {
  let n = 0;
  return createExecutionSourceRegistry({ rootDir: join(dir, 'store'), now: () => clock.t, id: () => `cap-${++n}` });
}

const bytes = (text: string) => Buffer.from(text, 'utf8');
const failure = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return { code: (e as ExecutionSourceError).code, message: (e as Error).message }; }
  return undefined;
};

describe('execution source registry issueFromBytes', () => {
  it('issues attachments and snapshots exactly the supplied bytes', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    const { views, mapping } = await r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'plan.md', bytes: bytes('# the plan') }] });
    expect(views.map((v) => v.name)).toEqual(['plan.md']);
    expect(mapping).toEqual([{ index: 0, given: 'plan.md', used: 'plan.md' }]);
    const resolved = await r.resolve({ binding: A, projectId: P, capabilityIds: views.map((v) => v.id), snapshotKey: `k${++keys}` });
    expect(resolved.sources).toHaveLength(1);
    expect(resolved.sources[0]).toMatchObject({ name: 'plan.md', extractedText: '# the plan', contentDigest: `sha256:${sha256Hex(bytes('# the plan'))}` });
    expect(resolved.pathDescriptors[0]!.representations).toEqual([]);
    const stored = JSON.parse(await readFile(join(dir, 'store', resolved.contentRef), 'utf8'));
    expect(stored.sources[0].extractedText).toBe('# the plan');
  }));

  it('dedupes and suffixes through the shared validator and returns the mapping', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    const { views, mapping } = await r.issueFromBytes({
      binding: A, projectId: P,
      items: [{ name: 'a.md', bytes: bytes('one') }, { name: 'a.md', bytes: bytes('one') }, { name: 'a.md', bytes: bytes('two') }]
    });
    expect(views.map((v) => v.name)).toEqual(['a.md', 'a (1).md']);
    expect(mapping).toEqual([
      { index: 0, given: 'a.md', used: 'a.md' },
      { index: 1, given: 'a.md', used: 'a.md', deduplicated: 'a.md' },
      { index: 2, given: 'a.md', used: 'a (1).md' }
    ]);
  }));

  it('shares the budget and name space with path sources already in the launch', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    const existing = [{ name: 'plan.md', byteSize: 4, sha256: sha256Hex(bytes('disk')) }];
    const { views, mapping } = await r.issueFromBytes({ binding: A, projectId: P, existing, items: [{ name: 'plan.md', bytes: bytes('mine') }] });
    expect(views.map((v) => v.name)).toEqual(['plan (1).md']);
    expect(mapping).toEqual([{ index: 0, given: 'plan.md', used: 'plan (1).md' }]);
    const full = Array.from({ length: 16 }, (_v, i) => ({ name: `s${i}.md`, byteSize: 1, sha256: sha256Hex(bytes(String(i))) }));
    expect(await failure(r.issueFromBytes({ binding: A, projectId: P, existing: full, items: [{ name: 'x.md', bytes: bytes('x') }] })))
      .toMatchObject({ code: 'TOO_MANY_SOURCES' });
  }));

  it('counts only the capabilities a launch would add against the outstanding limit', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    for (let batch = 0; batch < 8; batch += 1) {
      const items = Array.from({ length: 16 }, (_v, i) => ({ name: `f${batch}-${i}.md`, bytes: bytes(`${batch}:${i}`) }));
      await r.issueFromBytes({ binding: A, projectId: P, items });
    }
    // At the limit, an attachment folded into an identical path source issues nothing, so it is allowed.
    const existing = [{ name: 'same.md', byteSize: 4, sha256: sha256Hex(bytes('same')) }];
    const folded = await r.issueFromBytes({ binding: A, projectId: P, existing, items: [{ name: 'same.md', bytes: bytes('same') }] });
    expect(folded.views).toEqual([]);
    expect(await failure(r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'new.md', bytes: bytes('new') }] })))
      .toMatchObject({ code: 'TOO_MANY_SOURCES' });
  }));

  it('refuses unsafe names, oversize items and too many items without issuing anything', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    expect(await failure(r.issueFromBytes({ binding: A, projectId: P, items: [{ name: '../x.md', bytes: bytes('x') }] })))
      .toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
    const big = Buffer.alloc(4 * 1024 * 1024 + 1, 97);
    expect(await failure(r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'big.md', bytes: big }] })))
      .toEqual({ code: 'SOURCE_TOO_LARGE', message: "attachment 'big.md' is 4194305 bytes; limit is 4194304" });
    const many = Array.from({ length: 17 }, (_v, i) => ({ name: `f${i}.md`, bytes: bytes(String(i)) }));
    expect(await failure(r.issueFromBytes({ binding: A, projectId: P, items: many }))).toMatchObject({ code: 'TOO_MANY_SOURCES' });
    // Nothing was issued by any of the refusals: a later valid issue starts clean.
    const ok = await r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'ok.md', bytes: bytes('ok') }] });
    expect(ok.views).toHaveLength(1);
  }));

  it('is only for agent sessions', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    expect(await failure(r.issueFromBytes({ windowId: 1, projectId: P, items: [{ name: 'a.md', bytes: bytes('a') }] })))
      .toMatchObject({ code: 'INVALID_CAPABILITY' });
  }));

  it('keeps a capability bound to its session, project, and single use', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    const { views } = await r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'a.md', bytes: bytes('a') }] });
    const ids = views.map((v) => v.id);
    expect(await failure(r.resolve({ binding: B, projectId: P, capabilityIds: ids, snapshotKey: `k${++keys}` }))).toMatchObject({ code: 'FOREIGN_CAPABILITY' });
    expect(await failure(r.resolve({ binding: A, projectId: 'other', capabilityIds: ids, snapshotKey: `k${++keys}` }))).toMatchObject({ code: 'FOREIGN_CAPABILITY' });
    await r.resolve({ binding: A, projectId: P, capabilityIds: ids, snapshotKey: `k${++keys}` });
    expect(await failure(r.resolve({ binding: A, projectId: P, capabilityIds: ids, snapshotKey: `k${++keys}` }))).toMatchObject({ code: 'REPLAYED_CAPABILITY' });
  }));

  it('expires an unresolved capability like any other', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    const { views } = await r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'a.md', bytes: bytes('a') }] });
    clock.t += 11 * 60 * 1_000;
    expect(await failure(r.resolve({ binding: A, projectId: P, capabilityIds: views.map((v) => v.id), snapshotKey: `k${++keys}` })))
      .toMatchObject({ code: 'EXPIRED_CAPABILITY' });
  }));

  it('rejects binary content at resolve through the shared extraction', () => fixture(async (dir, clock) => {
    const r = make(dir, clock);
    const { views } = await r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'blob.bin', bytes: Buffer.from([0, 1, 2, 3, 255, 254]) }] });
    expect(await failure(r.resolve({ binding: A, projectId: P, capabilityIds: views.map((v) => v.id), snapshotKey: `k${++keys}` })))
      .toMatchObject({ code: 'BINARY_UNSUPPORTED' });
  }));

  it('refuses an issue that would exceed the outstanding capability limit', () => fixture(async (dir, clock) => {
    let n = 0;
    const r = createExecutionSourceRegistry({ rootDir: join(dir, 'store'), now: () => clock.t, id: () => `cap-${++n}`, limits: { maxOutstandingCapabilities: 1 } });
    await r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'a.md', bytes: bytes('a') }] });
    expect(await failure(r.issueFromBytes({ binding: A, projectId: P, items: [{ name: 'b.md', bytes: bytes('b') }] })))
      .toMatchObject({ code: 'TOO_MANY_SOURCES' });
  }));
});
