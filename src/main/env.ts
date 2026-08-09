import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * PATH repair for GUI launches.
 *
 * A macOS/Linux app launched from Finder/Dock (rather than a terminal)
 * inherits a minimal PATH — typically `/usr/bin:/bin:/usr/sbin:/sbin` — that
 * omits every place a user-installed CLI lives (`claude`, node shims).
 * A bare `claude` spawn then fails with ENOENT, the pty exits in milliseconds,
 * and the tab "opens already closed" / scheduled runs error with `exit 1` after
 * ~20ms. Launching from a terminal masks the bug because the shell PATH is
 * inherited.
 *
 * The reliable fix is to ask the user's own login shell for its PATH — the same
 * technique VS Code and the `shell-env`/`fix-path` packages use. That captures
 * wherever the CLI actually is (volta, nvm, asdf, homebrew, a custom prefix),
 * not just the handful of dirs we could guess. The guessed dirs are kept only as
 * a fallback for when the shell query fails (timeout, exotic shell, Windows).
 */

/**
 * Dotfile-managed CLI installers (asdf, volta, cargo, bun, deno, most vendor
 * installers, …) all follow the same convention: drop a `bin/` dir inside a
 * `~/.<tool>/` home. We don't special-case any one vendor — instead scan the
 * top level of the home dir for that `~/.*​/bin` shape once, so a tool we've
 * never heard of (today: AI Suite's `~/.aisuite/bin`) is picked up for free.
 * Bounded to a single non-recursive `readdir` — cheap, and never throws (a
 * permission error / missing home dir degrades to no extra dirs).
 */
function dotDirBinPaths(): string[] {
  const home = homedir();
  try {
    return readdirSync(home, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.'))
      .map((entry) => join(home, entry.name, 'bin'))
      .filter((dir) => existsSync(dir));
  } catch {
    return [];
  }
}

/** Known CLI install dirs — fallback only, when the shell query can't run. */
function fallbackDirs(): string[] {
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(homedir(), '.local', 'bin'),
    join(homedir(), 'bin'),
    ...dotDirBinPaths()
  ];
}

/**
 * Resolve the directory that holds the `zcc` CLI executable, so agents spawned
 * in a pty can resolve a bare `zcc` (the CLI ships as the `@zcc/cli` workspace
 * package; that dir is otherwise absent from the composed PATH). Returns
 * `undefined` — a no-op — when it can't be found, so this degrades cleanly
 * before the CLI is built or on a platform we don't ship a launcher for.
 *
 * Ladder mirrors `local-extension.ts` templateRoot() / `extension-installer.ts`
 * bundledRoot(): explicit override → packaged `resourcesPath` → dev repo-relative.
 * The candidates are, in priority order:
 *   1. `ZCC_CLI_DIR` override (only when the dir it names exists),
 *   2. packaged: `resourcesPath/zcc-cli/bin` (electron-builder copies
 *      `packages/cli/dist` -> `zcc-cli`),
 *   3. dev: repo-relative `packages/cli/dist/bin` (compiled to out/main/env.js,
 *      so repo root is two levels up from this file's dir),
 *   4. dev: the npm workspace symlink `<repo>/node_modules/.bin` (where npm links
 *      the `@zcc/cli` bin before/if `packages/cli/dist/bin/zcc` was built).
 *
 * Every non-override candidate is strictly gated on an executable *literally
 * named* `zcc` (no extension) existing in it — a shell resolving a bare `zcc`
 * needs exactly that file, and only `dist/bin` (via the CLI post-build step) or
 * the npm `.bin` symlink provide it (the `.js` file alone is invisible to PATH).
 * We never add these dirs as blanket PATH entries; system tools stay
 * authoritative because the resolved dir is always appended LAST.
 */
export function resolveZccCliBinDir(): string | undefined {
  // Explicit override wins, but only if the dir it names actually exists.
  const override = process.env.ZCC_CLI_DIR;
  if (override && existsSync(override)) return override;

  // Derive the repo root from this module's location. Compiled to out/main/env.js,
  // so repo root is two levels up from this file's dir.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const candidates: string[] = [];
  // Packaged: extraResources copies packages/cli/dist -> resourcesPath/zcc-cli.
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'zcc-cli', 'bin'));
  // Dev: the CLI's own build output (post-build emits the extensionless `zcc`).
  candidates.push(join(repoRoot, 'packages', 'cli', 'dist', 'bin'));
  // Dev: the npm workspace symlink for @zcc/cli's bin.
  candidates.push(join(repoRoot, 'node_modules', '.bin'));

  // Only offer a dir when a real, extensionless `zcc` executable lives there.
  for (const dir of candidates) {
    if (existsSync(join(dir, 'zcc'))) return dir;
  }
  return undefined;
}

/**
 * Resolve the directory that holds the embedded `opencode` binary the
 * local OpenCode integration uses. Returns `undefined` when it can't be found,
 * so callers can degrade to an honest "opencode unavailable" error rather than
 * spawning a bare `opencode` and getting ENOENT.
 *
 * Ladder mirrors {@link resolveZccCliBinDir} exactly:
 *   1. `OPENCODE_BIN_DIR` override (only when the dir it names exists),
 *   2. packaged: `resourcesPath/opencode/<arch>` (electron-builder copies the
 *      per-arch `opencode-darwin-{arm64,x64}` npm package's `bin/` there —
 *      see `electron-builder.yml`'s `extraResources`),
 *   3. dev: repo-relative `vendor/opencode/<arch>` — the same tree
 *      `npm run fetch:opencode` stages ahead of `electron-builder` for a
 *      packaged build (see `scripts/fetch-opencode-binaries.mjs`); running
 *      that script once also unblocks `npm run dev`,
 *   4. dev: the locally-installed `opencode-darwin-<arch>` npm package under
 *      the repo's `node_modules` (mac-only, matching the arch this process is
 *      actually running as — no cross-arch fallback).
 *
 * Every non-override candidate is gated on an executable literally named
 * `opencode` existing in it, same discipline as the CLI resolver.
 */
export function resolveOpencodeBinDir(): string | undefined {
  const override = process.env.OPENCODE_BIN_DIR;
  if (override && existsSync(override)) return override;

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const arch = process.arch; // 'arm64' | 'x64' — no cross-arch fallback.

  const candidates: string[] = [];
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'opencode', arch));
  candidates.push(join(repoRoot, 'vendor', 'opencode', arch));
  candidates.push(join(repoRoot, 'node_modules', `opencode-darwin-${arch}`, 'bin'));

  for (const dir of candidates) {
    if (existsSync(join(dir, 'opencode'))) return dir;
  }
  return undefined;
}

/**
 * Append the resolved `zcc` CLI bin dir to `current` as the LOWEST-precedence
 * entry (deduped via composePath). Pure and idempotent — re-running only
 * re-dedupes. A graceful no-op (returns `current` unchanged) when the dir /
 * `zcc` executable is absent, so callers can compose it unconditionally.
 */
export function augmentPathWithZcc(current: string | undefined): string {
  const dir = resolveZccCliBinDir();
  if (!dir) return current ?? '';
  return composePath(current, dir);
}

/** Merge PATH fragments in priority order, dropping empties and duplicates. */
function composePath(...fragments: Array<string | undefined | null>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const frag of fragments) {
    for (const dir of (frag ?? '').split(':')) {
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        out.push(dir);
      }
    }
  }
  return out.join(':');
}

/** Append the fallback CLI dirs to `current` (deduped). Pure. */
export function augmentPath(current: string | undefined): string {
  return composePath(current, ...fallbackDirs());
}

/**
 * Per-invocation session markers Claude Code exports into its OWN child
 * environment. These describe *that* invocation's session — not a config the
 * user chose — so they must never be inherited by a claude WE spawn.
 *
 * Deliberately NARROW: only the markers that identify a running session. We do
 * NOT strip config/auth vars (`CLAUDE_CODE_USE_BEDROCK`,
 * `CLAUDE_CODE_SKIP_BEDROCK_AUTH`, `CLAUDE_CODE_ENABLE_TELEMETRY`,
 * `ANTHROPIC_*`, …) — those carry the user's intended runtime and must pass
 * through untouched. See {@link stripInheritedClaudeSession}.
 */
export const INHERITED_CLAUDE_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_EXECPATH'
] as const;

/**
 * Drop Claude Code's nested-session markers from a child env (mutates in place).
 *
 * When ZCC is launched from inside a Claude Code shell (e.g. `npm run dev` run
 * from a Claude session), the app inherits that session's markers
 * (`CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID=…`, …) and — spreading `process.env`
 * wholesale into every pty — passes them on to each `claude` it spawns. The
 * spawned claude then sees itself as a NESTED CHILD session and never writes a
 * normal interactive transcript, which silently breaks every transcript-derived
 * feature (the Slack answer-relay, idle-triage, close summaries). A
 * Finder-launched app has a clean env and is unaffected, so the bug only shows
 * in dev — but a sanitize-at-the-source guard is cheap and removes the footgun
 * for good. Idempotent; a no-op when no markers are present. Keep alongside
 * {@link applyHeapCeiling} at the env-build choke point in `pty.ts`.
 */
export function stripInheritedClaudeSession(env: Record<string, string>): void {
  for (const key of INHERITED_CLAUDE_SESSION_VARS) {
    delete env[key];
  }
}

/**
 * Resolve the PATH a real interactive login shell would have, by running it
 * once and printing `$PATH`. Returns null when it can't be determined (Windows,
 * missing shell, timeout) so the caller can fall back to the guessed dirs.
 *
 * `-i` (interactive) is deliberate: many users set PATH in `~/.zshrc` /
 * `~/.bashrc`, which a non-interactive shell skips. We bracket the value in
 * sentinels so rc-file banners/noise on stdout don't corrupt the parse.
 *
 * This runs synchronously on the main thread before the window opens, so the
 * timeout is also the worst-case startup-latency ceiling: a misbehaving rc can
 * delay launch by at most `timeout` ms, then we fall back to the guessed dirs.
 * stdin is `/dev/null` so a stray `read` in an rc returns EOF instead of
 * blocking; stderr is ignored so "can't access tty; job control turned off"
 * and similar interactive-shell noise can't corrupt the parse. The marker
 * strings are hardcoded constants — never interpolate user input here, or the
 * `-c` payload becomes an injection surface.
 */
function loginShellPath(): string | null {
  if (process.platform === 'win32') return null;
  const shell = process.env.SHELL || '/bin/zsh';
  const marker = '__ZCC_PATH_START__';
  const endMarker = '__ZCC_PATH_END__';
  try {
    const out = execFileSync(shell, ['-ilc', `printf '%s%s%s' '${marker}' "$PATH" '${endMarker}'`], {
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const start = out.indexOf(marker);
    const end = out.indexOf(endMarker);
    if (start === -1 || end === -1 || end <= start) return null;
    const value = out.slice(start + marker.length, end).trim();
    return value || null;
  } catch {
    // Shell missing, non-zero exit, or timed out — fall back to guessed dirs.
    return null;
  }
}

/**
 * Repair this process's PATH so every downstream spawn (local pty, file
 * openers, scheduler fires) can resolve user-installed CLIs. Idempotent —
 * re-running only re-dedupes. Call once at app startup, before any pty is
 * created. Order: real login-shell PATH first (authoritative), then whatever
 * PATH we were launched with, then the guessed fallback dirs as a backstop, and
 * finally the bundled `zcc` CLI bin dir as the LOWEST-precedence entry.
 *
 * The `zcc` dir is appended HERE, not in fallbackDirs(): fallbackDirs() also
 * feeds augmentPath(), which composes the REMOTE SSH path, and a local
 * repo/resources path must never leak into a remote session.
 */
export function ensureProcessPath(): void {
  const base = composePath(loginShellPath(), process.env.PATH, ...fallbackDirs());
  process.env.PATH = augmentPathWithZcc(base);
}
