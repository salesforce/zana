import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { normalizeRepoUrl, canonicalRemote, safeRef, cloneProject } from './git-clone.js';

describe('normalizeRepoUrl', () => {
  it('parses a plain https GitHub URL', () => {
    const r = normalizeRepoUrl('https://github.com/omnigent-ai/omnigent');
    expect(r.repoName).toBe('omnigent');
    expect(r.cloneUrl).toBe('https://github.com/omnigent-ai/omnigent');
  });

  it('strips a trailing .git and slash', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo.git').repoName).toBe('repo');
    expect(normalizeRepoUrl('https://github.com/owner/repo/').repoName).toBe('repo');
    expect(normalizeRepoUrl('https://github.com/owner/repo.git/').repoName).toBe('repo');
  });

  it('handles non-GitHub https hosts', () => {
    const r = normalizeRepoUrl('https://git.example.com/team/project.git');
    expect(r.repoName).toBe('project');
    expect(r.cloneUrl).toBe('https://git.example.com/team/project.git');
  });

  it('parses scp-style ssh URLs', () => {
    const r = normalizeRepoUrl('git@github.com:owner/repo.git');
    expect(r.repoName).toBe('repo');
    expect(r.cloneUrl).toBe('git@github.com:owner/repo.git');
  });

  it('parses ssh:// URLs', () => {
    const r = normalizeRepoUrl('ssh://git@github.com/owner/repo.git');
    expect(r.repoName).toBe('repo');
  });

  it('expands owner/repo shorthand to a GitHub https URL', () => {
    const r = normalizeRepoUrl('omnigent-ai/omnigent');
    expect(r.repoName).toBe('omnigent');
    expect(r.cloneUrl).toBe('https://github.com/omnigent-ai/omnigent.git');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeRepoUrl('  https://github.com/owner/repo  ').repoName).toBe('repo');
  });

  it('rejects empty input', () => {
    expect(() => normalizeRepoUrl('')).toThrow();
    expect(() => normalizeRepoUrl('   ')).toThrow();
  });

  it('rejects an argv-flag-shaped spec', () => {
    expect(() => normalizeRepoUrl('--upload-pack=evil')).toThrow();
  });

  it('rejects whitespace inside the URL', () => {
    expect(() => normalizeRepoUrl('https://github.com/ow ner/repo')).toThrow();
  });

  it('rejects unsupported schemes', () => {
    expect(() => normalizeRepoUrl('file:///etc/passwd')).toThrow();
    expect(() => normalizeRepoUrl('ftp://host/x/y')).toThrow();
  });

  it('rejects an over-long URL', () => {
    expect(() => normalizeRepoUrl('https://github.com/' + 'a'.repeat(3000))).toThrow();
  });

  it('derives a single safe path segment (no separators, no leading dots)', () => {
    // A crafted pathname can't yield a real separator or a leading `..`, so the
    // destination join() can never escape the clone root. `%2f` stays literal
    // (URL doesn't decode it) — it's a harmless filename char, not a separator.
    const r = normalizeRepoUrl('https://github.com/owner/..%2f..%2fetc');
    expect(r.repoName).not.toContain('/');
    expect(r.repoName).not.toContain('\\');
    expect(r.repoName.startsWith('.')).toBe(false);
  });
});

describe('canonicalRemote', () => {
  it('treats https and ssh forms of the same repo as equal', () => {
    expect(canonicalRemote('https://github.com/owner/repo.git')).toBe(
      canonicalRemote('git@github.com:owner/repo.git')
    );
    expect(canonicalRemote('https://github.com/owner/repo')).toBe(
      canonicalRemote('ssh://git@github.com/owner/repo.git')
    );
  });

  it('ignores .git suffix, trailing slash, credentials, and case', () => {
    const base = canonicalRemote('https://github.com/owner/repo');
    expect(canonicalRemote('https://github.com/owner/repo.git')).toBe(base);
    expect(canonicalRemote('https://github.com/owner/repo/')).toBe(base);
    expect(canonicalRemote('https://user:tok@github.com/Owner/Repo')).toBe(base);
  });

  it('keeps distinct repos distinct', () => {
    expect(canonicalRemote('https://github.com/owner/repo')).not.toBe(
      canonicalRemote('https://github.com/owner/other')
    );
    expect(canonicalRemote('https://github.com/owner/repo')).not.toBe(
      canonicalRemote('https://gitlab.com/owner/repo')
    );
  });

  it('returns empty for blank input', () => {
    expect(canonicalRemote('')).toBe('');
    expect(canonicalRemote('   ')).toBe('');
  });
});

describe('safeRef', () => {
  it('accepts a plain branch/tag and returns it unchanged', () => {
    expect(safeRef('main')).toBe('main');
    expect(safeRef('v1.2.3')).toBe('v1.2.3');
    expect(safeRef('release/2026-07')).toBe('release/2026-07');
    // A full/short SHA is a valid ref.
    expect(safeRef('a1b2c3d')).toBe('a1b2c3d');
  });

  it('trims surrounding whitespace', () => {
    expect(safeRef('  main  ')).toBe('main');
  });

  it('rejects an empty ref', () => {
    expect(() => safeRef('')).toThrow();
    expect(() => safeRef('   ')).toThrow();
  });

  it('rejects an argv-flag-shaped ref (leading dash)', () => {
    expect(() => safeRef('--upload-pack=evil')).toThrow();
    expect(() => safeRef('-x')).toThrow();
  });

  it('rejects whitespace inside the ref', () => {
    expect(() => safeRef('feature branch')).toThrow();
  });

  it('rejects an over-long ref', () => {
    expect(() => safeRef('a'.repeat(300))).toThrow();
  });

  it('rejects git revision metacharacters (pathspec/rev injection)', () => {
    // `..` range/traversal, `~`/`^` ancestry, `@{` reflog, `:` rev:path, glob, `\`.
    for (const bad of ['a..b', 'main~1', 'HEAD^', 'main@{1}', 'a:b', 'v*', 'x?', 'a[b]', 'a\\b']) {
      expect(() => safeRef(bad), `${bad} should be rejected`).toThrow();
    }
  });
});

describe('cloneProject (input validation, offline)', () => {
  // normalizeRepoUrl rejects file://-and-local specs, so the success path is
  // covered offline by the e2e suite (which injects a raw `git clone -- <bare>`).
  // Here we lock the fail-closed BAD_INPUT branches that never touch the network.

  it('rejects an unparseable url with BAD_INPUT', async () => {
    const res = await cloneProject({ url: '--upload-pack=evil', destBase: join(tmpdir(), 'x') });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('BAD_INPUT');
  });

  it('rejects a relative destBase with BAD_INPUT', async () => {
    const res = await cloneProject({ url: 'https://github.com/owner/repo', destBase: 'relative/dir' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('BAD_INPUT');
  });

  it('rejects an invalid ref with BAD_INPUT before any network access', async () => {
    const res = await cloneProject({
      url: 'https://github.com/owner/repo',
      destBase: join(tmpdir(), 'x'),
      ref: '--evil',
      shallow: true
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('BAD_INPUT');
  });

  it('rejects a symlink destination before git can write outside the clone root', async () => {
    const root = join(tmpdir(), `zcc-clone-root-${Date.now()}`);
    const external = join(tmpdir(), `zcc-clone-external-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    mkdirSync(external, { recursive: true });
    symlinkSync(external, join(root, 'repo'));

    try {
      const res = await cloneProject({ url: 'https://github.com/owner/repo', destBase: root });
      expect(res.ok).toBe(false);
      expect(res.code).toBe('BAD_INPUT');
      expect(res.message).toMatch(/symbolic link/);
      expect(existsSync(join(external, '.git'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it('uses the canonical clone-root path when the configured root is a symlink', async () => {
    const root = join(tmpdir(), `zcc-clone-root-${Date.now()}`);
    const alias = join(tmpdir(), `zcc-clone-alias-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    mkdirSync(join(root, 'repo', 'placeholder'), { recursive: true });
    symlinkSync(root, alias);

    try {
      const res = await cloneProject({ url: 'https://github.com/owner/repo', destBase: alias });
      expect(res.ok).toBe(false);
      expect(res.code).toBe('DEST_EXISTS');
      expect(res.path).toBe(join(realpathSync(root), 'repo'));
    } finally {
      rmSync(alias, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
