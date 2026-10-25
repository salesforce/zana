import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireSnapshotSlot, changedPaths, configuredAliases, createPhaseTimer, githubRepository, parseTuples, prepareTinynodReview, runFastVerification, runFullVerification, runPrePush, runPrePushWithReview, selectPush, selectedTestFiles, snapshotCacheRoot, snapshotKey, spawnCommand, windowsPnpm, withSnapshot } from './pre-push-verification.mjs';

// Spy on spawnSync while keeping real spawning, so tests can check what the hook starts.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const OID = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const feature = { localRef: 'refs/heads/feature', localOid: OID, remoteRef: 'refs/heads/feature', remoteOid: BASE };
const services = (paths: string[] = ['apps/server/src/index.ts']) => ({
  hasObject: () => true,
  mergeBase: () => BASE,
  isAncestor: () => true,
  changed: () => paths,
});

// Tests that do not exercise snapshot reuse must never touch the real user cache.
beforeEach(() => {
  vi.stubEnv('ZANA_PREPUSH_FRESH_SNAPSHOT', '1');
  vi.stubEnv('ZANA_PREPUSH_TIMING', '');
  // The advisory tinynod review is opt-in; keep a developer's own setting out of these tests.
  vi.stubEnv('TINYNOD_SKIP_HOOK', '1');
  vi.stubEnv('ZANA_TINYNOD_REVIEW', '');
});

it('accepts only canonical GitHub remote spellings and configured aliases', () => {
  expect(githubRepository('https://github.com/salesforce/zana.git')).toBe('salesforce/zana');
  expect(githubRepository('git@github.com:salesforce/zana.git')).toBe('salesforce/zana');
  expect(githubRepository('git@github.com-work-public:salesforce/zana.git', { 'github.com-work-public': 'github.com' })).toBe('salesforce/zana');
  expect(githubRepository('git@github.com-work-public:salesforce/zana.git')).toBeNull();
  expect(githubRepository('git@git.soma.salesforce.com:salesforce/zana.git')).toBeNull();
  expect(githubRepository('https://github.com/fork/zana.git')).toBeNull();
});

it('resolves only configured SSH aliases to GitHub', () => {
  const run = vi.fn((_command, args) => args[1] === 'github.com-work-public'
    ? { status: 0, stdout: 'hostname github.com\n' }
    : { status: 0, stdout: 'hostname git.example.test\n' });
  expect(configuredAliases(run, 'github.com-work-public,work-gh')).toEqual({ 'github.com-work-public': 'github.com', 'work-gh': 'git.example.test' });
  expect(run).toHaveBeenCalledTimes(2);
});

it('parses git tuples and rejects malformed streams', () => {
  expect(parseTuples(`refs/heads/x ${OID} refs/heads/x ${BASE}\n`)).toEqual([{ ...feature, localRef: 'refs/heads/x', remoteRef: 'refs/heads/x' }]);
  expect(parseTuples('invalid')).toBeNull();
});

it('preserves both sides of rename and copy records', () => {
  const runGit = vi.fn().mockReturnValue('R100\tapps/server/src/runtime.ts\tdocs/runtime.md\nC100\tapps/server/src/source.ts\tdocs/source.md\nD\tapps/server/src/removed.ts');
  expect(changedPaths(BASE, OID, runGit)).toEqual([
    'apps/server/src/runtime.ts', 'docs/runtime.md', 'apps/server/src/source.ts', 'docs/source.md', 'apps/server/src/removed.ts',
  ]);
});

it('skips only explicit inert prose and selects fast for ordinary feature source', () => {
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(['docs/guide.md', 'README.md']) })).toMatchObject({ action: 'skip' });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(['docs/fixtures/example.md']) })).toMatchObject({ action: 'fast' });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(['apps/server/src/removed.ts']) })).toMatchObject({ action: 'fast', oid: OID, base: BASE });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(['docs/guide.md', 'apps/server/src/removed.ts']) })).toMatchObject({ action: 'fast' });
});

it('treats repo agent instructions as inert prose outside plugins and test inputs', () => {
  const select = (paths: string[]) => selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(paths) });
  expect(select(['AGENTS.md', 'CLAUDE.md'])).toMatchObject({ action: 'skip' });
  expect(select(['apps/host-daemon/AGENTS.md', 'apps/server/src/services/inbox/CLAUDE.md', 'packages/domain/AGENTS.md', 'docs/releases/AGENTS.md', 'docs/control-sdk.md'])).toMatchObject({ action: 'skip' });
  expect(select(['plugins/agent-city/AGENTS.md'])).toMatchObject({ action: 'fast' });
  expect(select(['apps/server/src/plugins/builtin-skills/zcc-cli/AGENTS.md'])).toMatchObject({ action: 'fast' });
  expect(select(['apps/server/src/__tests__/AGENTS.md'])).toMatchObject({ action: 'fast' });
  expect(select(['e2e/fixtures/CLAUDE.md'])).toMatchObject({ action: 'fast' });
  expect(select(['website/AGENTS.md'])).toMatchObject({ action: 'fast' });
  expect(select(['apps/app/NOTES.md'])).toMatchObject({ action: 'fast' });
  expect(select(['AGENTS.md', 'apps/host-daemon/src/pty.ts'])).toMatchObject({ action: 'fast' });
});

it('uses changed-test verification for infrastructure paths and large feature changes', () => {
  for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.build.json', 'vitest.workspace.config.ts', 'electron.vite.config.mts', 'scripts/build.mjs', '.github/workflows/ci.yml', '.githooks/pre-push', 'packages/domain/src/index.ts']) {
    expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services([path]) })).toMatchObject({ action: 'fast', reason: 'feature branch change-aware verification' });
  }
  const paths = Array.from({ length: 201 }, (_, index) => `apps/server/src/${index}.ts`);
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(paths) })).toMatchObject({ action: 'fast' });
});

it('uses strictest full policy for unsafe refs, bases, remote identity, and multiple objects', () => {
  expect(selectPush({ tuples: [{ ...feature, remoteRef: 'refs/heads/main' }], remoteUrl: 'https://github.com/salesforce/zana', ...services() })).toMatchObject({ action: 'full', reason: expect.stringContaining('protected') });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/fork/zana', ...services() })).toMatchObject({ action: 'full', reason: expect.stringContaining('remote') });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(), isAncestor: () => false })).toMatchObject({ action: 'full', reason: expect.stringContaining('non-ancestor') });
  expect(selectPush({ tuples: [feature, { ...feature, localOid: 'c'.repeat(40), remoteRef: 'refs/heads/other' }], remoteUrl: 'https://github.com/salesforce/zana', ...services() })).toMatchObject({ action: 'full', reason: expect.stringContaining('multiple') });
  expect(selectPush({ tuples: [feature, { ...feature, remoteRef: 'refs/heads/other', remoteOid: 'c'.repeat(40) }], remoteUrl: 'https://github.com/salesforce/zana', ...services() })).toMatchObject({ action: 'full', reason: expect.stringContaining('bases') });
  expect(selectPush({ tuples: [{ ...feature, remoteRef: 'refs/changes/1' }], remoteUrl: 'https://github.com/salesforce/zana', ...services() })).toMatchObject({ action: 'full', reason: expect.stringContaining('unknown') });
});

it('handles new branches and deletion-only pushes conservatively', () => {
  const fresh = { ...feature, remoteOid: '0'.repeat(40) };
  expect(selectPush({ tuples: [fresh], remoteUrl: 'https://github.com/salesforce/zana', ...services(['docs/readme.md']) })).toMatchObject({ action: 'skip' });
  expect(selectPush({ tuples: [fresh], remoteUrl: 'https://github.com/salesforce/zana', ...services(), hasObject: () => false })).toMatchObject({ action: 'full', reason: expect.stringContaining('origin/main') });
  expect(selectPush({ tuples: [{ ...feature, localOid: '0'.repeat(40) }], remoteUrl: 'https://github.com/salesforce/zana', ...services() })).toMatchObject({ action: 'skip', reason: 'ref deletion only' });
});

it('runs snapshot verification once per selected pushed oid and surfaces failures', () => {
  const log = vi.fn(); const error = vi.fn(); const verify = vi.fn();
  const select = vi.fn().mockReturnValue({ action: 'full', reason: 'fallback', oids: [OID, 'c'.repeat(40)] });
  expect(runPrePush({ input: `${feature.localRef} ${OID} ${feature.remoteRef} ${BASE}\n`, remoteUrl: 'https://github.com/salesforce/zana', log, error, select, verify, run: () => ({ status: 1 }) })).toBe(0);
  expect(verify).toHaveBeenCalledTimes(2);
  expect(log).toHaveBeenCalledWith('pre-push: full; fallback');
  expect(runPrePush({ input: 'broken', remoteUrl: 'https://github.com/salesforce/zana', log, error, select: () => ({ action: 'abort', reason: 'bad input' }), verify, run: () => ({ status: 1 }) })).toBe(1);
  expect(runPrePush({ input: '', remoteUrl: 'https://github.com/salesforce/zana', log, error, select: () => ({ action: 'full', reason: 'fallback', oid: OID }), verify: () => { throw new Error('snapshot unavailable'); }, run: () => ({ status: 1 }) })).toBe(1);
  expect(error).toHaveBeenCalledWith('pre-push: snapshot unavailable');
  expect(runPrePush({ input: '', log, error })).toBe(1);
  expect(error).toHaveBeenCalledWith('pre-push: Git did not provide remote URL; aborting push.');
});

it('falls back to every pushed object when a conservative selection omits oids', () => {
  const verify = vi.fn();
  const second = 'c'.repeat(40);
  const input = `${feature.localRef} ${OID} ${feature.remoteRef} ${BASE}\nrefs/heads/other ${second} refs/heads/other ${BASE}\n`;
  expect(runPrePush({ input, remoteUrl: 'https://github.com/salesforce/zana', select: () => ({ action: 'full', reason: 'protected ref' }), verify, run: () => ({ status: 1 }), log: vi.fn(), error: vi.fn() })).toBe(0);
  expect(verify).toHaveBeenCalledWith(expect.objectContaining({ oid: OID }));
  expect(verify).toHaveBeenCalledWith(expect.objectContaining({ oid: second }));
});

it('installs dependencies and runs changed tests plus direct colocated tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-fast-'));
  const snapshots: string[] = [];
  const run = vi.fn((command, args) => {
    if (command === 'git' && args[0] === 'clone') snapshots.push(args.at(-1)!);
    if (command === 'fd') return { status: 0, stdout: 'apps/app/src/__tests__/rule6.guard.test.ts\nscripts/install-seam.guard.test.ts\n' };
    return { status: 0 };
  });
  try {
    runFastVerification({ oid: OID, base: BASE, paths: ['plugins/slack-bridge-2ff2/src/index.test.ts'], root, run, log: vi.fn() });
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['git', ['clone', '--no-local', '--no-checkout', root, snapshots[0]]],
      ['git', ['config', '--unset-all', 'core.worktree']],
      ['git', ['fetch', '--no-tags', root, OID]],
      ['git', ['checkout', '--detach', OID]],
      ['pnpm', ['install', '--frozen-lockfile', '--prefer-offline']],
      ['pnpm', ['run', 'typecheck']],
      ['pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package']],
      ['pnpm', ['exec', 'vitest', 'run', 'plugins/slack-bridge-2ff2/src/index.test.ts']],
      ['fd', ['-e', 'ts', 'guard\\.test']],
      ['pnpm', ['exec', 'vitest', 'run', 'apps/app/src/__tests__/rule6.guard.test.ts', 'scripts/install-seam.guard.test.ts']],
    ]);
    for (const [, , options] of run.mock.calls.slice(0, 4)) {
      expect(options.env).not.toHaveProperty('GIT_DIR');
      expect(options.env).not.toHaveProperty('GIT_WORK_TREE');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('installs snapshot dependencies and skips tests for non-code inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-fast-reuse-'));
  mkdirSync(join(root, 'node_modules'));
  const run = vi.fn((command, args) => {
    if (command === 'fd') return { status: 0, stdout: '' };
    return { status: 0 };
  });
  try {
    runFastVerification({ oid: OID, base: BASE, paths: ['docs/guide.md'], root, run, log: vi.fn() });
    expect(run).toHaveBeenCalledWith('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], expect.anything());
    expect(run).not.toHaveBeenCalledWith('pnpm', expect.arrayContaining(['vitest']), expect.anything());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('uses an install when dependency inputs change and broad tests for runner config', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-fast-dependencies-'));
  const run = vi.fn((command, args) => {
    if (command === 'fd') return { status: 0, stdout: '' };
    return { status: 0 };
  });
  try {
    runFastVerification({ oid: OID, base: BASE, paths: ['pnpm-lock.yaml', 'vitest.config.ts'], root, run, log: vi.fn() });
    expect(run).toHaveBeenCalledWith('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], expect.anything());
    expect(run).toHaveBeenCalledWith('pnpm', ['exec', 'vitest', 'run', '--changed', BASE], expect.anything());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('falls back to install and skips optional test stages when no code inputs or guards exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-fast-empty-'));
  const run = vi.fn((command, args) => {
    if (command === 'fd') return { status: 0, stdout: '' };
    return { status: 0 };
  });
  try {
    runFastVerification({ oid: OID, base: BASE, paths: [], root, run, log: vi.fn() });
    expect(run).toHaveBeenCalledWith('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], expect.anything());
    expect(run).not.toHaveBeenCalledWith('pnpm', expect.arrayContaining(['vitest']), expect.anything());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('uses broad changed-test selection for test and runner configuration inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-fast-broad-'));
  const run = vi.fn((command, args) => {
    if (command === 'fd') return { status: 0, stdout: '' };
    return { status: 0 };
  });
  try {
    runFastVerification({ oid: OID, base: BASE, paths: ['vitest.config.ts'], root, run, log: vi.fn() });
    const commands = run.mock.calls.map(([command, args]) => [command, args]);
    const assets = commands.findIndex(([, args]) => args.includes('package'));
    expect(assets).toBeGreaterThan(-1);
    expect(commands.slice(assets, assets + 2)).toEqual([
      ['pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package']],
      ['pnpm', ['exec', 'vitest', 'run', '--changed', BASE]],
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('skips Slack asset preparation when no selected test is in the Slack bridge', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-fast-no-slack-'));
  const run = vi.fn((command) => (command === 'fd' ? { status: 0, stdout: '' } : { status: 0 }));
  try {
    runFastVerification({ oid: OID, base: BASE, paths: ['apps/server/src/service.test.ts'], root, run, log: vi.fn() });
    expect(run).not.toHaveBeenCalledWith('pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package'], expect.anything());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('fast verification fails when Slack asset preparation fails before broad tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-fast-slack-failure-'));
  const run = vi.fn((command, args) => {
    if (args.includes('package')) return { status: 1 };
    return command === 'fd' ? { status: 0, stdout: '' } : { status: 0 };
  });
  try {
    expect(() => runFastVerification({ oid: OID, base: BASE, paths: ['vitest.config.ts'], root, run, log: vi.fn() }))
      .toThrow('snapshot Slack runtime asset preparation failed');
    expect(run).not.toHaveBeenCalledWith('pnpm', expect.arrayContaining(['vitest']), expect.anything());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('selects colocated test files with every supported script extension', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-test-selection-'));
  try {
    mkdirSync(join(root, 'apps', 'app', 'src'), { recursive: true });
    for (const file of ['Widget.test.tsx', 'Widget.coverage.test.mts', 'Widget.spec.jsx', 'Other.test.ts']) {
      writeFileSync(join(root, 'apps', 'app', 'src', file), '');
    }
    expect(selectedTestFiles(['apps/app/src/Widget.tsx'], root)).toEqual([
      'apps/app/src/Widget.coverage.test.mts',
      'apps/app/src/Widget.spec.jsx',
      'apps/app/src/Widget.test.tsx'
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each([
  ['install', 5, 'snapshot dependency install failed'],
  ['typecheck', 6, 'verification failed: pnpm run typecheck'],
  ['selected vitest', 7, 'verification failed: selected vitest tests'],
  ['guard discovery', 8, 'could not list source-text guard tests'],
])('fast verification fails when %s fails', (_stage, failedCall, message) => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-fast-failure-'));
  let calls = 0;
  const run = vi.fn((command) => {
    calls += 1;
    if (calls === failedCall) return { status: 1 };
    if (command === 'fd') return { status: 0, stdout: '' };
    return { status: 0 };
  });
  try {
    expect(() => runFastVerification({ oid: OID, base: BASE, paths: ['apps/server/src/service.test.ts'], root, run, log: vi.fn() })).toThrow(message);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('does not let environment overrides weaken full fallback policy', () => {
  const verify = vi.fn();
  const fastVerify = vi.fn();
  expect(runPrePush({ input: '', remoteUrl: 'https://github.com/salesforce/zana', run: () => ({ status: 1 }), log: vi.fn(), error: vi.fn(), verify, fastVerify, prePush: 'fast', select: () => ({ action: 'full', reason: 'protected', oid: OID, base: BASE }) })).toBe(0);
  expect(verify).toHaveBeenCalledWith(expect.objectContaining({ oid: OID }));
  expect(fastVerify).not.toHaveBeenCalled();
});

it('creates a private detached snapshot, runs named full union, and cleans it up', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-root-'));
  const snapshots: string[] = [];
  const run = vi.fn((command, args, options) => {
    if (command === 'git' && args[0] === 'clone') snapshots.push(args.at(-1)!);
    return { status: 0 };
  });
  try {
    runFullVerification({ oid: OID, root, run, log: vi.fn() });
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['git', ['clone', '--no-local', '--no-checkout', root, snapshots[0]]],
      ['git', ['config', '--unset-all', 'core.worktree']],
      ['git', ['fetch', '--no-tags', root, OID]],
      ['git', ['checkout', '--detach', OID]],
      ['pnpm', ['install', '--frozen-lockfile', '--prefer-offline']],
      ['pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package']],
      ['pnpm', ['verify:full']],
    ]);
    expect(snapshots).toHaveLength(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const NPM_SHIM = '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n';

function pnpmDirectory(root: string, name: string, files: Record<string, string>) {
  const directory = join(root, name);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), content);
  }
  return directory;
}

it('resolves Windows pnpm to its exe or to the script its cmd shim runs, in PATH order', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-pnpm-'));
  try {
    const empty = pnpmDirectory(root, 'empty', {});
    const npm = pnpmDirectory(root, 'npm', { 'pnpm.cmd': NPM_SHIM });
    const exe = pnpmDirectory(root, 'exe', { 'pnpm.exe': '' });
    const legacy = pnpmDirectory(root, 'legacy', { 'pnpm.cmd': '@"%~dp0\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\r\n' });
    // Real Corepack shim captured on Windows from `corepack enable` (%~dp0\node_modules\corepack\dist\pnpm.js):
    const corepackShim = '@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\node_modules\\corepack\\dist\\pnpm.js" %*\r\n) ELSE (\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\node_modules\\corepack\\dist\\pnpm.js" %*\r\n)\r\n';
    const corepack = pnpmDirectory(root, 'corepack', { 'pnpm.cmd': corepackShim });
    const unknown = pnpmDirectory(root, 'unknown', { 'pnpm.cmd': '@pnpm-launcher.exe %*\r\n' });
    expect(windowsPnpm(`${empty};"${npm}";${exe}`)).toEqual([process.execPath, join(npm, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')]);
    expect(windowsPnpm(corepack)).toEqual([process.execPath, join(corepack, 'node_modules', 'corepack', 'dist', 'pnpm.js')]);
    expect(windowsPnpm(`${exe};${npm}`)).toEqual([join(exe, 'pnpm.exe')]);
    expect(windowsPnpm(`;${legacy}`)).toEqual([process.execPath, join(legacy, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')]);
    expect(windowsPnpm(unknown)).toEqual(['pnpm']);
    expect(windowsPnpm('')).toEqual(['pnpm']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('passes Windows pnpm arguments verbatim, without a shell', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-pnpm-'));
  const shim = pnpmDirectory(root, 'npm', {
    'pnpm.cmd': NPM_SHIM,
    'node_modules/pnpm/bin/pnpm.mjs': 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
  });
  vi.stubEnv('PATH', shim);
  const args = ['exec', 'vitest', 'run', 'src dir/a&b|c>d.test.ts', '%PATH%'];
  try {
    const result = spawnCommand('pnpm', args, { encoding: 'utf8' }, 'win32');
    expect(JSON.parse(String(result.stdout))).toEqual(args);
    expect(vi.mocked(spawnSync).mock.lastCall?.[0]).toBe(process.execPath);
    expect(vi.mocked(spawnSync).mock.lastCall?.[2]).not.toHaveProperty('shell');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it('leaves other commands and other platforms to spawnSync unchanged', () => {
  vi.mocked(spawnSync).mockReturnValueOnce({ status: 0 } as never).mockReturnValueOnce({ status: 0 } as never);
  spawnCommand('pnpm', ['verify:full'], { stdio: 'inherit' }, 'linux');
  expect(spawnSync).toHaveBeenLastCalledWith('pnpm', ['verify:full'], { stdio: 'inherit' });
  spawnCommand('git', ['status'], { stdio: 'inherit' }, 'win32');
  expect(spawnSync).toHaveBeenLastCalledWith('git', ['status'], { stdio: 'inherit' });
});

it('cleans snapshots and rejects missing oid or failed commands', () => {
  expect(() => runFullVerification({ oid: '' })).toThrow('no pushed object');
  const root = mkdtempSync(join(tmpdir(), 'zana-push-failure-'));
  try {
    expect(() => runFullVerification({ oid: OID, root, run: () => ({ status: 1 }), log: vi.fn() })).toThrow('could not create isolated push snapshot');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('times phases only when ZANA_PREPUSH_TIMING is on, and still logs a phase that throws', () => {
  const log = vi.fn();
  expect(createPhaseTimer({ env: {}, log })('install', () => 7)).toBe(7);
  expect(log).not.toHaveBeenCalled();
  let clock = 0;
  const time = createPhaseTimer({ env: { ZANA_PREPUSH_TIMING: '1' }, log, now: () => (clock += 1500) });
  expect(time('install', () => 8)).toBe(8);
  expect(log).toHaveBeenLastCalledWith('pre-push: timing install 1500ms');
  expect(() => time('typecheck', () => { throw new Error('boom'); })).toThrow('boom');
  expect(log).toHaveBeenLastCalledWith('pre-push: timing typecheck 1500ms');
});

it('logs a timing line for each verification phase and the total', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-timing-'));
  const run = vi.fn((command) => (command === 'fd' ? { status: 0, stdout: 'scripts/a.guard.test.ts\n' } : { status: 0 }));
  const env = { ZANA_PREPUSH_TIMING: '1', ZANA_PREPUSH_FRESH_SNAPSHOT: '1' };
  const phases = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map(([line]) => /^pre-push: timing (\S+) \d+ms$/.exec(line)?.[1]).filter(Boolean);
  try {
    const fastLog = vi.fn();
    runFastVerification({ oid: OID, base: BASE, paths: ['plugins/slack-bridge-2ff2/src/index.test.ts'], root, run, log: fastLog, env });
    expect(phases(fastLog)).toEqual(['clone', 'fetch', 'checkout', 'install', 'typecheck', 'slack-assets', 'tests', 'guards']);
    const broadLog = vi.fn();
    runFastVerification({ oid: OID, base: BASE, paths: ['vitest.config.ts'], root, run, log: broadLog, env });
    expect(phases(broadLog)).toEqual(['clone', 'fetch', 'checkout', 'install', 'typecheck', 'slack-assets', 'tests', 'guards']);
    const fullLog = vi.fn();
    runFullVerification({ oid: OID, root, run, log: fullLog, env });
    expect(phases(fullLog)).toEqual(['clone', 'fetch', 'checkout', 'install', 'slack-assets', 'verify:full']);
    vi.stubEnv('ZANA_PREPUSH_TIMING', '1');
    const pushLog = vi.fn();
    const input = `${feature.localRef} ${OID} ${feature.remoteRef} ${BASE}\n`;
    expect(runPrePush({ input, remoteUrl: 'https://github.com/salesforce/zana', log: pushLog, error: vi.fn(), select: () => ({ action: 'fast', reason: 'feature', oid: OID, base: BASE, paths: [] }), fastVerify: vi.fn(), run: () => ({ status: 1 }) })).toBe(0);
    expect(runPrePush({ input, remoteUrl: 'https://github.com/salesforce/zana', log: pushLog, error: vi.fn(), select: () => ({ action: 'full', reason: 'protected', oid: OID }), verify: vi.fn(), run: () => ({ status: 1 }) })).toBe(0);
    expect(phases(pushLog)).toEqual(['total', 'total']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function plainGit(cwd: string, args: string[]) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[key];
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

it('keys snapshot caches by repository and keeps them in the user cache directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-cache-root-'));
  // Only PATH, so Git resolves without inheriting the hook's routing variables.
  const bare = (extra: Record<string, string> = {}) => ({ PATH: process.env.PATH ?? '', ...extra });
  try {
    expect(snapshotCacheRoot(root, { env: bare() })).toBeNull();
    plainGit(root, ['init', '-q']);
    expect(snapshotCacheRoot(root, { env: bare({ ZANA_PREPUSH_FRESH_SNAPSHOT: '1' }) })).toBeNull();
    const custom = snapshotCacheRoot(root, { env: bare({ ZANA_PREPUSH_CACHE_DIR: '/cache' }) })!;
    expect(custom).toMatch(/^\/cache\/[0-9a-f]{16}$/);
    const repository = custom.slice('/cache/'.length);
    mkdirSync(join(root, 'nested'));
    expect(snapshotCacheRoot(join(root, 'nested'), { env: bare({ ZANA_PREPUSH_CACHE_DIR: '/cache' }) })).toBe(custom);
    expect(snapshotCacheRoot(root, { env: bare({ GIT_DIR: '/elsewhere' }), platform: 'darwin' })).toBe(join(homedir(), 'Library', 'Caches', 'zana-pre-push', repository));
    expect(snapshotCacheRoot(root, { env: bare({ LOCALAPPDATA: 'C:/Local' }), platform: 'win32' })).toBe(join('C:/Local', 'zana-pre-push', repository));
    expect(snapshotCacheRoot(root, { env: bare(), platform: 'win32' })).toBe(join(homedir(), 'AppData', 'Local', 'zana-pre-push', repository));
    expect(snapshotCacheRoot(root, { env: bare({ XDG_CACHE_HOME: '/xdg' }), platform: 'linux' })).toBe(join('/xdg', 'zana-pre-push', repository));
    expect(snapshotCacheRoot(root, { env: bare(), platform: 'linux' })).toBe(join(homedir(), '.cache', 'zana-pre-push', repository));
  } finally { rmSync(root, { recursive: true, force: true }); }
  expect(snapshotKey({ abi: '127', platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64-node127');
  expect(snapshotKey()).toBe(`${process.platform}-${process.arch}-node${process.versions.modules}`);
});

const HOST = 'this-host';
const owner = (lock: string) => JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
function writeLock(lock: string, record?: Record<string, unknown>) {
  mkdirSync(lock, { recursive: true });
  if (record) writeFileSync(join(lock, 'owner.json'), JSON.stringify(record));
}

it('hands out bounded snapshot slots under exclusive, token-owned locks', () => {
  const cache = mkdtempSync(join(tmpdir(), 'zana-push-slots-'));
  try {
    const first = acquireSnapshotSlot(cache, { key: 'k', host: HOST })!;
    const second = acquireSnapshotSlot(cache, { key: 'k', host: HOST })!;
    expect([first.path, second.path]).toEqual([join(cache, 'k-0'), join(cache, 'k-1')]);
    expect(owner(join(cache, 'k-0.lock'))).toEqual({ pid: process.pid, host: HOST, token: expect.any(String) });
    expect(owner(join(cache, 'k-0.lock')).token).not.toBe(owner(join(cache, 'k-1.lock')).token);
    expect(acquireSnapshotSlot(cache, { key: 'k', host: HOST })).toBeNull();
    first.release();
    expect(existsSync(join(cache, 'k-0.lock'))).toBe(false);
    expect(acquireSnapshotSlot(cache, { key: 'k', host: HOST })!.path).toBe(join(cache, 'k-0'));

    // A holder releases only its own lock, never one another push has since taken.
    writeLock(join(cache, 'k-1.lock'), { pid: 4242, host: HOST, token: 'someone-else' });
    second.release();
    expect(owner(join(cache, 'k-1.lock')).token).toBe('someone-else');
    expect(readdirSync(cache).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

it('reclaims locks of dead or never-recorded owners but not live, foreign, or just-created ones', () => {
  const cache = mkdtempSync(join(tmpdir(), 'zana-push-stale-'));
  const lock = join(cache, 'k-0.lock');
  const options = (extra: Record<string, unknown> = {}) => ({ key: 'k', host: HOST, slots: 1, ...extra });
  try {
    writeLock(lock, { pid: 999999, host: HOST, token: 'dead' });
    expect(acquireSnapshotSlot(cache, options({ alive: () => true }))).toBeNull();
    expect(acquireSnapshotSlot(cache, options({ alive: () => false }))!.path).toBe(join(cache, 'k-0'));
    expect(owner(lock)).toMatchObject({ pid: process.pid, host: HOST });
    rmSync(lock, { recursive: true });

    // An owner record that cannot be read, such as an older pid-only lock.
    writeLock(lock);
    writeFileSync(join(lock, 'pid'), '1');
    expect(acquireSnapshotSlot(cache, options())).toBeNull();
    expect(acquireSnapshotSlot(cache, options({ now: () => Date.now() + 120_000 }))!.path).toBe(join(cache, 'k-0'));
    rmSync(lock, { recursive: true });

    // Another host's pid cannot be probed, so only age expires its lock.
    writeLock(lock, { pid: 1, host: 'other-host', token: 'remote' });
    const alive = vi.fn(() => false);
    expect(acquireSnapshotSlot(cache, options({ alive, now: () => Date.now() + 120_000 }))).toBeNull();
    expect(alive).not.toHaveBeenCalled();
    expect(acquireSnapshotSlot(cache, options({ alive, now: () => Date.now() + 25 * 60 * 60_000 }))!.path).toBe(join(cache, 'k-0'));
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

it('leaves a lock alone when a concurrent push reclaimed it first', () => {
  const cache = mkdtempSync(join(tmpdir(), 'zana-push-race-'));
  const lock = join(cache, 'k-0.lock');
  try {
    writeLock(lock, { pid: 999999, host: HOST, token: 'dead' });
    const alive = vi.fn(() => {
      // Another push replaces the dead owner's lock between our check and rename.
      rmSync(lock, { recursive: true });
      writeLock(lock, { pid: 4242, host: HOST, token: 'winner' });
      return false;
    });
    expect(acquireSnapshotSlot(cache, { key: 'k', host: HOST, alive, slots: 1 })).toBeNull();
    expect(owner(lock).token).toBe('winner');
    expect(readdirSync(cache).sort()).toEqual(['k-0.lock']);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

it('prunes unlocked slots built for another runtime, keeps locked ones, and sweeps old debris', () => {
  const cache = mkdtempSync(join(tmpdir(), 'zana-push-prune-'));
  const old = new Date(Date.now() - 120_000);
  try {
    mkdirSync(join(cache, 'old-0', 'node_modules'), { recursive: true });
    mkdirSync(join(cache, 'old-1'));
    writeLock(join(cache, 'old-1.lock'), { pid: 4242, host: HOST, token: 'live' });
    writeFileSync(join(cache, 'stray-file'), '');
    for (const debris of ['k-0.lock.a.tmp', 'old-2.b.discard', 'old-3.lock.c.stale', 'k-1.lock.d.tmp']) mkdirSync(join(cache, debris));
    for (const debris of ['k-0.lock.a.tmp', 'old-2.b.discard', 'old-3.lock.c.stale']) utimesSync(join(cache, debris), old, old);
    acquireSnapshotSlot(cache, { key: 'k', host: HOST, alive: (pid: number) => pid === 4242 });
    expect(readdirSync(cache).sort()).toEqual(['k-0.lock', 'k-1.lock.d.tmp', 'old-1', 'old-1.lock', 'stray-file']);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

it('keeps a slot when pruning fails', () => {
  const cache = mkdtempSync(join(tmpdir(), 'zana-push-prune-fail-'));
  try {
    mkdirSync(join(cache, 'old-0'));
    writeLock(join(cache, 'old-0.lock'), { pid: 4242, host: HOST, token: 'held' });
    // The slot's own lock is free; probing the other runtime's lock owner then throws.
    const alive = () => { throw new Error('probe failed'); };
    expect(acquireSnapshotSlot(cache, { key: 'k', host: HOST, alive })!.path).toBe(join(cache, 'k-0'));
    expect(existsSync(join(cache, 'old-0'))).toBe(true);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

type Run = (command: string, args: string[], options?: Record<string, unknown>) => { status: number; stdout?: string };
type Fixture = { config?: string; status?: string; head?: string; index?: string; layout?: (slot: string) => string; replaced?: string; inputs?: () => string; fail?: (command: string, args: string[], inSlot: boolean, attempt: number) => boolean };

const INPUTS = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', ':(glob)**/package.json'];

function reuseFixture({ config = 'core.bare\0core.worktree\0core.hooksPath\0', status = '', head = OID, index = 'H package.json\0', layout = (slot) => `${slot}\n${slot}/.git\n`, replaced = '', inputs = () => '100644 abc 0\tpackage.json\0', fail = () => false }: Fixture = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-reuse-root-'));
  const cacheRoot = mkdtempSync(join(tmpdir(), 'zana-push-reuse-cache-'));
  const slot = join(cacheRoot, `${snapshotKey()}-0`);
  mkdirSync(join(slot, '.git'), { recursive: true });
  const attempts = new Map<string, number>();
  const run = vi.fn<Run>((command, args, options) => {
    const name = `${command} ${args[0]}`;
    attempts.set(name, (attempts.get(name) ?? 0) + 1);
    if (fail(command, args, String(options?.cwd ?? '').startsWith(slot), attempts.get(name)!)) return { status: 1, stdout: '' };
    if (command !== 'git') return { status: 0 };
    if (args[0] === 'rev-parse') return { status: 0, stdout: args[1] === 'HEAD' ? `${head}\n` : layout(slot) };
    if (args[0] === 'for-each-ref') return { status: 0, stdout: replaced };
    if (args[0] === 'config' && args.includes('--list')) return { status: 0, stdout: config };
    if (args[0] === 'status') return { status: 0, stdout: status };
    if (args[0] === 'ls-files') return { status: 0, stdout: args[1] === '-v' ? index : inputs() };
    return { status: 0, stdout: '' };
  });
  const cleanup = () => { rmSync(root, { recursive: true, force: true }); rmSync(cacheRoot, { recursive: true, force: true }); };
  const snapshot = (log = vi.fn(), verify: (snapshot: string) => unknown = (path) => path) => withSnapshot({ oid: OID, root, run, log, cacheRoot }, verify);
  return { root, cacheRoot, slot, run, cleanup, snapshot, record: join(slot, '.git', 'zana-pre-push-dependencies'), calls: () => run.mock.calls.map(([command, args]) => [command, args]) };
}

it('reuses a free snapshot that proves clean at the pushed object', () => {
  const fixture = reuseFixture();
  writeFileSync(join(fixture.slot, '.git', 'index'), '');
  const log = vi.fn();
  try {
    expect(fixture.snapshot(log)).toBe(fixture.slot);
    expect(existsSync(join(fixture.slot, '.git', 'index'))).toBe(false);
    expect(fixture.calls()).toEqual([
      ['git', ['config', '--local', '--no-includes', '--name-only', '--list', '-z']],
      ['git', ['config', '--local', '--unset-all', 'core.worktree']],
      ['git', ['config', '--local', '--unset-all', 'core.hooksPath']],
      ['git', ['rev-parse', '--show-toplevel', '--absolute-git-dir']],
      ['git', ['for-each-ref', '--format=%(refname)', 'refs/replace/']],
      ['git', ['fetch', '--no-tags', '--force', '--prune', fixture.root, OID, '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*']],
      ['git', ['checkout', '--detach', '--force', OID]],
      ['git', ['clean', '-ffdx', '-e', 'node_modules']],
      ['git', ['rev-parse', 'HEAD']],
      ['git', ['ls-files', '-v', '-z']],
      ['git', ['status', '--porcelain=v1', '-z', '--ignored=matching', '--untracked-files=all']],
      ['git', ['ls-files', '-s', '-z', '--', ...INPUTS]],
      ['pnpm', ['install', '--frozen-lockfile', '--prefer-offline']],
    ]);
    const hooks = fixture.run.mock.calls[0][2]?.env?.GIT_CONFIG_VALUE_0 as string;
    expect(hooks).toMatch(/zana-pre-push-hooks-/);
    for (const [, , options] of fixture.run.mock.calls) {
      expect(options?.env).not.toHaveProperty('GIT_DIR');
      expect(options?.env).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks });
      expect(options?.cwd).toBe(fixture.slot);
    }
    expect(existsSync(hooks)).toBe(false);
    expect(log).toHaveBeenCalledWith(`pre-push: snapshot ${OID.slice(0, 12)} in ${fixture.slot} (reused)`);
    expect(readFileSync(fixture.record, 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(`${fixture.slot}.lock`)).toBe(false);
  } finally { fixture.cleanup(); }
});

it('clones into an empty slot before reusing it', () => {
  const fixture = reuseFixture();
  rmSync(join(fixture.slot, '.git'), { recursive: true });
  try {
    fixture.snapshot();
    expect(fixture.calls().slice(0, 3)).toEqual([
      ['git', ['clone', '--no-local', '--no-checkout', fixture.root, fixture.slot]],
      ['git', ['config', '--unset-all', 'core.worktree']],
      ['git', ['fetch', '--no-tags', '--force', '--prune', fixture.root, OID, '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*']],
    ]);
  } finally { fixture.cleanup(); }
});

it('keeps dependencies only while their inputs match the install that produced them', () => {
  let inputs = '100644 abc 0\tpackage.json\0';
  const fixture = reuseFixture({ status: '!! node_modules/\0', inputs: () => inputs });
  writeFileSync(join(fixture.slot, 'package.json'), '{}');
  const log = vi.fn();
  try {
    // No record yet: whatever is there was never proven, so it goes.
    mkdirSync(join(fixture.slot, 'node_modules/stale'), { recursive: true });
    fixture.snapshot(log);
    expect(existsSync(join(fixture.slot, 'node_modules/stale'))).toBe(false);
    const recorded = readFileSync(fixture.record, 'utf8');

    mkdirSync(join(fixture.slot, 'node_modules/kept'), { recursive: true });
    fixture.snapshot(log);
    expect(existsSync(join(fixture.slot, 'node_modules/kept'))).toBe(true);
    expect(readFileSync(fixture.record, 'utf8')).toBe(recorded);

    inputs = '100644 def 0\tpackage.json\0';
    fixture.snapshot(log);
    expect(existsSync(join(fixture.slot, 'node_modules/kept'))).toBe(false);
    expect(readFileSync(fixture.record, 'utf8')).not.toBe(recorded);
    expect(log.mock.calls.filter(([line]) => line === 'pre-push: dependency inputs changed since the last install; reinstalling from scratch')).toHaveLength(2);
  } finally { fixture.cleanup(); }
});

it.each([
  ['untracked file', { status: '?? junk.txt\0' }, 'reused snapshot is not clean: ?? junk.txt'],
  ['modified tracked file', { status: ' M src/a.ts\0' }, 'reused snapshot is not clean:  M src/a.ts'],
  ['ignored build output', { status: '!! dist/\0' }, 'reused snapshot is not clean: !! dist/'],
  ['assume-unchanged entry', { index: 'H package.json\0h src/a.ts\0' }, 'reused snapshot index hides changes: h src/a.ts'],
  ['skip-worktree entry', { index: 'S src/a.ts\0' }, 'reused snapshot index hides changes: S src/a.ts'],
  ['wrong HEAD', { head: BASE }, `reused snapshot is not at ${OID}`],
  ['unreadable config', { fail: (_command: string, args: string[]) => args[0] === 'config' && args.includes('--list') }, 'could not read reused snapshot config'],
  ['failed worktree reset', { fail: (_command: string, args: string[], inSlot: boolean) => inSlot && args[0] === 'config' && args[1] === '--local' && args.at(-1) === 'core.worktree' }, 'could not reset reused snapshot core.worktree'],
  ['failed filter reset', { config: 'core.bare\0filter.evil.smudge\0', fail: (_command: string, args: string[]) => args[0] === 'config' && args.at(-1) === 'filter.evil.smudge' }, 'could not reset reused snapshot filter.evil.smudge'],
  ['repository outside its slot', { layout: () => `${tmpdir()}\n${tmpdir()}/.git\n` }, 'reused snapshot repository points outside its slot'],
  ['unreadable layout', { fail: (_command: string, args: string[]) => args[1] === '--show-toplevel' }, 'reused snapshot repository points outside its slot'],
  ['replacement ref', { replaced: 'refs/replace/abc\n' }, 'reused snapshot has replacement refs'],
  ['failed retry clean', { fail: (command: string, args: string[], inSlot: boolean, attempt: number) => (command === 'pnpm' && inSlot && attempt === 1) || (args[0] === 'clean' && args.length === 2) }, 'could not clean reused snapshot'],
  ['failed fetch', { fail: (_command: string, args: string[], inSlot: boolean) => inSlot && args[0] === 'fetch' }, `could not fetch pushed object ${OID}`],
  ['failed checkout', { fail: (_command: string, args: string[], inSlot: boolean) => inSlot && args[0] === 'checkout' }, `could not check out pushed object ${OID}`],
  ['failed clean', { fail: (_command: string, args: string[]) => args[0] === 'clean' }, 'could not clean reused snapshot'],
  ['unreadable index', { fail: (_command: string, args: string[]) => args[0] === 'ls-files' && args[1] === '-v' }, 'could not read reused snapshot index'],
  ['failed status', { fail: (_command: string, args: string[]) => args[0] === 'status' }, 'could not read reused snapshot status'],
  ['unreadable dependency inputs', { fail: (_command: string, args: string[]) => args[0] === 'ls-files' && args[1] === '-s' }, 'could not read reused snapshot dependency inputs'],
])('falls back to a fresh clone when the reused snapshot has a %s', (_case, options, reason) => {
  const fixture = reuseFixture(options);
  const log = vi.fn();
  const verified: string[] = [];
  try {
    fixture.snapshot(log, (snapshot) => { verified.push(snapshot); });
    expect(log).toHaveBeenCalledWith(`pre-push: reused snapshot unusable (${reason}); using a fresh clone`);
    expect(existsSync(fixture.slot)).toBe(false);
    expect(existsSync(`${fixture.slot}.lock`)).toBe(false);
    expect(verified).toHaveLength(1);
    expect(verified[0]).not.toBe(fixture.slot);
    expect(fixture.calls()).toContainEqual(['git', ['clone', '--no-local', '--no-checkout', fixture.root, verified[0]]]);
  } finally { fixture.cleanup(); }
});

it('retries a failed install from scratch in the reused snapshot', () => {
  const fixture = reuseFixture({ status: '!! node_modules/\0', fail: (command, _args, _inSlot, attempt) => command === 'pnpm' && attempt === 1 });
  writeFileSync(join(fixture.slot, 'package.json'), '{}');
  mkdirSync(join(fixture.slot, 'node_modules/x'), { recursive: true });
  const log = vi.fn();
  try {
    expect(fixture.snapshot(log)).toBe(fixture.slot);
    expect(log).toHaveBeenCalledWith('pre-push: install failed in reused snapshot; retrying from scratch');
    expect(fixture.calls().slice(-3)).toEqual([
      ['pnpm', ['install', '--frozen-lockfile', '--prefer-offline']],
      ['git', ['clean', '-ffdx']],
      ['pnpm', ['install', '--frozen-lockfile', '--prefer-offline']],
    ]);
    expect(existsSync(fixture.record)).toBe(true);
  } finally { fixture.cleanup(); }
});

it('fails the push without a fresh clone when install fails twice in the reused snapshot', () => {
  const fixture = reuseFixture({ fail: (command) => command === 'pnpm' });
  const verify = vi.fn();
  try {
    expect(() => fixture.snapshot(vi.fn(), verify)).toThrow('snapshot dependency install failed');
    expect(verify).not.toHaveBeenCalled();
    expect(fixture.calls()).not.toContainEqual(expect.arrayContaining(['git', expect.arrayContaining(['clone'])]));
    expect(fixture.run.mock.calls.filter(([command]) => command === 'pnpm')).toHaveLength(2);
    expect(existsSync(fixture.slot)).toBe(true);
    expect(existsSync(fixture.record)).toBe(false);
    expect(existsSync(`${fixture.slot}.lock`)).toBe(false);
  } finally { fixture.cleanup(); }
});

it('removes node_modules left by deleted packages and keeps live ones', () => {
  const fixture = reuseFixture({ status: '!! node_modules/\0!! packages/gone/node_modules/\0!! packages/live/node_modules/\0' });
  for (const directory of ['node_modules', 'packages/gone/node_modules', 'packages/live/node_modules']) mkdirSync(join(fixture.slot, directory), { recursive: true });
  writeFileSync(join(fixture.slot, 'package.json'), '{}');
  writeFileSync(join(fixture.slot, 'packages/live/package.json'), '{}');
  try {
    fixture.snapshot();
    // First reuse has no record, so live dependencies are reinstalled too; a matching record keeps them.
    for (const directory of ['node_modules', 'packages/live/node_modules']) mkdirSync(join(fixture.slot, directory), { recursive: true });
    mkdirSync(join(fixture.slot, 'packages/gone/node_modules'), { recursive: true });
    fixture.snapshot();
    expect(existsSync(join(fixture.slot, 'node_modules'))).toBe(true);
    expect(existsSync(join(fixture.slot, 'packages/live/node_modules'))).toBe(true);
    expect(existsSync(join(fixture.slot, 'packages/gone/node_modules'))).toBe(false);
  } finally { fixture.cleanup(); }
});

it('falls back to a fresh clone when the slot .git is not a directory', () => {
  const fixture = reuseFixture();
  rmSync(join(fixture.slot, '.git'), { recursive: true });
  writeFileSync(join(fixture.slot, '.git'), `gitdir: ${fixture.root}\n`);
  const log = vi.fn();
  try {
    expect(fixture.snapshot(log)).not.toBe(fixture.slot);
    expect(log).toHaveBeenCalledWith('pre-push: reused snapshot unusable (reused snapshot .git is not a directory); using a fresh clone');
    expect(fixture.calls().filter(([, args]) => (args as string[])[0] === 'config' && (args as string[])[1] === '--local')).toEqual([]);
    expect(existsSync(fixture.root)).toBe(true);
  } finally { fixture.cleanup(); }
});

it('never reports a result from a slot whose lock a racing push took', () => {
  const fixture = reuseFixture();
  const slotWith = (owns: () => boolean) => () => ({ path: fixture.slot, owns, release: vi.fn() });
  try {
    const before = vi.fn((snapshot: string) => snapshot);
    const log = vi.fn();
    const result = withSnapshot({ oid: OID, root: fixture.root, run: fixture.run, log, cacheRoot: fixture.cacheRoot, acquire: slotWith(() => false) }, before);
    expect(result).not.toBe(fixture.slot);
    expect(before).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(`pre-push: lost the lock on ${fixture.slot}; using a fresh clone`);
    expect(existsSync(fixture.slot)).toBe(true);

    const owned = [true, false];
    const during = vi.fn((snapshot: string) => snapshot);
    const again = withSnapshot({ oid: OID, root: fixture.root, run: fixture.run, log, cacheRoot: fixture.cacheRoot, acquire: slotWith(() => owned.shift() ?? false) }, during);
    expect(during.mock.calls.map(([path]) => path)).toEqual([fixture.slot, again]);
    expect(again).not.toBe(fixture.slot);
    expect(log).toHaveBeenCalledWith(`pre-push: lost the lock on ${fixture.slot} during verification; verifying again in a fresh clone`);
  } finally { fixture.cleanup(); }
});

it.skipIf(process.platform === 'win32')('keeps a push green when its lock cannot be removed, and distrusts a slot it cannot move aside', () => {
  const cache = mkdtempSync(join(tmpdir(), 'zana-push-stuck-'));
  try {
    const slot = acquireSnapshotSlot(cache, { key: 'k', host: HOST })!;
    chmodSync(cache, 0o555);
    expect(() => slot.release()).not.toThrow();
  } finally { chmodSync(cache, 0o755); rmSync(cache, { recursive: true, force: true }); }

  const fixture = reuseFixture({ status: '?? junk\0' });
  writeFileSync(fixture.record, 'recorded');
  const run = fixture.run.getMockImplementation()!;
  fixture.run.mockImplementation((command, args, options) => {
    // The slot cannot be renamed aside once its parent is read-only.
    if (args[0] === 'status') chmodSync(fixture.cacheRoot, 0o555);
    return run(command, args, options);
  });
  try {
    expect(fixture.snapshot()).not.toBe(fixture.slot);
    expect(existsSync(fixture.slot)).toBe(true);
    expect(existsSync(fixture.record)).toBe(false);
  } finally { chmodSync(fixture.cacheRoot, 0o755); fixture.cleanup(); }
});

it('surfaces verification failures from a reused snapshot without retrying, and keeps it', () => {
  const fixture = reuseFixture();
  try {
    expect(() => fixture.snapshot(vi.fn(), () => { throw new Error('verification failed: tests'); })).toThrow('verification failed: tests');
    expect(fixture.calls()).not.toContainEqual(expect.arrayContaining(['git', expect.arrayContaining(['clone'])]));
    expect(existsSync(fixture.slot)).toBe(true);
    expect(existsSync(`${fixture.slot}.lock`)).toBe(false);
  } finally { fixture.cleanup(); }
});

it('uses a fresh clone when no slot is free or the cache is unusable', () => {
  const fixture = reuseFixture();
  const blocked = join(fixture.cacheRoot, 'not-a-directory');
  writeFileSync(blocked, '');
  const log = vi.fn();
  try {
    const busy = withSnapshot({ oid: OID, root: fixture.root, run: fixture.run, log, cacheRoot: fixture.cacheRoot, acquire: () => null }, (snapshot: string) => snapshot);
    expect(busy).not.toBe(fixture.slot);
    expect(log).toHaveBeenCalledWith('pre-push: no free cached snapshot; using a fresh clone');
    const unusable = withSnapshot({ oid: OID, root: fixture.root, run: fixture.run, log, cacheRoot: join(blocked, 'cache') }, (snapshot: string) => snapshot);
    expect(unusable).not.toBe(fixture.slot);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^pre-push: snapshot cache unavailable \(.+\); using a fresh clone$/));
  } finally { fixture.cleanup(); }
});

it('restores a reused snapshot to exactly the pushed tree with real Git', () => {
  const root = mkdtempSync(join(tmpdir(), 'zana-push-real-root-'));
  const cacheRoot = mkdtempSync(join(tmpdir(), 'zana-push-real-cache-'));
  const marker = join(root, 'hook-ran');
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const commit = (message: string) => {
    plainGit(root, ['add', '-A']);
    plainGit(root, ['commit', '-qm', message]);
    return plainGit(root, ['rev-parse', 'HEAD']);
  };
  // Real Git, stubbed pnpm: the cleanliness contract is Git's job, not the install's.
  const run = (command: string, args: string[], options: Record<string, unknown>) => (command === 'pnpm' ? { status: 0 } : spawnSync(command, args, { ...options, stdio: options.stdio === 'inherit' ? 'ignore' : options.stdio }));
  const keep = (snapshot: string) => {
    mkdirSync(join(snapshot, 'node_modules/keep'), { recursive: true });
    writeFileSync(join(snapshot, 'node_modules/keep/index.js'), '');
  };
  const log = vi.fn();
  try {
    plainGit(root, ['init', '-q']);
    write('.gitignore', 'node_modules\ndist\n');
    write('package.json', '{}');
    write('packages/gone/package.json', '{}');
    write('src/a.txt', 'first\n');
    write('src/b.txt', 'stable\n');
    const first = commit('first');
    rmSync(join(root, 'packages/gone'), { recursive: true });
    write('src/a.txt', 'second\n');
    const second = commit('second');
    write('src/a.txt', 'third\n');
    const third = commit('third');

    const used = withSnapshot({ oid: first, root, run, log, cacheRoot }, (snapshot: string) => {
      expect(readFileSync(join(snapshot, 'src/a.txt'), 'utf8')).toBe('first\n');
      // An edit that keeps size and mtime, against an index that already trusts that stat.
      const stable = join(snapshot, 'src/b.txt');
      const old = new Date(Date.now() - 3_600_000);
      utimesSync(stable, old, old);
      plainGit(snapshot, ['update-index', '--refresh']);
      writeFileSync(stable, 'sneaky\n');
      utimesSync(stable, old, old);
      // Leave every kind of residue a verification run could produce.
      writeFileSync(join(snapshot, 'src/a.txt'), 'dirty\n');
      writeFileSync(join(snapshot, 'junk.txt'), '');
      mkdirSync(join(snapshot, 'dist'));
      writeFileSync(join(snapshot, 'dist/out.js'), '');
      keep(snapshot);
      mkdirSync(join(snapshot, 'packages/gone/node_modules/x'), { recursive: true });
      mkdirSync(join(snapshot, 'nested-repo'));
      plainGit(join(snapshot, 'nested-repo'), ['init', '-q']);
      // An install points hooks into the snapshot; reuse must not run them.
      plainGit(snapshot, ['config', 'core.hooksPath', '.githooks']);
      // Code under verification can also plant hooks, filters, and info files
      // that a later checkout would otherwise obey.
      for (const hooks of ['.git/hooks', '.githooks']) {
        mkdirSync(join(snapshot, hooks), { recursive: true });
        for (const hook of ['post-checkout', 'reference-transaction']) writeFileSync(join(snapshot, hooks, hook), `#!/bin/sh\necho ran >> "${marker}"\n`, { mode: 0o755 });
      }
      plainGit(snapshot, ['config', 'filter.evil.smudge', `sh -c 'echo ran >> "${marker}"; cat'`]);
      plainGit(snapshot, ['config', 'include.path', '../../outside.config']);
      writeFileSync(join(snapshot, '.git/info/attributes'), '* filter=evil\n');
      return snapshot;
    });
    // Removing a package changed the dependency inputs, so kept dependencies are reinstalled.
    const changed = withSnapshot({ oid: second, root, run, log, cacheRoot }, (snapshot: string) => {
      expect(plainGit(snapshot, ['rev-parse', 'HEAD'])).toBe(second);
      expect(plainGit(snapshot, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
      expect(readFileSync(join(snapshot, 'src/a.txt'), 'utf8')).toBe('second\n');
      expect(readFileSync(join(snapshot, 'src/b.txt'), 'utf8')).toBe('stable\n');
      for (const gone of ['junk.txt', 'dist', 'nested-repo', 'packages/gone/node_modules', 'node_modules/keep']) expect(existsSync(join(snapshot, gone))).toBe(false);
      keep(snapshot);
      return snapshot;
    });
    const reused = withSnapshot({ oid: third, root, run, log, cacheRoot }, (snapshot: string) => {
      expect(readFileSync(join(snapshot, 'src/a.txt'), 'utf8')).toBe('third\n');
      expect(existsSync(join(snapshot, 'node_modules/keep/index.js'))).toBe(true);
      expect(() => plainGit(snapshot, ['config', '--local', '--get-all', 'core.hooksPath'])).toThrow();
      expect(() => plainGit(snapshot, ['config', '--local', '--get-regexp', '^(filter|include)\\.'])).toThrow();
      expect(existsSync(join(snapshot, '.git/info'))).toBe(false);
      return snapshot;
    });
    expect(new Set([used, changed, reused].map((path) => realpathSync(path))).size).toBe(1);
    expect(existsSync(marker)).toBe(false);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('using a fresh clone'));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

// ---- Advisory tinynod review integration ----

const REMOTE = 'https://github.com/salesforce/zana';
const PUSH_INPUT = `${feature.localRef} ${OID} ${feature.remoteRef} ${BASE}\n`;

function fakeAdapter(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const trees: string[] = [];
  const review = { child: { pid: 4242 }, dir: '/tmp/none' };
  const lock = { release: vi.fn(() => events.push('lock-released')) };
  const cleanup = { setLock: vi.fn(), setChild: vi.fn(), track: vi.fn(), untrack: vi.fn(), cleanup: vi.fn(() => events.push('cleanup')), dispose: vi.fn() };
  const adapter = {
    resolveEnablement: vi.fn(() => ({ enabled: true, source: 'test' })),
    deriveReviewTarget: vi.fn(() => ({ oid: OID, base: BASE })),
    checkTinynodVersion: vi.fn(() => ({ ok: true, version: '2.5.0' })),
    acquireReviewLock: vi.fn(() => lock),
    installAbortCleanup: vi.fn(() => cleanup),
    withRepoIdentityEnv: vi.fn((env: object) => ({ ...env, LOG_LEVEL: 'warn' })),
    createReviewTree: vi.fn(() => { const tree = mkdtempSync(join(tmpdir(), 'tn-fake-tree-')); trees.push(tree); return tree; }),
    startReview: vi.fn(() => { events.push('review-started'); return review; }),
    finishReview: vi.fn(async () => ({ stdout: '' })),
    classifyReview: vi.fn(() => ({ status: 'clean', message: 'no findings', findings: [] })),
    ledgerEntryFor: vi.fn(() => null),
    recordAndPruneHistory: vi.fn(),
    ...overrides,
  };
  return { adapter, events, lock, cleanup, review, trees };
}

const withReview = (adapter: object) => (context: object) => prepareTinynodReview({ ...(context as Record<string, unknown>), adapter } as never);

describe('prepareTinynodReview', () => {
  const base = (adapter: object) => ({
    tuples: [feature], selection: { action: 'fast', reason: 'r' }, root: process.cwd(), aliases: {},
    checks: { remoteVerified: true, hasObject: () => true, mergeBase: () => BASE, isAncestor: () => true },
    log: vi.fn(), error: vi.fn(), adapter,
  });

  it('stays silent when disabled, and warns about invalid settings', () => {
    const { adapter } = fakeAdapter({ resolveEnablement: () => ({ enabled: false }) });
    const context = base(adapter);
    expect(prepareTinynodReview(context as never)).toBeNull();
    expect(context.log).not.toHaveBeenCalled();
    const warned = fakeAdapter({ resolveEnablement: () => ({ enabled: false, warning: 'invalid value' }) });
    const second = base(warned.adapter);
    expect(prepareTinynodReview(second as never)).toBeNull();
    expect(second.error).toHaveBeenCalledWith('pre-push: tinynod review: invalid value');
  });

  it('reads git enablement from the developer root', () => {
    const readGitEnablement = vi.fn(() => 'true');
    const { adapter } = fakeAdapter({ readGitEnablement, resolveEnablement: ({ readConfig }: { readConfig: () => string }) => ({ enabled: readConfig() === 'true' }) });
    const context = { ...base(adapter), root: process.cwd() };
    expect(prepareTinynodReview(context as never)).not.toBeNull();
    expect(readGitEnablement).toHaveBeenCalledWith(process.cwd(), expect.anything());
  });

  it('does nothing for an aborted selection', () => {
    const { adapter } = fakeAdapter();
    expect(prepareTinynodReview({ ...base(adapter), selection: { action: 'abort', reason: 'x' } } as never)).toBeNull();
    expect(adapter.deriveReviewTarget).not.toHaveBeenCalled();
  });

  it('reports a docs-only push as skipped without a snapshot', () => {
    const { adapter } = fakeAdapter();
    const context = { ...base(adapter), selection: { action: 'skip', reason: 'verified inert prose only' } };
    expect(prepareTinynodReview(context as never)).toBeNull();
    expect(context.log).toHaveBeenCalledWith('pre-push: tinynod review skipped: docs-only push (no snapshot)');
    const deletion = { ...base(adapter), selection: { action: 'skip', reason: 'ref deletion only' } };
    prepareTinynodReview(deletion as never);
    expect(deletion.log).toHaveBeenCalledWith('pre-push: tinynod review skipped: ref deletion only');
  });

  it.each([
    ['no derivable target', { deriveReviewTarget: () => ({ skip: 'protected ref refs/heads/main' }) }, 'protected ref refs/heads/main'],
    ['old tinynod', { checkTinynodVersion: () => ({ ok: false, reason: 'tinynod 2.4.0 is older than the required 2.5.0' }) }, 'older than the required'],
    ['a busy lock', { acquireReviewLock: () => null }, 'another review is running'],
  ])('skips with a reason for %s', (_name, overrides, text) => {
    const { adapter } = fakeAdapter(overrides);
    const context = base(adapter);
    expect(prepareTinynodReview(context as never)).toBeNull();
    expect(context.log).toHaveBeenCalledWith(expect.stringContaining(text));
  });

  it('never throws', () => {
    const { adapter } = fakeAdapter({ deriveReviewTarget: () => { throw new Error('kaboom'); } });
    const context = base(adapter);
    expect(prepareTinynodReview(context as never)).toBeNull();
    expect(context.error).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
  });

  it('skips when there is no git common directory', () => {
    const { adapter } = fakeAdapter();
    const context = { ...base(adapter), root: join(tmpdir(), 'definitely-not-a-repo-xyz') };
    expect(prepareTinynodReview(context as never)).toBeNull();
    expect(context.log).toHaveBeenCalledWith(expect.stringContaining('no git common directory'));
  });

  it('maps the snapshot origin back to the developer remote for the review environment', () => {
    const makeRepo = (origin: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'tn-origin-'));
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir });
      return dir;
    };
    const developer = makeRepo('git@github.com:salesforce/zana.git');
    const snapshot = makeRepo('/developer/checkout');
    try {
      const { adapter } = fakeAdapter({ createReviewTree: () => snapshot });
      const session = prepareTinynodReview({ ...base(adapter), root: developer } as never);
      session.start('/ignored-snapshot', OID);
      expect(adapter.withRepoIdentityEnv).toHaveBeenLastCalledWith(expect.any(Object), {}, { developerOrigin: 'git@github.com:salesforce/zana.git', slotOrigin: '/developer/checkout' });
    } finally {
      rmSync(developer, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });

  it('starts at the exact target in a private tree with an explicit environment, once per target oid', () => {
    const { adapter, events, trees } = fakeAdapter();
    const context = base(adapter);
    const session = prepareTinynodReview(context as never);
    session.start('/snap', 'f'.repeat(40));
    expect(adapter.startReview).not.toHaveBeenCalled();
    session.start('/snap', OID);
    expect(adapter.createReviewTree).toHaveBeenCalledWith(expect.objectContaining({ root: process.cwd(), oid: OID }));
    expect(trees).toHaveLength(1);
    expect(adapter.startReview).toHaveBeenCalledWith({ base: BASE, cwd: trees[0], env: expect.objectContaining({ LOG_LEVEL: 'warn' }) });
    expect(context.log).toHaveBeenCalledWith(`pre-push: tinynod review started (base ${BASE.slice(0, 12)}, head ${OID.slice(0, 12)})`);
    expect(events).toEqual(['review-started']);
  });

  it('runs the review outside the snapshot and removes its private tree when it finishes, aborts or restarts', async () => {
    const finished = fakeAdapter();
    const finishSession = prepareTinynodReview(base(finished.adapter) as never);
    finishSession.start('/snap', OID);
    expect(finished.adapter.startReview).not.toHaveBeenCalledWith(expect.objectContaining({ cwd: '/snap' }));
    expect(existsSync(finished.trees[0])).toBe(true);
    await finishSession.finish();
    expect(existsSync(finished.trees[0])).toBe(false);

    const aborted = fakeAdapter();
    const abortSession = prepareTinynodReview(base(aborted.adapter) as never);
    abortSession.start('/snap', OID);
    abortSession.abort();
    expect(existsSync(aborted.trees[0])).toBe(false);

    const restarted = fakeAdapter();
    const restartSession = prepareTinynodReview(base(restarted.adapter) as never);
    restartSession.start('/snap-a', OID);
    restartSession.start('/snap-b', OID);
    expect(restarted.trees).toHaveLength(2);
    expect(existsSync(restarted.trees[0])).toBe(false);
    expect(existsSync(restarted.trees[1])).toBe(true);
    await restartSession.finish();
    expect(existsSync(restarted.trees[1])).toBe(false);
  });

  it('skips the review, not the push, when the private tree cannot be created', () => {
    const { adapter } = fakeAdapter({ createReviewTree: () => { throw new Error('no space'); } });
    const context = base(adapter);
    const session = prepareTinynodReview(context as never);
    expect(() => session.start('/snap', OID)).not.toThrow();
    expect(adapter.startReview).not.toHaveBeenCalled();
    expect(context.error).toHaveBeenCalledWith(expect.stringContaining('no space'));
  });

  it('does not throw on null findings', async () => {
    const { adapter } = fakeAdapter({ classifyReview: () => ({ status: 'findings', message: '2 findings', findings: [null, 'text'] }) });
    const context = base(adapter);
    const session = prepareTinynodReview(context as never);
    session.start('/snap', OID);
    await session.finish();
    expect(context.log).toHaveBeenCalledWith('  [unknown] null');
  });

  it('logs and carries on when the review cannot start', () => {
    const { adapter } = fakeAdapter({ startReview: () => { throw new Error('no fds'); } });
    const context = base(adapter);
    const session = prepareTinynodReview(context as never);
    expect(() => session.start('/snap', OID)).not.toThrow();
    expect(context.error).toHaveBeenCalledWith(expect.stringContaining('no fds'));
  });

  it('replaces the first review when the same push verifies again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tn-restart-'));
    const reviews = [{ child: { pid: 2 ** 22 + 7 }, dir }, { child: { pid: 2 ** 22 + 8 }, dir: '/tmp/none' }];
    const { adapter } = fakeAdapter({ startReview: vi.fn(() => reviews.shift()) });
    const session = prepareTinynodReview(base(adapter) as never);
    session.start('/snap-a', OID);
    session.start('/snap-b', OID);
    expect(adapter.startReview).toHaveBeenCalledTimes(2);
    expect(existsSync(dir)).toBe(false);
  });

  it('finish prints the advisory result and findings, records history, and releases everything', async () => {
    const findings = Array.from({ length: 12 }, (_, index) => ({ severity: 'warning', filePath: `f${index}.ts`, lineNumber: index + 1, comment: `problem ${index}\nsecond line` }));
    const { adapter, lock, cleanup } = fakeAdapter({
      classifyReview: () => ({ status: 'findings', message: '12 findings', findings, payload: { historyPath: '/h' } }),
      ledgerEntryFor: () => ({ file: '/h', at: 1 }),
    });
    const context = base(adapter);
    const session = prepareTinynodReview(context as never);
    session.start('/snap', OID);
    await session.finish();
    expect(context.log).toHaveBeenCalledWith('pre-push: tinynod review (advisory) findings: 12 findings');
    expect(context.log).toHaveBeenCalledWith('  [warning] f0.ts:1 problem 0');
    expect(context.log).toHaveBeenCalledWith('  ... 2 more');
    expect(adapter.recordAndPruneHistory).toHaveBeenCalledWith(expect.objectContaining({ entry: { file: '/h', at: 1 } }));
    expect(lock.release).toHaveBeenCalled();
    expect(cleanup.dispose).toHaveBeenCalled();
  });

  it('reports warnings and tolerates findings without location or text', async () => {
    const { adapter } = fakeAdapter({ classifyReview: () => ({ status: 'warning', message: 'review output too large', findings: [{}] }) });
    const context = base(adapter);
    const session = prepareTinynodReview(context as never);
    session.start('/snap', OID);
    await session.finish();
    expect(context.log).toHaveBeenCalledWith('pre-push: tinynod review (advisory) warning: review output too large');
    expect(context.log).toHaveBeenCalledWith('  [unknown]');
  });

  it('finish never throws and still releases the lock', async () => {
    const { adapter, lock } = fakeAdapter({ finishReview: async () => { throw new Error('read failed'); } });
    const context = base(adapter);
    const session = prepareTinynodReview(context as never);
    session.start('/snap', OID);
    await expect(session.finish()).resolves.toBeUndefined();
    expect(context.error).toHaveBeenCalledWith(expect.stringContaining('read failed'));
    expect(lock.release).toHaveBeenCalled();
  });

  it('finish without a started review just releases the lock, and is idempotent', async () => {
    const { adapter, lock } = fakeAdapter();
    const session = prepareTinynodReview(base(adapter) as never);
    await session.finish();
    await session.finish();
    session.abort();
    expect(adapter.finishReview).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('abort kills the review, releases the lock, and disarms later work', async () => {
    const { adapter, events, cleanup } = fakeAdapter();
    const session = prepareTinynodReview(base(adapter) as never);
    session.start('/snap', OID);
    session.abort();
    expect(events).toEqual(['review-started', 'cleanup', 'lock-released']);
    expect(cleanup.dispose).toHaveBeenCalled();
    session.start('/snap', OID);
    expect(adapter.startReview).toHaveBeenCalledTimes(1);
    await session.finish();
    expect(adapter.finishReview).not.toHaveBeenCalled();
  });
});

describe('runPrePush with the review seam', () => {
  const common = { remoteUrl: REMOTE, run: () => ({ status: 1 }) };

  it('does not prepare a review unless one is injected', () => {
    const fastVerify = vi.fn();
    expect(runPrePush({ ...common, input: PUSH_INPUT, log: vi.fn(), error: vi.fn(), select: () => ({ action: 'fast', reason: 'r', oid: OID, base: BASE, paths: [] }), fastVerify })).toBe(0);
    expect(fastVerify).toHaveBeenCalledWith(expect.not.objectContaining({ review: expect.anything() }));
  });

  it('keeps the exit code when a session rejects while finishing', async () => {
    const session = { start: vi.fn(), abort: vi.fn(), finish: vi.fn(async () => { throw new Error('boom'); }) };
    const error = vi.fn();
    const code = await runPrePushWithReview({ ...common, input: PUSH_INPUT, log: vi.fn(), error, select: () => ({ action: 'fast', reason: 'r', oid: OID, base: BASE, paths: [] }), fastVerify: vi.fn(), review: () => session });
    expect(code).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('passes verifiers the session only when a review exists, and keeps their other arguments', () => {
    const fastVerify = vi.fn(); const verify = vi.fn();
    const session = { start: vi.fn(), abort: vi.fn() };
    const select = () => ({ action: 'fast', reason: 'r', oid: OID, base: BASE, paths: ['a.ts'] });
    expect(runPrePush({ ...common, input: PUSH_INPUT, log: vi.fn(), error: vi.fn(), select, fastVerify, review: () => session })).toBe(0);
    expect(fastVerify).toHaveBeenCalledWith({ oid: OID, base: BASE, paths: ['a.ts'], root: process.cwd(), log: expect.any(Function), run: expect.any(Function), review: session });
    fastVerify.mockClear();
    expect(runPrePush({ ...common, input: PUSH_INPUT, log: vi.fn(), error: vi.fn(), select, fastVerify, review: () => null })).toBe(0);
    expect(fastVerify.mock.calls[0][0]).not.toHaveProperty('review');
    expect(runPrePush({ ...common, input: PUSH_INPUT, log: vi.fn(), error: vi.fn(), select: () => ({ action: 'full', reason: 'r', oid: OID }), verify, review: () => session })).toBe(0);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ oid: OID, review: session }));
  });

  it('hands the review the derived checks, the verified-remote flag, and the unchanged stdin tuples', () => {
    const review = vi.fn().mockReturnValue(null);
    runPrePush({ ...common, input: `${PUSH_INPUT}`, log: vi.fn(), error: vi.fn(), select: () => ({ action: 'skip', reason: 'verified inert prose only' }), review });
    const context = review.mock.calls[0][0];
    expect(context.tuples).toEqual([feature]);
    expect(context.checks.remoteVerified).toBe(true);
    expect(typeof context.checks.hasObject).toBe('function');
    review.mockClear();
    runPrePush({ remoteUrl: 'https://example.com/other/repo', input: PUSH_INPUT, run: () => ({ status: 1 }), log: vi.fn(), error: vi.fn(), select: () => ({ action: 'skip', reason: 'r' }), review });
    expect(review.mock.calls[0][0].checks.remoteVerified).toBe(false);
  });

  it('does not start a review for an aborted selection', () => {
    const review = vi.fn();
    expect(runPrePush({ ...common, input: 'broken', log: vi.fn(), error: vi.fn(), select: () => ({ action: 'abort', reason: 'bad' }), review })).toBe(1);
    expect(review).not.toHaveBeenCalled();
  });

  it('aborts the review and still fails the push when mandatory verification fails', () => {
    const session = { start: vi.fn(), abort: vi.fn() };
    const error = vi.fn();
    const fastVerify = vi.fn(({ review }) => { review.start('/snap', OID); throw new Error('verification failed: pnpm run typecheck'); });
    expect(runPrePush({ ...common, input: PUSH_INPUT, log: vi.fn(), error, select: () => ({ action: 'fast', reason: 'r', oid: OID, base: BASE, paths: [] }), fastVerify, review: () => session })).toBe(1);
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('pre-push: verification failed: pnpm run typecheck');
  });
});

describe('runPrePushWithReview', () => {
  const common = { remoteUrl: REMOTE, run: () => ({ status: 1 }), input: PUSH_INPUT };

  it('finishes each started review after verification and returns the verification exit code', async () => {
    const order: string[] = [];
    const session = { start: vi.fn(), abort: vi.fn(), finish: vi.fn(async () => { order.push('finish'); }) };
    const fastVerify = vi.fn(() => { order.push('verify'); });
    const code = await runPrePushWithReview({ ...common, log: vi.fn(), error: vi.fn(), select: () => ({ action: 'fast', reason: 'r', oid: OID, base: BASE, paths: [] }), fastVerify, review: () => session });
    expect(code).toBe(0);
    expect(order).toEqual(['verify', 'finish']);
  });

  it('never lets review output change a passing exit code', async () => {
    const session = { start: vi.fn(), abort: vi.fn(), finish: vi.fn(async () => undefined) };
    expect(await runPrePushWithReview({ ...common, log: vi.fn(), error: vi.fn(), select: () => ({ action: 'skip', reason: 'r' }), review: () => session })).toBe(0);
  });

  it('does not wait on a review that was aborted by a failing verification', async () => {
    const adapter = fakeAdapter();
    const code = await runPrePushWithReview({ ...common, log: vi.fn(), error: vi.fn(), select: () => ({ action: 'fast', reason: 'r', oid: OID, base: BASE, paths: [] }), fastVerify: ({ review }: { review: { start: (s: string, o: string) => void } }) => { review.start('/snap', OID); throw new Error('nope'); }, review: withReview(adapter.adapter) });
    expect(code).toBe(1);
    expect(adapter.adapter.finishReview).not.toHaveBeenCalled();
    expect(adapter.events).toEqual(['review-started', 'cleanup', 'lock-released']);
  });

  it('works with no review sessions and with the default review factory', async () => {
    expect(await runPrePushWithReview({ ...common, log: vi.fn(), error: vi.fn(), select: () => ({ action: 'skip', reason: 'r' }) })).toBe(0);
    expect(await runPrePushWithReview({ ...common, log: vi.fn(), error: vi.fn(), select: () => ({ action: 'skip', reason: 'r' }), review: () => null })).toBe(0);
  });
});

describe('verifiers start the review inside the clean snapshot', () => {
  it('starts it for fast and full verification with the pushed oid and a snapshot that is not the developer root', () => {
    const root = mkdtempSync(join(tmpdir(), 'zana-review-root-'));
    const run = vi.fn((command: string, args: string[], options?: { cwd?: string }) => {
      if (command === 'fd') return { status: 0, stdout: '' };
      if (command === 'git' && args[0] === 'clone') mkdirSync(join(args[args.length - 1], '.git'), { recursive: true });
      return { status: 0, stdout: '' };
    });
    const review = { start: vi.fn() };
    try {
      runFastVerification({ oid: OID, base: BASE, paths: [], root, run: run as never, log: vi.fn(), review });
      runFullVerification({ oid: OID, root, run: run as never, log: vi.fn(), review });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(review.start).toHaveBeenCalledTimes(2);
    for (const [snapshot, oid] of review.start.mock.calls) {
      expect(oid).toBe(OID);
      expect(snapshot).not.toBe(root);
      expect(snapshot).toContain('zana-pre-push-');
    }
    // Mandatory checks are unchanged by the review.
    const commands = run.mock.calls.map(([command, args]) => `${command} ${(args as string[]).join(' ')}`);
    expect(commands).toContain('pnpm run typecheck');
    expect(commands).toContain('pnpm verify:full');
  });

  it('a failing mandatory check still throws with a review attached', () => {
    const root = mkdtempSync(join(tmpdir(), 'zana-review-root-'));
    const run = (command: string, args: string[]) => {
      if (command === 'pnpm' && args[0] === 'run') return { status: 1 };
      return { status: 0, stdout: '' };
    };
    try {
      expect(() => runFastVerification({ oid: OID, base: BASE, paths: [], root, run: run as never, log: vi.fn(), review: { start: vi.fn() } })).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
