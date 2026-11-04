/**
 * The Cursor native tool veto. cursor-agent runs every tool through its
 * `preToolUse` hook step before the tool body, and a step reply of
 * `permission: "deny"` rejects the call. The step is blocking: an invalid
 * reply denies, and a hook marked `failClosed` also denies when it crashes or
 * times out. Denies win when hook sources merge, so a user- or project-level
 * hook cannot turn this one's deny into an allow.
 *
 * `--plugin-dir` loads a plugin directory for one launch, so the gate lives in
 * a host-owned per-session directory named on argv and never touches the
 * user's `~/.cursor` or the project's `.cursor`. The directory's hook posts the
 * pending call to main's identity-bearing native-tool route (the same route the
 * Claude and Codex relays use) and relays only the route's exact reply: an
 * allow prints `{}` (no decision, so Cursor's own permission flow still
 * applies), a deny prints Cursor's deny shape, and every other outcome - a
 * refused connection, timeout, non-2xx, malformed body - denies.
 */
import { nativeToolReplyClassifier } from '../native-tool-relay.js';
import { shellQuote } from '../shell-quote.js';

/** Seconds Cursor lets the hook run; longer than the relay's own curl bound. */
export const CURSOR_HOOK_TIMEOUT_SEC = 10;
/** Seconds the relay waits on main's route. */
export const CURSOR_RELAY_CURL_MAX_SEC = 5;
/** The reason shown when the route cannot be reached or answers anything unexpected. */
export const CURSOR_GATE_UNREACHABLE = 'native tool policy unreachable';

/** Name of the generated plugin; it is also the gate directory's marker for sweeping. */
export const CURSOR_GATE_PLUGIN_NAME = 'zcc-native-tool-gate';

/** The deny reply Cursor reads for any outcome that is not an exact allow or deny. */
const UNREACHABLE_REPLY = JSON.stringify({ permission: 'deny', user_message: CURSOR_GATE_UNREACHABLE });

/**
 * Hook command for the `preToolUse` step. Cursor feeds the event JSON on stdin.
 * The deny reason is already a JSON string literal inside the route's reply, so
 * it is lifted out by parameter expansion rather than re-encoded.
 */
export function cursorNativeToolGateCommand(nativeToolUrl: string): string {
  return `ZCC_IN=$(cat); OUT=$(printf '%s' "$ZCC_IN" | curl --fail -s -m ${CURSOR_RELAY_CURL_MAX_SEC} -X POST --data-binary @- ${shellQuote(nativeToolUrl)} 2>/dev/null); STATUS=$?; ` +
    nativeToolReplyClassifier() +
    `case "$KIND" in allow) printf '%s' '{}';; ` +
    `deny) R=\${OUT#*'"permissionDecisionReason":'}; R=\${R%\\}\\}}; printf '{"permission":"deny","user_message":%s}' "$R";; ` +
    `*) printf '%s' ${shellQuote(UNREACHABLE_REPLY)};; esac; exit 0`;
}

export interface CursorGateFile {
  /** Path relative to the gate directory. */
  readonly path: string;
  readonly contents: string;
}

/** The plugin directory's files for one session. */
export function cursorNativeToolGateFiles(nativeToolUrl: string): CursorGateFile[] {
  return [
    {
      path: '.cursor-plugin/plugin.json',
      contents: JSON.stringify({
        name: CURSOR_GATE_PLUGIN_NAME,
        version: '1.0.0',
        description: 'Per-session native tool policy gate. Generated; do not edit.',
        hooks: './hooks/hooks.json'
      })
    },
    {
      path: 'hooks/hooks.json',
      contents: JSON.stringify({
        version: 1,
        hooks: {
          preToolUse: [{
            type: 'command',
            command: cursorNativeToolGateCommand(nativeToolUrl),
            timeout: CURSOR_HOOK_TIMEOUT_SEC,
            failClosed: true
          }]
        }
      })
    }
  ];
}

/** Argv that makes cursor-agent load the gate directory. */
export function cursorNativeToolGateArgs(gateDir: string): string[] {
  return ['--plugin-dir', gateDir];
}
