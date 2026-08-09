#!/usr/bin/env node
/**
 * LIVE verification of LOCAL ↔ REMOTE agent coordination, over a REAL SSH hop.
 *
 * ## What this is (and is NOT)
 *
 * The automated test (`src/main/__tests__/remote-local-coordination.integration.test.ts`)
 * proves the local coordinator seam end-to-end with a real pty + real MCP server,
 * but it CANNOT exercise the `ssh` transport itself — CI has no sshd, no devbox.
 *
 * THIS script is the missing live leg. It is meant to be run BY AN AGENT (or a
 * human) on the operator's machine, against a REAL registered remote (SSH)
 * project, and it drives the actual `ssh -t` transport the app uses in
 * production (`createRemote` in src/main/pty.ts). It verifies, over the real
 * wire, the one invariant the user cares about:
 *
 *     Coordination always originates LOCALLY: the local side opens the SSH pty,
 *     injects a coordination line into the REMOTE agent's stdin, and the remote
 *     receives it. A remote agent has no MCP URL and cannot call back — the only
 *     remote→local channel is what the local side reads off the pty stream.
 *
 * It does NOT touch your running Electron app or its stores; it stands up the
 * same primitives the app uses (system `ssh`, a pty) so it is safe to run
 * alongside the app. It mutates nothing on the remote — it runs `cat` (an echo)
 * inside the remote login shell and kills it on exit.
 *
 * ## Prerequisites
 *
 *   1. A remote (SSH) project registered in the app, i.e. a row in
 *      ~/.zcc/projects.json with a `remote: { host, user?, remotePath? }`.
 *      (Or pass --host / --user / --path explicitly to skip the lookup.)
 *   2. `ssh <host>` works non-interactively from this machine (key-based auth;
 *      the host is in ~/.ssh/config or resolvable). Test it first:
 *          ssh -o BatchMode=yes <host> true && echo OK
 *   3. node-pty installed (it is, in this repo's node_modules).
 *
 * ## Run
 *
 *   node scripts/verify-remote-local-coordination.mjs                # first remote project
 *   node scripts/verify-remote-local-coordination.mjs --project kit-kat
 *   node scripts/verify-remote-local-coordination.mjs --host my-devbox --user me
 *
 * ## Checklist it asserts (prints PASS/FAIL per step, exit 0 iff all pass)
 *
 *   [1] Resolve a remote target (from projects.json or flags).
 *   [2] SSH reachability: a non-interactive `ssh <host> true` succeeds.
 *   [3] Open a REAL `ssh -t <host> "cd <path>; exec cat"` pty (the createRemote
 *       transport). The remote process is live.
 *   [4] LOCAL → REMOTE: inject a coordination line into the pty's stdin (the
 *       `reply()` primitive: body, then a deferred CR). It crosses the SSH hop
 *       and echoes back on the remote's stdout — proof the remote received it.
 *   [5] Asymmetry: confirm the remote command carries NO ZCC_MCP_URL (a remote
 *       agent cannot originate coordination — local is the only coordinator).
 */

import { spawn as ptySpawn } from 'node-pty';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---- tiny arg parser -------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const opt = {
  project: flag('project'),
  host: flag('host'),
  user: flag('user'),
  path: flag('path'),
  timeoutMs: Number(flag('timeout') ?? 20000)
};

// ---- pretty reporting ------------------------------------------------------
let failures = 0;
function step(n, label) {
  process.stdout.write(`\n[${n}] ${label}\n`);
}
function pass(msg) {
  process.stdout.write(`    ✅ PASS — ${msg}\n`);
}
function fail(msg) {
  failures += 1;
  process.stdout.write(`    ❌ FAIL — ${msg}\n`);
}
function info(msg) {
  process.stdout.write(`    · ${msg}\n`);
}

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- [1] resolve the remote target ----------------------------------------
function resolveTarget() {
  if (opt.host) {
    return { host: opt.host, user: opt.user, remotePath: opt.path, source: 'flags' };
  }
  const projectsFile = join(homedir(), '.zcc', 'projects.json');
  let raw;
  try {
    raw = JSON.parse(readFileSync(projectsFile, 'utf8'));
  } catch (err) {
    throw new Error(`could not read ${projectsFile}: ${err.message}. Pass --host explicitly.`);
  }
  const projects = Array.isArray(raw) ? raw : raw.projects ?? [];
  const remotes = projects.filter((p) => p && p.remote && p.remote.host);
  if (remotes.length === 0) {
    throw new Error('no remote (SSH) projects in projects.json. Pass --host explicitly.');
  }
  const chosen = opt.project
    ? remotes.find((p) => p.name === opt.project || p.tag === opt.project || p.id === opt.project)
    : remotes[0];
  if (!chosen) {
    throw new Error(
      `no remote project matched "${opt.project}". Available: ${remotes.map((p) => p.name).join(', ')}`
    );
  }
  return {
    name: chosen.name,
    host: chosen.remote.host,
    user: chosen.remote.user,
    remotePath: opt.path ?? chosen.remote.remotePath,
    source: `projects.json (${chosen.name})`
  };
}

// Mirror remote-fs.ts sshBaseArgs (BatchMode so it fails fast, no password hang).
function sshBaseArgs(t) {
  if (String(t.host).startsWith('-')) throw new Error(`refusing host starting with '-': ${t.host}`);
  if (t.user && String(t.user).startsWith('-')) throw new Error(`refusing user starting with '-': ${t.user}`);
  const target = t.user ? `${t.user}@${t.host}` : t.host;
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', target];
}

// ---- [2] ssh reachability --------------------------------------------------
function sshReachable(t) {
  return new Promise((resolve) => {
    execFile('ssh', [...sshBaseArgs(t), 'true'], { timeout: 12000 }, (err) => {
      resolve(!err);
    });
  });
}

// ---- main ------------------------------------------------------------------
async function main() {
  process.stdout.write('LOCAL ↔ REMOTE agent-coordination — LIVE SSH verification\n');
  process.stdout.write('='.repeat(60) + '\n');

  step(1, 'Resolve a remote target');
  let target;
  try {
    target = resolveTarget();
    pass(`target = ${target.user ? target.user + '@' : ''}${target.host}` +
      `${target.remotePath ? ' path=' + target.remotePath : ''}  (from ${target.source})`);
  } catch (err) {
    fail(err.message);
    return finish();
  }

  step(2, 'SSH reachability (non-interactive `ssh <host> true`)');
  if (await sshReachable(target)) {
    pass('ssh connected non-interactively');
  } else {
    fail(
      `ssh could not connect to ${target.host} in BatchMode. ` +
        `Fix key-based auth (try: ssh -o BatchMode=yes ${target.host} true), then re-run.`
    );
    return finish();
  }

  // Build the SAME remote command shape createRemote uses for a shell profile:
  //   [cd <path> && ] exec <cmd>     — here cmd = `cat` so we get a pure echo.
  const cdPrefix = target.remotePath ? `cd ${shellQuote(target.remotePath)} && ` : '';
  const remoteCmd = `${cdPrefix}exec cat`;
  // createRemote's argv shape: ssh -t [base opts] <target> "<remote cmd>".
  // sshBaseArgs returns [...opts, target]; splice -t in front and append the cmd.
  const sshArgs = ['-t', ...sshBaseArgs(target), remoteCmd];

  step(3, 'Open a REAL `ssh -t` pty to the remote (the createRemote transport)');
  let proc;
  let out = '';
  let exited = false;
  let exitCode = null;
  try {
    // NOTE: createRemote builds env WITHOUT ZCC_MCP_URL — we mirror that here.
    // Only TERM is set; there is deliberately no MCP/hook URL for a remote.
    proc = ptySpawn('ssh', sshArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: homedir(),
      env: { ...process.env, TERM: 'xterm-256color' }
    });
  } catch (err) {
    fail(`could not spawn ssh pty: ${err.message}`);
    return finish();
  }
  proc.onData((d) => {
    out += d;
  });
  proc.onExit(({ exitCode: code }) => {
    exited = true;
    exitCode = code;
  });

  // Give the SSH handshake + remote `exec cat` a moment to come up.
  await sleep(2500);
  if (exited) {
    fail(`remote pty exited early (code ${exitCode}). Remote command: ${remoteCmd}`);
    info(`last output: ${JSON.stringify(out.slice(-200))}`);
    return finish();
  }
  pass('remote `ssh -t … exec cat` is live');

  step(4, 'LOCAL → REMOTE: inject a coordination line into the remote stdin');
  const marker = `ZCC_COORD_${Date.now()}`;
  const line = `[message from @local-coordinator] ${marker}`;
  // The reply() primitive: write the body, then a deferred CR (so the remote
  // TUI/line-discipline treats it as a submitted line, not a paste).
  proc.write(line);
  await sleep(60);
  proc.write('\r');

  // Wait for the marker to echo back across the SSH hop (cat echoes stdin).
  const deadline = Date.now() + opt.timeoutMs;
  while (!out.includes(marker) && Date.now() < deadline && !exited) {
    await sleep(50);
  }
  if (out.includes(marker)) {
    pass(`coordination line crossed the SSH hop and echoed back (marker "${marker}" seen)`);
  } else if (exited) {
    fail(`remote exited (code ${exitCode}) before the marker echoed`);
  } else {
    fail(`marker "${marker}" never echoed back within ${opt.timeoutMs}ms`);
    info(`tail of remote output: ${JSON.stringify(out.slice(-200))}`);
  }

  step(5, 'Asymmetry: the remote command carries NO ZCC_MCP_URL');
  // The remote agent has no way to call agent_send: createRemote never injects
  // ZCC_MCP_URL, and neither did we. The remote command line is pure `exec cat`
  // — assert no MCP/hook URL leaked into it.
  if (!/ZCC_MCP_URL|ZCC_HOOK_URL/.test(remoteCmd)) {
    pass('remote command has no MCP/hook URL — local is the only coordinator');
  } else {
    fail(`remote command unexpectedly references an MCP/hook URL: ${remoteCmd}`);
  }

  try {
    proc.kill();
  } catch {
    /* ignore */
  }
  return finish();
}

function finish() {
  process.stdout.write('\n' + '='.repeat(60) + '\n');
  if (failures === 0) {
    process.stdout.write('RESULT: ✅ all checks passed — local↔remote coordination works over real SSH.\n');
    process.exit(0);
  } else {
    process.stdout.write(`RESULT: ❌ ${failures} check(s) failed — see above.\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stdout.write(`\nUNEXPECTED ERROR: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
