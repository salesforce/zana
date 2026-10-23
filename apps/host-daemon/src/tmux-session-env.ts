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
