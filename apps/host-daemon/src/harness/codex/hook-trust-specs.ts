/**
 * Codex session-flags hook specs: the single description of every `-c
 * hooks.<Event>=[…]` override Zana injects, shared by the launch argv builder
 * (`CodexProvider.hookArgs`) and the per-binary trust conformance probe
 * (`hook-trust.ts`) so the probe exercises exactly the shapes that ship.
 */

import type { ProviderHookUrls } from '../launch-provider.js';
import { shellQuote } from '../shell-quote.js';
import { RELAY_BACKSTOP_SEC } from '@zana-ai/zcc-domain/native-tool-policy-budget';
import { nativeToolRelayTail, toolSettledRelayCommand, toolSettledUrlFor } from '../native-tool-relay.js';

/** One matcher group: its matcher and one `command` handler per entry. */
export interface CodexHookGroup {
  readonly matcher: string;
  readonly commands: readonly string[];
}

/** All matcher groups registered for one PascalCase event key. */
export interface CodexHookEventSpec {
  readonly event: string;
  readonly groups: readonly CodexHookGroup[];
}

/** Escape a value for embedding in a TOML basic (double-quoted) string. */
export function tomlBasic(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

/**
 * Render one event as `['-c', 'hooks.<Event>=[…]']`. Codex takes exactly one
 * hooks list per event key (a second `-c` for the same key OVERWRITES the first,
 * verified live), so every matcher group for an event folds into this one value.
 * The command is a shell string codex runs via `sh -c`, so it is escaped once
 * for the TOML basic string it sits in.
 */
export function renderHookOverride(spec: CodexHookEventSpec): string[] {
  const tables = spec.groups
    .map(({ matcher, commands }) => {
      const handlers = commands.map((c) => `{type="command",command="${tomlBasic(c)}"}`).join(',');
      return `{matcher="${matcher}",hooks=[${handlers}]}`;
    })
    .join(',');
  return ['-c', `hooks.${spec.event}=[${tables}]`];
}

/** Render every event spec in order. */
export function renderHookOverrides(specs: readonly CodexHookEventSpec[]): string[] {
  return specs.flatMap(renderHookOverride);
}

const one = (event: string, command: string | undefined, matcher = '*', extra: readonly string[] = []): CodexHookEventSpec => ({
  event,
  groups: [{ matcher, commands: [...(command === undefined ? [] : [command]), ...extra] }]
});

/**
 * Build the hook specs for the wired callbacks, in the stable emission order the
 * golden-argv net pins. Returns `[]` when no callback is wanted.
 *
 * Hard requirements, verified against codex:
 *  1. Event-key casing is PascalCase (codex's `HookEventsToml` config struct).
 *  2. codex delivers each hook's event JSON on the command's STDIN. Fire-and-forget
 *     hooks that only ping a fixed URL DRAIN stdin first (`cat >/dev/null`) so
 *     codex's write never blocks on an unread pipe; the first-prompt hook instead
 *     pipes stdin through (`--data-binary @-`) because it needs the `prompt` body.
 *     `curl -sS -m 5 -o /dev/null` keeps every hook quiet and bounded so a hung
 *     callback can't wedge codex's shutdown.
 *
 *     `-o /dev/null` is LOAD-BEARING, not cosmetic: codex reads a hook command's
 *     STDOUT and, for lifecycle events like `Stop`, tries to parse it as an
 *     optional JSON control directive. Our `/hook/*` routes reply with a plain
 *     `ok` body, so without discarding curl's response codex logs `error: hook
 *     returned invalid stop hook JSON output` on every turn end (verified live).
 *     Draining STDIN is a separate concern — that stops codex blocking on the
 *     pipe; `-o /dev/null` stops it mis-reading the reply.
 */
export function buildCodexHookSpecs(urls: ProviderHookUrls): CodexHookEventSpec[] {
  const specs: CodexHookEventSpec[] = [];

  // OBL-011: the observational post-tool twin of the native-tool gate. It folds
  // into the one PostToolUse override beside notify's unblock ping (codex takes
  // one hooks list per event key).
  const settledUrl = toolSettledUrlFor(urls.nativeTool);
  const settledCommands = settledUrl ? [toolSettledRelayCommand(shellQuote(settledUrl))] : [];

  // PreToolUse carries two independent jobs with DIFFERENT matchers — native
  // tool policy's `*` (every tool call) and notify's `request_user_input` (only
  // the ask-user-question tool). Verified live these matchers are mutually
  // exclusive per call, so no stdout collision; both fold into ONE override.
  const preToolUse: CodexHookGroup[] = [];
  if (urls.nativeTool) {
    // This hook must actually BLOCK, not fire-and-forget — verified live against
    // codex 0.154.0 that a hook's stdout IS parsed as a blocking
    // `hookSpecificOutput.permissionDecision` directive, the identical contract
    // Claude's PreToolUse hooks use. So we pipe stdin straight into
    // `/hook/nativetool/…` (which replies in that exact shape, see mcp-server.ts)
    // and relay only its exact DENY. A plugin `allow` means "no objection", never
    // approval — codex's parser rejects an `allow` without `updatedInput`
    // (`codex-rs/hooks/src/engine/output_parser.rs`), so an allow prints nothing,
    // which codex reads as "no decision": its own approval policy decides.
    // FAIL CLOSED: every other outcome (a non-zero curl exit — refused, timeout,
    // non-2xx, a body cut short — or any other body) emits an explicit `deny` JSON
    // ourselves — verified live that codex otherwise fails OPEN (empty hook stdout
    // → tool proceeds unmodified). The tail is shared with the Claude relay
    // (native-tool-relay.ts).
    preToolUse.push({
      matcher: '*',
      commands: [
        `OUT=$(curl --fail -s -m ${RELAY_BACKSTOP_SEC} -X POST --data-binary @- ${shellQuote(urls.nativeTool)}); STATUS=$?; ` +
          nativeToolRelayTail()
      ]
    });
  }

  if (urls.stop) {
    // Turn END → auto-close / scheduler stamp / goal loop. `/hook/stop` ignores
    // the body, so just drain stdin and ping.
    specs.push(one('Stop', `cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.stop}"`));
  }

  if (urls.notify) {
    // Forward identities so prompt repaints cannot resolve pending approval and
    // another concurrent tool's completion cannot dismiss this request.
    const post = (action: string) =>
      `curl -sS -m 5 -o /dev/null -X POST --data-binary @- "${urls.notify}/${action}"`;
    preToolUse.push({ matcher: 'request_user_input', commands: [post('blocked')] });
    specs.push(
      one('PermissionRequest', post('blocked')),
      one('PostToolUse', post('unblocked'), '*', settledCommands),
      one('Interrupt', post('unblocked'))
    );
  } else if (settledCommands.length > 0) {
    specs.push(one('PostToolUse', undefined, '*', settledCommands));
  }

  if (preToolUse.length > 0) specs.push({ event: 'PreToolUse', groups: preToolUse });

  // UserPromptSubmit carries two independent jobs; fold both commands into a
  // single group (each `command` entry gets its own stdin copy).
  const userPrompt: string[] = [];
  if (urls.notify) {
    // A new turn cleared the "needs you" wait → POST /unblocked. Drains stdin.
    userPrompt.push(`cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.notify}/unblocked"`);
  }
  if (urls.firstPrompt) {
    // Forward the event JSON (carries `prompt`) so the tab-namer can title the
    // tab. Pipe stdin through verbatim — this is the one hook that needs the body.
    userPrompt.push(`curl -sS -m 5 -o /dev/null -X POST --data-binary @- "${urls.firstPrompt}"`);
  }
  if (userPrompt.length > 0) specs.push({ event: 'UserPromptSubmit', groups: [{ matcher: '*', commands: userPrompt }] });

  if (urls.subagent) {
    // Live sub-agent-count badge. SubagentStart → /start (increments),
    // SubagentStop → /stop (decrements). Both fixed-URL pings; drain stdin.
    specs.push(
      one('SubagentStart', `cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.subagent}/start"`),
      one('SubagentStop', `cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST "${urls.subagent}/stop"`)
    );
  }

  return specs;
}
