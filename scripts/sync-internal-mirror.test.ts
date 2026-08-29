import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';

const script = join(dirname(fileURLToPath(import.meta.url)), 'sync-internal-mirror.sh');

const gitEnv = {
  GIT_AUTHOR_NAME: 'sync-test',
  GIT_AUTHOR_EMAIL: 'sync-test@example.com',
  GIT_COMMITTER_NAME: 'sync-test',
  GIT_COMMITTER_EMAIL: 'sync-test@example.com',
};

function git(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...gitEnv, ...extraEnv }
  }).trim();
}

function initBare(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--bare']);
}

function initWork(work: string, originBare: string): void {
  mkdirSync(work, { recursive: true });
  git(work, ['init', '-b', 'main']);
  git(work, ['remote', 'add', 'origin', originBare]);
}

function commitAll(work: string, message: string): void {
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', message]);
  git(work, ['push', '-u', 'origin', 'HEAD:main']);
}

describe('sync-internal-mirror.sh', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function setupPair(): {
    srcWork: string;
    dstBare: string;
    dstWork: string;
  } {
    const root = mkdtempSync(join(tmpdir(), 'sync-internal-'));
    roots.push(root);
    const srcBare = join(root, 'src.git');
    const dstBare = join(root, 'dst.git');
    initBare(srcBare);
    initBare(dstBare);

    const srcWork = join(root, 'src');
    initWork(srcWork, srcBare);
    writeFileSync(join(srcWork, 'README.md'), 'public readme\n');
    writeFileSync(join(srcWork, 'app.txt'), 'from public\n');
    mkdirSync(join(srcWork, 'pkg'), { recursive: true });
    writeFileSync(join(srcWork, 'pkg', 'a.ts'), 'export const a = 1;\n');
    commitAll(srcWork, 'public tree');

    const dstWork = join(root, 'dst');
    initWork(dstWork, dstBare);
    writeFileSync(join(dstWork, 'README.md'), 'internal banner\n');
    writeFileSync(join(dstWork, 'app.txt'), 'stale\n');
    writeFileSync(join(dstWork, 'only-internal.txt'), 'should be deleted\n');
    commitAll(dstWork, 'internal tree');

    return { srcWork, dstBare, dstWork };
  }

  it('copies every path except README.md and deletes paths gone from source', () => {
    const { srcWork, dstBare, dstWork } = setupPair();

    execFileSync('bash', [script], {
      cwd: srcWork,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...gitEnv,
        INTERNAL_URL: dstBare,
        INTERNAL_REMOTE: 'internal',
        INTERNAL_BRANCH: 'main',
        SOURCE_REF: 'HEAD'
      }
    });

    git(dstWork, ['pull', '--ff-only']);
    const readme = execFileSync('git', ['show', 'HEAD:README.md'], {
      cwd: dstWork,
      encoding: 'utf8'
    });
    const app = execFileSync('git', ['show', 'HEAD:app.txt'], {
      cwd: dstWork,
      encoding: 'utf8'
    });
    const pkg = execFileSync('git', ['show', 'HEAD:pkg/a.ts'], {
      cwd: dstWork,
      encoding: 'utf8'
    });

    expect(readme).toBe('internal banner\n');
    expect(app).toBe('from public\n');
    expect(pkg).toBe('export const a = 1;\n');
    expect(() =>
      execFileSync('git', ['cat-file', '-e', 'HEAD:only-internal.txt'], { cwd: dstWork })
    ).toThrow();
  });

  it('is a no-op when the internal tree already matches', () => {
    const { srcWork, dstBare } = setupPair();
    const env = {
      ...process.env,
      ...gitEnv,
      INTERNAL_URL: dstBare,
      INTERNAL_REMOTE: 'internal',
      INTERNAL_BRANCH: 'main',
      SOURCE_REF: 'HEAD'
    };
    execFileSync('bash', [script], { cwd: srcWork, encoding: 'utf8', env });
    const first = git(dstBare, ['rev-parse', 'main']);
    const out = execFileSync('bash', [script], { cwd: srcWork, encoding: 'utf8', env });
    expect(out).toMatch(/already matches/);
    expect(git(dstBare, ['rev-parse', 'main'])).toBe(first);
  });

  it('fails when the internal branch has no README.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-internal-'));
    roots.push(root);
    const srcBare = join(root, 'src.git');
    const dstBare = join(root, 'dst.git');
    initBare(srcBare);
    initBare(dstBare);

    const srcWork = join(root, 'src');
    initWork(srcWork, srcBare);
    writeFileSync(join(srcWork, 'README.md'), 'public\n');
    writeFileSync(join(srcWork, 'app.txt'), 'x\n');
    commitAll(srcWork, 'public');

    const dstWork = join(root, 'dst');
    initWork(dstWork, dstBare);
    writeFileSync(join(dstWork, 'only.txt'), 'no readme\n');
    commitAll(dstWork, 'internal without readme');

    expect(() =>
      execFileSync('bash', [script], {
        cwd: srcWork,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...gitEnv,
          INTERNAL_URL: dstBare,
          INTERNAL_REMOTE: 'internal',
          INTERNAL_BRANCH: 'main',
          SOURCE_REF: 'HEAD'
        }
      })
    ).toThrow(/no README\.md to preserve/);
  });

  it('dry-run does not update the internal branch', () => {
    const { srcWork, dstBare } = setupPair();
    const before = git(dstBare, ['rev-parse', 'main']);
    execFileSync('bash', [script], {
      cwd: srcWork,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...gitEnv,
        INTERNAL_URL: dstBare,
        INTERNAL_REMOTE: 'internal',
        INTERNAL_BRANCH: 'main',
        SOURCE_REF: 'HEAD',
        DRY_RUN: '1'
      }
    });
    expect(git(dstBare, ['rev-parse', 'main'])).toBe(before);
  });
});
