import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { githubRepository, parseTuples, runFullVerification, runPrePush, selectPush } from './pre-push-verification.mjs';

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

it('parses git tuples and rejects malformed streams', () => {
  expect(parseTuples(`refs/heads/x ${OID} refs/heads/x ${BASE}\n`)).toEqual([{ ...feature, localRef: 'refs/heads/x', remoteRef: 'refs/heads/x' }]);
  expect(parseTuples('invalid')).toBeNull();
});

it('skips only explicit inert prose and preserves deletion paths', () => {
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(['docs/guide.md', 'README.md']) })).toMatchObject({ action: 'skip' });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(['docs/fixtures/example.md']) })).toMatchObject({ action: 'full' });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(['apps/server/src/removed.ts']) })).toMatchObject({ action: 'full' });
});

it('uses strictest full policy for unsafe refs, bases, remote identity, and multiple objects', () => {
  expect(selectPush({ tuples: [{ ...feature, remoteRef: 'refs/heads/main' }], remoteUrl: 'https://github.com/salesforce/zana', ...services() })).toMatchObject({ action: 'full', reason: expect.stringContaining('protected') });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/fork/zana', ...services() })).toMatchObject({ action: 'full', reason: expect.stringContaining('remote') });
  expect(selectPush({ tuples: [feature], remoteUrl: 'https://github.com/salesforce/zana', ...services(), isAncestor: () => false })).toMatchObject({ action: 'full', reason: expect.stringContaining('non-ancestor') });
  expect(selectPush({ tuples: [feature, { ...feature, localOid: 'c'.repeat(40), remoteRef: 'refs/heads/other' }], remoteUrl: 'https://github.com/salesforce/zana', ...services() })).toMatchObject({ action: 'full', reason: expect.stringContaining('multiple') });
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
