import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { changedPaths, configuredAliases, githubRepository, parseTuples, runFastVerification, runFullVerification, runPrePush, selectPush, selectedTestFiles } from './pre-push-verification.mjs';

const OID = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const feature = { localRef: 'refs/heads/feature', localOid: OID, remoteRef: 'refs/heads/feature', remoteOid: BASE };
const services = (paths: string[] = ['apps/server/src/index.ts']) => ({
  hasObject: () => true,
  mergeBase: () => BASE,
  isAncestor: () => true,
  changed: () => paths,
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
    expect(run).toHaveBeenCalledWith('pnpm', ['exec', 'vitest', 'run', '--changed', BASE], expect.anything());
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
      ['pnpm', ['install', '--frozen-lockfile']],
      ['pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package']],
      ['pnpm', ['verify:full']],
    ]);
    expect(snapshots).toHaveLength(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('cleans snapshots and rejects missing oid or failed commands', () => {
  expect(() => runFullVerification({ oid: '' })).toThrow('no pushed object');
  const root = mkdtempSync(join(tmpdir(), 'zana-push-failure-'));
  try {
    expect(() => runFullVerification({ oid: OID, root, run: () => ({ status: 1 }), log: vi.fn() })).toThrow('could not create isolated push snapshot');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
