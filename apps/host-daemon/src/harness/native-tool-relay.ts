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

import { TOOL_SETTLED_POST_MS } from '@zana-ai/zcc-domain/native-tool-policy-budget';

/** Whole seconds for the settled post's `curl -m`, rounded up. */
export const TOOL_SETTLED_POST_SEC = Math.ceil(TOOL_SETTLED_POST_MS / 1_000);

/** The route's exact reply shape (mcp-server.ts) as a `case` pattern; the reason is the only wildcard. */
const replyPattern = (decision: 'allow' | 'deny') =>
  `'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"${decision}","permissionDecisionReason":'*'"}}'`;

/** The deny printed for every outcome that is not an exact allow or deny reply. */
export const NATIVE_TOOL_RELAY_UNREACHABLE =
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"native tool policy unreachable"}}';

/**
 * Shell fragment that classifies the route's reply into `KIND` (`allow`, `deny`
 * or `bad`). Expects `OUT` (curl's body) and `STATUS` (curl's exit code) and
 * trusts either reply shape only after a clean curl exit, so a truncated allow
 * can never be read as an allow.
 */
export function nativeToolReplyClassifier(): string {
  return 'KIND=bad; ' +
    `if [ "$STATUS" -eq 0 ]; then case "$OUT" in ${replyPattern('allow')}) KIND=allow;; ${replyPattern('deny')}) KIND=deny;; esac; fi; `;
}

/**
 * Shell tail of a PreToolUse relay. Expects `OUT` (curl's body) and `STATUS`
 * (curl's exit code); trusts either reply shape only after a clean curl exit,
 * so a truncated allow can never turn into silence. Always exits 0.
 */
export function nativeToolRelayTail(): string {
  return nativeToolReplyClassifier() +
    `case "$KIND" in allow) ;; deny) printf '%s' "$OUT";; *) echo '${NATIVE_TOOL_RELAY_UNREACHABLE}';; esac; exit 0`;
}

/**
 * The settled (post-tool) callback for a native-tool callback URL: same host,
 * project and session, `/hook/toolsettled/` in place of `/hook/nativetool/`. A
 * URL of any other shape has no settled twin, so the provider wires nothing.
 */
export function toolSettledUrlFor(nativeToolUrl: string | undefined): string | undefined {
  if (!nativeToolUrl) return undefined;
  const settled = nativeToolUrl.replace(/\/hook\/nativetool\/([^/]+\/[^/]+)$/, '/hook/toolsettled/$1');
  return settled === nativeToolUrl ? undefined : settled;
}

/**
 * Shell fragment that posts a post-tool event to the settled route and returns
 * at once. OBSERVATIONAL: the post runs in a detached background subshell with
 * all stdio discarded and a short curl bound ({@link TOOL_SETTLED_POST_SEC}), so
 * a hung or absent main can never delay the tool's completion, and a failed post
 * is dropped. Prints nothing (a CLI parses hook stdout as a directive) and exits 0.
 * `urlExpr` is a shell word: a quoted literal or `"$ENV_VAR"`.
 */
export function toolSettledRelayCommand(urlExpr: string): string {
  return `ZCC_IN=$(cat); if [ -n ${urlExpr} ]; then (printf "%s" "$ZCC_IN" | curl -s -m ${TOOL_SETTLED_POST_SEC} -o /dev/null -X POST --data-binary @- ${urlExpr} >/dev/null 2>&1 &); fi; exit 0`;
}
