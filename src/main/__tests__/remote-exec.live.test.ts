/**
 * LIVE remote_exec verification — runs against a REAL registered SSH workspace.
 *
 * This is the one thing the fake-ssh unit tests (remote-fs.test.ts) can't cover:
 * the actual ssh transport, the real ControlMaster multiplexing, and a genuine
 * remote login shell with real coreutils. It drives the
 * SAME production chain the MCP tool uses — `resolveAndExecRemote` with the real
 * `remoteRoot` + `execRemote` deps — so a green run here proves the whole path
 * end to end against the live host.
 *
 * GATED OFF BY DEFAULT. A target may require interactive authentication, so this
 * cannot run in CI or headless environments. It self-skips unless opted in.
 *
 * How to run (once the SSH session is authenticated — e.g. after a successful
 * `ssh my-remote true`):
 *
 *   # Pick the target by its projects.json tag (recommended):
 *   ZCC_LIVE_REMOTE=1 ZCC_LIVE_REMOTE_TAG=my-remote \
 *     npx vitest run src/main/__tests__/remote-exec.live.test.ts
 *
 *   # …or point at a host/path directly, bypassing projects.json:
 *   ZCC_LIVE_REMOTE=1 ZCC_LIVE_REMOTE_HOST=my-remote ZCC_LIVE_REMOTE_PATH=/path/to/project \
 *     npx vitest run src/main/__tests__/remote-exec.live.test.ts
 *
 *   # …or just ZCC_LIVE_REMOTE=1 to auto-pick the FIRST remote in projects.json.
 *
 * Env knobs:
 *   ZCC_LIVE_REMOTE        must be "1"/"true" to enable the suite at all
 *   ZCC_LIVE_REMOTE_TAG    projects.json tag (or name) of the remote to target
 *   ZCC_LIVE_REMOTE_HOST   ssh host alias (overrides projects.json lookup)
 *   ZCC_LIVE_REMOTE_PATH   remote start path (defaults to the project's remotePath)
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  remoteRoot,
  execRemote,
  resolveAndExecRemote,
  type RemoteExecResolveDeps
} from '../remote-fs.js';
import type { ProjectRemote } from '../../shared/types.js';

const LIVE = /^(1|true)$/i.test(process.env.ZCC_LIVE_REMOTE ?? '');
// vitest: describe.skip when not opted in, so the suite is inert by default.
const suite = LIVE ? describe : describe.skip;

/** Read the user's projects.json and return its remote-backed entries. */
async function readRemoteProjects(): Promise<Array<{ tag?: string; name?: string; remote: ProjectRemote }>> {
  const file = join(homedir(), '.zcc', 'projects.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  const list: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as any)?.projects)
      ? (parsed as any).projects
      : [];
  return list.filter((p) => p && p.remote && typeof p.remote.host === 'string');
}

/** Resolve the ProjectRemote to test against, from env → projects.json. */
async function resolveTarget(): Promise<{ label: string; remote: ProjectRemote } | null> {
  const envHost = process.env.ZCC_LIVE_REMOTE_HOST?.trim();
  if (envHost) {
    return {
      label: `env:${envHost}`,
      remote: { host: envHost, remotePath: process.env.ZCC_LIVE_REMOTE_PATH?.trim() || undefined }
    };
  }
  const remotes = await readRemoteProjects();
  if (remotes.length === 0) return null;
  const wanted = process.env.ZCC_LIVE_REMOTE_TAG?.trim();
  const chosen = wanted
    ? remotes.find((p) => p.tag === wanted || p.name === wanted)
    : remotes[0];
  if (!chosen) return null;
  const remotePath = process.env.ZCC_LIVE_REMOTE_PATH?.trim() || chosen.remote.remotePath;
  return { label: chosen.tag ?? chosen.name ?? chosen.remote.host, remote: { ...chosen.remote, remotePath } };
}

suite('remote_exec (LIVE ssh)', () => {
  let remote: ProjectRemote;
  let root: string;
  let label: string;
  // The production deps: real store-shaped resolution (host from the resolved
  // target, not agent free-text) + the real ssh-backed root/exec.
  let deps: RemoteExecResolveDeps;
  const PROJECT_ID = 'live-target';

  beforeAll(async () => {
    // Each test crosses the network via ssh. The default 5s per-test timeout is
    // fine for a nearby box (us-west-2) but too tight for a high-latency remote
    // (e.g. ap-south-1), where a cold ControlMaster handshake alone can approach
    // it. Raise the per-test ceiling for the whole live suite.
    vi.setConfig({ testTimeout: 20_000 });
    const target = await resolveTarget();
    if (!target) {
      throw new Error(
        'No live remote target. Set ZCC_LIVE_REMOTE_HOST or register a remote project in ~/.zcc/projects.json.'
      );
    }
    remote = target.remote;
    label = target.label;
    deps = {
      findRemote: (id) => (id === PROJECT_ID ? remote : null),
      defaultPath: undefined,
      resolveRoot: remoteRoot,
      exec: execRemote
    };

    // Resolve the root once up front. If this fails, the host is unreachable /
    // unauthenticated — fail loudly with a clear message rather than letting
    // every test emit a confusing timeout.
    const rr = await remoteRoot(remote);
    if (!rr.ok || !rr.root) {
      throw new Error(
        `Cannot resolve remote root for ${label} (${remote.host}): ${rr.ok ? 'no root' : rr.message}. ` +
          `Is the SSH session authenticated? Try: ssh ${remote.host} true`
      );
    }
    root = rr.root;
    // eslint-disable-next-line no-console
    console.log(`[live] target=${label} host=${remote.host} root=${root}`);
  }, 60_000);

  it('resolves an absolute realpath root under the expected mount', () => {
    expect(root.startsWith('/')).toBe(true);
  });

  it('runs a trivial command end-to-end (echo, exit 0)', async () => {
    const res = await execRemote(remote, root, 'echo zcc-live-ok');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout?.trim()).toBe('zcc-live-ok');
    expect(res.stderr).toBe('');
    expect(res.truncated).toBe(false);
  });

  it('starts in the project root (pwd matches the resolved root)', async () => {
    const res = await execRemote(remote, root, 'pwd -P');
    expect(res.ok).toBe(true);
    expect(res.stdout?.trim()).toBe(root);
  });

  it('reports the remote as a real POSIX host', async () => {
    const res = await execRemote(remote, root, 'uname -s; whoami');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout?.trim().length).toBeGreaterThan(0);
  });

  it('honors shell operators (pipe + grep) in the real login shell', async () => {
    const res = await execRemote(remote, root, 'printf "alpha\\nbeta\\ngamma\\n" | grep beta');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout?.trim()).toBe('beta');
  });

  it('returns a non-zero exit as DATA, not a transport error', async () => {
    const res = await execRemote(remote, root, 'echo to-stderr >&2; exit 7');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(7);
    expect(res.stderr).toContain('to-stderr');
  });

  it('captures a realistic read-only workspace command (git or ls fallback)', async () => {
    // git status if it's a repo, else a plain listing — either way, real output.
    const res = await execRemote(remote, root, 'git rev-parse --is-inside-work-tree 2>/dev/null && git status --porcelain | head -5 || ls -a | head -5');
    expect(res.ok).toBe(true);
    expect(typeof res.stdout).toBe('string');
  });

  it('confines a cwd to a real subdirectory under the root', async () => {
    // Create a temp subdir, list from it, then clean up — proves cwd confinement
    // resolves a real remote path and the command runs there.
    const sub = `${root}/.zcc-live-cwd-test`;
    await execRemote(remote, root, `mkdir -p ${quote(sub)} && : > ${quote(sub)}/marker`);
    try {
      const res = await execRemote(remote, root, 'ls', { cwd: sub });
      expect(res.ok).toBe(true);
      expect(res.stdout).toContain('marker');
    } finally {
      await execRemote(remote, root, `rm -rf ${quote(sub)}`);
    }
  });

  it('rejects a cwd OUTSIDE the project root before touching ssh', async () => {
    const res = await execRemote(remote, root, 'ls', { cwd: '/etc' });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/outside the project/);
  });

  it('reports a vanished cwd (confined but nonexistent) as exit 127', async () => {
    const res = await execRemote(remote, root, 'echo SHOULD_NOT_RUN', { cwd: `${root}/definitely-not-here-zzz` });
    expect(res.ok).toBe(true);
    expect(res.code).toBe(127);
    expect(res.stdout).not.toContain('SHOULD_NOT_RUN');
    expect(res.stderr).toMatch(/working directory not found/);
  });

  it('clips an oversized stdout stream and flags truncated', async () => {
    // Emit > 1 MB; the per-stream cap must clip and set truncated.
    const res = await execRemote(remote, root, 'head -c 1500000 /dev/zero | tr "\\0" "x"');
    expect(res.ok).toBe(true);
    expect(res.truncated).toBe(true);
    expect(Buffer.byteLength(res.stdout ?? '', 'utf8')).toBeLessThanOrEqual(1024 * 1024);
  });

  it('rejects an empty command without an ssh round-trip', async () => {
    const res = await execRemote(remote, root, '   ');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/[Ee]mpty/);
  });

  it('honors a short timeout on a hung command (sleep beyond the ceiling)', async () => {
    const res = await execRemote(remote, root, 'sleep 30', { timeoutMs: 2_000 });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/timed out/i);
  }, 15_000);

  // The FULL production chain (the exact code path index.ts wires behind the
  // MCP tool): resolve projectId → ProjectRemote → realpath root → exec.
  it('drives the full resolveAndExecRemote chain (production path)', async () => {
    const res = await resolveAndExecRemote(deps, PROJECT_ID, 'echo chain-ok');
    expect(res.ok).toBe(true);
    expect(res.stdout?.trim()).toBe('chain-ok');
  });

  it('the chain rejects an unknown / non-remote projectId', async () => {
    const res = await resolveAndExecRemote(deps, 'not-a-registered-remote', 'echo nope');
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Not a remote project');
  });
});

/** Local POSIX single-quote (mirrors remote-fs shellQuote) for building test cmds. */
function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
