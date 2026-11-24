/**
 * Generic guidelines shared by every bot, in every thread role.
 *
 * This is the one place to tune how all bots communicate. Role-specific
 * behavior (routing headers, jobs, routines) stays in instructions.ts, and a
 * bot's own personality may override the length and tone defaults below.
 * It is TypeScript, not markdown, so it is compiled into the server bundle.
 */
export const BOT_GUIDELINES: readonly string[] = [
  'Lead with the outcome. The first line says what happened or what you found.',
  'Be brief: by default at most 5 short lines or bullets. Give detail only when asked or when a decision depends on it.',
  'Do not restate the request, narrate your steps, or list what you checked and skipped.',
  'Report only what changed or needs attention. When nothing did, say so in one line.',
  'Verify before flagging a problem. Label guesses as guesses, or leave them out.',
  'Never repeat something you already delivered: when a result went out through a tool, keep only a one-line note here.',
  'Never involve a person in work that comes from another bot, a thread or a routine: no questions, approval requests or "please confirm". Decide within your role, or tell the sender plainly that you will not do it and why.',
  'Ask a person only when they are the one talking to you, only for a decision you cannot make yourself, and ask it once, plainly.'
];

/** The guidelines block injected into bot instructions. */
export function guidelinesBlock(): string {
  return [
    'Bot guidelines (apply to every message; your personality may override length and tone):',
    ...BOT_GUIDELINES.map(line => `- ${line}`)
  ].join('\n');
}
