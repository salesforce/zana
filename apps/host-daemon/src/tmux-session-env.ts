import { mkdirSync, writeFileSync } from 'node:fs';
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
 * Per-session identity vars. Never put on the tmux argv (`-e` values are visible
 * in `ps`); delivered to the pane through a 0600 env file instead, so a 2nd+ pane
 * in a long-lived tmux server cannot inherit the first session's identity.
 */
export const SESSION_IDENTITY_ENV_KEYS = ['ZCC_SESSION_ID', 'ZCC_SESSION_TOKEN'] as const;

const SESSION_ENV_FILE_DIR = join(tmpdir(), 'zcc-session-env');

/** Where a session's identity env file lives. */
export function sessionEnvFilePath(sessionId: string): string {
  return join(SESSION_ENV_FILE_DIR, `${sessionId}.env`);
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Write `export KEY='VAL'` lines for the defined vars to a 0600 file in a 0700
 * directory. The pane command sources then deletes it (see `buildLocalTmuxCommand`).
 */
export function writeSessionEnvFile(sessionId: string, vars: Record<string, string | undefined>): string {
  mkdirSync(SESSION_ENV_FILE_DIR, { recursive: true, mode: 0o700 });
  const path = sessionEnvFilePath(sessionId);
  const body = Object.entries(vars)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `export ${key}=${shSingleQuote(value)}\n`)
    .join('');
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}
