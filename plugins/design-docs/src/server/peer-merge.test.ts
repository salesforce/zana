import { describe, expect, it } from 'vitest';
import { mergeDocument, mergeHistory, mergeText } from './peer-merge.js';
import type { PeerDocumentClosure } from '../shared/peer-contract.js';
import { MAX_PEER_HISTORY_ROWS } from '../shared/peer-limits.js';

const actor = JSON.stringify({ kind: 'user', label: 'You', threadId: null });
function closure(): PeerDocumentClosure {
  return {
    doc: { id: 'doc', slug: 'doc', title: 'Doc', summary: '', status: 'draft', project_id: null,
      tags: [], entry_path: 'README.md', created_at: 1, updated_at: 1, created_by: actor, updated_by: actor },
    files: [{ sync_id: 'file', path: 'README.md', content: 'one\ntwo\nthree', encoding: 'utf8', size: 13, updated_at: 1, updated_by: actor }],
    history: [], comments: [], threads: []
  };
}

describe('mergeDocument', () => {
  it('merges disjoint text and metadata without clock winners or mutating inputs', () => {
    const base = closure(), local = structuredClone(base), remote = structuredClone(base);
    local.files[0]!.content = 'ONE\ntwo\nthree'; remote.files[0]!.content = 'one\ntwo\nTHREE';
    local.doc.title = 'Local title'; remote.doc.summary = 'Remote summary';
    local.doc.updated_at = 99; remote.doc.updated_at = 100;
    const before = structuredClone([base, local, remote]);
    const result = mergeDocument(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.candidate?.files[0]).toMatchObject({ sync_id: 'file', content: 'ONE\ntwo\nTHREE', size: 13 });
    expect(result.candidate?.doc).toMatchObject({ title: 'Local title', summary: 'Remote summary', status: 'draft' });
    expect([base, local, remote]).toEqual(before);
  });

  it.each(['text', 'status', 'rename', 'delete', 'binary', 'identity'] as const)('preserves %s forks', (kind) => {
    const base = closure(), local = structuredClone(base), remote = structuredClone(base);
    local.files[0]!.content = 'ONE\ntwo\nthree';
    if (kind === 'text') remote.files[0]!.content = 'Uno\ntwo\nthree';
    if (kind === 'status') { local.doc.status = 'approved'; remote.doc.status = 'archived'; }
    if (kind === 'rename') { remote.files[0]!.path = 'renamed.md'; remote.doc.entry_path = 'renamed.md'; }
    if (kind === 'delete') remote.files = [];
    if (kind === 'binary') for (const [index, value] of [base, local, remote].entries()) {
      value.files[0] = { ...value.files[0]!, path: 'asset.png', encoding: 'base64', content: Buffer.from(String(index)).toString('base64'), size: 1 };
      value.doc.entry_path = 'asset.png';
    }
    if (kind === 'identity') remote.doc.id = 'another-doc';
    expect(mergeDocument(base, local, remote)).toMatchObject({ candidate: null, conflicts: expect.any(Array) });
    expect(mergeDocument(base, local, remote).conflicts.length).toBeGreaterThan(0);
  });

  it('unions independent comments and replies but refuses incompatible resolution', () => {
    const base = closure(), local = structuredClone(base), remote = structuredClone(base);
    const root: PeerDocumentClosure['comments'][number] = { id: 'root', path: null, quote: null, body: 'Review', author: actor,
      status: 'open', created_at: 1, resolved_at: null, parent_id: null };
    base.comments = [root]; local.comments = [root, { ...root, id: 'local-reply', parent_id: 'root' }];
    remote.comments = [root, { ...root, id: 'remote-reply', parent_id: 'root' }];
    expect(mergeDocument(base, local, remote).candidate?.comments.map((row) => row.id)).toEqual(['local-reply', 'remote-reply', 'root']);
    local.comments[0] = { ...root, body: 'Edited' }; remote.comments[0] = { ...root, status: 'resolved', resolved_at: 2 };
    expect(mergeDocument(base, local, remote).candidate).toBeNull();
  });

  it('rejects immutable history substitution and invalid merged aggregates', () => {
    const base = closure(), local = structuredClone(base), remote = structuredClone(base);
    const history: PeerDocumentClosure['history'][number] = { sync_id: 'history', path: 'README.md', content: 'old', encoding: 'utf8',
      size: 3, revision: 1, op: 'write', note: null, renamed_from: null, actor, created_at: 1 };
    local.history = [history]; remote.history = [{ ...history, content: 'bad' }];
    expect(mergeDocument(base, local, remote).conflicts).toContain('history identity history');
    local.history = []; remote.history = [];
    local.files.push({ ...base.files[0]!, sync_id: 'local-file', path: 'note.md' });
    remote.files.push({ ...base.files[0]!, sync_id: 'remote-file', path: 'NOTE.md' });
    expect(mergeDocument(base, local, remote).candidate).toBeNull();
  });

  it('keeps one-sided adds, deletes and renames by stable identity and unions immutable history', () => {
    const base = closure(), local = structuredClone(base), remote = structuredClone(base);
    base.files.push({ ...base.files[0]!, sync_id: 'deleted', path: 'deleted.md' });
    local.files.push({ ...base.files[0]!, sync_id: 'added', path: 'added.md' });
    remote.files.push(base.files[1]!);
    remote.files[0]!.path = 'renamed.md'; remote.doc.entry_path = 'renamed.md';
    expect(mergeDocument(base, local, remote).candidate?.files.map((file) => file.path)).toEqual(['added.md', 'renamed.md']);
    expect(mergeDocument(base, remote, local).candidate?.files.map((file) => file.path)).toEqual(['added.md', 'renamed.md']);
    remote.files = structuredClone(base.files); remote.doc.entry_path = base.doc.entry_path;
    remote.files[0]!.updated_at = 9;
    expect(mergeDocument(base, base, remote).candidate?.files[0]!.content).toBe(base.files[0]!.content);
    const history: PeerDocumentClosure['history'][number] = { sync_id: 'old', path: 'README.md', content: 'old', encoding: 'utf8',
      size: 3, revision: 1, op: 'write', note: null, renamed_from: null, actor, created_at: 1 };
    base.history = [history]; local.history = [history, { ...history, sync_id: 'local-history' }]; remote.history = [history, { ...history, sync_id: 'remote-history' }];
    expect(mergeDocument(base, local, remote).candidate?.history.map((row) => row.sync_id)).toEqual(['old', 'local-history', 'remote-history']);
    remote.threads = [{ thread_id: 'thread', title: 'Peer provenance', role: 'reviewer', last_activity_at: 1 }];
    expect(mergeDocument(base, local, remote).candidate?.threads).toEqual(remote.threads);
  });

  it('refuses orphan replies and merged content beyond aggregate cap', () => {
    const base = closure(), local = structuredClone(base), remote = structuredClone(base);
    remote.comments = [{ id: 'reply', path: null, quote: null, body: 'Review', author: actor,
      status: 'open', created_at: 1, resolved_at: null, parent_id: 'missing' }];
    expect(mergeDocument(base, local, remote).conflicts).toContain('invalid comment parent');
    remote.comments = [];
    const content = 'x'.repeat(2 * 1024 * 1024);
    local.files.push(...Array.from({ length: 12 }, (_, index) => ({ ...base.files[0]!, sync_id: `large-${index}`, path: `large-${index}.md`, content, size: content.length })));
    expect(mergeDocument(base, local, remote).conflicts).toContain('document exceeds content limit');
  });
});

describe('mergeText', () => {
  it('handles equal and one-sided content without inventing edits', () => {
    expect(mergeText('base', 'same', 'same')).toEqual({ content: 'same', conflicts: [] });
    expect(mergeText('base', 'base', 'remote')).toEqual({ content: 'remote', conflicts: [] });
    expect(mergeText('base', 'local', 'base')).toEqual({ content: 'local', conflicts: [] });
    expect(mergeText('one\ntwo\nthree\nfour', 'one\nINSERT\ntwo\nthree\nfour', 'one\ntwo\nthree')).toEqual({
      content: 'one\nINSERT\ntwo\nthree', conflicts: []
    });
  });
  it('merges independent line changes', () => {
    expect(mergeText('one\ntwo\nthree', 'ONE\ntwo\nthree', 'one\ntwo\nTHREE')).toEqual({ content: 'ONE\ntwo\nTHREE', conflicts: [] });
  });

  it('merges adjacent replacements but keeps insertions on shared boundaries ambiguous', () => {
    expect(mergeText('one\ntwo', 'ONE\ntwo', 'one\nTWO')).toEqual({ content: 'ONE\nTWO', conflicts: [] });
    expect(mergeText('one\ntwo', 'one\ninsert\ntwo', 'one\nTWO').content).toBeNull();
  });

  it('preserves overlapping edits as a conflict', () => {
    expect(mergeText('one\ntwo', 'ONE\ntwo', 'Uno\ntwo')).toEqual({ content: null, conflicts: ['overlapping text edits'] });
  });
});

describe('mergeHistory', () => {
  const row = (sync_id: string): PeerDocumentClosure['history'][number] => ({ sync_id, path: 'README.md', content: '', encoding: 'utf8',
    size: 0, revision: 1, op: 'write', note: null, renamed_from: null, actor, created_at: 1 });

  it('keeps causal order across pruned branches without using clocks', () => {
    const old = row('old'), shared = row('shared'), local = row('local'), remote = { ...row('remote'), created_at: 0 };
    expect(mergeHistory([[shared], [shared, local], [old, shared, remote]]).map((row) => row.sync_id))
      .toEqual(['old', 'shared', 'local', 'remote']);
    expect(mergeHistory([[shared, shared], [old, shared]])).toEqual([old, shared]);
    expect(mergeHistory([])).toEqual([]);
    expect(mergeHistory([[shared], [shared, remote], [shared, local]]))
      .toEqual(mergeHistory([[shared], [shared, local], [shared, remote]]));
    expect(mergeHistory([[old, shared], [shared, old]], [shared, old])).toEqual([shared, old]);
  });

  it('rejects immutable substitution, contradictory order and aggregate overflow', () => {
    const first = row('first'), second = row('second');
    expect(() => mergeHistory([[first], [{ ...first, note: 'substituted' }]])).toThrow('history identity first');
    expect(() => mergeHistory([[first, second], [second, first]])).toThrow('history causal order conflict');
    expect(() => mergeHistory([Array.from({ length: MAX_PEER_HISTORY_ROWS }, (_, index) => row(`row-${index}`)), [first]]))
      .toThrow('merged history exceeds row limit');
    const base = closure(), local = closure(), remote = closure();
    local.history = [first, second]; remote.history = [second, first];
    expect(mergeDocument(base, local, remote)).toMatchObject({ candidate: null, conflicts: ['history causal order conflict'] });
  });
});
