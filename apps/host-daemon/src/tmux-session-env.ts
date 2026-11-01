import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Per-session callback URL vars the launch env may carry. Each embeds THIS
 * session's id, so each must ride `new-session -e` (see "Per-session env" on
 * `buildLocalTmuxCommand` in tmux.ts). A new per-session callback var belongs here.
 */
export const SESSION_CALLBACK_ENV_KEYS = [
  'ZCC_MCP_URL',
  'ZCC_HOOK_URL',
  'ZCC_NOTIFY_URL',
  'ZCC_FIRSTPROMPT_URL',
  'ZCC_SUBAGENT_URL',
  'ZCC_TOOLACTIVITY_URL',
  'ZCC_OVERSEER_URL',
  'ZCC_CONTENTSCREEN_URL',
  'ZCC_NATIVETOOL_URL'
] as const;

/**
 * `sessionEnv` for a tmux `new-session -e`, with every callback key this launch
 * does not set forwarded as the empty string. An omitted key sends no `-e`, so
 * the pane would fall back to the server snapshot's value (another session's
 * endpoint). Every hook gates on `[ -n "$VAR" ]`, so empty reads the same as
 * unset. Used only on the tmux argv: the child env keeps those keys absent.
 */
export function withBlankedSessionCallbacks(
  sessionEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  const blanked: Record<string, string | undefined> = { ...sessionEnv };
  for (const key of SESSION_CALLBACK_ENV_KEYS) blanked[key] ??= '';
  return blanked;
}

/**
 * Drop every per-session callback var from a child env copied from `process.env`
 * (mutates in place). When the app itself runs inside a Zana session (dev from a
 * Zana tab, or E2E from an agent shell) the ambient env carries THAT session's
 * `ZCC_MCP_URL` / hook URLs. A launch that does not set its own value for a key
 * (codex carries MCP as a `-c` arg, so it never sets `ZCC_MCP_URL`) would hand
 * the child the parent session's endpoint, and anything in the child that reads
 * the var would call back as the wrong session. Each launch re-sets exactly the
 * keys it owns after this runs. Idempotent.
 */
export function stripInheritedSessionCallbacks(env: Record<string, string | undefined>): void {
  for (const key of SESSION_CALLBACK_ENV_KEYS) delete env[key];
}

/**
 * Per-session identity vars. Never put on the tmux argv (`-e` values are visible
 * in `ps`); delivered to the pane through a 0600 env file instead, so a 2nd+ pane
 * in a long-lived tmux server cannot inherit the first session's identity.
 */
export const SESSION_IDENTITY_ENV_KEYS = ['ZCC_SESSION_ID', 'ZCC_SESSION_TOKEN'] as const;

let sessionEnvDir: string | undefined;

/**
 * Per-process private dir. `mkdtempSync` gives a unique, caller-owned 0700 dir, so
 * another local user cannot pre-create or swap it on a shared `/tmp`.
 */
function privateSessionEnvDir(): string {
  sessionEnvDir ??= mkdtempSync(join(tmpdir(), 'zcc-session-env-'));
  return sessionEnvDir;
}

/** Where a session's identity env file lives. May throw if the private dir cannot be created. */
export function sessionEnvFilePath(sessionId: string): string {
  return join(privateSessionEnvDir(), `${sessionId}.env`);
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Write the env file: `export KEY='VAL'` for defined vars, `unset KEY` for
 * undefined ones (so the pane never keeps the tmux server snapshot's value).
 * Created 0600 with O_EXCL so a planted symlink or file is rejected. The pane
 * command sources then deletes it (see `buildLocalTmuxCommand`).
 */
export function writeSessionEnvFile(sessionId: string, vars: Record<string, string | undefined>): string {
  const path = sessionEnvFilePath(sessionId);
  const body = Object.entries(vars)
    .map(([key, value]) => (value === undefined ? `unset ${key}\n` : `export ${key}=${shSingleQuote(value)}\n`))
    .join('');
  try {
    unlinkSync(path); // stale file from a prior launch of the same session id
  } catch {
    /* none */
  }
  writeFileSync(path, body, { mode: 0o600, flag: 'wx' });
  return path;
}
