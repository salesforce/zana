import { spawn } from 'node:child_process';
import { closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * GitHub CLI login -> environment for sessions on remote machines.
 *
 * Everything here is in memory. The token is read from `gh auth token`, handed
 * to the host through `zcc.remoteEnvironment`, and never stored, logged or put
 * in a setting. Failures always degrade to "forward nothing".
 */

/** Must match `zcc.extra.remoteEnvironment` in package.json. */
export const GITHUB_REMOTE_ENV_NAMES = Object.freeze([
  'GH_TOKEN',
  'GIT_CONFIG_*',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL'
]);

const GITHUB_HOST = 'github.com';
const TOKEN_MAX_LENGTH = 4096;
const TOKEN_PATTERN = /^[^\s\u0000]+$/u;
const LOGIN_PATTERN = /^[a-zA-Z0-9-]{1,64}$/u;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;
const GIT_CONFIG_GROUP = 'git-config';

// Git asks this helper for github.com over HTTPS only and answers from $GH_TOKEN at run time, so the
// token is never written into git configuration. It is scoped to that URL, so the machine's own helpers
// for every other host keep working.
const CREDENTIAL_HELPER =
  '!f() { test "$1" = get || exit 0; protocol=; host=; while IFS= read -r line && test -n "$line"; do case "$line" in protocol=*) protocol=${line#protocol=} ;; host=*) host=${line#host=} ;; esac; done; if test "$protocol" = https && test "$host" = github.com && test -n "$GH_TOKEN"; then printf "username=x-access-token\\npassword=%s\\n" "$GH_TOKEN"; fi; }; f';

const CREDENTIAL_CONFIG = Object.freeze([
  ['credential.https://github.com.helper', ''],
  ['credential.https://github.com.helper', CREDENTIAL_HELPER]
]);
// Opt-in: on a machine with a working GitHub SSH key this would route around it.
const SSH_REWRITE_CONFIG = Object.freeze([
  ['url.https://github.com/.insteadOf', 'git@github.com:'],
  ['url.https://github.com/.insteadOf', 'ssh://git@github.com/']
]);

/** Fixed vocabulary only: a reason never carries anything the child printed. */
export class GhRunError extends Error {
  constructor(reason) {
    super(`gh ${reason}`);
    this.name = 'GhRunError';
    this.reason = reason;
  }
}

export function parseGithubToken(text) {
  if (typeof text !== 'string') return null;
  const token = text.trim();
  if (token.length === 0 || token.length > TOKEN_MAX_LENGTH || !TOKEN_PATTERN.test(token)) return null;
  return token;
}

export function parseGithubIdentity(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { login, id, email } = value;
  if (typeof login !== 'string' || !LOGIN_PATTERN.test(login)) return null;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (email !== undefined && email !== null && (typeof email !== 'string' || email.length > 254 || !EMAIL_PATTERN.test(email))) return null;
  return { login, id, email: typeof email === 'string' ? email : null };
}

/**
 * `commitIdentity` and `sshRemotes` are opt-in: an environment identity overrides the `user.name` and
 * `user.email` configured on the machine, and the SSH rewrite bypasses a key that already works.
 */
export function buildGithubRemoteEnvironment({ token, identity }, { commitIdentity = false, sshRemotes = false } = {}) {
  const entries = [{ name: 'GH_TOKEN', value: token }];
  if (commitIdentity && identity) {
    const email = identity.email ?? `${identity.id}+${identity.login}@users.noreply.github.com`;
    entries.push(
      { name: 'GIT_AUTHOR_NAME', value: identity.login },
      { name: 'GIT_AUTHOR_EMAIL', value: email },
      { name: 'GIT_COMMITTER_NAME', value: identity.login },
      { name: 'GIT_COMMITTER_EMAIL', value: email }
    );
  }
  // One unit, and only where a token is available (this push's or the user's own): a half applied or
  // tokenless rewrite of ssh remotes to https would break pushes instead of fixing them.
  const gitConfig = sshRemotes ? [...CREDENTIAL_CONFIG, ...SSH_REWRITE_CONFIG] : CREDENTIAL_CONFIG;
  const config = [{ name: 'GIT_CONFIG_COUNT', value: String(gitConfig.length) }];
  gitConfig.forEach(([key, value], index) => {
    config.push({ name: `GIT_CONFIG_KEY_${index}`, value: key }, { name: `GIT_CONFIG_VALUE_${index}`, value });
  });
  for (const entry of config) entries.push({ ...entry, group: GIT_CONFIG_GROUP, requires: ['GH_TOKEN'] });
  return entries;
}

/**
 * Run `gh` with stdout captured through a private, already-unlinked temp file: a piped stdout was once
 * truncated at 8192 bytes inside Electron main. One command at a time, a bounded queue, a hard timeout and
 * an output cap; nothing the child prints is ever placed in an error.
 */
export function createGhRunner(options = {}) {
  const command = options.command ?? 'gh';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const outputLimit = options.outputLimit ?? 1024 * 1024;
  const maxQueued = options.maxQueued ?? 8;
  const spawnProcess = options.spawn ?? spawn;
  const tmpRoot = options.tmpRoot ?? tmpdir();
  const POLL_MS = 100;
  let running = false;
  const waiting = [];

  function capture(args) {
    return new Promise((resolve, reject) => {
      let dir;
      let fd;
      let child;
      let timer;
      let poll;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        let output = '';
        let failure = error;
        if (!failure && fd !== undefined) {
          try {
            const size = fstatSync(fd).size;
            if (size > outputLimit) failure = new GhRunError('output-limit');
            else {
              const buffer = Buffer.alloc(size);
              let read = 0;
              while (read < size) {
                const count = readSync(fd, buffer, read, size - read, read);
                if (count === 0) break;
                read += count;
              }
              output = buffer.toString('utf8', 0, read);
            }
          } catch {
            failure = new GhRunError('spawn');
          }
        }
        if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
        if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
        if (failure) reject(failure);
        else resolve(output);
      };
      try {
        dir = mkdtempSync(join(tmpRoot, 'zcc-gh-'));
        const path = join(dir, 'stdout');
        // Read/write so the same descriptor can be read back after the child exits.
        fd = openSync(path, 'wx+', 0o600);
        // The child keeps writing to the open inode; the name is gone straight away. Windows cannot
        // unlink an open file, so the directory removal in finish() is the fallback there.
        try { unlinkSync(path); } catch { /* removed with the directory */ }
      } catch {
        finish(new GhRunError('spawn'));
        return;
      }
      try {
        child = spawnProcess(command, args, {
          stdio: ['ignore', fd, 'ignore'],
          windowsHide: true,
          env: {
            ...process.env,
            GH_PROMPT_DISABLED: '1',
            GH_NO_UPDATE_NOTIFIER: '1',
            GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
            NO_COLOR: '1'
          }
        });
      } catch {
        finish(new GhRunError('spawn'));
        return;
      }
      const kill = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
      timer = setTimeout(() => {
        kill();
        finish(new GhRunError('timeout'));
      }, timeoutMs);
      poll = setInterval(() => {
        try {
          if (fstatSync(fd).size > outputLimit) {
            kill();
            finish(new GhRunError('output-limit'));
          }
        } catch { /* closed concurrently */ }
      }, POLL_MS);
      child.once('error', () => finish(new GhRunError('spawn')));
      child.once('close', (code) => finish(code === 0 ? undefined : new GhRunError('exit')));
    });
  }

  function next() {
    const item = waiting.shift();
    if (!item) {
      running = false;
      return;
    }
    capture(item.args).then(item.resolve, item.reject).finally(next);
  }

  return function runGh(args) {
    if (!running) {
      running = true;
      return capture(args).finally(next);
    }
    if (waiting.length >= maxQueued) return Promise.reject(new GhRunError('busy'));
    return new Promise((resolve, reject) => { waiting.push({ args, resolve, reject }); });
  };
}

function failureReason(error) {
  return error instanceof GhRunError ? error.reason : 'error';
}

/**
 * Never throws: any failure means "no credentials". `onFailure` receives a reason from a fixed vocabulary.
 * The profile is only fetched when `options.commitIdentity` asks for it.
 */
export async function loadGithubCredentials(run, onFailure, options = {}) {
  const fail = (reason) => {
    try { onFailure?.(reason); } catch { /* diagnostics must not break the lookup */ }
    return [];
  };
  try {
    const token = parseGithubToken(await run(['auth', 'token', '--hostname', GITHUB_HOST]));
    if (!token) return fail('invalid-token');
    if (!options.commitIdentity) return buildGithubRemoteEnvironment({ token, identity: null }, options);
    const identity = parseGithubIdentity(await run(['api', '--hostname', GITHUB_HOST, 'user']));
    if (!identity) return fail('invalid-profile');
    return buildGithubRemoteEnvironment({ token, identity }, options);
  } catch (error) {
    return fail(failureReason(error));
  }
}

/**
 * Stale-while-revalidate holder: `current()` never waits. A cold cache answers with nothing and loads in the
 * background; an expired value is served while one reload runs. Entries live 60s, an empty answer 5s, so a
 * logout or a revoked token stops forwarding quickly and a transient failure heals quickly.
 */
export function createCredentialSource(options) {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? 60_000;
  const emptyTtlMs = options.emptyTtlMs ?? 5_000;
  let settled = null;
  let pending = null;
  let generation = 0;
  let disposed = false;

  const copy = (entries) => entries.map((entry) => ({ ...entry, ...(entry.requires ? { requires: [...entry.requires] } : {}) }));
  const signatureOf = (entries) => (entries.length === 0 ? '' : JSON.stringify(entries));

  function start() {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    const ticket = generation;
    let work;
    try {
      work = Promise.resolve(options.load());
    } catch {
      work = Promise.resolve([]);
    }
    const started = work
      .catch(() => [])
      .then((loaded) => {
        if (disposed || ticket !== generation) return;
        const entries = Array.isArray(loaded) ? loaded : [];
        const before = settled ? settled.signature : '';
        const signature = signatureOf(entries);
        settled = { entries, signature, expiresAt: now() + (entries.length > 0 ? ttlMs : emptyTtlMs) };
        if (signature !== before) {
          try { options.onChange?.(); } catch { /* a listener must not break the cache */ }
        }
      })
      .finally(() => {
        if (pending === started) pending = null;
      });
    pending = started;
    return started;
  }

  return {
    current() {
      if (disposed) return [];
      if (!settled) {
        void start();
        return [];
      }
      if (settled.expiresAt <= now()) void start();
      return copy(settled.entries);
    },
    refresh: start,
    /** Load again now, for example after an option changed, still serving the current value meanwhile. */
    reload() {
      generation += 1;
      pending = null;
      return start();
    },
    clear() {
      generation += 1;
      settled = null;
      pending = null;
    },
    dispose() {
      disposed = true;
      generation += 1;
      settled = null;
      pending = null;
    }
  };
}
