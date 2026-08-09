import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFile, createDir, renamePath, deletePath, confine } from '../fs.js';

describe('fs CRUD (create / rename / delete, project-confined)', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cc-fs-root-'));
    outside = await mkdtemp(join(tmpdir(), 'cc-fs-out-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  describe('createFile', () => {
    it('creates an empty file under root', async () => {
      const target = join(root, 'a.txt');
      const r = createFile(root, target);
      expect(r.ok).toBe(true);
      expect(existsSync(target)).toBe(true);
      expect(await readFile(target, 'utf8')).toBe('');
    });

    it('creates missing parent directories', async () => {
      const target = join(root, 'nested/deep/a.txt');
      const r = createFile(root, target);
      expect(r.ok).toBe(true);
      expect(existsSync(target)).toBe(true);
    });

    it('refuses to overwrite an existing path', async () => {
      const target = join(root, 'a.txt');
      await writeFile(target, 'keep me');
      const r = createFile(root, target);
      expect(r.ok).toBe(false);
      expect(await readFile(target, 'utf8')).toBe('keep me');
    });

    it('rejects paths outside the project root', async () => {
      const r = createFile(root, join(outside, 'evil.txt'));
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/outside the project/);
      expect(existsSync(join(outside, 'evil.txt'))).toBe(false);
    });

    it('rejects ".." traversal escapes', async () => {
      const r = createFile(root, join(root, '..', 'escape.txt'));
      expect(r.ok).toBe(false);
      expect(existsSync(join(root, '..', 'escape.txt'))).toBe(false);
    });

    it('rejects a name-prefixed sibling dir (root="/x/proj" vs "/x/proj-evil")', async () => {
      // The `realRoot + sep` prefix guard must not treat a sibling whose name
      // merely starts with the root's name as "inside" the project.
      const sibling = root + '-evil';
      const r = createFile(root, join(sibling, 'f.txt'));
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/outside the project/);
      expect(existsSync(join(sibling, 'f.txt'))).toBe(false);
    });

    it('rejects writing through a symlinked parent pointing outside', async () => {
      // root/link -> outside ; then try to create root/link/evil.txt
      await symlink(outside, join(root, 'link'), 'dir');
      const r = createFile(root, join(root, 'link', 'evil.txt'));
      expect(r.ok).toBe(false);
      expect(existsSync(join(outside, 'evil.txt'))).toBe(false);
    });
  });

  describe('createDir', () => {
    it('creates a directory under root', async () => {
      const target = join(root, 'newdir');
      const r = createDir(root, target);
      expect(r.ok).toBe(true);
      expect(existsSync(target)).toBe(true);
    });

    it('refuses an existing path', async () => {
      const target = join(root, 'newdir');
      await mkdir(target);
      const r = createDir(root, target);
      expect(r.ok).toBe(false);
    });

    it('refuses to create when target IS the root itself', async () => {
      // confine allows realTarget === realRoot, but the existsSync guard must
      // reject it (root always exists) — pin that so create can't no-op on root.
      expect(createDir(root, root).ok).toBe(false);
      expect(createFile(root, root).ok).toBe(false);
    });
  });

  describe('confine — symlinked project root (supported per fs.ts docs)', () => {
    it('treats a symlinked root as in-bounds for create and delete', async () => {
      // A project whose path is a symlink to a real dir must still work: confine
      // realpaths the root, so operations through the link land in the real dir
      // and the root-delete guard still fires on the resolved path.
      const realDir = await mkdtemp(join(tmpdir(), 'cc-fs-realroot-'));
      const linkRoot = join(outside, 'proj-link');
      await symlink(realDir, linkRoot, 'dir');
      try {
        const f = createFile(linkRoot, join(linkRoot, 'a.txt'));
        expect(f.ok).toBe(true);
        expect(existsSync(join(realDir, 'a.txt'))).toBe(true);
        // Deleting the root (via either name) is still refused.
        expect(deletePath(linkRoot, linkRoot).ok).toBe(false);
        expect(deletePath(linkRoot, realDir).ok).toBe(false);
        expect(existsSync(realDir)).toBe(true);
      } finally {
        await rm(realDir, { recursive: true, force: true });
      }
    });
  });

  describe('renamePath', () => {
    it('renames a file within root', async () => {
      const from = join(root, 'a.txt');
      const to = join(root, 'b.txt');
      await writeFile(from, 'hi');
      const r = renamePath(root, from, to);
      expect(r.ok).toBe(true);
      expect(existsSync(from)).toBe(false);
      expect(await readFile(to, 'utf8')).toBe('hi');
    });

    it('moves into a not-yet-existing subdir (creates parents)', async () => {
      const from = join(root, 'a.txt');
      const to = join(root, 'sub/dir/a.txt');
      await writeFile(from, 'hi');
      const r = renamePath(root, from, to);
      expect(r.ok).toBe(true);
      expect(existsSync(to)).toBe(true);
    });

    it('refuses to overwrite an existing destination', async () => {
      const from = join(root, 'a.txt');
      const to = join(root, 'b.txt');
      await writeFile(from, 'a');
      await writeFile(to, 'b');
      const r = renamePath(root, from, to);
      expect(r.ok).toBe(false);
      expect(await readFile(to, 'utf8')).toBe('b');
    });

    it('rejects a destination outside root', async () => {
      const from = join(root, 'a.txt');
      await writeFile(from, 'a');
      const r = renamePath(root, from, join(outside, 'a.txt'));
      expect(r.ok).toBe(false);
      expect(existsSync(from)).toBe(true);
    });

    it('rejects a source outside root', async () => {
      const from = join(outside, 'a.txt');
      await writeFile(from, 'a');
      const r = renamePath(root, from, join(root, 'a.txt'));
      expect(r.ok).toBe(false);
    });

    it('rejects a destination through a symlinked parent pointing outside', async () => {
      const from = join(root, 'a.txt');
      await writeFile(from, 'a');
      await symlink(outside, join(root, 'link'), 'dir');
      const r = renamePath(root, from, join(root, 'link', 'a.txt'));
      expect(r.ok).toBe(false);
      expect(existsSync(from)).toBe(true);
      expect(existsSync(join(outside, 'a.txt'))).toBe(false);
    });
  });

  describe('deletePath', () => {
    it('deletes a file', async () => {
      const target = join(root, 'a.txt');
      await writeFile(target, 'bye');
      const r = deletePath(root, target);
      expect(r.ok).toBe(true);
      expect(existsSync(target)).toBe(false);
    });

    it('deletes a directory recursively', async () => {
      const dir = join(root, 'sub');
      await mkdir(dir);
      await writeFile(join(dir, 'a.txt'), 'x');
      const r = deletePath(root, dir);
      expect(r.ok).toBe(true);
      expect(existsSync(dir)).toBe(false);
    });

    it('refuses to delete the project root itself', async () => {
      const r = deletePath(root, root);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/project root/);
      expect(existsSync(root)).toBe(true);
    });

    it('rejects a path outside root', async () => {
      const target = join(outside, 'a.txt');
      await writeFile(target, 'x');
      const r = deletePath(root, target);
      expect(r.ok).toBe(false);
      expect(existsSync(target)).toBe(true);
    });

    it('refuses to delete a symlink leaf pointing outside (fail-closed)', async () => {
      // A symlink the user sees in the tree but whose target is outside the
      // project resolves out of root, so confine rejects it. Intentional.
      const outsideFile = join(outside, 'real.txt');
      await writeFile(outsideFile, 'x');
      const link = join(root, 'link.txt');
      await symlink(outsideFile, link, 'file');
      const r = deletePath(root, link);
      expect(r.ok).toBe(false);
      expect(existsSync(outsideFile)).toBe(true);
    });
  });
});

// Regression (QA high-sev #1): fs.readFile / listDir were unconfined — only the
// mutating ops confined. The read IPC handlers now route every path through
// `confine(<trusted project root>, path)`, so the traversal payload an inbox doc
// can carry (`joinPath(project.path, '../../.ssh/id_rsa')`) is rejected in main.
// These assert the confinement primitive the handlers rely on rejects exactly
// that shape, and still accepts legitimate in-project reads.
describe('confine — read-path traversal guard', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cc-confine-root-'));
    outside = await mkdtemp(join(tmpdir(), 'cc-confine-out-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('accepts a real file inside the project', async () => {
    const f = join(root, 'notes', 'doc.md');
    await mkdir(join(root, 'notes'), { recursive: true });
    await writeFile(f, 'hello');
    const c = confine(root, f);
    expect(c.ok).toBe(true);
  });

  it('rejects a ".." traversal that escapes the project (the inbox-doc payload)', () => {
    // Mirrors joinPath(project.path, '../../.ssh/id_rsa').
    const c = confine(root, join(root, '..', '..', '.ssh', 'id_rsa'));
    expect(c.ok).toBe(false);
  });

  it('rejects an absolute path outside the project', async () => {
    const f = join(outside, 'secret.txt');
    await writeFile(f, 'x');
    const c = confine(root, f);
    expect(c.ok).toBe(false);
  });

  it('rejects an in-project symlink whose target points outside (fail-closed)', async () => {
    const outsideFile = join(outside, 'real.txt');
    await writeFile(outsideFile, 'x');
    const link = join(root, 'escape');
    await symlink(outsideFile, link, 'file');
    const c = confine(root, link);
    expect(c.ok).toBe(false);
  });
});
