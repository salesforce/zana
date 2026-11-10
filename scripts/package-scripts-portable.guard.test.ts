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
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Folders whose direct children are packages (pnpm-workspace.yaml globs). */
const PACKAGE_PARENTS = ['apps', 'packages', 'plugins', 'tools'];
/** Single packages: the root, the npm-installed website and the marketplace. */
const SINGLE_PACKAGES = ['.', 'website', 'marketplace'];

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

function workspacePackageJsonFiles(): string[] {
  const dirs = [
    ...SINGLE_PACKAGES,
    ...PACKAGE_PARENTS.filter((parent) => existsSync(join(repoRoot, parent))).flatMap((parent) =>
      readdirSync(join(repoRoot, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`)
    )
  ];
  return dirs
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

describe('package.json scripts run under cmd.exe', () => {
  const files = workspacePackageJsonFiles();

  it('scans the workspace package.json files', () => {
    expect(files).toEqual(expect.arrayContaining(['package.json', 'website/package.json', 'packages/control-sdk/package.json']));
    expect(files.length).toBeGreaterThan(20);
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
