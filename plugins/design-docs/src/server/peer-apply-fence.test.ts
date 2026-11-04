import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginDatabase, PluginPeerRequest, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { DesignDocPeerService } from './peer-service.js';
import { DesignDocSyncStore, type PreparedTransfer } from './sync-store.js';
import { DesignDocStore } from './store.js';
import { createTransferHash, transferQuery, type PeerTransfer } from './peer-protocol.js';
import { MAX_PEER_CHUNK_BYTES } from '../shared/peer-limits.js';

/**
 * Counts full-closure validation/hash passes that run while the peer commit fence is held. The production worker
 * fence aborts the plugin after a fixed execution budget, so the fenced apply of a maximal document must not
 * repeat whole-closure work that can be done (once) before the fence.
 */
const passes = vi.hoisted(() => ({ inFence: false, validate: 0, hash: 0 }));
vi.mock('../shared/peer-contract.js', async (original) => {
  const actual = await original<typeof import('../shared/peer-contract.js')>();
  const large = (value: unknown): boolean => {
    const closure = (value as { closure?: unknown })?.closure ?? value;
    const files = (closure as { files?: Array<{ content?: unknown }> })?.files;
    return Array.isArray(files) && files.reduce((sum, file) => sum + (typeof file?.content === 'string' ? file.content.length : 0), 0) > 4 * 1024 * 1024;
  };
  return { ...actual,
    validateDocumentClosure: (input: unknown) => { if (passes.inFence && large(input)) passes.validate++; return actual.validateDocumentClosure(input); },
    canonicalPeerHash: (input: unknown) => { if (passes.inFence && large(input)) passes.hash++; return actual.canonicalPeerHash(input); } };
});

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
const user = { kind: 'user' as const, label: 'You', threadId: null };
const members = ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 }));
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((fn) => fn()); passes.inFence = false; });

function fixture(name: string) {
  const folder = mkdtempSync(join(tmpdir(), 'dd-fence-'));
  const raw = new Database(join(folder, 'docs.sqlite'));
  cleanup.push(() => { raw.close(); rmSync(folder, { recursive: true, force: true }); });
  const script = (sql: string) => { raw['exec'](sql); };
  const db: PluginDatabase = { prepare: (sql) => raw.prepare(sql), runScript: script,
    transaction: (fn) => raw.transaction(fn)(), migrate: (statements) => raw.transaction(() => statements.forEach(script))() };
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db);
  sync.initialize('repo', `replica-${name}`);
  sync.setGroup('repo', 'group', members);
  return { raw, store, sync, service: new DesignDocPeerService(sync) };
}

type Fence = <T>(fn: () => T) => Promise<T>;
const recordingFence: Fence = async (fn) => { passes.inFence = true; try { return fn(); } finally { passes.inFence = false; } };

/** Receiver handlers; the fence records the work done while it is held. */
function receiver(b: ReturnType<typeof fixture>) {
  const handlers = new Map<string, (request: PluginPeerRequest) => unknown>();
  b.service.register({ sdk: { peers: { handle: (method: string, handler: (request: PluginPeerRequest) => unknown) => handlers.set(method, handler) } },
    onDispose: (dispose: () => void) => cleanup.push(dispose) } as unknown as ZccPluginApi);
  return (method: string, body: unknown, commitSync: Fence = recordingFence) => Promise.resolve(handlers.get(method)!({ peerId: 'machine-a', body,
    grantEpoch: 1, scope: 'repo', signal: new AbortController().signal, commitSync } as PluginPeerRequest)) as Promise<any>;
}

async function stage(a: ReturnType<typeof fixture>, send: ReturnType<typeof receiver>, transfer: PeerTransfer): Promise<void> {
  await send('transfer', transfer);
  const missing = await send('missing', transferQuery(transfer)) as { chunks: Array<{ blobHash: string; index: number }> };
  for (const chunk of missing.chunks) await send('chunk', a.sync.outgoingChunk(transfer, chunk.blobHash, chunk.index));
}

function frozenTransfer(a: ReturnType<typeof fixture>, docId: string): PeerTransfer {
  const intent = a.sync.freezeManual().find((candidate) => candidate.frozenHead === a.sync.head('repo', docId))!;
  return a.service.createTransfer(intent, 1);
}

const maximalFiles = () => Array.from({ length: 12 }, (_, index) => index === 11
  ? { path: 'asset.png', content: Buffer.alloc(2 * 1024 * 1024, 255).toString('base64'), encoding: 'base64' as const }
  : { path: index === 0 ? 'README.md' : `file-${index}.md`, content: String.fromCharCode(65 + index).repeat(2 * 1024 * 1024) });

describe('fenced transfer apply stays within the worker commit budget', () => {
  it('hydrates and verifies a maximal 24MiB document before the fence; the fence only projects and re-verifies', async () => {
    const a = fixture('a'), b = fixture('b'), send = receiver(b);
    const files = maximalFiles();
    const doc = a.store.create({ title: 'Maximum worker fence', status: 'approved', files }, user);
    for (const revision of ['initial', 'rewrite'] as const) {
      if (revision === 'rewrite') a.store.writeFile(doc.id, { path: 'README.md', content: 'Z'.repeat(2 * 1024 * 1024) }, user);
      const transfer = frozenTransfer(a, doc.id);
      await stage(a, send, transfer);
      passes.validate = 0; passes.hash = 0;
      await expect(send('apply', transferQuery(transfer))).resolves.toMatchObject({ stage: 'synced', appliedHeads: transfer.heads });
      // Fenced work per projected document: capture the durable projection (validate + hash), plus on a rewrite the
      // existing local head's capture and the already-held ancestor's stored-integrity check. Before the fix the fence
      // re-hydrated and re-validated the incoming closure 6x (initial) / 11x (rewrite) and hashed it 20x / 27x.
      const limits = revision === 'initial' ? { validate: 1, hash: 1 } : { validate: 3, hash: 3 };
      expect(passes.validate, `${revision} fenced validations`).toBeLessThanOrEqual(limits.validate);
      expect(passes.hash, `${revision} fenced closure hashes`).toBeLessThanOrEqual(limits.hash);
      expect(b.sync.head('repo', doc.id)).toBe(transfer.heads[doc.id]);
      expect(b.raw.prepare("SELECT COUNT(*) AS n FROM sync_transfer_chunks WHERE direction = 'in'").get()).toEqual({ n: 0 });
    }
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('Z'.repeat(2 * 1024 * 1024));
    expect(b.store.readFile(doc.id, 'asset.png').content).toBe(files[11]!.content);
  }, 60_000);

  it('never trusts a preparation it did not mint and re-hydrates inside the fence instead', async () => {
    const a = fixture('a'), b = fixture('b'), send = receiver(b);
    const content = 'x'.repeat(MAX_PEER_CHUNK_BYTES + 7);
    const doc = a.store.create({ title: 'Forged preparation', status: 'approved', files: [{ path: 'README.md', content }] }, user);
    const transfer = frozenTransfer(a, doc.id), query = transferQuery(transfer);
    await stage(a, send, transfer);
    const prepared = b.sync.prepareTransfer(query)!;
    expect(prepared.versions).toHaveLength(transfer.versions.length);
    const forged: PreparedTransfer = { header: prepared.header, versions: [], used: transfer.blobs.length };
    expect(b.sync.applyTransfer(query, forged)).toMatchObject({ stage: 'synced', appliedHeads: transfer.heads });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe(content);
    // Applied sessions answer from the checkpoint; nothing is left to prepare.
    expect(b.sync.prepareTransfer(query)).toBeNull();
    expect(b.sync.applyTransfer(query, prepared)).toMatchObject({ stage: 'synced' });
  });

  it('refuses a held version id re-sent under a different operation', async () => {
    const a = fixture('a'), b = fixture('b'), send = receiver(b);
    const doc = a.store.create({ title: 'Replayed id', status: 'approved', files: [{ path: 'README.md', content: 'replay' }] }, user);
    const transfer = frozenTransfer(a, doc.id);
    await stage(a, send, transfer);
    await expect(send('apply', transferQuery(transfer))).resolves.toMatchObject({ stage: 'synced' });
    const [version] = transfer.versions;
    const { scopeHash: _scope, ...header } = transfer;
    const body = { ...header, sessionId: 'replayed-id', versions: [{ ...version!, operation: { ...version!.operation, sequence: version!.operation.sequence + 1 } }] };
    const replay = { ...body, scopeHash: createTransferHash(body) };
    await send('transfer', replay);
    const missing = await send('missing', transferQuery(replay)) as { chunks: Array<{ blobHash: string; index: number }> };
    for (const chunk of missing.chunks) await send('chunk', { ...a.sync.outgoingChunk(transfer, chunk.blobHash, chunk.index), ...transferQuery(replay) });
    await expect(send('apply', transferQuery(replay))).rejects.toThrow('operation id payload mismatch');
  });

  it('ignores a minted preparation once the staged header changed under it', async () => {
    const a = fixture('a'), b = fixture('b'), send = receiver(b);
    const doc = a.store.create({ title: 'Header swap', status: 'draft', files: [{ path: 'README.md', content: 'header' }] }, user);
    const transfer = frozenTransfer(a, doc.id), query = transferQuery(transfer);
    await stage(a, send, transfer);
    const prepared = b.sync.prepareTransfer(query)!;
    // The private-draft marker sits outside scopeHash, so only the fenced re-read of the header can see it.
    b.raw.prepare("UPDATE sync_transfers SET header_json = json_set(header_json, '$.manual', json('true')) WHERE direction = 'in'").run();
    expect(() => b.sync.applyTransfer(query, prepared)).toThrow('bilateral manual consent missing');
    expect(b.store.find(doc.id)).toBeNull();
  });

  it('reports staging failures before the fence is taken', async () => {
    const a = fixture('a'), b = fixture('b'), send = receiver(b);
    const doc = a.store.create({ title: 'Incomplete', status: 'approved', files: [{ path: 'README.md', content: 'y'.repeat(MAX_PEER_CHUNK_BYTES + 1) }] }, user);
    const transfer = frozenTransfer(a, doc.id);
    await send('transfer', transfer);
    let fenced = false;
    await expect(send('apply', transferQuery(transfer), async (fn) => { fenced = true; return fn(); })).rejects.toThrow('staged blob incomplete');
    expect(fenced).toBe(false);
  });
});

describe('transaction-scoped verified versions', () => {
  it('reuses a verified version only within one apply scope and never past a compaction or rewrite', () => {
    const a = fixture('a');
    const doc = a.store.create({ title: 'Cache', status: 'approved', files: [{ path: 'README.md', content: 'cached' }] }, user);
    const head = a.sync.head('repo', doc.id)!;
    const outside = [a.sync.version('repo', head), a.sync.version('repo', head)];
    expect(outside[0]).toEqual(outside[1]);
    expect(outside[0]).not.toBe(outside[1]);
    const scoped = a.sync as unknown as { withVerifiedVersions<T>(fn: () => T): T };
    let first: unknown;
    expect(() => a.raw.transaction(() => scoped.withVerifiedVersions(() => {
      first = a.sync.version('repo', head);
      expect(a.sync.version('repo', head)).toBe(first);
      expect(scoped.withVerifiedVersions(() => a.sync.version('repo', head))).toBe(first);
      a.raw.prepare('UPDATE sync_versions SET compacted = 1 WHERE head_id = ?').run(head);
      expect(a.sync.version('repo', head)).toBeNull();
      a.raw.prepare('UPDATE sync_versions SET compacted = 0 WHERE head_id = ?').run(head);
      a.raw.prepare("UPDATE sync_versions SET closure_json = json_set(closure_json, '$.doc.title', 'Tampered') WHERE head_id = ?").run(head);
      expect(() => a.sync.version('repo', head)).toThrow('immutable version payload hash mismatch');
      throw new Error('rollback');
    }))()).toThrow('rollback');
    // The scope ended with its (rolled back) transaction: reads are fresh again.
    const after = a.sync.version('repo', head);
    expect(after).toEqual(first);
    expect(after).not.toBe(first);
  });
});
