/**
 * The shared decision tail of every native-tool-policy (OBL-004) PreToolUse
 * relay command. Each provider's hook builder owns its command's head (how
 * the event JSON reaches curl); this dependency-free leaf owns what the CLI
 * reads back on stdout.
 *
 * A plugin `allow` means "no plugin objected", never approval, so it prints
 * NOTHING: an exit-0 hook with no output is "no decision" to both CLIs and
 * their own permission flow still decides. Only the hook route's exact deny
 * reply is relayed. Every other outcome — a non-zero curl exit (refused,
 * timeout, non-2xx via `--fail`, a body cut short), an unset URL, or any
 * other body — synthesizes a deny, so the gate stays fail-closed.
 */

/** The route's exact reply shape (mcp-server.ts) as a `case` pattern; the reason is the only wildcard. */
const replyPattern = (decision: 'allow' | 'deny') =>
  `'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"${decision}","permissionDecisionReason":'*'"}}'`;

/** The deny printed for every outcome that is not an exact allow or deny reply. */
export const NATIVE_TOOL_RELAY_UNREACHABLE =
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"native tool policy unreachable"}}';

/**
 * Shell tail of a PreToolUse relay. Expects `OUT` (curl's body) and `STATUS`
 * (curl's exit code); trusts either reply shape only after a clean curl exit,
 * so a truncated allow can never turn into silence. Always exits 0.
 */
export function nativeToolRelayTail(): string {
  return 'KIND=bad; ' +
    `if [ "$STATUS" -eq 0 ]; then case "$OUT" in ${replyPattern('allow')}) KIND=allow;; ${replyPattern('deny')}) KIND=deny;; esac; fi; ` +
    `case "$KIND" in allow) ;; deny) printf '%s' "$OUT";; *) echo '${NATIVE_TOOL_RELAY_UNREACHABLE}';; esac; exit 0`;
}
