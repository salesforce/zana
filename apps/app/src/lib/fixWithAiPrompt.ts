/**
 * Seed prompt for the "Fix with AI" action on a failed agent launch
 * (`AgentLauncher`'s `.launch-error` banner). Generic by design — the error can
 * originate from any harness/provider (a CLI version floor, a missing binary, a
 * bad config file, …) so the agent is handed the raw failure text and told to
 * diagnose from there, rather than being pre-steered toward one fix.
 *
 * Spawned as a positional `[prompt]` argv on a `claude-yolo` quick agent (same
 * pattern as `DOCTOR_PROMPT`) so it can inspect/repair local tooling without a
 * permission prompt on every step.
 */
export function buildFixWithAiPrompt(errorMessage: string): string {
  return `A coding-agent launch failed inside Zana (an Electron desktop app) with this error:

"""
${errorMessage}
"""

Diagnose the root cause and fix it if you safely can. Typical causes are a CLI
tool that's missing, outdated, or misconfigured on this machine — check
installed versions (e.g. \`<tool> --version\`) against what the error expects,
and upgrade/reinstall/reconfigure as needed. If the cause instead looks like an
app bug (e.g. a version requirement in Zana's own code no longer matches
reality), say so instead of guessing at unrelated changes.

After attempting a fix, verify it actually resolves the underlying condition
(re-run the command the error implies was failing). Finish with a short, plain
summary: what was wrong, what you fixed, and anything that still needs the
user. Use the \`inbox_push\` MCP tool to deliver this summary so the user sees
it even if they've left this tab.

Be conservative: prefer the narrowest fix that resolves this specific error
over broader changes.`;
}
