#!/usr/bin/env node
/**
 * Fail-closed local verification for pre-push. A verified inert-docs change is
 * the only no-test fast path until each production owner has a proven complete
 * test inventory. All other selections run the CI unit-test configuration union
 * in an isolated clone of the exact object being pushed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ZERO_OID = /^0+$/;
const GITHUB_REPOSITORY = 'salesforce/zana';
// Known work alias is retained for existing installs. Teams may add aliases
// without weakening host verification through ZANA_GITHUB_SSH_ALIASES.
const DEFAULT_GITHUB_SSH_ALIASES = ['github.com-work-public'];
// Repo agent instructions (AGENTS.md / CLAUDE.md @AGENTS.md stubs) are read only
// by coding agents, never by the product, so root/apps/packages/docs copies are
// inert. plugins/** stays out: plugin dirs are path-installed and shipped.
const INERT_DOC = /^(?:docs\/.+\.md|README\.md|CONTRIBUTING\.md|(?:(?:apps|packages|docs)\/(?:[^/]+\/)*)?(?:AGENTS|CLAUDE)\.md)$/;
const UNSAFE_DOC = /(?:^|\/)(?:SKILL\.md|fixtures?\/|snapshots?\/|test(?:ing)?\/|test-data\/|assets\/|generated\/|builtin-skills\/|__tests__\/)/i;

function git(args, { cwd = process.cwd(), encoding = 'utf8' } = {}) {
  return execFileSync('git', args, { cwd, encoding, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOk(args, options) {
  try { return git(args, options); } catch { return null; }
}

export function parseTuples(input) {
  const tuples = [];
  for (const line of input.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) return null;
    const [localRef, localOid, remoteRef, remoteOid] = fields;
    if (!localRef || !localOid || !remoteRef || !remoteOid) return null;
    tuples.push({ localRef, localOid, remoteRef, remoteOid });
  }
  return tuples;
}

function sshHostAlias(host, aliases) {
  return aliases[host] === 'github.com' ? 'github.com' : host;
}

/** Recognize only configured GitHub SSH aliases and normal GitHub URL forms. */
export function githubRepository(remoteUrl, aliases = {}) {
  let host;
  let path;
  const ssh = /^(?:ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  const https = /^https:\/\/([^/]+)\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  if (https) [, host, path] = https;
  else if (ssh) [, host, path] = ssh;
  else return null;
  host = sshHostAlias(host, aliases);
  return host === 'github.com' && path === GITHUB_REPOSITORY ? path : null;
}

function protectedRef(ref) {
  return ref === 'refs/heads/main' || ref.startsWith('refs/tags/') || ref.startsWith('refs/heads/release/');
}

function featureRef(ref) {
  return /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) && !protectedRef(ref);
}

export function changedPaths(base, localOid, runGit) {
  const output = runGit(['diff', '--name-status', '--find-renames', base, localOid]);
  return output.split('\n').filter(Boolean).flatMap((line) => {
    const [status, ...paths] = line.split('\t');
    // Renames and copies carry both paths. A runtime source renamed into docs
    // remains runtime-affecting and must not take the inert prose fast path.
    return /^[RC]/.test(status) ? paths : paths.slice(-1);
  }).filter(Boolean);
}

function inertDocs(paths) {
  return paths.length > 0 && paths.every((path) => INERT_DOC.test(path) && !UNSAFE_DOC.test(path));
}

/**
 * Pure selection policy. `hasObject`, `mergeBase`, and `isAncestor` are injected
 * so tests can exercise force/new-branch behavior without a network or repo.
 */
export function selectPush({ tuples, remoteUrl, aliases = {}, hasObject, mergeBase, isAncestor, changed }) {
  if (!tuples?.length) return { action: 'abort', reason: 'missing or malformed pre-push ref tuples' };
  if (!githubRepository(remoteUrl, aliases)) return { action: 'full', reason: 'remote is not verified GitHub salesforce/zana' };
  const paths = new Set();
  const oids = new Set();
  for (const tuple of tuples) {
    if (ZERO_OID.test(tuple.localOid)) continue; // deletion contributes no tests
    if (protectedRef(tuple.remoteRef)) return { action: 'full', reason: `protected ref ${tuple.remoteRef}` };
    if (!featureRef(tuple.localRef) || !featureRef(tuple.remoteRef)) return { action: 'full', reason: `unknown ref ${tuple.localRef} -> ${tuple.remoteRef}` };
    if (ZERO_OID.test(tuple.remoteOid)) {
      if (!hasObject('origin/main')) return { action: 'full', reason: 'new branch has no local origin/main base' };
      const base = mergeBase('origin/main', tuple.localOid);
      if (!base) return { action: 'full', reason: 'new branch has no sound merge base' };
      for (const path of changed(base, tuple.localOid)) paths.add(path);
    } else {
      if (!hasObject(tuple.remoteOid)) return { action: 'full', reason: `remote base ${tuple.remoteOid} is unavailable locally` };
      if (!isAncestor(tuple.remoteOid, tuple.localOid)) return { action: 'full', reason: `non-ancestor update for ${tuple.remoteRef}` };
      for (const path of changed(tuple.remoteOid, tuple.localOid)) paths.add(path);
    }
    oids.add(tuple.localOid);
  }
  if (!oids.size) return { action: 'skip', reason: 'ref deletion only', paths: [] };
  if (oids.size !== 1) return { action: 'full', reason: 'multiple distinct pushed commits require separate snapshots', oids: [...oids] };
  const resultPaths = [...paths].sort();
  if (inertDocs(resultPaths)) return { action: 'skip', reason: 'verified inert prose only', paths: resultPaths, oid: [...oids][0] };
  // No production owner is proven complete yet. Conservative fallback is required.
  return { action: 'full', reason: resultPaths.length ? 'path owner is not in complete fast-path inventory' : 'empty diff cannot establish safe selection', paths: resultPaths, oid: [...oids][0] };
}

export function configuredAliases(run, configured = process.env.ZANA_GITHUB_SSH_ALIASES) {
  const aliases = {};
  const hosts = configured ? configured.split(',').map((host) => host.trim()).filter(Boolean) : DEFAULT_GITHUB_SSH_ALIASES;
  for (const host of hosts) {
    const result = run('ssh', ['-G', host], { encoding: 'utf8' });
    if (result?.status !== 0) continue;
    const hostname = /^hostname\s+(.+)$/m.exec(result.stdout)?.[1];
    if (hostname) aliases[host] = hostname;
  }
  return aliases;
}

export function runFullVerification({ oid, root = process.cwd(), run = spawnSync, log = console.log }) {
  if (!oid) throw new Error('no pushed object available for snapshot verification');
  const snapshot = mkdtempSync(join(tmpdir(), 'zana-pre-push-'));
  try {
    log(`pre-push: snapshot ${oid.slice(0, 12)} in ${snapshot}`);
    const clone = run('git', ['clone', '--no-local', '--no-checkout', root, snapshot], { stdio: 'inherit' });
    if (clone.status !== 0) throw new Error('could not create isolated push snapshot');
    const fetch = run('git', ['fetch', '--no-tags', root, oid], { cwd: snapshot, stdio: 'inherit' });
    if (fetch.status !== 0) throw new Error(`could not fetch pushed object ${oid}`);
    const checkout = run('git', ['checkout', '--detach', oid], { cwd: snapshot, stdio: 'inherit' });
    if (checkout.status !== 0) throw new Error(`could not check out pushed object ${oid}`);
    const install = run('pnpm', ['install', '--frozen-lockfile'], { cwd: snapshot, stdio: 'inherit' });
    if (install.status !== 0) throw new Error('snapshot dependency install failed');
    const assets = run('pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package'], { cwd: snapshot, stdio: 'inherit' });
    if (assets.status !== 0) throw new Error('snapshot Slack runtime asset preparation failed');
    log('pre-push: pnpm verify:full');
    const result = run('pnpm', ['verify:full'], { cwd: snapshot, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('verification failed: pnpm verify:full');
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

export function runPrePush({ input = readFileSync(0, 'utf8'), remoteUrl, root = process.cwd(), log = console.log, error = console.error, select = selectPush, verify = runFullVerification, run = spawnSync } = {}) {
  if (!remoteUrl) {
    error('pre-push: Git did not provide remote URL; aborting push.');
    return 1;
  }
  const tuples = parseTuples(input);
  const runGit = (args) => gitOk(args, { cwd: root });
  const selection = select({
    tuples,
    remoteUrl,
    aliases: configuredAliases(run),
    hasObject: (object) => runGit(['cat-file', '-e', `${object}^{commit}`]) !== null,
    mergeBase: (left, right) => runGit(['merge-base', left, right]),
    isAncestor: (left, right) => runGit(['merge-base', '--is-ancestor', left, right]) !== null,
    changed: (base, oid) => changedPaths(base, oid, runGit),
  });
  log(`pre-push: ${selection.action}; ${selection.reason}`);
  if (selection.paths?.length) log(`pre-push: selected paths:\n${selection.paths.map((path) => `  ${path}`).join('\n')}`);
  if (selection.action === 'abort') return 1;
  if (selection.action === 'skip') return 0;
  try {
    const oids = selection.oids ?? (selection.oid ? [selection.oid] : [...new Set((tuples ?? [])
      .filter((tuple) => !ZERO_OID.test(tuple.localOid)).map((tuple) => tuple.localOid))]);
    if (!oids.length) throw new Error('no pushed object available for full verification');
    for (const oid of oids) verify({ oid, root, log });
    return 0;
  } catch (cause) {
    error(`pre-push: ${cause.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runPrePush({ remoteUrl: process.argv[3] });
}
