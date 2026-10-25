import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_DOC_CHANNEL, AGENT_DOC_LEASE_TTL_MS, AGENT_DOC_RPC, type AgentDocChange } from '../lib/agent-doc-contract.js';
import { sha256Hex } from '../lib/agent-files.js';
import { AgentScriptDocumentStore, registerAgentScriptDocuments, type AgentDocIo, type AgentDocLimits } from '../lib/agent-script-document.js';
import { createNodeDeps } from '../lib/node-deps.js';
import type { StudioServerContext } from '../lib/studio-server-context.js';

const P = 'proj';
const PATH = 'force-app/Support.agent';
const A = 'client-a';
const B = 'client-b';

function harness(limits: Partial<AgentDocLimits> = {}, files: Record<string, string> = { [PATH]: 'a\nb\nc\n' }) {
  let time = 1_000_000;
  const disk = new Map<string, string>(Object.entries(files));
  const kvData = new Map<string, unknown>();
  const kv = { get: vi.fn(async (key: string) => kvData.get(key) as never), set: vi.fn(async (key: string, value: unknown) => { kvData.set(key, JSON.parse(JSON.stringify(value))); }) };
  const events: AgentDocChange[] = [];
  const io: AgentDocIo & { reads: number; writes: number } = {
    reads: 0, writes: 0,
    async read(_p, path) {
      io.reads++;
      const content = disk.get(path);
      return content === undefined ? { ok: false, code: 'not_found', error: 'missing' } : { ok: true, content, sha256: sha256Hex(content) };
    },
    async write(_p, path, content, expected) {
      io.writes++;
      if (sha256Hex(disk.get(path) ?? '') !== expected) return { ok: false, code: 'sha_mismatch', error: 'changed' };
      disk.set(path, content);
      return { ok: true, sha256: sha256Hex(content) };
    }
  };
  let ids = 0;
  const store = new AgentScriptDocumentStore({ kv, io, publish: change => events.push(change), now: () => time, newId: () => `id-${++ids}`, limits });
  return { store, disk, kv, kvData, io, events, tick: (ms: number) => { time += ms; }, clock: () => time };
}
const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => { expect(result).toMatchObject({ ok: true }); return result as never; };
const propose = (path = PATH, base = 'a\nb\nc\n', extra: Record<string, unknown> = {}) => ({ path, input: { path, expectedSha256: sha256Hex(base), summary: 'edit', edits: [{ startLine: 2, endLine: 2, text: 'B' }] }, ...extra });

describe('open', () => {
  it('loads disk text as a clean document and returns the live one next time', async () => {
    const h = harness();
    const doc = ok(await h.store.open(P, PATH)).doc;
    expect(doc).toMatchObject({ projectId: P, path: PATH, text: 'a\nb\nc\n', dirty: false, savedText: null, lease: null, proposals: [], baseSha256: sha256Hex('a\nb\nc\n') });
    expect(doc.rev).toBeGreaterThan(0);
    expect(ok(await h.store.open(P, PATH)).doc.rev).toBe(doc.rev);
    expect(h.store.size).toBe(1);
  });
  it('rejects missing project, unsafe paths and non-agent files', async () => {
    const h = harness();
    expect(await h.store.open('', PATH)).toMatchObject({ ok: false, code: 'project_required' });
    for (const path of ['../x.agent', '/abs.agent', 'a\\b.agent', '', 'a//b.agent']) expect(await h.store.open(P, path)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await h.store.open(P, 'notes.txt')).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await h.store.open(P, 5 as never)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(h.io.reads).toBe(0);
  });
  it('passes a read failure through', async () => {
    expect(await harness().store.open(P, 'missing.agent')).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('marks a file over the text cap as too large without text', async () => {
    const h = harness({ textMax: 5 });
    const doc = ok(await h.store.open(P, PATH)).doc;
    expect(doc).toMatchObject({ text: null, tooLarge: true, dirty: false, savedText: null });
  });
  it('adopts a newer disk version when clean and bumps the rev', async () => {
    const h = harness();
    const first = ok(await h.store.open(P, PATH)).doc;
    h.disk.set(PATH, 'changed\n'); h.tick(3000);
    const second = ok(await h.store.open(P, PATH)).doc;
    expect(second).toMatchObject({ text: 'changed\n', dirty: false, baseSha256: sha256Hex('changed\n') });
    expect(second.rev).toBeGreaterThan(first.rev);
    expect(h.events.at(-1)).toMatchObject({ kind: 'text', rev: second.rev });
  });
  it('keeps a dirty buffer when disk moves on, diffing against the new disk text', async () => {
    const h = harness();
    const doc = ok(await h.store.open(P, PATH)).doc;
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'mine\n' }));
    h.disk.set(PATH, 'theirs\n'); h.tick(3000);
    const next = ok(await h.store.open(P, PATH)).doc;
    // The base stays the version the edit started from, so the editor's save conflicts instead of reverting 'theirs'.
    expect(next).toMatchObject({ text: 'mine\n', dirty: true, savedText: 'theirs\n', baseSha256: sha256Hex('a\nb\nc\n') });
    expect(h.kvData.get(`agentdoc:buffers:${P}`)).toMatchObject({ buffers: [{ path: PATH, text: 'mine\n', baseSha256: sha256Hex('a\nb\nc\n') }] });
    // A second open with unchanged disk neither bumps the rev nor flips the base.
    h.tick(3000);
    expect(ok(await h.store.open(P, PATH)).doc.rev).toBe(next.rev);
    h.disk.set(PATH, 'mine\n'); h.tick(3000);
    expect(ok(await h.store.open(P, PATH)).doc).toMatchObject({ dirty: false, savedText: null, baseSha256: sha256Hex('mine\n') });
    expect(h.kvData.get(`agentdoc:buffers:${P}`)).toEqual({ buffers: [] });
  });
  it('marks a dirty doc dirty when disk grows past the cap', async () => {
    const h = harness({ textMax: 10 });
    const doc = ok(await h.store.open(P, PATH)).doc;
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'mine' }));
    h.disk.set(PATH, 'x'.repeat(50)); h.tick(3000);
    expect(ok(await h.store.open(P, PATH)).doc).toMatchObject({ dirty: true, text: 'mine', savedText: null });
  });
  it('serializes concurrent opens into one document', async () => {
    const h = harness();
    const [one, two] = await Promise.all([h.store.open(P, PATH), h.store.open(P, PATH)]);
    expect(ok(one).doc.rev).toBe(ok(two).doc.rev);
    expect(h.store.size).toBe(1);
  });
});

describe('update and leases', () => {
  it('grants the lease to the first editor, computes dirty against disk and publishes', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const updated = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'a\nB\nc\n', label: 'Studio', diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error', message: 'bad' }] })).doc;
    expect(updated).toMatchObject({ text: 'a\nB\nc\n', dirty: true, savedText: 'a\nb\nc\n', lease: { clientId: A, label: 'Studio' } });
    expect(updated.diagnostics).toHaveLength(1);
    expect(updated.rev).toBeGreaterThan(doc.rev);
    expect(h.events.at(-1)).toEqual({ projectId: P, path: PATH, rev: updated.rev, kind: 'text' });
    // Back to the disk text is clean again.
    const clean = ok(await h.store.update(P, { path: PATH, clientId: A, rev: updated.rev, text: 'a\nb\nc\n' })).doc;
    expect(clean).toMatchObject({ dirty: false, savedText: null });
    expect(clean.diagnostics).toHaveLength(1);
  });
  it('is a no-op (same rev, no event) when nothing changed, and renews the lease', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const first = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x\n' })).doc;
    const events = h.events.length;
    h.tick(10_000);
    const again = ok(await h.store.update(P, { path: PATH, clientId: A, rev: first.rev, text: 'x\n' })).doc;
    expect(again.rev).toBe(first.rev);
    expect(h.events).toHaveLength(events);
    expect(again.lease!.renewedAt).toBe(h.clock());
  });
  it('rejects a stale rev with the current doc attached', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const result = await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev - 1, text: 'x' });
    expect(result).toMatchObject({ ok: false, code: 'stale', doc: { rev: doc.rev } });
  });
  it('refuses another client while a live lease exists, and allows it once the lease lapses', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const mine = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x\n', label: 'Window 1' })).doc;
    const refused = await h.store.update(P, { path: PATH, clientId: B, rev: mine.rev, text: 'y\n' });
    expect(refused).toMatchObject({ ok: false, code: 'leased', error: expect.stringContaining('Window 1') });
    h.tick(AGENT_DOC_LEASE_TTL_MS);
    const taken = ok(await h.store.update(P, { path: PATH, clientId: B, rev: mine.rev, text: 'y\n' })).doc;
    expect(taken.lease).toMatchObject({ clientId: B, label: 'Agentforce Studio' });
    expect(taken.text).toBe('y\n');
  });
  it('validates arguments', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    expect(await h.store.update(P, { path: PATH, clientId: '', rev: doc.rev, text: 'x' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.update(P, { path: PATH, clientId: 'c'.repeat(201), rev: doc.rev, text: 'x' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.update(P, { path: PATH, clientId: A, rev: 1.5, text: 'x' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 4 as never })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x', diagnostics: [{ nope: 1 }] })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.update(P, { path: '../x.agent', clientId: A, rev: 1, text: 'x' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.update(P, { path: 'missing.agent', clientId: A, rev: 1, text: 'x' })).toMatchObject({ code: 'not_found' });
  });
  it('stores no text for an over-cap buffer but still tracks dirty', async () => {
    const h = harness({ textMax: 8 });
    const { doc } = ok(await h.store.open(P, PATH));
    const big = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x'.repeat(50) })).doc;
    expect(big).toMatchObject({ text: null, tooLarge: true, dirty: true, savedText: 'a\nb\nc\n' });
    expect(h.kvData.get(`agentdoc:buffers:${P}`)).toBeUndefined();
    // Back under the cap and equal to disk.
    expect(ok(await h.store.update(P, { path: PATH, clientId: A, rev: big.rev, text: 'a\nb\nc\n' })).doc).toMatchObject({ text: 'a\nb\nc\n', dirty: false });
  });
  it('tracks dirty by sha when disk itself is over the cap', async () => {
    const h = harness({ textMax: 8 }, { [PATH]: 'x'.repeat(50) });
    const { doc } = ok(await h.store.open(P, PATH));
    const same = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x'.repeat(50) })).doc;
    expect(same).toMatchObject({ dirty: false, tooLarge: true, text: null });
    expect(ok(await h.store.update(P, { path: PATH, clientId: A, rev: same.rev, text: 'y'.repeat(50) })).doc.dirty).toBe(true);
  });
  it('survives a publish that throws', async () => {
    const h = harness();
    const store = new AgentScriptDocumentStore({ kv: h.kv, io: h.io, publish: () => { throw new Error('down'); } });
    expect(ok(await store.open(P, PATH)).doc.rev).toBeGreaterThan(0);
    const { doc } = ok(await store.open(P, PATH));
    expect(ok(await store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'z' })).doc.dirty).toBe(true);
  });

  describe('lease', () => {
    it('grants, renews, refuses and takes over', async () => {
      const h = harness();
      const granted = ok(await h.store.lease(P, { path: PATH, clientId: A, label: ' Window A ' })).doc;
      expect(granted.lease).toMatchObject({ clientId: A, label: 'Window A', since: h.clock() });
      expect(h.events.at(-1)?.kind).toBe('lease');
      const events = h.events.length;
      h.tick(5000);
      const renewed = ok(await h.store.lease(P, { path: PATH, clientId: A, label: 'Renamed', leaseId: granted.lease!.id })).doc;
      expect(renewed).toMatchObject({ rev: granted.rev, lease: { label: 'Renamed', since: granted.lease!.since, renewedAt: h.clock() } });
      expect(h.events).toHaveLength(events);
      const refused = await h.store.lease(P, { path: PATH, clientId: B, label: 'B' });
      expect(refused).toMatchObject({ ok: false, code: 'leased', doc: { lease: { clientId: A } } });
      const taken = ok(await h.store.lease(P, { path: PATH, clientId: B, label: 'B', take: true })).doc;
      expect(taken.lease).toMatchObject({ clientId: B });
      expect(taken.rev).toBeGreaterThan(renewed.rev);
      // The previous holder can no longer write.
      expect(await h.store.update(P, { path: PATH, clientId: A, rev: taken.rev, text: 'x' })).toMatchObject({ code: 'leased' });
    });
    it('treats an expired lease as free and defaults the label to the client id', async () => {
      const h = harness();
      ok(await h.store.lease(P, { path: PATH, clientId: A }));
      h.tick(AGENT_DOC_LEASE_TTL_MS - 1);
      expect(await h.store.lease(P, { path: PATH, clientId: B })).toMatchObject({ code: 'leased' });
      h.tick(1);
      expect(ok(await h.store.lease(P, { path: PATH, clientId: B })).doc.lease).toMatchObject({ clientId: B, label: B });
    });
    it('validates and surfaces load failures', async () => {
      const h = harness();
      expect(await h.store.lease(P, { path: PATH, clientId: '' })).toMatchObject({ code: 'invalid_input' });
      expect(await h.store.lease(P, { path: 'missing.agent', clientId: A })).toMatchObject({ code: 'not_found' });
    });
  });

  describe('release and close', () => {
    it('release frees only the holder lease', async () => {
      const h = harness();
      ok(await h.store.lease(P, { path: PATH, clientId: A }));
      expect(await h.store.release(P, { path: PATH, clientId: B })).toEqual({ ok: true });
      expect(ok(await h.store.open(P, PATH)).doc.lease).toMatchObject({ clientId: A });
      expect(await h.store.release(P, { path: PATH, clientId: A })).toEqual({ ok: true });
      expect(ok(await h.store.open(P, PATH)).doc.lease).toBeNull();
      expect(h.events.at(-1)?.kind).toBe('lease');
      expect(await h.store.release(P, { path: 'other.agent', clientId: A })).toEqual({ ok: true });
      expect(await h.store.release(P, { path: PATH, clientId: '' })).toMatchObject({ code: 'invalid_input' });
    });
    it('close evicts a clean unleased doc with a newer rev next time', async () => {
      const h = harness();
      const first = ok(await h.store.lease(P, { path: PATH, clientId: A })).doc;
      expect(await h.store.close(P, { path: PATH, clientId: A })).toEqual({ ok: true });
      expect(h.store.size).toBe(0);
      expect(h.events.at(-1)?.kind).toBe('closed');
      expect(ok(await h.store.open(P, PATH)).doc.rev).toBeGreaterThan(h.events.at(-1)!.rev - 1);
      expect(ok(await h.store.open(P, PATH)).doc.rev).toBeGreaterThan(first.rev);
    });
    it('close keeps a dirty doc, a doc leased by someone else, or one with pending proposals', async () => {
      const h = harness();
      const { doc } = ok(await h.store.open(P, PATH));
      ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'dirty' }));
      await h.store.close(P, { path: PATH, clientId: A });
      expect(h.store.size).toBe(1);
      await h.store.close(P, { path: PATH, clientId: B });
      expect(ok(await h.store.open(P, PATH)).doc.lease).toBeNull();
      const other = harness();
      ok(await other.store.lease(P, { path: PATH, clientId: A }));
      await other.store.close(P, { path: PATH, clientId: B });
      expect(other.store.size).toBe(1);
      const pending = harness();
      ok(await pending.store.propose(P, propose()));
      await pending.store.close(P, { path: PATH, clientId: A });
      expect(pending.store.size).toBe(1);
      expect(await pending.store.close(P, { path: 'none.agent', clientId: A })).toEqual({ ok: true });
      expect(await pending.store.close(P, { path: PATH, clientId: '' })).toMatchObject({ code: 'invalid_input' });
    });
  });
});

describe('saved', () => {
  it('rebases on the saved sha, clears dirty and the buffer', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const dirty = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'new\n' })).doc;
    expect(h.kvData.get(`agentdoc:buffers:${P}`)).toMatchObject({ buffers: [{ path: PATH, text: 'new\n' }] });
    h.tick(1000);
    const saved = ok(await h.store.saved(P, { path: PATH, clientId: A, sha256: sha256Hex('new\n'), text: 'new\n' })).doc;
    expect(saved).toMatchObject({ dirty: false, savedText: null, text: 'new\n', baseSha256: sha256Hex('new\n') });
    expect(saved.rev).toBeGreaterThan(dirty.rev);
    expect(saved.lease!.renewedAt).toBe(h.clock());
    expect(h.events.at(-1)?.kind).toBe('saved');
    expect(h.kvData.get(`agentdoc:buffers:${P}`)).toEqual({ buffers: [] });
  });
  it('refuses another holder, bad input, and handles over-cap text', async () => {
    const h = harness({ textMax: 8 });
    const { doc } = ok(await h.store.open(P, PATH));
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x' }));
    expect(await h.store.saved(P, { path: PATH, clientId: B, sha256: sha256Hex('x'), text: 'x' })).toMatchObject({ code: 'leased' });
    expect(await h.store.saved(P, { path: PATH, clientId: A, sha256: 'nope', text: 'x' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.saved(P, { path: PATH, clientId: A, sha256: sha256Hex('x'), text: 1 as never })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.saved(P, { path: PATH, clientId: '', sha256: sha256Hex('x'), text: 'x' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.saved(P, { path: 'missing.agent', clientId: A, sha256: sha256Hex('x'), text: 'x' })).toMatchObject({ code: 'not_found' });
    const big = 'y'.repeat(40);
    expect(ok(await h.store.saved(P, { path: PATH, clientId: A, sha256: sha256Hex(big), text: big })).doc).toMatchObject({ text: null, tooLarge: true, dirty: false });
  });
  it('is accepted without a lease (it lapsed during the save)', async () => {
    const h = harness();
    const text = 'x\n';
    expect(ok(await h.store.saved(P, { path: PATH, clientId: A, sha256: sha256Hex(text), text })).doc).toMatchObject({ text, lease: null, dirty: false });
  });
});

describe('proposals', () => {
  it('records a pending proposal with a generated or mirrored id, idempotently', async () => {
    const h = harness();
    const one = ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { threadId: 'thread-1' })));
    expect(one.proposal).toMatchObject({ id: 'id-1', status: 'pending', threadId: 'thread-1', createdAt: h.clock() });
    expect(one.doc.proposals).toHaveLength(1);
    expect(h.events.at(-1)?.kind).toBe('proposals');
    const mirrored = ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'studio-9', threadId: 7 })));
    expect(mirrored.proposal.id).toBe('studio-9');
    expect(mirrored.proposal.threadId).toBeUndefined();
    const events = h.events.length;
    const again = ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'studio-9' })));
    expect(again.doc.proposals).toHaveLength(2);
    expect(h.events).toHaveLength(events);
  });
  it('validates the proposal, id and target', async () => {
    const h = harness();
    expect(await h.store.propose(P, { path: PATH, input: { nope: 1 } })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.propose(P, { ...propose('other.agent'), path: PATH })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.propose(P, propose(PATH, 'a', { id: 5 }))).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.propose(P, propose(PATH, 'a', { id: 'i'.repeat(101) }))).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.propose('', propose())).toMatchObject({ code: 'project_required' });
    expect(await h.store.propose(P, propose('missing.agent'))).toMatchObject({ code: 'not_found' });
    const edits = (list: unknown[]) => ({ path: PATH, input: { path: PATH, expectedSha256: sha256Hex('a\nb\nc\n'), summary: 'e', edits: list } });
    expect(await h.store.propose(P, edits([{ startLine: 2, endLine: 9, text: 'x' }]))).toMatchObject({ code: 'invalid_input', error: expect.stringContaining('outside the file'), doc: { path: PATH } });
    expect(await h.store.propose(P, edits([{ startLine: 1, endLine: 2, text: 'x' }, { startLine: 2, endLine: 3, text: 'y' }]))).toMatchObject({ code: 'invalid_input', error: 'Proposed edits overlap.' });
  });
  it('caps proposals, dropping the oldest resolved first and refusing when all are open', async () => {
    const h = harness({ maxProposals: 3 });
    for (const id of ['p1', 'p2', 'p3']) { h.tick(1); ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id }))); }
    const full = await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p4' }));
    expect(full).toMatchObject({ ok: false, code: 'proposals_full', doc: { proposals: expect.any(Array) } });
    ok(await h.store.resolve(P, { path: PATH, id: 'p2', decision: 'reject' }));
    const next = ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p4' })));
    expect(next.doc.proposals.map(row => row.id)).toEqual(['p1', 'p3', 'p4']);
  });
});

describe('resolve', () => {
  async function withProposal(h = harness(), extra: Record<string, unknown> = {}) {
    const { doc } = ok(await h.store.open(P, PATH));
    const { proposal } = ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p1', ...extra })));
    return { h, doc, proposal };
  }
  it('rejects and marks applied as accepted', async () => {
    const { h } = await withProposal();
    ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p2' })));
    const rejected = ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'reject' }));
    expect(rejected.proposal).toMatchObject({ status: 'rejected', resolvedAt: h.clock() });
    const applied = ok(await h.store.resolve(P, { path: PATH, id: 'p2', decision: 'applied' }));
    expect(applied.proposal.status).toBe('accepted');
    expect(h.io.writes).toBe(0);
    expect(applied.doc.proposals.map(row => row.status)).toEqual(['rejected', 'accepted']);
  });
  it('is idempotent for the same outcome and refuses contradicting ones', async () => {
    const { h } = await withProposal();
    ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'applied' }));
    const events = h.events.length;
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'applied' })).proposal.status).toBe('accepted');
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept' })).proposal.status).toBe('accepted');
    expect(h.events).toHaveLength(events);
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'reject' })).toMatchObject({ ok: false, code: 'already_resolved' });
    ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p2' })));
    ok(await h.store.resolve(P, { path: PATH, id: 'p2', decision: 'reject' }));
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p2', decision: 'reject' })).proposal.status).toBe('rejected');
    expect(await h.store.resolve(P, { path: PATH, id: 'p2', decision: 'applied' })).toMatchObject({ code: 'already_resolved' });
  });
  it('validates arguments and unknown proposals', async () => {
    const { h } = await withProposal();
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'maybe' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.resolve(P, { path: PATH, id: '', decision: 'accept' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.resolve(P, { path: '../x.agent', id: 'p1', decision: 'accept' })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.resolve(P, { path: PATH, id: 'nope', decision: 'accept' })).toMatchObject({ code: 'not_found', doc: { path: PATH } });
    expect(await h.store.resolve(P, { path: 'closed.agent', id: 'p1', decision: 'accept' })).toMatchObject({ code: 'not_found' });
  });
  it('accept by the lease holder is accepted so the editor applies it; a non-holder gets accept-requested', async () => {
    const { h, doc } = await withProposal();
    ok(await h.store.lease(P, { path: PATH, clientId: A, label: 'Studio' }));
    const requested = ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept', clientId: B }));
    expect(requested.proposal.status).toBe('accept-requested');
    expect(requested.proposal.resolvedAt).toBeUndefined();
    const rev = requested.doc.rev;
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept' })).doc.rev).toBe(rev);
    ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p2' })));
    const holder = ok(await h.store.resolve(P, { path: PATH, id: 'p2', decision: 'accept', clientId: A }));
    expect(holder.proposal.status).toBe('accepted');
    expect(h.io.writes).toBe(0);
    // The editor applies the requested one and resolves it.
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'applied', clientId: A })).proposal.status).toBe('accepted');
    expect(doc.rev).toBeLessThan(rev);
  });
  it('accept with no live lease writes the applied text to disk and rebases the doc', async () => {
    const { h } = await withProposal();
    const result = ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept' }));
    expect(h.disk.get(PATH)).toBe('a\nB\nc\n');
    expect(result.proposal.status).toBe('accepted');
    expect(result.doc).toMatchObject({ text: 'a\nB\nc\n', dirty: false, baseSha256: sha256Hex('a\nB\nc\n') });
    expect(h.events.at(-1)?.kind).toBe('saved');
  });
  it('accept after a lapsed lease writes to disk', async () => {
    const { h } = await withProposal();
    ok(await h.store.lease(P, { path: PATH, clientId: A }));
    h.tick(AGENT_DOC_LEASE_TTL_MS);
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept' })).proposal.status).toBe('accepted');
    expect(h.disk.get(PATH)).toBe('a\nB\nc\n');
  });
  it('writes content proposals and handles an over-cap result', async () => {
    const h = harness({ textMax: 8 });
    ok(await h.store.open(P, PATH));
    ok(await h.store.propose(P, { path: PATH, id: 'c1', input: { path: PATH, expectedSha256: sha256Hex('a\nb\nc\n'), summary: 's', edits: [{ startLine: 2, endLine: 2, text: 'z'.repeat(8) }] } }));
    const result = ok(await h.store.resolve(P, { path: PATH, id: 'c1', decision: 'accept' }));
    const written = `a\n${'z'.repeat(8)}\nc\n`;
    expect(h.disk.get(PATH)).toBe(written);
    expect(result.doc).toMatchObject({ text: null, tooLarge: true, dirty: false, baseSha256: sha256Hex(written) });
  });
  it('refuses when the doc is dirty without a lease', async () => {
    const { h } = await withProposal();
    const doc = ok(await h.store.open(P, PATH)).doc;
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'edited' }));
    h.tick(AGENT_DOC_LEASE_TTL_MS);
    const result = await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept' });
    expect(result).toMatchObject({ ok: false, code: 'dirty', doc: { dirty: true } });
    expect(h.disk.get(PATH)).toBe('a\nb\nc\n');
  });
  it('reports a conflict when disk moved on, and resyncs the doc', async () => {
    const { h } = await withProposal();
    h.disk.set(PATH, 'other\n');
    const result = await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept' });
    expect(result).toMatchObject({ ok: false, code: 'conflict', doc: { text: 'other\n' } });
    expect(h.io.writes).toBe(0);
  });
  it('reports a conflict when the write itself loses the race, and passes other write errors through', async () => {
    const { h } = await withProposal();
    const write = h.io.write;
    h.io.write = async (...args) => { h.disk.set(PATH, 'raced'); return write(...args); };
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept' })).toMatchObject({ code: 'conflict' });
    h.disk.set(PATH, 'a\nb\nc\n');
    h.io.write = async () => ({ ok: false, code: 'path_refused', error: 'no' });
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept' })).toMatchObject({ code: 'path_refused' });
  });
  it('passes a read failure through and checks the viewer sha', async () => {
    const { h } = await withProposal();
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept', sha256: sha256Hex('stale') })).toMatchObject({ code: 'conflict' });
    h.disk.delete(PATH);
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept', sha256: sha256Hex('a\nb\nc\n') })).toMatchObject({ code: 'not_found' });
  });
});

describe('LRU of open documents', () => {
  const files = { 'a.agent': 'a', 'b.agent': 'b', 'c.agent': 'c', 'd.agent': 'd' };
  it('evicts the least recently used clean document', async () => {
    const h = harness({ maxOpen: 2 }, files);
    ok(await h.store.open(P, 'a.agent')); ok(await h.store.open(P, 'b.agent'));
    ok(await h.store.open(P, 'a.agent')); // a is now newest
    ok(await h.store.open(P, 'c.agent'));
    expect(h.store.size).toBe(2);
    h.io.reads = 0;
    ok(await h.store.open(P, 'a.agent'));
    expect(h.io.reads).toBe(0); // still in memory (and checked moments ago)
    ok(await h.store.open(P, 'b.agent'));
    expect(h.store.size).toBe(2);
  });
  it('never evicts a dirty doc with a live lease, and refuses to open when all are pinned', async () => {
    const h = harness({ maxOpen: 2 }, files);
    for (const path of ['a.agent', 'b.agent']) {
      const { doc } = ok(await h.store.open(P, path));
      ok(await h.store.update(P, { path, clientId: A, rev: doc.rev, text: `${path} edited` }));
    }
    expect(await h.store.open(P, 'c.agent')).toMatchObject({ ok: false, code: 'too_many_open' });
    expect(h.store.size).toBe(2);
    h.tick(AGENT_DOC_LEASE_TTL_MS); // leases lapse: dirty docs are evictable (their buffer is persisted)
    ok(await h.store.open(P, 'c.agent'));
    expect(h.store.size).toBe(2);
    expect((h.kvData.get(`agentdoc:buffers:${P}`) as { buffers: unknown[] }).buffers).toHaveLength(2);
    // The evicted dirty doc comes back from its buffer.
    ok(await h.store.open(P, 'd.agent'));
    expect(ok(await h.store.open(P, 'a.agent')).doc).toMatchObject({ text: 'a.agent edited', dirty: true, savedText: 'a' });
  });
  it('keeps documents of different projects apart', async () => {
    const h = harness({}, files);
    const one = ok(await h.store.open('p1', 'a.agent')).doc;
    const two = ok(await h.store.open('p2', 'a.agent')).doc;
    ok(await h.store.update('p1', { path: 'a.agent', clientId: A, rev: one.rev, text: 'x' }));
    expect(ok(await h.store.open('p2', 'a.agent')).doc).toMatchObject({ rev: two.rev, dirty: false });
  });
});

describe('buffer persistence', () => {
  const key = `agentdoc:buffers:${P}`;
  it('restores a buffer whose base still matches disk after a restart', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'unsaved\n' }));
    const restarted = new AgentScriptDocumentStore({ kv: h.kv, io: h.io, now: () => h.clock() });
    expect(ok(await restarted.open(P, PATH)).doc).toMatchObject({ text: 'unsaved\n', dirty: true, savedText: 'a\nb\nc\n', lease: null });
  });
  it('restores a buffer whose disk moved on against its true base, and drops one that equals disk', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'unsaved\n' }));
    h.disk.set(PATH, 'moved\n');
    const restarted = new AgentScriptDocumentStore({ kv: h.kv, io: h.io });
    expect(ok(await restarted.open(P, PATH)).doc).toMatchObject({ text: 'unsaved\n', dirty: true, savedText: 'moved\n', baseSha256: sha256Hex('a\nb\nc\n') });
    h.disk.set(PATH, 'unsaved\n');
    const again = new AgentScriptDocumentStore({ kv: h.kv, io: h.io });
    expect(ok(await again.open(P, PATH)).doc).toMatchObject({ text: 'unsaved\n', dirty: false });
    await vi.waitFor(() => expect(h.kvData.get(key)).toEqual({ buffers: [] }));
  });
  it('caps buffers by count (newest win) and by total bytes', async () => {
    const files = Object.fromEntries(['a', 'b', 'c', 'd'].map(n => [`${n}.agent`, n]));
    const h = harness({ maxBuffers: 2 }, files);
    for (const n of ['a', 'b', 'c']) {
      const { doc } = ok(await h.store.open(P, `${n}.agent`));
      ok(await h.store.update(P, { path: `${n}.agent`, clientId: A, rev: doc.rev, text: `${n}!` }));
      h.tick(10);
    }
    expect((h.kvData.get(key) as { buffers: Array<{ path: string }> }).buffers.map(row => row.path)).toEqual(['c.agent', 'b.agent']);
    const bytes = harness({ buffersBytes: 10 }, files);
    for (const n of ['a', 'b']) {
      const { doc } = ok(await bytes.store.open(P, `${n}.agent`));
      ok(await bytes.store.update(P, { path: `${n}.agent`, clientId: A, rev: doc.rev, text: `${n}`.repeat(6) }));
      bytes.tick(10);
    }
    expect((bytes.kvData.get(key) as { buffers: Array<{ path: string }> }).buffers.map(row => row.path)).toEqual(['b.agent']);
  });
  it('serializes writes per project so no buffer is lost', async () => {
    const files = Object.fromEntries(['a', 'b', 'c'].map(n => [`${n}.agent`, n]));
    const h = harness({}, files);
    const docs = await Promise.all(['a', 'b', 'c'].map(async n => ok(await h.store.open(P, `${n}.agent`)).doc));
    await Promise.all(docs.map(doc => h.store.update(P, { path: doc.path, clientId: A, rev: doc.rev, text: `${doc.path}!` })));
    expect((h.kvData.get(key) as { buffers: unknown[] }).buffers).toHaveLength(3);
  });
  it('never fails an edit when kv is broken, and ignores malformed stored buffers', async () => {
    const h = harness();
    h.kv.set.mockRejectedValue(new Error('disk full'));
    const { doc } = ok(await h.store.open(P, PATH));
    expect(ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x' })).doc.dirty).toBe(true);
    const bad = harness();
    bad.kvData.set(key, { buffers: [null, { path: 1 }, { path: PATH, text: 'ok', baseSha256: sha256Hex('a\nb\nc\n'), updatedAt: 1 }] });
    expect(ok(await bad.store.open(P, PATH)).doc).toMatchObject({ text: 'ok', dirty: true });
    const broken = harness();
    broken.kv.get.mockRejectedValue(new Error('kv down'));
    expect(ok(await broken.store.open(P, PATH)).doc.dirty).toBe(false);
    const empty = harness();
    empty.kvData.set(key, { buffers: 'nope' });
    expect(ok(await empty.store.open(P, PATH)).doc.dirty).toBe(false);
  });
});

describe('registerAgentScriptDocuments', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  function setup(opts: { projectId?: string | null; root?: string } = {}) {
    const root = opts.root ?? mkdtempSync(join(tmpdir(), 'sf-agentdoc-'));
    dirs.push(root);
    const files: Record<string, string> = { [PATH]: 'a\nb\nc\n' };
    for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
    const handlers = new Map<string, (args: unknown) => Promise<any>>();
    const published: Array<[string, unknown]> = [];
    const kvData = new Map<string, unknown>();
    const studio = {
      zcc: {
        storage: { kv: { get: async (k: string) => kvData.get(k), set: async (k: string, v: unknown) => { kvData.set(k, v); } } },
        realtime: { publish: (channel: string, payload: unknown) => { published.push([channel, payload]); } }
      },
      registerRpc: (name: string, handler: (args: unknown) => Promise<any>) => handlers.set(name, handler),
      contexts: { current: () => opts.projectId === null ? undefined : { projectId: opts.projectId ?? P, settings: { projectRoot: root } } },
      deps: createNodeDeps()
    } as unknown as StudioServerContext;
    registerAgentScriptDocuments(studio);
    return { call: (name: string, args: unknown) => handlers.get(name)!(args), root, published, handlers };
  }
  it('registers every RPC', () => {
    expect([...setup().handlers.keys()].sort()).toEqual(Object.values(AGENT_DOC_RPC).sort());
  });
  it('answers project_required without a project context', async () => {
    const h = setup({ projectId: null });
    for (const name of Object.values(AGENT_DOC_RPC)) expect(await h.call(name, { path: PATH })).toMatchObject({ ok: false, code: 'project_required' });
  });
  it('runs the full flow through the plugin agent-file path, publishing realtime changes', async () => {
    const h = setup();
    const opened = await h.call(AGENT_DOC_RPC.open, { path: PATH });
    expect(opened).toMatchObject({ ok: true, doc: { text: 'a\nb\nc\n', dirty: false } });
    const leased = await h.call(AGENT_DOC_RPC.lease, { path: PATH, clientId: A, label: 'Studio', take: false });
    expect(leased.doc.lease.label).toBe('Studio');
    const updated = await h.call(AGENT_DOC_RPC.update, { path: PATH, clientId: A, rev: leased.doc.rev, text: 'a\nX\nc\n' });
    expect(updated.doc.dirty).toBe(true);
    expect(await h.call(AGENT_DOC_RPC.update, { path: PATH, clientId: A, text: 'a' })).toMatchObject({ code: 'invalid_input' });
    const proposed = await h.call(AGENT_DOC_RPC.propose, { path: PATH, id: 'pp', threadId: 't', input: { path: PATH, expectedSha256: sha256Hex('a\nb\nc\n'), summary: 's', edits: [{ startLine: 3, endLine: 3, text: 'C' }] } });
    expect(proposed.proposal.id).toBe('pp');
    expect(await h.call(AGENT_DOC_RPC.resolve, { path: PATH, id: 'pp', decision: 'accept', clientId: B })).toMatchObject({ ok: true, proposal: { status: 'accept-requested' } });
    expect(await h.call(AGENT_DOC_RPC.resolve, { path: PATH, id: 'pp', decision: 'applied', clientId: A })).toMatchObject({ ok: true, proposal: { status: 'accepted' } });
    const text = 'a\nX\nC\n';
    const applied = await h.call(AGENT_DOC_RPC.update, { path: PATH, clientId: A, rev: (await h.call(AGENT_DOC_RPC.open, { path: PATH })).doc.rev, text });
    expect(applied.ok).toBe(true);
    expect(await h.call(AGENT_DOC_RPC.saved, { path: PATH, clientId: A, sha256: sha256Hex(text), text })).toMatchObject({ ok: true, doc: { dirty: false } });
    expect(await h.call(AGENT_DOC_RPC.release, { path: PATH, clientId: A })).toEqual({ ok: true });
    expect(await h.call(AGENT_DOC_RPC.close, { path: PATH, clientId: A })).toEqual({ ok: true });
    expect(h.published.every(([channel]) => channel === AGENT_DOC_CHANNEL)).toBe(true);
    expect(h.published.map(([, change]) => (change as AgentDocChange).kind)).toEqual(expect.arrayContaining(['lease', 'text', 'proposals', 'saved', 'closed']));
  });
  it('accepts a proposal to disk with no lease and announces the file change', async () => {
    const h = setup();
    await h.call(AGENT_DOC_RPC.propose, { path: PATH, id: 'd1', input: { path: PATH, expectedSha256: sha256Hex('a\nb\nc\n'), summary: 's', edits: [{ startLine: 1, endLine: 1, text: 'A' }] } });
    expect(await h.call(AGENT_DOC_RPC.resolve, { path: PATH, id: 'd1', decision: 'accept', sha256: '' })).toMatchObject({ ok: true, proposal: { status: 'accepted' } });
    expect(readFileSync(join(h.root, PATH), 'utf8')).toBe('A\nb\nc\n');
    expect(h.published).toContainEqual(['sf.studio.changed', expect.objectContaining({ kind: 'files', path: PATH })]);
  });
  it('maps filesystem refusals to failures and tolerates junk args', async () => {
    const h = setup();
    expect(await h.call(AGENT_DOC_RPC.open, { path: 'missing.agent' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await h.call(AGENT_DOC_RPC.open, null)).toMatchObject({ ok: false, code: 'invalid_input' });
    const noRoot = setup({ root: '' });
    expect(await noRoot.call(AGENT_DOC_RPC.open, { path: PATH })).toMatchObject({ ok: false });
    // A symlink-free path that escapes is refused by the safe-path check before any read.
    expect(await h.call(AGENT_DOC_RPC.open, { path: '../outside.agent' })).toMatchObject({ ok: false, code: 'invalid_input' });
  });
  it('reports a write refusal and a throwing realtime publisher without failing', async () => {
    const h = setup();
    await h.call(AGENT_DOC_RPC.propose, { path: PATH, id: 'w1', input: { path: PATH, expectedSha256: sha256Hex('a\nb\nc\n'), summary: 's', content: 'new\n' } });
    writeFileSync(join(h.root, PATH), 'raced\n');
    expect(await h.call(AGENT_DOC_RPC.resolve, { path: PATH, id: 'w1', decision: 'accept' })).toMatchObject({ ok: false, code: 'conflict' });
  });
});

describe('review fixes', () => {
  const sha = sha256Hex('a\nb\nc\n');
  const prop = (id: string, extra: Record<string, unknown> = {}) => ({ path: PATH, id, input: { path: PATH, expectedSha256: sha, summary: 's', edits: [{ startLine: 2, endLine: 2, text: 'B' }], ...extra } });

  it('H1: refuses a non-holder accept of a stale proposal while a lease is live', async () => {
    const h = harness();
    ok(await h.store.open(P, PATH));
    ok(await h.store.propose(P, { ...prop('old'), input: { ...prop('old').input, expectedSha256: sha256Hex('zzz') } }));
    ok(await h.store.lease(P, { path: PATH, clientId: A }));
    expect(await h.store.resolve(P, { path: PATH, id: 'old', decision: 'accept', clientId: B })).toMatchObject({ ok: false, code: 'conflict', doc: { proposals: [{ status: 'pending' }] } });
    ok(await h.store.propose(P, prop('fresh')));
    expect(await h.store.resolve(P, { path: PATH, id: 'fresh', decision: 'accept', clientId: B, sha256: sha256Hex('other') })).toMatchObject({ code: 'conflict' });
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'fresh', decision: 'accept', clientId: B, sha256: sha })).proposal.status).toBe('accept-requested');
  });

  it('H4: a save of an older text keeps the newer live text dirty against the saved base', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const t1 = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'T1\n' })).doc;
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: t1.rev, text: 'T2\n' }));
    const saved = ok(await h.store.saved(P, { path: PATH, clientId: A, sha256: sha256Hex('T1\n'), text: 'T1\n' })).doc;
    expect(saved).toMatchObject({ text: 'T2\n', dirty: true, savedText: 'T1\n', baseSha256: sha256Hex('T1\n') });
    expect(h.kvData.get(`agentdoc:buffers:${P}`)).toMatchObject({ buffers: [{ text: 'T2\n', baseSha256: sha256Hex('T1\n') }] });
    const final = ok(await h.store.saved(P, { path: PATH, clientId: A, sha256: sha256Hex('T2\n'), text: 'T2\n' })).doc;
    expect(final).toMatchObject({ dirty: false, savedText: null });
  });

  it('M4: refuses an oversized proposal and drops the body of resolved ones', async () => {
    const h = harness({ textMax: 20 });
    ok(await h.store.open(P, PATH));
    expect(await h.store.propose(P, { path: PATH, input: { path: PATH, expectedSha256: sha, summary: 's', content: 'x'.repeat(21) } })).toMatchObject({ code: 'invalid_input' });
    expect(await h.store.propose(P, { path: PATH, input: { path: PATH, expectedSha256: sha, summary: 's', edits: [{ startLine: 1, endLine: 1, text: 'x'.repeat(12) }, { startLine: 2, endLine: 2, text: 'y'.repeat(12) }] } })).toMatchObject({ code: 'invalid_input' });
    ok(await h.store.propose(P, prop('r')));
    const rejected = ok(await h.store.resolve(P, { path: PATH, id: 'r', decision: 'reject' })).proposal;
    expect(rejected.input).toEqual({ path: PATH, expectedSha256: sha, summary: 's' });
    // Holder accept keeps the body for the editor; the editor's 'applied' then drops it.
    ok(await h.store.lease(P, { path: PATH, clientId: A }));
    ok(await h.store.propose(P, prop('h')));
    const accepted = ok(await h.store.resolve(P, { path: PATH, id: 'h', decision: 'accept', clientId: A })).proposal;
    expect(accepted).toMatchObject({ status: 'accepted', input: { edits: expect.any(Array) } });
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'h', decision: 'applied' })).proposal.input.edits).toBeUndefined();
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'h', decision: 'applied' })).proposal.status).toBe('accepted');
  });

  it('M4: a disk accept also drops the body', async () => {
    const h = harness();
    ok(await h.store.open(P, PATH));
    ok(await h.store.propose(P, prop('d')));
    const done = ok(await h.store.resolve(P, { path: PATH, id: 'd', decision: 'accept' })).proposal;
    expect(done).toMatchObject({ status: 'accepted' });
    expect(done.input.edits).toBeUndefined();
  });

  it('L3: never evicts a doc with an open proposal', async () => {
    const files = { 'a.agent': 'a', 'b.agent': 'b', 'c.agent': 'c' };
    const h = harness({ maxOpen: 2 }, files);
    ok(await h.store.open(P, 'a.agent'));
    ok(await h.store.propose(P, { path: 'a.agent', input: { path: 'a.agent', expectedSha256: sha256Hex('a'), summary: 's', content: 'A' } }));
    ok(await h.store.open(P, 'b.agent'));
    ok(await h.store.open(P, 'c.agent')); // evicts b, not the older a
    ok(await h.store.propose(P, { path: 'c.agent', input: { path: 'c.agent', expectedSha256: sha256Hex('c'), summary: 's', content: 'C' } }));
    expect(await h.store.open(P, 'b.agent')).toMatchObject({ ok: false, code: 'too_many_open' });
  });

  it('L4: an implicit lease uses the given label or a friendly default', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const named = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x', label: 'L'.repeat(100) })).doc;
    expect(named.lease!.label).toBe('L'.repeat(80));
    const g = harness();
    const d2 = ok(await g.store.open(P, PATH)).doc;
    expect(ok(await g.store.update(P, { path: PATH, clientId: A, rev: d2.rev, text: 'x', label: '  ' })).doc.lease!.label).toBe('Agentforce Studio');
  });

  it('L2: open skips the disk read inside the check window and re-reads after it', async () => {
    const h = harness();
    ok(await h.store.open(P, PATH));
    h.io.reads = 0;
    h.disk.set(PATH, 'moved\n');
    expect(ok(await h.store.open(P, PATH)).doc.text).toBe('a\nb\nc\n');
    expect(h.io.reads).toBe(0);
    h.tick(2500);
    expect(ok(await h.store.open(P, PATH)).doc.text).toBe('moved\n');
    expect(h.io.reads).toBe(1);
  });

  it('M6: a dirty doc whose disk text converges to the live text becomes clean on the new base', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'same\n' }));
    h.disk.set(PATH, 'same\n'); h.tick(3000);
    expect(ok(await h.store.open(P, PATH)).doc).toMatchObject({ dirty: false, baseSha256: sha256Hex('same\n') });
    // an update back to the (new) disk text is clean as well
    const live = ok(await h.store.open(P, PATH)).doc;
    ok(await h.store.update(P, { path: PATH, clientId: A, rev: live.rev, text: 'edit\n' }));
    h.disk.set(PATH, 'later\n'); h.tick(3000);
    const moved = ok(await h.store.open(P, PATH)).doc;
    expect(moved.baseSha256).toBe(sha256Hex('same\n'));
    expect(ok(await h.store.update(P, { path: PATH, clientId: A, rev: moved.rev, text: 'later\n' })).doc).toMatchObject({ dirty: false, baseSha256: sha256Hex('later\n') });
  });
});

describe('second review fixes', () => {
  it('final review 2: a lapse found lazily is a change: the rev moves and it is announced after the call', async () => {
    const h = harness();
    ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p1' })));
    const held = ok(await h.store.lease(P, { path: PATH, clientId: A, label: 'Studio' })).doc;
    ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept', clientId: B }));
    h.events.length = 0;
    h.tick(AGENT_DOC_LEASE_TTL_MS);
    const lapsed = ok(await h.store.open(P, PATH)).doc;
    expect(lapsed.lease).toBeNull();
    expect(lapsed.proposals.find(row => row.id === 'p1')?.status).toBe('pending');
    expect(lapsed.rev).toBeGreaterThan(held.rev);
    await Promise.resolve();
    expect(h.events).toEqual([{ projectId: P, path: PATH, rev: lapsed.rev, kind: 'lease' }]);
    // Announced once: the next read finds no lease to drop.
    ok(await h.store.open(P, PATH)); await Promise.resolve();
    expect(h.events).toHaveLength(1);
  });

  it('final review 2: an edit on the rev from before a lapse found during that update is not stale', async () => {
    const h = harness();
    const held = ok(await h.store.lease(P, { path: PATH, clientId: A })).doc;
    h.tick(AGENT_DOC_LEASE_TTL_MS);
    const next = ok(await h.store.update(P, { path: PATH, clientId: A, rev: held.rev, text: 'after lapse\n' })).doc;
    expect(next).toMatchObject({ text: 'after lapse\n', lease: { clientId: A } });
    expect(await h.store.update(P, { path: PATH, clientId: A, rev: held.rev, text: 'x\n' })).toMatchObject({ ok: false, code: 'stale' });
  });

  const S2 = sha256Hex('a\nb\nc\nd\n');

  it('2: records the client whose update last changed the text', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    expect(doc.lastWriter).toBeNull();
    const first = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'mine\n' })).doc;
    expect(first.lastWriter).toBe(A);
    // A diagnostics-only update does not change the writer.
    const taken = ok(await h.store.lease(P, { path: PATH, clientId: B, take: true })).doc;
    const diag = ok(await h.store.update(P, { path: PATH, clientId: B, rev: taken.rev, text: 'mine\n', diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error', message: 'x' }] })).doc;
    expect(diag.lastWriter).toBe(A);
    expect(ok(await h.store.update(P, { path: PATH, clientId: B, rev: diag.rev, text: 'theirs\n' })).doc.lastWriter).toBe(B);
  });

  it('6: a renewal names its grant; the same client without one gets a fresh grant, a stale grant id is refused', async () => {
    const h = harness();
    const one = ok(await h.store.lease(P, { path: PATH, clientId: A })).doc.lease!;
    expect(one.id).toBe('id-1');
    // A reload of the same window: no grant id, a new grant.
    const two = ok(await h.store.lease(P, { path: PATH, clientId: A })).doc;
    expect(two.lease!.id).not.toBe(one.id);
    // The old session renewing with its old grant: someone else holds it now.
    expect(await h.store.lease(P, { path: PATH, clientId: A, leaseId: one.id })).toMatchObject({ ok: false, code: 'leased' });
    expect(await h.store.update(P, { path: PATH, clientId: A, rev: two.rev, text: 'old\n', leaseId: one.id })).toMatchObject({ ok: false, code: 'leased' });
    // ...and its close or release leaves the new grant alone.
    await h.store.close(P, { path: PATH, clientId: A, leaseId: one.id });
    await h.store.release(P, { path: PATH, clientId: A, leaseId: one.id });
    expect(ok(await h.store.open(P, PATH)).doc.lease!.id).toBe(two.lease!.id);
    // The current grant renews, then closes.
    expect(ok(await h.store.lease(P, { path: PATH, clientId: A, leaseId: two.lease!.id })).doc.lease!.id).toBe(two.lease!.id);
    expect(ok(await h.store.update(P, { path: PATH, clientId: A, rev: two.rev, text: 'new\n', leaseId: two.lease!.id })).doc.lease!.id).toBe(two.lease!.id);
    await h.store.release(P, { path: PATH, clientId: A, leaseId: two.lease!.id });
    expect(ok(await h.store.open(P, PATH)).doc.lease).toBeNull();
    // An empty grant id ("I hold none") never matches.
    ok(await h.store.lease(P, { path: PATH, clientId: A }));
    await h.store.close(P, { path: PATH, clientId: A, leaseId: '' });
    expect(ok(await h.store.open(P, PATH)).doc.lease).not.toBeNull();
  });

  it('6: an implicit grant from update carries an id, and a lapsed lease is granted anew to any grant id', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const upd = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'x\n', leaseId: 'gone' })).doc;
    expect(upd.lease).toMatchObject({ clientId: A, id: expect.any(String) });
    h.tick(AGENT_DOC_LEASE_TTL_MS);
    const regained = ok(await h.store.lease(P, { path: PATH, clientId: A, leaseId: upd.lease!.id })).doc;
    expect(regained.lease!.id).not.toBe(upd.lease!.id);
  });

  it('5: accept-requested falls back to pending when the lease lapses, is released or closed', async () => {
    for (const end of ['lapse', 'release', 'close'] as const) {
      const h = harness();
      ok(await h.store.open(P, PATH));
      const lease = ok(await h.store.lease(P, { path: PATH, clientId: A })).doc.lease!;
      ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p1' })));
      expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept', clientId: B })).proposal.status).toBe('accept-requested');
      if (end === 'lapse') h.tick(AGENT_DOC_LEASE_TTL_MS);
      else await h.store[end](P, { path: PATH, clientId: A, leaseId: lease.id });
      expect(ok(await h.store.open(P, PATH)).doc.proposals[0]!.status).toBe('pending');
      // ...so the thread can accept it again (written to disk) or reject it.
      expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept', clientId: B })).proposal.status).toBe('accepted');
      expect(h.disk.get(PATH)).toBe('a\nB\nc\n');
    }
    const h = harness();
    ok(await h.store.open(P, PATH));
    ok(await h.store.lease(P, { path: PATH, clientId: A }));
    ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p1' })));
    ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept', clientId: B }));
    h.tick(AGENT_DOC_LEASE_TTL_MS);
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'reject', clientId: B })).proposal.status).toBe('rejected');
  });

  it('8: under a live lease only the holder reports applied or settles an accept-requested proposal', async () => {
    const h = harness();
    ok(await h.store.open(P, PATH));
    ok(await h.store.lease(P, { path: PATH, clientId: A, label: 'Studio' }));
    ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p1' })));
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'applied', clientId: B })).toMatchObject({ ok: false, code: 'leased' });
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'applied' })).toMatchObject({ ok: false, code: 'leased' });
    ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'accept', clientId: B }));
    // The thread's reject racing the holder's apply: the holder wins.
    expect(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'reject', clientId: B })).toMatchObject({ ok: false, code: 'leased', error: 'Studio is applying this proposal.' });
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p1', decision: 'applied', clientId: A })).proposal.status).toBe('accepted');
    // A pending one may still be rejected from the thread while the lease is live.
    ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p2' })));
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p2', decision: 'reject', clientId: B })).proposal.status).toBe('rejected');
    // The holder rejects an accept-requested one it cannot apply.
    ok(await h.store.propose(P, propose(PATH, 'a\nb\nc\n', { id: 'p3' })));
    ok(await h.store.resolve(P, { path: PATH, id: 'p3', decision: 'accept', clientId: B }));
    expect(ok(await h.store.resolve(P, { path: PATH, id: 'p3', decision: 'reject', clientId: A })).proposal.status).toBe('rejected');
  });

  it('7: a dirty update adopts the editor base sha (validated), a clean one always sits on disk', async () => {
    const h = harness();
    const { doc } = ok(await h.store.open(P, PATH));
    const dirty = ok(await h.store.update(P, { path: PATH, clientId: A, rev: doc.rev, text: 'mine\n', baseSha256: S2 })).doc;
    expect(dirty.baseSha256).toBe(S2);
    expect((h.kvData.get(`agentdoc:buffers:${P}`) as { buffers: Array<{ baseSha256: string }> }).buffers[0]!.baseSha256).toBe(S2);
    // Only the base moved: still a change (new rev).
    const again = ok(await h.store.update(P, { path: PATH, clientId: A, rev: dirty.rev, text: 'mine\n', baseSha256: sha256Hex('a\nb\nc\n') })).doc;
    expect(again.rev).toBeGreaterThan(dirty.rev);
    expect(again.baseSha256).toBe(sha256Hex('a\nb\nc\n'));
    // Junk is ignored.
    expect(ok(await h.store.update(P, { path: PATH, clientId: A, rev: again.rev, text: 'mine\n', baseSha256: 'nope' })).doc.baseSha256).toBe(sha256Hex('a\nb\nc\n'));
    const clean = ok(await h.store.update(P, { path: PATH, clientId: A, rev: again.rev, text: 'a\nb\nc\n', baseSha256: S2 })).doc;
    expect(clean).toMatchObject({ dirty: false, baseSha256: sha256Hex('a\nb\nc\n') });
  });

  it('passes lease ids and base sha through the registered RPCs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentdoc-ids-'));
    try {
      mkdirSync(dirname(join(root, PATH)), { recursive: true });
      writeFileSync(join(root, PATH), 'a\n');
      const handlers = new Map<string, (args: unknown) => Promise<any>>();
      const kv = new Map<string, unknown>();
      registerAgentScriptDocuments({
        contexts: { current: () => ({ projectId: P, settings: { projectRoot: root } }) },
        deps: createNodeDeps(),
        zcc: { storage: { kv: { get: async (k: string) => kv.get(k), set: async (k: string, v: unknown) => { kv.set(k, v); } } }, realtime: { publish: () => undefined } },
        registerRpc: (name: string, handler: (args: unknown) => Promise<unknown>) => { handlers.set(name, handler); }
      } as unknown as StudioServerContext);
      const call = (name: string, args: unknown) => handlers.get(name)!(args);
      const first = await call(AGENT_DOC_RPC.lease, { path: PATH, clientId: A });
      const second = await call(AGENT_DOC_RPC.lease, { path: PATH, clientId: A });
      expect(await call(AGENT_DOC_RPC.lease, { path: PATH, clientId: A, leaseId: first.doc.lease.id })).toMatchObject({ code: 'leased' });
      const upd = await call(AGENT_DOC_RPC.update, { path: PATH, clientId: A, rev: second.doc.rev, text: 'b\n', leaseId: second.doc.lease.id, baseSha256: S2 });
      expect(upd.doc).toMatchObject({ baseSha256: S2, lastWriter: A });
      await call(AGENT_DOC_RPC.close, { path: PATH, clientId: A, leaseId: '' });
      await call(AGENT_DOC_RPC.release, { path: PATH, clientId: A, leaseId: first.doc.lease.id });
      expect((await call(AGENT_DOC_RPC.open, { path: PATH })).doc.lease.id).toBe(second.doc.lease.id);
      await call(AGENT_DOC_RPC.close, { path: PATH, clientId: A, leaseId: second.doc.lease.id });
      expect((await call(AGENT_DOC_RPC.open, { path: PATH })).doc.lease).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
