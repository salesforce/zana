import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMemoryLibraryStore,
  LibraryStore,
  type ILibraryStore
} from '../library-store.js';
import type { LibraryAddInput, LibraryManifest } from '../../shared/types.js';

const baseInput: LibraryAddInput = {
  scope: 'global',
  relPath: 'test.md',
  title: 'Test doc',
  content: '# Hello'
};

function runSuite(label: string, make: () => Promise<ILibraryStore> | ILibraryStore) {
  describe(`LibraryStore (${label})`, () => {
    let store: ILibraryStore;
    beforeEach(async () => {
      store = await make();
    });

    it('add assigns id + timestamps and returns the doc', async () => {
      const before = Date.now();
      const doc = store.add(baseInput);
      expect(doc).not.toBeNull();
      if (!doc) return;
      expect(doc.id).toMatch(/[0-9a-f-]{36}/);
      expect(doc.createdAt).toBeGreaterThanOrEqual(before);
      expect(doc.updatedAt).toBeGreaterThanOrEqual(before);
      expect(doc.title).toBe('Test doc');
      expect(doc.kind).toBe('md');
    });

    it('rejects empty relPath', async () => {
      const doc = store.add({ ...baseInput, relPath: '' });
      expect(doc).toBeNull();
    });

    it('rejects relPath with .. (path traversal)', async () => {
      const doc = store.add({ ...baseInput, relPath: '../etc/passwd' });
      expect(doc).toBeNull();
    });

    it('rejects absolute relPath', async () => {
      const doc = store.add({ ...baseInput, relPath: '/etc/passwd' });
      expect(doc).toBeNull();
    });

    it('rejects project scope without projectId', async () => {
      const doc = store.add({ ...baseInput, scope: 'project' });
      expect(doc).toBeNull();
    });

    it('list returns newest-first by updatedAt', async () => {
      const a = store.add({ ...baseInput, title: 'first', relPath: 'a.md' });
      const b = store.add({ ...baseInput, title: 'second', relPath: 'b.md' });
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      if (!a || !b) return;
      const list = store.list();
      expect(list.map((d) => d.id)).toContain(a.id);
      expect(list.map((d) => d.id)).toContain(b.id);
      expect(list[0].updatedAt).toBeGreaterThanOrEqual(list[list.length - 1].updatedAt);
    });

    it('update patches title/summary/tags and bumps updatedAt', async () => {
      const doc = store.add(baseInput);
      expect(doc).not.toBeNull();
      if (!doc) return;
      const before = doc.updatedAt;
      const updated = store.update(doc.id, {
        title: 'Updated title',
        summary: 'A summary',
        tags: ['foo', 'bar']
      });
      expect(updated).not.toBeNull();
      if (!updated) return;
      expect(updated.title).toBe('Updated title');
      expect(updated.summary).toBe('A summary');
      expect(updated.tags).toEqual(['foo', 'bar']);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('update returns null for missing id', async () => {
      const updated = store.update('no-such-id', { title: 'nope' });
      expect(updated).toBeNull();
    });

    it('remove deletes the doc; missing id returns false', async () => {
      const doc = store.add(baseInput);
      expect(doc).not.toBeNull();
      if (!doc) return;
      expect(store.remove(doc.id)).toBe(true);
      expect(store.list().find((d) => d.id === doc.id)).toBeUndefined();
      expect(store.remove('no-such-id')).toBe(false);
    });

    it('onChanged fires on add/update/remove; dispose stops it', async () => {
      let fired = 0;
      const off = store.onChanged(() => fired++);
      store.add(baseInput);
      const doc = store.add({ ...baseInput, title: 'two', relPath: 'two.md' });
      if (doc) {
        store.update(doc.id, { title: 'two updated' });
        store.remove(doc.id);
      }
      off();
      store.add({ ...baseInput, title: 'after dispose', relPath: 'after.md' });
      expect(fired).toBe(4); // add, add, update, remove
    });

    it('derives kind from extension', async () => {
      const cases = [
        { relPath: 'doc.md', kind: 'md' },
        { relPath: 'paper.pdf', kind: 'pdf' },
        { relPath: 'pic.png', kind: 'image' },
        { relPath: 'photo.jpg', kind: 'image' },
        { relPath: 'script.js', kind: 'code' },
        { relPath: 'data.json', kind: 'code' },
        { relPath: 'thing.bin', kind: 'other' }
      ];
      for (const { relPath, kind } of cases) {
        const doc = store.add({ ...baseInput, relPath });
        expect(doc).not.toBeNull();
        if (!doc) continue;
        expect(doc.kind).toBe(kind);
      }
    });
  });
}

runSuite('in-memory', () => createMemoryLibraryStore());

// File-backed suite: drives the real LibraryStore against a tmp homeDir
// (the `homeDir` constructor override is exactly the testability seam saved-store
// gets via its `dir` option). This is where reconcile()/readManifest()/the atomic
// writeManifest() get real coverage — none of it is exercised by the in-memory store.
describe('LibraryStore (file-backed)', () => {
  let home: string;
  let globalDir: string;
  let store: LibraryStore;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cc-library-'));
    globalDir = join(home, '.zcc', 'library');
    // No projects — global scope only keeps these tests focused.
    store = new LibraryStore(() => [], { homeDir: home });
  });

  afterEach(async () => {
    store.stop();
    await rm(home, { recursive: true, force: true });
  });

  async function readManifestFile(): Promise<LibraryManifest> {
    const raw = await readFile(join(globalDir, 'index.json'), 'utf8');
    return JSON.parse(raw) as LibraryManifest;
  }

  it('add writes the file + a manifest entry, then list reflects it', async () => {
    const doc = store.add({ scope: 'global', relPath: 'notes.md', title: 'Notes', content: '# Hi' });
    expect(doc).not.toBeNull();

    // File written.
    expect(await readFile(join(globalDir, 'notes.md'), 'utf8')).toBe('# Hi');
    // Manifest entry persisted.
    const manifest = await readManifestFile();
    expect(manifest.docs).toHaveLength(1);
    expect(manifest.docs[0].relPath).toBe('notes.md');

    // list() stamps scope + absPath.
    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].scope).toBe('global');
    expect(listed[0].absPath).toBe(join(globalDir, 'notes.md'));
    expect(listed[0].kind).toBe('md');
  });

  it('readContent reads a GLOBAL doc by scope+relPath (regression: global docs are outside any project)', () => {
    const doc = store.add({ scope: 'global', relPath: 'ideas/thing.md', title: 'Thing', content: '# Body' });
    expect(doc).not.toBeNull();
    // The generic project-confined fs.readFile would reject this path
    // ("not inside a known project"); the scope-confined seam reads it.
    const res = store.readContent('global', 'ideas/thing.md');
    expect(res.ok).toBe(true);
    expect(res.content).toBe('# Body');
  });

  it('writeContent overwrites a GLOBAL doc; readContent reflects it', () => {
    store.add({ scope: 'global', relPath: 'note.md', title: 'Note', content: 'v1' });
    const w = store.writeContent('global', 'note.md', 'v2');
    expect(w.ok).toBe(true);
    expect(store.readContent('global', 'note.md').content).toBe('v2');
  });

  it('readContent rejects a path-traversal relPath (confinement holds)', () => {
    const res = store.readContent('global', '../../etc/passwd');
    expect(res.ok).toBe(false);
  });

  it('writeContent refuses to create a file that does not exist yet (edit, not create)', () => {
    const res = store.writeContent('global', 'nope.md', 'x');
    expect(res.ok).toBe(false);
  });

  it('reconcile drops a manifest entry whose file was deleted out from under it', async () => {
    const doc = store.add({ scope: 'global', relPath: 'gone.md', title: 'Gone', content: 'x' });
    expect(doc).not.toBeNull();
    expect(store.list()).toHaveLength(1);

    // Delete the backing file but leave the manifest entry behind.
    await unlink(join(globalDir, 'gone.md'));

    const listed = store.list();
    expect(listed.find((d) => d.relPath === 'gone.md')).toBeUndefined();
  });

  it('reconcile surfaces an on-disk file missing from the manifest as untracked (id="")', async () => {
    // Drop a file directly into the library dir, no manifest entry.
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, 'orphan.pdf'), 'pretend-pdf');

    const listed = store.list();
    const orphan = listed.find((d) => d.relPath === 'orphan.pdf');
    expect(orphan).toBeDefined();
    expect(orphan!.id).toBe('');
    expect(orphan!.kind).toBe('pdf');
    expect(orphan!.title).toBe('orphan.pdf');
  });

  it('readManifest tolerates a corrupt index.json (returns no tracked docs, not a throw)', async () => {
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, 'index.json'), '{ this is not json');
    await writeFile(join(globalDir, 'real.md'), '# real');

    // Must not throw, and the on-disk file still surfaces as untracked.
    const listed = store.list();
    const real = listed.find((d) => d.relPath === 'real.md');
    expect(real).toBeDefined();
    expect(real!.id).toBe('');
  });

  it('update persists across a fresh read; remove drops the entry but keeps the file', async () => {
    const doc = store.add({ scope: 'global', relPath: 'doc.md', title: 'Old', content: 'body' });
    expect(doc).not.toBeNull();

    const updated = store.update(doc!.id, { title: 'New', tags: ['a'] });
    expect(updated?.title).toBe('New');
    expect((await readManifestFile()).docs[0].title).toBe('New');

    expect(store.remove(doc!.id)).toBe(true);
    expect((await readManifestFile()).docs).toHaveLength(0);
    // remove() is manifest-only — the file stays on disk (and resurfaces untracked).
    expect(await readFile(join(globalDir, 'doc.md'), 'utf8')).toBe('body');
    const listed = store.list();
    expect(listed.find((d) => d.relPath === 'doc.md')?.id).toBe('');
  });

  it('writeManifest is atomic: a tmp file is never left behind', async () => {
    store.add({ scope: 'global', relPath: 'a.md', title: 'A', content: '1' });
    store.add({ scope: 'global', relPath: 'b.md', title: 'B', content: '2' });
    const { readdir } = await import('node:fs/promises');
    const names = await readdir(globalDir);
    expect(names.some((n) => n.includes('.tmp-'))).toBe(false);
    expect(names).toContain('index.json');
  });

  it('rejects path-traversal relPath without writing anything', async () => {
    expect(store.add({ scope: 'global', relPath: '../escape.md', title: 'Esc', content: 'x' })).toBeNull();
    expect(store.add({ scope: 'global', relPath: '/abs.md', title: 'Abs', content: 'x' })).toBeNull();
    // Nothing leaked into the library dir.
    const listed = store.list();
    expect(listed).toHaveLength(0);
  });

  it('search finds a body-content match the metadata filter would miss', async () => {
    store.add({
      scope: 'global',
      relPath: 'notes.md',
      title: 'Meeting notes',
      content: '# Meeting notes\n\nWe agreed to adopt the widget approach next quarter.'
    });
    // "widget" appears only in the body — not the title/summary/tags.
    const res = store.search('widget');
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].absPath).toBe(join(globalDir, 'notes.md'));
    expect(res.hits[0].line).toBe(3);
    expect(res.hits[0].preview).toContain('widget');
    expect(res.truncated).toBe(false);
  });

  it('search is case-insensitive and returns the first match per doc', async () => {
    store.add({
      scope: 'global',
      relPath: 'a.md',
      title: 'A',
      content: 'alpha Beta\nbeta again'
    });
    const res = store.search('BETA');
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].line).toBe(1); // first match wins
  });

  it('search ignores non-text docs and an empty query', async () => {
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, 'pic.png'), 'binary-ish');
    store.add({ scope: 'global', relPath: 'x.md', title: 'X', content: 'binary content here' });
    // Empty query short-circuits to no hits.
    expect(store.search('   ').hits).toHaveLength(0);
    // A hit in the md, but the png (kind !== md/code) is never read/matched.
    const res = store.search('binary');
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].absPath).toBe(join(globalDir, 'x.md'));
  });

  it('createFolder makes an empty directory (and missing parents)', async () => {
    const res = store.createFolder('global', 'findings/deep');
    expect(res.ok).toBe(true);
    const { stat } = await import('node:fs/promises');
    expect((await stat(join(globalDir, 'findings', 'deep'))).isDirectory()).toBe(true);
  });

  it('createFolder refuses to overwrite an existing file/folder', async () => {
    store.add({ scope: 'global', relPath: 'notes.md', title: 'N', content: 'x' });
    const res = store.createFolder('global', 'notes.md');
    expect(res.ok).toBe(false);
  });

  it('createFolder rejects path traversal', () => {
    expect(store.createFolder('global', '../escape').ok).toBe(false);
  });

  it('moveEntry renames a single doc and updates the manifest relPath', async () => {
    const doc = store.add({ scope: 'global', relPath: 'a.md', title: 'A', content: 'body' });
    expect(doc).not.toBeNull();
    const res = store.moveEntry({ scope: 'global', relPath: 'a.md' }, { scope: 'global', relPath: 'b.md' });
    expect(res.ok).toBe(true);
    expect(await readFile(join(globalDir, 'b.md'), 'utf8')).toBe('body');
    const manifest = await readManifestFile();
    expect(manifest.docs).toHaveLength(1);
    expect(manifest.docs[0].relPath).toBe('b.md');
    expect(manifest.docs[0].id).toBe(doc!.id);
    const listed = store.list();
    expect(listed.find((d) => d.relPath === 'a.md')).toBeUndefined();
    expect(listed.find((d) => d.relPath === 'b.md')).toBeDefined();
  });

  it('moveEntry moves an entire folder subtree, rewriting every child relPath', async () => {
    store.add({ scope: 'global', relPath: 'findings/a.md', title: 'A', content: '1' });
    store.add({ scope: 'global', relPath: 'findings/nested/b.md', title: 'B', content: '2' });
    const res = store.moveEntry(
      { scope: 'global', relPath: 'findings' },
      { scope: 'global', relPath: 'archive/findings' }
    );
    expect(res.ok).toBe(true);
    expect(await readFile(join(globalDir, 'archive', 'findings', 'a.md'), 'utf8')).toBe('1');
    expect(await readFile(join(globalDir, 'archive', 'findings', 'nested', 'b.md'), 'utf8')).toBe('2');
    const listed = store.list();
    expect(listed.map((d) => d.relPath).sort()).toEqual([
      'archive/findings/a.md',
      'archive/findings/nested/b.md'
    ]);
  });

  it('moveEntry refuses to overwrite an existing destination', () => {
    store.add({ scope: 'global', relPath: 'a.md', title: 'A', content: '1' });
    store.add({ scope: 'global', relPath: 'b.md', title: 'B', content: '2' });
    const res = store.moveEntry({ scope: 'global', relPath: 'a.md' }, { scope: 'global', relPath: 'b.md' });
    expect(res.ok).toBe(false);
  });

  it('moveEntry rejects a source or destination outside the library dir', () => {
    store.add({ scope: 'global', relPath: 'a.md', title: 'A', content: '1' });
    expect(
      store.moveEntry({ scope: 'global', relPath: 'a.md' }, { scope: 'global', relPath: '../escape.md' }).ok
    ).toBe(false);
    expect(
      store.moveEntry({ scope: 'global', relPath: '../escape.md' }, { scope: 'global', relPath: 'a.md' }).ok
    ).toBe(false);
  });

  it('deleteEntry removes a single file + its manifest entry', async () => {
    const doc = store.add({ scope: 'global', relPath: 'a.md', title: 'A', content: '1' });
    expect(doc).not.toBeNull();
    const res = store.deleteEntry('global', 'a.md');
    expect(res.ok).toBe(true);
    expect(existsSync(join(globalDir, 'a.md'))).toBe(false);
    expect((await readManifestFile()).docs).toHaveLength(0);
  });

  it('deleteEntry removes a folder recursively + every manifest entry under it', async () => {
    store.add({ scope: 'global', relPath: 'findings/a.md', title: 'A', content: '1' });
    store.add({ scope: 'global', relPath: 'findings/nested/b.md', title: 'B', content: '2' });
    store.add({ scope: 'global', relPath: 'keep.md', title: 'K', content: 'k' });
    const res = store.deleteEntry('global', 'findings');
    expect(res.ok).toBe(true);
    expect(existsSync(join(globalDir, 'findings'))).toBe(false);
    const listed = store.list();
    expect(listed.map((d) => d.relPath)).toEqual(['keep.md']);
  });

  it('deleteEntry refuses to delete the library root itself', () => {
    expect(store.deleteEntry('global', '.').ok).toBe(false);
  });

  it('deleteEntry rejects path traversal and a missing path', () => {
    expect(store.deleteEntry('global', '../escape').ok).toBe(false);
    expect(store.deleteEntry('global', 'nope.md').ok).toBe(false);
  });
});

// Agent-facing, project-locked surface (backs the library_* MCP tools). These
// assert the council's blocking security conditions: realpath confinement,
// reserved-name rejection, host-set source, agent-only mutation, and scope lock.
describe('LibraryStore agent surface (file-backed)', () => {
  let home: string;
  let projectPath: string;
  let libDir: string;
  let store: LibraryStore;
  const projectId = 'proj-1';
  const sessionId = 'sess-abc';

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cc-libagent-'));
    projectPath = await mkdtemp(join(tmpdir(), 'cc-proj-'));
    libDir = join(projectPath, '.zcc', 'library');
    store = new LibraryStore(() => [{ id: projectId, name: 'Proj', path: projectPath, tag: 'proj' } as never], {
      homeDir: home
    });
  });

  afterEach(async () => {
    store.stop();
    await rm(home, { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  it('agentWrite creates a doc with host-stamped agent source, then agentRead returns content', () => {
    const doc = store.agentWrite(projectId, sessionId, {
      relPath: 'findings/auth.md',
      title: 'Auth findings',
      content: '# Auth\nbody',
      tags: ['findings']
    });
    expect(doc.id).toMatch(/[0-9a-f-]{36}/);
    expect(doc.source).toEqual({ kind: 'agent', sessionId, projectId });
    const read = store.agentRead(projectId, 'findings/auth.md');
    expect(read?.content).toBe('# Auth\nbody');
    expect(read?.title).toBe('Auth findings');
  });

  it('agentWrite is an upsert: a second write to the same relPath overwrites + keeps the id', () => {
    const first = store.agentWrite(projectId, sessionId, { relPath: 'n.md', content: 'v1' });
    const second = store.agentWrite(projectId, sessionId, { relPath: 'n.md', content: 'v2', title: 'N' });
    expect(second.id).toBe(first.id);
    expect(store.agentRead(projectId, 'n.md')?.content).toBe('v2');
    expect(second.title).toBe('N');
    // metadata-only write (no content) leaves the body intact
    store.agentWrite(projectId, sessionId, { relPath: 'n.md', summary: 'sum' });
    expect(store.agentRead(projectId, 'n.md')?.content).toBe('v2');
  });

  it('agentWrite rejects index.json (manifest) and dot-prefixed segments', () => {
    expect(() => store.agentWrite(projectId, sessionId, { relPath: 'index.json', content: '{}' })).toThrow();
    expect(() => store.agentWrite(projectId, sessionId, { relPath: '.git/hooks/x', content: 'x' })).toThrow();
    expect(() => store.agentWrite(projectId, sessionId, { relPath: '../escape.md', content: 'x' })).toThrow();
    expect(() => store.agentWrite(projectId, sessionId, { relPath: '/etc/passwd', content: 'x' })).toThrow();
  });

  it('agentWrite confines via realpath: a symlinked subdir pointing outside is rejected', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'cc-outside-'));
    await mkdir(libDir, { recursive: true });
    const { symlink } = await import('node:fs/promises');
    // .zcc/library/escape -> /some/outside/dir
    await symlink(outside, join(libDir, 'escape'));
    expect(() => store.agentWrite(projectId, sessionId, { relPath: 'escape/pwn.md', content: 'x' })).toThrow();
    // Nothing was written into the outside dir.
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(outside)).toHaveLength(0);
    await rm(outside, { recursive: true, force: true });
  });

  it('agentWrite/agentRemove refuse to touch a user-authored doc', () => {
    // Seed a user-authored doc via the privileged add() path.
    store.add({ scope: 'project', projectId, relPath: 'user-note.md', title: 'U', content: 'mine', source: { kind: 'user' } });
    expect(() => store.agentWrite(projectId, sessionId, { relPath: 'user-note.md', content: 'hijack' })).toThrow(/user/);
    expect(() => store.agentRemove(projectId, 'user-note.md')).toThrow(/user/);
    // The user's content is untouched.
    expect(store.agentRead(projectId, 'user-note.md')?.content).toBe('mine');
  });

  it('agentWrite refuses to overwrite an UNTRACKED on-disk file (no manifest entry, not agent-authored)', async () => {
    // Simulate a user-dropped file: on disk, no manifest entry, no front-matter.
    // This is also the fresh-clone shape for any user/non-md doc (index.json is
    // gitignored). An agent must NOT be able to silently claim/overwrite it.
    await mkdir(join(libDir, 'findings'), { recursive: true });
    await writeFile(join(libDir, 'findings', 'user-dropped.md'), '# secret notes\nmine');
    expect(() =>
      store.agentWrite(projectId, sessionId, { relPath: 'findings/user-dropped.md', content: 'hijacked' })
    ).toThrow(/not agent-authored/);
    // Content untouched.
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(libDir, 'findings', 'user-dropped.md'), 'utf8')).toBe('# secret notes\nmine');

    // Same protection for a non-md untracked file (never carries front-matter).
    await writeFile(join(libDir, 'creds.json'), '{"token":"abc"}');
    expect(() =>
      store.agentWrite(projectId, sessionId, { relPath: 'creds.json', content: '{}' })
    ).toThrow(/not agent-authored/);
    expect(await readFile(join(libDir, 'creds.json'), 'utf8')).toBe('{"token":"abc"}');
  });

  it('agentRemove refuses to delete an UNTRACKED on-disk file that is not agent-authored', async () => {
    await mkdir(libDir, { recursive: true });
    await writeFile(join(libDir, 'user-note.md'), '# not the agents\nkeep');
    await writeFile(join(libDir, 'data.bin'), 'binary');
    expect(() => store.agentRemove(projectId, 'user-note.md')).toThrow(/not agent-authored/);
    expect(() => store.agentRemove(projectId, 'data.bin')).toThrow(/not agent-authored/);
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(libDir, 'user-note.md'))).toBe(true);
    expect(existsSync(join(libDir, 'data.bin'))).toBe(true);
  });

  it('agent CAN still overwrite/remove its own untracked md (front-matter source=agent, e.g. fresh clone)', async () => {
    // Agent writes a doc (gets front-matter source=agent), then the manifest is
    // lost (fresh-clone). The agent must still be able to revise/remove its own.
    store.agentWrite(projectId, sessionId, { relPath: 'findings/mine.md', content: 'v1' });
    const { rmSync } = await import('node:fs');
    rmSync(join(libDir, 'index.json'));
    // Overwrite: allowed (front-matter proves agent authorship).
    const rewritten = store.agentWrite(projectId, sessionId, { relPath: 'findings/mine.md', content: 'v2' });
    expect(store.agentRead(projectId, 'findings/mine.md')?.content).toBe('v2');
    expect(rewritten.source?.kind).toBe('agent');
    // Remove: allowed too.
    rmSync(join(libDir, 'index.json'));
    expect(store.agentRemove(projectId, 'findings/mine.md')).toBe(true);
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(libDir, 'findings', 'mine.md'))).toBe(false);
  });

  it('agentRemove deletes an agent doc (manifest + file); missing relPath returns false', async () => {
    store.agentWrite(projectId, sessionId, { relPath: 'tmp.md', content: 'x' });
    expect(store.agentRemove(projectId, 'tmp.md')).toBe(true);
    expect(store.agentRead(projectId, 'tmp.md')).toBeNull();
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(libDir, 'tmp.md'))).toBe(false);
    expect(store.agentRemove(projectId, 'tmp.md')).toBe(false);
  });

  it('agent surface is scope-locked: an unknown projectId throws (no global reach)', () => {
    expect(() => store.agentWrite('no-such-project', sessionId, { relPath: 'x.md', content: 'x' })).toThrow(
      /Project not found/
    );
    expect(() => store.agentList('no-such-project')).toThrow(/Project not found/);
  });

  it('agentList returns only this project, newest-first', () => {
    store.agentWrite(projectId, sessionId, { relPath: 'a.md', content: '1' });
    store.agentWrite(projectId, sessionId, { relPath: 'b.md', content: '2' });
    const list = store.agentList(projectId);
    expect(list.map((d) => d.relPath).sort()).toEqual(['a.md', 'b.md']);
    expect(list.every((d) => d.projectId === projectId && d.scope === 'project')).toBe(true);
  });

  // Ticket #4: git-trackability via front-matter round-trip.

  it('agentWrite stores md with a front-matter header; agentRead strips it (round-trip)', async () => {
    store.agentWrite(projectId, sessionId, {
      relPath: 'findings/x.md',
      title: 'My: Title "quoted"',
      content: '# Body\nline two',
      tags: ['findings', 'auth']
    });
    // On disk: header present, JSON-encoded title (colon/quote safe), body after.
    const { readFile } = await import('node:fs/promises');
    const onDisk = await readFile(join(libDir, 'findings', 'x.md'), 'utf8');
    expect(onDisk.startsWith('---\n')).toBe(true);
    expect(onDisk).toContain('title: "My: Title \\"quoted\\""');
    expect(onDisk).toContain('tags: ["findings", "auth"]');
    expect(onDisk).toContain('source: "agent"');
    // Agent reads back exactly the body it wrote — header stripped.
    expect(store.agentRead(projectId, 'findings/x.md')?.content).toBe('# Body\nline two');
  });

  it('non-md content is written verbatim (no front-matter injected)', async () => {
    store.agentWrite(projectId, sessionId, { relPath: 'data.json', content: '{"a":1}' });
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(libDir, 'data.json'), 'utf8')).toBe('{"a":1}');
    expect(store.agentRead(projectId, 'data.json')?.content).toBe('{"a":1}');
  });

  it('metadata-only edit of an md doc rewrites the header but keeps the body', async () => {
    store.agentWrite(projectId, sessionId, { relPath: 'n.md', content: 'keep me', title: 'Old' });
    store.agentWrite(projectId, sessionId, { relPath: 'n.md', title: 'New', tags: ['t'] });
    const read = store.agentRead(projectId, 'n.md');
    expect(read?.content).toBe('keep me');
    expect(read?.title).toBe('New');
    expect(read?.tags).toEqual(['t']);
  });

  it('fresh-clone case: a doc present with NO manifest rebuilds losslessly from front-matter', () => {
    const created = store.agentWrite(projectId, sessionId, {
      relPath: 'decisions/d.md',
      title: 'Decision One',
      content: 'we chose X',
      summary: 'the X decision',
      tags: ['decision']
    });
    // Simulate a clone: the committed .md is on disk, index.json was never committed.
    const { rmSync, existsSync } = require('node:fs') as typeof import('node:fs');
    rmSync(join(libDir, 'index.json'));
    expect(existsSync(join(libDir, 'decisions', 'd.md'))).toBe(true);

    const list = store.agentList(projectId);
    const rebuilt = list.find((d) => d.relPath === 'decisions/d.md');
    expect(rebuilt).toBeDefined();
    expect(rebuilt!.id).toBe(created.id); // id recovered, NOT '' (untracked)
    expect(rebuilt!.title).toBe('Decision One');
    expect(rebuilt!.summary).toBe('the X decision');
    expect(rebuilt!.tags).toEqual(['decision']);
    expect(rebuilt!.source?.kind).toBe('agent');
  });

  it('malformed front-matter falls back to untracked, never throws', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(libDir, { recursive: true });
    await writeFile(join(libDir, 'broken.md'), '---\nthis is not closed properly\nstill body');
    const list = store.agentList(projectId);
    const broken = list.find((d) => d.relPath === 'broken.md');
    expect(broken).toBeDefined();
    expect(broken!.id).toBe(''); // degraded gracefully, no throw
  });

  it('round-trips a body whose first line is a --- horizontal rule (fence not mis-detected)', () => {
    const body = '---\nafter the rule\nmore';
    store.agentWrite(projectId, sessionId, { relPath: 'hr.md', title: 'HR', content: body });
    // agentRead strips the header and returns exactly the body, including the
    // leading `---` (which naive fence-scanning would have swallowed).
    expect(store.agentRead(projectId, 'hr.md')?.content).toBe(body);
  });

  it('agentRead rejects a file over the size cap instead of OOM-reading it', async () => {
    const { writeFile } = await import('node:fs/promises');
    await mkdir(libDir, { recursive: true });
    // 11 MB > the 10 MB agent-read cap.
    await writeFile(join(libDir, 'huge.txt'), 'x'.repeat(11 * 1024 * 1024));
    expect(() => store.agentRead(projectId, 'huge.txt')).toThrow(/too large/);
  });

  it('reconcile de-dups a corrupt manifest with two entries for the same relPath', async () => {
    store.agentWrite(projectId, sessionId, { relPath: 'dup.md', content: 'body' });
    // Corrupt the manifest by hand: duplicate the single entry.
    const { readFile, writeFile } = await import('node:fs/promises');
    const manifestPath = join(libDir, 'index.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as LibraryManifest;
    manifest.docs.push({ ...manifest.docs[0], id: 'a-second-id' });
    await writeFile(manifestPath, JSON.stringify(manifest));
    // Only one row surfaces despite two manifest entries.
    const rows = store.agentList(projectId).filter((d) => d.relPath === 'dup.md');
    expect(rows).toHaveLength(1);
  });

  it('reconcile does NOT follow a symlinked file pointing outside the library dir', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'cc-outside-'));
    const { writeFile, symlink } = await import('node:fs/promises');
    await writeFile(join(outside, 'secret'), 'PRIVATE KEY');
    await mkdir(libDir, { recursive: true });
    // library/leak.md -> /outside/secret (non-dot name, so not skipped by dotfilter)
    await symlink(join(outside, 'secret'), join(libDir, 'leak.md'));
    const rows = store.agentList(projectId).map((d) => d.relPath);
    expect(rows).not.toContain('leak.md'); // symlink escape not surfaced
    await rm(outside, { recursive: true, force: true });
  });

  it('moveEntry moves a doc across scopes (project -> global), relocating the manifest entry', async () => {
    store.add({ scope: 'project', projectId, relPath: 'note.md', title: 'N', content: 'body', source: { kind: 'user' } });
    const res = store.moveEntry(
      { scope: 'project', relPath: 'note.md', projectId },
      { scope: 'global', relPath: 'note.md' }
    );
    expect(res.ok).toBe(true);
    expect(existsSync(join(libDir, 'note.md'))).toBe(false);
    const homeLibDir = join(home, '.zcc', 'library');
    expect(await readFile(join(homeLibDir, 'note.md'), 'utf8')).toBe('body');
    const listed = store.list();
    expect(listed.find((d) => d.relPath === 'note.md' && d.scope === 'global')).toBeDefined();
    expect(listed.find((d) => d.scope === 'project')).toBeUndefined();
  });
});
