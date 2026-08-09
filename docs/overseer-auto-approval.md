# Overseer — experimental auto-approval cascade

**Status:** experimental, OFF by default. Lives in Settings → Experimental →
"Overseer (auto-approve)", pared to what this app needs.

## What it does

When armed, every interactive `claude` tab gets a **synchronous `PreToolUse`
hook** that POSTs each tool call to the local MCP server. The server runs a
three-tier cascade and answers with a Claude Code permission decision the agent
blocks on:

1. **Deny / guardrail tier** — built-in guardrail substrings (`.ssh`, `.env`,
   `rm -rf`, `git push`, `curl `, secrets…) plus operator-supplied deny
   patterns. A match forces the normal prompt (`ask`) and **short-circuits** —
   the LLM tier never runs. This is the safety floor.
2. **Allow tier** — a static allow-list: read-only tools (`Read`, `Glob`,
   `Grep`, `NotebookRead`, `ToolSearch`, `TodoWrite`) and **state/metadata-only**
   `Bash` prefixes (`git status`, `git log`, `git branch`, `ls`, `pwd`, `which`,
   `node --version`, `npm ls`/`view`). Content-bearing readers (`cat`, `head`,
   `tail`, `wc`, `env`, `git diff`, `git show`, `grep`/`rg`) are **deliberately
   excluded** — they can exfiltrate secrets (`cat ~/.npmrc`, `env` dumps the
   callback URLs, `git diff --no-index /etc/passwd`), and a filename denylist is
   inherently leaky, so they fall through to `ask`/LLM instead. A safe Bash
   command with any shell chainer (`;`, `&&`, `|`, `$()`, redirects, `sudo`) is
   rejected here.
3. **LLM tier (opt-in)** — for whatever's left, an optional bounded
   `builtin:overseer-judge` micro-call answers "safe to auto-approve?". Only a
   confident `{"safe":true}` auto-approves; anything else falls through to
   `ask`.

Anything no tier resolves → `ask` (the normal prompt).

## Why it's safe to leave on (and trivial to turn off)

- **OFF by default.** When `overseerMode === 'off'` **no hook is installed** —
  the feature is completely inert. Turning it off fully restores stock
  behaviour on the next session launch.
- **Fail-open everywhere.** Server down, curl error, non-2xx, empty reply,
  parse failure, decision timeout (8s server / 10s hook), or a bug in the
  cascade → the agent sees its **normal permission prompt**. The Overseer can
  never make the agent *worse off* than no Overseer at all.
- **It never emits `deny`.** Its only job is to REMOVE friction (auto-`allow`
  the safe stuff). A false `deny` would wedge an agent mid-task, so the deny
  tier resolves to `ask`, never `deny`. (And per Claude Code's "most restrictive
  wins" rule, our `allow` can't override another hook's or rule's block.)
- **Dry-run mode.** `overseerMode === 'dryRun'` runs the cascade and logs what
  it *would* auto-approve (`[overseer] … computed=allow acted=ask`) but always
  returns `ask`. Watch it before trusting it.

## Where the pieces live

| Concern | File |
| --- | --- |
| Cascade engine (pure, unit-tested) | `src/main/overseer.ts` |
| Judge prompt (`builtin:overseer-judge`) | `src/main/prompt-registry.ts` |
| Synchronous hook command | `src/main/pty.ts` (`buildHookSettings`, `overseer`) |
| Hook gating + `ZCC_OVERSEER_URL` | `src/main/pty.ts` (`wantsOverseerHook`) |
| Route + decision serialization | `src/main/mcp-server.ts` (`matchOverseerHookRoute`, `onOverseerHook`) |
| Wiring + cwd resolution | `src/main/index.ts` (`overseer`, `onOverseerHook`) |
| Config + validation | `src/shared/types.ts`, `src/main/store.ts` |
| Settings UI | `src/renderer/components/SettingsPanel.tsx` (`ExperimentalTab`) |
| Tests | `src/main/__tests__/overseer.test.ts`, `mcp-server.test.ts` |

## Rule alignment

- **Rule 1 (main authorizes).** The decision runs in main; `cwd` is resolved
  from the live pty, never trusted from the agent-supplied event body. Config is
  validated in `normalizeConfig` (renderer is untrusted).
- **Rule 5 (bounded work).** The judge call is opt-in and de-duped; the hook is
  scoped to interactive claude tabs (not scheduled/headless/yolo). No unbounded
  store — the decision log is a diagnostic console line.
- **Rule 7 (deliberate trust expansion).** This is a genuine trust-boundary
  feature. It's gated experimental + off-by-default + fail-open + dry-run-first,
  and the deny tier can never be overridden by the LLM tier.

## Surfacing — audit ring + Agent Attention badge

The Overseer is the `blocked`-path twin of idle-triage's `idle`-path: both answer
"what actually needs the human?". Idle-triage removes idle noise from the **Needs
you** lane; the Overseer removes permission-prompt noise. Its decisions now feed
the same Attention surface instead of only the console:

- **Bounded audit ring** (`src/main/overseer-audit.ts`, `OverseerAuditRing`) —
  every decision is recorded in `onOverseerHook` (where the session/project ids
  are in scope), capped at `DEFAULT_AUDIT_CAP` (200), oldest-first eviction
  (Rule 5). Cleared per-session on pty exit.
- **Per-session rollup → card badge** — a debounced (~250ms) `OverseerActivity`
  rollup is pushed over `IPC.terminals.onOverseerActivity` into the
  `useOverseerActivity` store slice (its own channel/slice, like `onIdleTriage`,
  so an auto-approval can't rebuild the status list). The Agents board badges it
  on the card: "⚡ ×N" when calls were auto-approved (`on`), "⚡ would ×N" in
  dry-run (computed `allow`, verdict `ask`) — so the badge never overstates.
- **Dry-run review pane** — Settings → Experimental → Overseer shows the recent
  decisions (`overseer.recent`, bounded by the ring) with tier + would/did
  verdict, so you can watch what it *would* auto-approve before trusting `on`.

## Known limitations / next steps

- The LLM tier judges one call in isolation (no transcript context). Good enough
  for "is this read-only", weaker for intent-dependent calls — hence `ask` on
  any doubt.
- The audit ring is **in-memory only** — it doesn't persist across app restarts.
  A persisted trail would be the next increment if the experiment graduates.
- The badge surfaces on the Agents board cards; it is not (yet) shown in the
  compact left-side agents list (which renders no activity badges today).
