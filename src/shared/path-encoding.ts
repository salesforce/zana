/**
 * Encode an absolute project path the way Claude Code names its per-project
 * transcript directory: every character outside [A-Za-z0-9] becomes `-`.
 *
 * Claude Code stores session transcripts at:
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * where `<encoded-cwd>` is the absolute project path with every non-alphanumeric
 * character replaced by a dash. This means `/`, `.`, `_`, and all other special
 * characters collapse to `-`.
 *
 * Examples:
 *   - `/Users/foo/my.app_dir`
 *     → `-Users-foo-my-app-dir`
 *   - `/Users/grebmann/.npm/_npx/x/node_modules`
 *     → `-Users-grebmann--npm--npx-x-node-modules`
 *
 * Verified against real ~/.claude/projects directory names. Pure function,
 * exported for tests and cross-module reuse.
 */
export function encodeProjectCwd(absPath: string): string {
  return absPath.replace(/[^A-Za-z0-9]/g, '-');
}
