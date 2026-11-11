/**
 * Source-text guard: package.json scripts must run under cmd.exe.
 *
 * pnpm and npm run scripts through cmd.exe on Windows, which has no
 * `VAR=value cmd` env prefix, no `$VAR` / `$(…)` expansion, treats single
 * quotes as literal characters, and has no `rm -rf`. A script that uses any
 * of these works on macOS/Linux and fails on Windows with "'VAR' is not
 * recognized as an internal or external command".
 *
 * Use `cross-env VAR=value cmd`, double quotes, and `rimraf` / a Node script
 * instead. Scripts that call `bash` explicitly are POSIX by design and pass.
 *
 * This is a static text check for the common POSIX-only patterns listed in
 * `posixOnlySyntax`, not a cmd.exe run: other constructs (`&` backgrounding,
 * `~`, `2>/dev/null`, `test`/`[ ]`, …) and shell syntax inside script files
 * are not detected. The package list comes from `pnpm-workspace.yaml`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Packages outside `pnpm-workspace.yaml` whose scripts still run on Windows,
 * each with the reason. The repo root is always scanned.
 */
const EXTRA_PACKAGES: Record<string, string> = {
  marketplace: 'standalone npm package; its scripts run in CI and locally'
};

/**
 * Scripts allowed to keep POSIX-only syntax, keyed `<package.json path>#<script>`,
 * each with the reason. Keep empty unless a script can never run on Windows.
 */
const ALLOWED: Record<string, string> = {};

const ENV_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;
const POSIX_COMMAND = /^(rm|cp|mv|mkdir|ln|chmod|touch|cat|sed|grep|export|unset)\s/;

/** Blank out double-quoted spans, which cmd.exe and POSIX shells both treat as one argument. */
function withoutDoubleQuoted(script: string): string {
  return script.replace(/"(?:\\.|[^"\\])*"/g, (span) => ' '.repeat(span.length));
}

/** Returns one message per POSIX-only construct in a package.json script. */
function posixOnlySyntax(script: string): string[] {
  const problems: string[] = [];
  if (/\$[A-Za-z_{(]/.test(script) || script.includes('`')) {
    problems.push('shell expansion ($VAR, $(…) or backticks)');
  }
  const unquoted = withoutDoubleQuoted(script);
  if (unquoted.includes("'")) problems.push('single-quoted argument (use double quotes)');
  for (const segment of unquoted.split(/&&|\|\||[;|]/)) {
    const command = segment.trim();
    if (ENV_PREFIX.test(command)) problems.push(`env prefix "${command.split(/\s/)[0]}" (use cross-env)`);
    const posix = POSIX_COMMAND.exec(command);
    if (posix) problems.push(`POSIX command "${posix[1]}" (use rimraf or a Node script)`);
  }
  return problems;
}

/** The `packages:` globs of a pnpm-workspace.yaml (a plain list of quoted or bare strings). */
function workspaceGlobs(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start < 0) throw new Error('pnpm-workspace.yaml has no packages: list');
  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    const item = line.match(/^\s+-\s*(["']?)([^"'#]+?)\1\s*(?:#.*)?$/);
    if (item) globs.push(item[2]);
  }
  return globs;
}

/** Package directories for one glob. Supports `dir`, `dir/*` and `dir/**`; throws on anything else. */
function expandGlob(glob: string): string[] {
  if (glob.startsWith('!')) throw new Error(`negated workspace glob "${glob}": teach the guard about it`);
  const parts = glob.split('/');
  const recursive = parts.at(-1) === '**';
  if (!recursive && parts.at(-1) !== '*') {
    if (parts.some((part) => part.includes('*'))) throw new Error(`unsupported workspace glob "${glob}"`);
    return [glob];
  }
  const base = parts.slice(0, -1).join('/');
  if (base.includes('*')) throw new Error(`unsupported workspace glob "${glob}"`);
  if (!existsSync(join(repoRoot, base))) return [];
  const children = (dir: string): string[] =>
    readdirSync(join(repoRoot, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .flatMap((entry) => {
        const child = posix.join(dir, entry.name);
        return recursive ? [child, ...children(child)] : [child];
      });
  return children(base);
}

function workspacePackageJsonFiles(): string[] {
  const globs = workspaceGlobs(readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'));
  const dirs = ['.', ...Object.keys(EXTRA_PACKAGES), ...globs.flatMap(expandGlob)];
  return [...new Set(dirs)]
    .map((dir) => (dir === '.' ? 'package.json' : `${dir}/package.json`))
    .filter((file) => existsSync(join(repoRoot, file)));
}

function scriptsOf(file: string): Array<[string, string]> {
  const json = JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as { scripts?: Record<string, string> };
  return Object.entries(json.scripts ?? {});
}

describe('posixOnlySyntax', () => {
  it.each([
    ['ZCC_LIVE_CONTROL=1 vitest run live/a.test.ts', 'env prefix'],
    ['pnpm build && FOO=bar node x.mjs', 'env prefix'],
    ['vitest run $(fd -e ts guard)', 'shell expansion'],
    ['echo $HOME', 'shell expansion'],
    ["vitest run --exclude '**/integration/**'", 'single-quoted'],
    ['rm -rf dist', 'POSIX command "rm"'],
    ['tsc && mkdir -p out', 'POSIX command "mkdir"']
  ])('flags %s', (script, problem) => {
    expect(posixOnlySyntax(script).join('; ')).toContain(problem);
  });

  it.each([
    'cross-env ZCC_LIVE_CONTROL=1 vitest run live/a.test.ts',
    'vitest run --exclude "**/integration/**"',
    'node -e "const p=\'./x.mjs\'; import(p)"',
    'rimraf dist tsconfig.tsbuildinfo',
    'bash scripts/e2e-docker.sh',
    'vitest run --reporter=default --config vitest.config.ts'
  ])('accepts %s', (script) => {
    expect(posixOnlySyntax(script)).toEqual([]);
  });
});

describe('workspaceGlobs', () => {
  it('reads quoted, bare and commented entries and stops at the next key', () => {
    const yaml = ['packages:', '  - "apps/*"', '  # note', '  - packages/*', "  - 'website' # site", '', 'onlyBuiltDependencies:', '  - "esbuild"', ''].join('\n');
    expect(workspaceGlobs(yaml)).toEqual(['apps/*', 'packages/*', 'website']);
  });

  it('reads CRLF files', () => {
    expect(workspaceGlobs(['packages:', '  - "apps/*"', '  - "website"', ''].join('\r\n'))).toEqual(['apps/*', 'website']);
  });

  it('throws without a packages list', () => {
    expect(() => workspaceGlobs(['onlyBuiltDependencies:', '  - esbuild', ''].join('\n'))).toThrow('no packages');
  });
});

describe('expandGlob', () => {
  it('rejects globs it cannot expand', () => {
    expect(() => expandGlob('!apps/legacy')).toThrow('negated');
    expect(() => expandGlob('apps/*-plugin')).toThrow('unsupported');
    expect(() => expandGlob('*/pkg/*')).toThrow('unsupported');
  });

  it('expands nested packages for dir/**', () => {
    expect(expandGlob('scripts/**').length).toBeGreaterThanOrEqual(expandGlob('scripts/*').length);
  });
});

describe('package.json scripts run under cmd.exe', () => {
  const files = workspacePackageJsonFiles();

  it('scans the workspace package.json files', () => {
    expect(files).toEqual(expect.arrayContaining(['package.json', 'website/package.json', 'packages/control-sdk/package.json']));
    expect(files.length).toBeGreaterThan(20);
  });

  it('scans every pnpm-workspace.yaml glob that has packages', () => {
    const globs = workspaceGlobs(readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'));
    expect(globs).toEqual(expect.arrayContaining(['apps/*', 'packages/*', 'website']));
    for (const glob of globs) {
      const expected = expandGlob(glob).map((dir) => `${dir}/package.json`).filter((file) => existsSync(join(repoRoot, file)));
      expect(files).toEqual(expect.arrayContaining(expected));
    }
  });

  it('uses no POSIX-only syntax outside the allow-list', () => {
    const offenders = files.flatMap((file) =>
      scriptsOf(file)
        .filter(([name]) => !(`${file}#${name}` in ALLOWED))
        .flatMap(([name, script]) => posixOnlySyntax(script).map((problem) => `${file}#${name}: ${problem}`))
    );
    expect(offenders).toEqual([]);
  });

  it('has no stale allow-list entries', () => {
    const stale = Object.keys(ALLOWED).filter((key) => {
      const [file, name] = key.split('#');
      const script = files.includes(file) ? scriptsOf(file).find(([n]) => n === name)?.[1] : undefined;
      return script === undefined || posixOnlySyntax(script).length === 0;
    });
    expect(stale).toEqual([]);
  });
});
