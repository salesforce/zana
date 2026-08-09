/**
 * Pure formatters for the Slack lifecycle notifications posted to the channel
 * (the generic fallback path, when a session isn't bot-launched). Kept
 * dependency-light and side-effect-free so the wording is unit-tested in
 * isolation — see notify-format.test.ts.
 *
 * The session is named by its UI tab TITLE (e.g. "fix login bug"), matching
 * what the user sees in the app, rather than a truncated session id like
 * `aa5de801` which is meaningless out of context. When known, the owning
 * project is appended so a multi-project user can tell runs apart.
 */

/** Human-readable name for a session — its tab title, or a fallback when unknown. */
function sessionLabel(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'a session';
}

/** ` in *Project*` clause when the project is known, else empty. */
function projectClause(projectName: string | undefined): string {
  const trimmed = projectName?.trim();
  return trimmed ? ` in *${trimmed}*` : '';
}

/** Notification posted when a (non-bot-launched) session's process exits. */
export function formatExitNotification(opts: {
  name?: string;
  code: number;
  projectName?: string;
}): string {
  const icon = opts.code === 0 ? '✅' : '❌';
  return `${icon} *${sessionLabel(opts.name)}* finished (exit ${opts.code})${projectClause(opts.projectName)}`;
}

/** Notification posted when a (non-bot-launched) session blocks on input. */
export function formatBlockedNotification(opts: { name?: string; projectName?: string }): string {
  return `⚠️ *${sessionLabel(opts.name)}* needs your input${projectClause(opts.projectName)}`;
}

/**
 * Hard cap on a relayed answer's BODY, in characters. Generous enough for a
 * 1–3 sentence turn summary (which the `turn-summary` prompt already clamps to
 * 600 chars) yet a real backstop if a caller ever relays something longer —
 * Slack rejects messages over ~40 KB, and a wall of text in a thread is noise.
 */
const ANSWER_MAX_CHARS = 2000;

/** Appended when a body is truncated, so the reader knows it was cut. */
const ANSWER_TRUNCATION_MARKER = '…(truncated)';

/**
 * Format the BODY of a bot turn-summary relay posted back into a Slack thread.
 * Trims surrounding whitespace and hard-caps the length; returns the body only
 * — the poster (`postBotReply`) stamps the `:robot_face:` echo-guard prefix, so
 * this stays a pure, prefix-free formatter (mirrors the other formatters here).
 */
export function formatAnswer(text: string): string {
  const body = text.trim();
  if (body.length <= ANSWER_MAX_CHARS) return body;
  return body.slice(0, ANSWER_MAX_CHARS) + ANSWER_TRUNCATION_MARKER;
}
