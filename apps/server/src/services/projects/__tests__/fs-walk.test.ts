import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles } from '../fs.js';

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-fs-walk-'))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
function file(rel: string, text = 'x\n') {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
function many(dir: string, n: number) {
  mkdirSync(join(root, dir), { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(root, dir, `${i}.txt`), '');
}

describe('walkFiles (git repo)', () => {
  it('returns a target beside a huge ignored subtree, untracked files included', async () => {
    git('init', '-q');
    file('.gitignore', 'ignored/\n');
    many('ignored', 8100);
    file('src/target.ts');
    git('add', '.gitignore');
    const { files, truncated } = await walkFiles(root);
    expect(files.map((f) => f.rel).sort()).toEqual(['.gitignore', 'src/target.ts']);
    expect(truncated).toBe(false);
    expect(files[0].path.startsWith(root)).toBe(true);
  });

  it('skips denied dirs, deleted tracked files, directories, and external symlinks; keeps internal links', async () => {
    git('init', '-q');
    file('a.ts'); file('gone.ts'); file('node_modules/x.js'); file('pkg/target/out.o');
    symlinkSync(join(root, 'a.ts'), join(root, 'link.ts'));
    symlinkSync(tmpdir(), join(root, 'outside'));
    symlinkSync(join(root, 'missing'), join(root, 'broken'));
    git('add', '-A', '-f');
    rmSync(join(root, 'gone.ts'));
    const { files } = await walkFiles(root);
    expect(files.map((f) => f.rel).sort()).toEqual(['a.ts', 'link.ts']);
  });

  it('sets truncated and keeps shallow files when the file cap is exceeded', async () => {
    git('init', '-q');
    file('top.ts');
    many('zdeep/a', 8001);
    const { files, truncated } = await walkFiles(root);
    expect(truncated).toBe(true);
    expect(files).toHaveLength(8000);
    expect(files[0].rel).toBe('top.ts');
  });

  it('flags files beyond the depth cap', async () => {
    git('init', '-q');
    file('ok.ts');
    file(`${Array(14).fill('d').join('/')}/deep.ts`);
    const { files, truncated } = await walkFiles(root);
    expect(truncated).toBe(true);
    expect(files.map((f) => f.rel)).toEqual(['ok.ts']);
  });
});

describe('walkFiles (non-git fallback)', () => {
  it('walks, denies the extended list, and reports truncated=false', async () => {
    file('src/a.ts');
    for (const d of ['.venv', 'venv', '__pycache__', 'coverage', '.pytest_cache', '.cache', 'target', 'node_modules']) file(`${d}/x`);
    expect(await walkFiles(root)).toEqual({ files: [{ rel: 'src/a.ts', path: join(root, 'src/a.ts') }], truncated: false });
  });

  it('is breadth-first: a shallow file survives a deep sibling subtree exceeding the cap', async () => {
    file('shallow.ts');
    many('a/b/c', 8001);
    const { files, truncated } = await walkFiles(root);
    expect(truncated).toBe(true);
    expect(files).toHaveLength(8000);
    expect(files.some((f) => f.rel === 'shallow.ts')).toBe(true);
  });

  it('flags depth truncation', async () => {
    file(`${Array(14).fill('d').join('/')}/deep.ts`);
    const { files, truncated } = await walkFiles(root);
    expect(files).toEqual([]);
    expect(truncated).toBe(true);
  });
});
