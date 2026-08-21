/**
 * Overseer — experimental auto-approval cascade for agent tool calls.
 *
 * When a claude session is about to run a tool, a synchronous `PreToolUse` hook
 * POSTs the event here and prints whatever decision we return — so the agent
 * blocks just long enough for us to answer `allow` / `ask` (we never emit
 * `deny`; see below). The whole point is to spare the operator from clicking
 * "approve" on tool calls that are obviously safe (a `Read`, a `git status`),
 * while leaving anything we're unsure about to the normal permission prompt.
 *
 * Tiers, evaluated in order, FIRST MATCH WINS:
 *
 *   1. DENY / guardrail tier — a hard list of tool+input patterns we will NEVER
 *      auto-approve (writes to sensitive roots, destructive shell, network
 *      egress, anything the operator listed). A match here short-circuits to
 *      `ask` (hand it back to the human) and the LLM tier never runs. This tier
 *      is the safety floor: the LLM can only ever turn an `ask` into an `allow`
 *      WITHIN what this tier already permitted, never override it.
 *   2. ALLOW tier — a static allow-list of provably-safe tools (read-only
 *      builtins) and safe shell-command prefixes (`git status`, `ls`, …). A
 *      match here is auto-approved with no LLM spend.
 *   2b. PATH-CONFINEMENT tier — a Write/Edit whose target realpath-confines
 *      inside the session cwd (rule 2). Deterministic and zero-latency: the
 *      agent could make that same edit behind an approved prompt anyway, and the
 *      deny tier already rejected sensitive paths. A write that escapes the tree
 *      falls through. Only consulted when a `confinePath` resolver is injected.
 *   3. LLM tier (opt-in), TWO escalating passes — for everything left:
 *        · a FAST `builtin:overseer-judge` micro-call (cheap model) that answers
 *          safe / unsafe / ESCALATE;
 *        · on `escalate` (and only if the deep tier is enabled), a DEEP
 *          `builtin:overseer-judge-deep` pass on a stronger model with a larger
 *          thinking + latency budget. It reasons harder about a plausibly-safe
 *          call on the SAME conservative bar. Only a confident "yes" at either
 *          stage auto-approves; anything else (incl. a failing call) → `ask`.
 *      The deep pass is what lets the Overseer safely approve MORE by thinking
 *      more, without lowering the floor or slowing the fast path.
 *
 * Fail-safe by construction:
 *   - The default decision is `ask` — i.e. the normal prompt. If this module
 *     errors, the server hands back an empty body, or the feature is off, the
 *     agent just sees its usual permission prompt. We NEVER make the agent worse
 *     off than no Overseer at all.
 *   - We never emit `deny`. The Overseer's job is to REMOVE friction (auto-allow
 *     the safe stuff), not to add new blocks — a false `deny` would wedge an
 *     agent mid-task. The deny tier therefore resolves to `ask`, not `deny`.
 *   - Dry-run mode computes the verdict and audits it but returns `ask`, so the
 *     operator can watch what it *would* auto-approve before trusting it.
 *
 * All collaborators are injected so the cascade is unit-testable without
 * Electron, the filesystem, or a real `claude --print` spawn.
 */

import type { LlmRunResult } from '@zana-ai/zcc-domain/product';

/** The three postures the cascade can land on. We only ever ACT on allow/ask. */
type OverseerVerdict = 'allow' | 'ask';

/**
 * Which tier produced the verdict — for the audit trail and dry-run display.
 *   - `confine`: a Write/Edit whose target realpath-confines inside the session
 *     cwd (a deterministic, zero-latency allow — see {@link OverseerDeps.confinePath}).
 *   - `deep`: the second, "think harder" LLM pass that runs only when the fast
 *     judge asked to escalate a plausibly-safe-but-uncertain call.
 */
type OverseerTier = 'deny-guard' | 'allow-list' | 'confine' | 'llm' | 'deep' | 'default';

/** Operating mode. `off` short-circuits before any work (the route 204s). */
type OverseerMode = 'off' | 'dryRun' | 'on';

/** The PreToolUse event fields we consume (a subset of Claude Code's payload). */
export interface OverseerToolEvent {
  /** e.g. `Bash`, `Read`, `Edit`, `mcp__zcc-inbox__inbox_push`. */
  toolName: string;
  /** The tool's raw input object (shape varies per tool). */
  toolInput: Record<string, unknown>;
  /** The session's working directory (server-resolved upstream; trusted). */
  cwd: string;
}

/** A computed decision plus enough provenance to audit and display it. */
export interface OverseerDecision {
  /** What we actually return to the hook (in dryRun this is forced to `ask`). */
  verdict: OverseerVerdict;
  /** What the cascade *computed* (may be `allow` even when dryRun returns `ask`). */
  computed: OverseerVerdict;
  /** The tier that decided. */
  tier: OverseerTier;
  /** One-line human reason, surfaced to the agent as permissionDecisionReason. */
  reason: string;
}

export interface OverseerConfig {
  mode: OverseerMode;
  /**
   * Run the LLM judgment tier for calls the static tiers didn't resolve. When
   * false the cascade stops after the allow-list (everything else → `ask`),
   * so the feature spends zero tokens.
   */
  llmTierEnabled: boolean;
  /**
   * Run the second, "think harder" judgment pass. Only consulted when the fast
   * judge ({@link llmTierEnabled}) returns `escalate` — i.e. the call is
   * plausibly safe but the cheap model wasn't confident. The deep judge runs a
   * stronger model with a larger latency/thinking budget on the SAME conservative
   * bar (it can only turn an escalate into an `allow`, never lower the floor).
   * When false, an `escalate` falls through to `ask`, so this add-on spends zero
   * extra tokens until you opt in.
   */
  deepTierEnabled: boolean;
  /**
   * Extra deny patterns (substrings matched case-insensitively against the
   * tool name and a flattened view of the input). Operator-supplied; additive
   * on top of the built-in guardrails. Never auto-approved.
   */
  denyPatterns: string[];
}

export interface OverseerDeps {
  /** Read live config so a Settings toggle takes effect without a restart. */
  getConfig: () => OverseerConfig;
  /**
   * Run the `builtin:overseer-judge` micro-call (the fast tier). Resolves to a
   * result whose `text` we parse for a verdict. Never throws (provider
   * contract). Absent ⇒ the LLM tier always falls through to `ask` (treated as
   * "can't tell").
   */
  runJudge?: (event: OverseerToolEvent, dedupeKey: string) => Promise<LlmRunResult>;
  /**
   * Run the `builtin:overseer-judge-deep` micro-call (the "think harder" tier).
   * Same result shape as {@link runJudge}, but backed by a stronger model with a
   * larger thinking budget. Only invoked when the fast judge returned
   * `escalate` AND {@link OverseerConfig.deepTierEnabled}. Absent ⇒ an escalate
   * falls through to `ask`.
   */
  runJudgeDeep?: (event: OverseerToolEvent, dedupeKey: string) => Promise<LlmRunResult>;
  /**
   * Resolve a filesystem path and report whether it REALPATH-confines inside the
   * session's working directory (CLAUDE.md rule 2). Used by the deterministic
   * path-confinement tier to auto-approve a Write/Edit whose target stays inside
   * `cwd`. Best-effort and synchronous-shaped (returns a boolean); a throw or a
   * miss is treated as "not confined" (→ falls through). Absent ⇒ the
   * confinement tier is skipped entirely (no Write/Edit auto-approval).
   */
  confinePath?: (targetPath: string, cwd: string) => boolean;
  /** Append one decision to the audit trail. Best-effort; must never throw. */
  audit?: (event: OverseerToolEvent, decision: OverseerDecision) => void;
}

/**
 * Tools that only ever READ — safe to auto-approve outright. Kept conservative:
 * a tool is here only if it cannot mutate the filesystem, spawn a process, or
 * reach the network. `Bash` is deliberately ABSENT (handled by prefix rules).
 */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'NotebookRead',
  'TodoWrite', // session-local scratchpad, no external effect
  'ToolSearch'
]);

/**
 * File-mutating built-ins whose blast radius is a single named path. Safe to
 * auto-approve ONLY when that path realpath-confines inside the session cwd (a
 * write the agent could already make with an approved prompt anyway) — the
 * confinement tier gates this, guardrails run first. Deliberately excludes tools
 * with no single obvious target (Bash, NotebookEdit's cell edits are fine but
 * the file path applies) and anything that can reach outside the tree.
 */
const CONFINABLE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * The path field each confinable tool carries its target in. All of Claude
 * Code's file tools use `file_path`; kept as a map so a future tool with a
 * different key is a one-line addition, not a special case. Pure lookup.
 */
const WRITE_PATH_FIELD: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path'
};

/** Extract the declared target path for a confinable write tool, or '' if absent. */
export function writeTargetPath(toolName: string, input: Record<string, unknown>): string {
  const field = WRITE_PATH_FIELD[toolName];
  if (!field) return '';
  const v = input?.[field];
  return typeof v === 'string' ? v : '';
}

/**
 * Agent-facing data directories directly under a `.zcc/` root. Agents already
 * write these through their MCP twins (`library_write`, `followup_create`,
 * `goal_create`), so a confinable Write/Edit whose target lands here is no more
 * privileged than what the agent can already do — the {@link GUARDRAIL_SUBSTRINGS}
 * `.zcc/` deny is relaxed for exactly these (see {@link isZccAgentDataWrite}).
 * Everything ELSE under `.zcc/` — `config.json`, `control.token`, `control.sock`,
 * `projects.json` (the path-confinement trust anchor, rule 2), `extensions/`,
 * `modules/`, `mcp/`, `schedules/`, `personas/`, `teams/` … — stays hard-denied.
 */
const ZCC_AGENT_DATA_DIRS = new Set(['library', 'followups', 'goals']);

/**
 * Resolve a path into its significant segments, collapsing `.` and `..` LEXICALLY
 * (no filesystem access). Traversal-safe by construction: `..` pops the prior
 * segment, so `.zcc/library/../config.json` → `['.zcc','config.json']`. Tolerates
 * both `/` and `\` separators. Pure.
 */
function resolvePathSegments(p: string): string[] {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out;
}

/**
 * True when this is a confinable write whose target, after resolving `.`/`..`,
 * lands DIRECTLY inside a `.zcc/<agent-data-dir>/` subtree ({@link
 * ZCC_AGENT_DATA_DIRS}). Used to relax the blunt `.zcc/` guardrail for writes the
 * agent could already make via MCP. This never AUTO-APPROVES on its own — it only
 * lets the call reach the deterministic path-confinement tier, which still
 * realpath-confines the target to the session cwd. Traversal-safe: a target that
 * climbs back out of the subtree (`.zcc/library/../config.json`) resolves to
 * `.zcc/config.json` and is NOT matched, so it stays denied. Pure; exported for
 * tests.
 */
export function isZccAgentDataWrite(toolName: string, input: Record<string, unknown>): boolean {
  if (!CONFINABLE_WRITE_TOOLS.has(toolName)) return false;
  const target = writeTargetPath(toolName, input);
  if (!target) return false;
  const segs = resolvePathSegments(target);
  const idx = segs.indexOf('.zcc');
  if (idx === -1) return false;
  const child = segs[idx + 1];
  return child !== undefined && ZCC_AGENT_DATA_DIRS.has(child);
}

/**
 * Safe `Bash` command prefixes — commands that only report repository/process
 * STATE or metadata, never arbitrary file *contents*. Matched against the
 * trimmed, lowercased command.
 *
 * Deliberately EXCLUDES every content-bearing reader — `cat`, `head`, `tail`,
 * `wc`, `env`, `git diff`, `git show`, and `grep`/`rg` against a chosen file.
 * Those can exfiltrate secrets the agent should never auto-read:
 * `cat ~/.npmrc`, `cat ~/.config/gh/hosts.yml`, `env` (dumps the process
 * environment, including the ZCC callback URLs that carry session identity),
 * `git diff --no-index /etc/passwd /dev/null`, `git show HEAD:secrets.env`. A
 * filename denylist is inherently leaky, so instead of trying to bless "safe"
 * arguments we drop the whole command class from the static allow-list — it
 * falls through to `ask` (or, if enabled, the LLM tier, which can reason about
 * the specific target). Each entry below is a pure query with no documented
 * mutating mode reachable by a bare prefix. Anything with a shell metacharacter
 * that could chain a second command is rejected before this list is consulted
 * (see {@link bashLooksSafe}).
 */
const SAFE_BASH_PREFIXES = [
  'git status',
  'git log',
  'git branch',
  'git remote -v',
  'git rev-parse',
  'ls',
  'pwd',
  'echo',
  'which',
  'node --version',
  'npm ls',
  'npm view'
];

/**
 * Built-in guardrails: substrings that, if present anywhere in the flattened
 * input, force `ask` regardless of everything else. The deny floor — these are
 * the things that are dangerous no matter which tool carries them.
 */
const GUARDRAIL_SUBSTRINGS = [
  '.ssh',
  '.aws',
  // `.zcc/` protects the app's control plane (config.json, control.token,
  // projects.json — the rule-2 trust anchor — extensions/, mcp/, schedules/, …).
  // A confinable write into the agent-DATA subtree (library/followups/goals) is
  // exempted in `guardHit` via `isZccAgentDataWrite`; everything else stays denied.
  '.zcc/',
  'id_rsa',
  'credentials',
  '.env',
  'secret',
  'rm -rf',
  'sudo ',
  'curl ',
  'wget ',
  'git push',
  ':(){', // fork bomb
  '> /dev/'
];

/** Shell metacharacters that let a "safe" prefix chain into something unsafe. */
const SHELL_CHAINERS = /[;&|`$(){}<>]|\n|\bsudo\b/;

/**
 * Flatten a tool input into one lowercased searchable string. Tolerant of any
 * shape — we JSON-stringify and lowercase, so a deny/guardrail substring is
 * caught whether it appears in `command`, `file_path`, `url`, etc. Pure.
 */
export function flattenInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input).toLowerCase();
  } catch {
    return '';
  }
}

/** Extract a Bash command string from a tool input, or '' if absent. Pure. */
function bashCommand(input: Record<string, unknown>): string {
  const c = input?.command;
  return typeof c === 'string' ? c : '';
}

/**
 * Is this `Bash` command safe to auto-approve? It must (a) carry no shell
 * chainer that could append a second command, and (b) start with one of the
 * known read-only prefixes. Conservative: a command we can't cleanly classify
 * returns false (→ falls through to the LLM tier or `ask`). Pure; exported for
 * tests.
 */
export function bashLooksSafe(command: string): boolean {
  const cmd = command.trim().toLowerCase();
  if (!cmd) return false;
  if (SHELL_CHAINERS.test(cmd)) return false;
  return SAFE_BASH_PREFIXES.some(
    (p) => cmd === p.trim() || cmd.startsWith(p.endsWith(' ') ? p : `${p} `)
  );
}

/**
 * Parse the judge micro-call's reply into a boolean "safe to auto-approve".
 * Tolerant: the model should emit `{"safe":true|false,"reason":"…"}` but may
 * wrap it in prose/fences, so we extract the first {...}. Only an explicit
 * `safe:true` approves; anything unparsable/ambiguous → false (→ `ask`). Pure;
 * exported for tests.
 */
export function parseJudge(text: string): { safe: boolean; reason: string } | null {
  if (!text.trim()) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const raw = obj as Record<string, unknown>;
  if (typeof raw.safe !== 'boolean') return null;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 120) : '';
  return { safe: raw.safe, reason };
}

/** The three outcomes the FAST judge can reach; `escalate` hands to the deep tier. */
export type TriageOutcome = 'safe' | 'unsafe' | 'escalate';

/**
 * Parse the FAST judge's reply into a three-way triage. Tolerant like
 * {@link parseJudge}: extracts the first {...} and reads a `verdict` string of
 * `"safe"|"unsafe"|"escalate"`. For BACKWARD COMPATIBILITY with a user who
 * shadowed the old prompt (which emitted `{"safe":true|false}`), a bare boolean
 * `safe` maps to `safe`/`unsafe` and never escalates — so an old prompt behaves
 * exactly as it does today. Anything unparsable/ambiguous → null (→ `ask`).
 * Pure; exported for tests.
 */
export function parseTriage(text: string): { outcome: TriageOutcome; reason: string } | null {
  if (!text.trim()) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const raw = obj as Record<string, unknown>;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 120) : '';
  const v = typeof raw.verdict === 'string' ? raw.verdict.trim().toLowerCase() : '';
  if (v === 'safe' || v === 'unsafe' || v === 'escalate') {
    return { outcome: v, reason };
  }
  // Backward-compat: an old `{"safe":bool}` reply with no `verdict`.
  if (typeof raw.safe === 'boolean') {
    return { outcome: raw.safe ? 'safe' : 'unsafe', reason };
  }
  return null;
}

/**
 * The auto-approval cascade. Stateless apart from injected deps + the in-flight
 * de-dupe inherited from the LLM service; safe to construct once at app init.
 */
export class Overseer {
  constructor(private readonly deps: OverseerDeps) {}

  /** True when the feature should install its hook / serve its route at all. */
  isArmed(): boolean {
    return this.deps.getConfig().mode !== 'off';
  }

  /**
   * Decide a single tool call. Never throws — any internal error resolves to
   * `ask` (the safe default). The returned `verdict` is what the hook should
   * print; in dryRun it's forced to `ask` while `computed` records what the
   * cascade would have done. Audits every non-off decision.
   */
  async decide(event: OverseerToolEvent): Promise<OverseerDecision> {
    let decision: OverseerDecision;
    try {
      decision = await this.run(event);
    } catch {
      // Belt-and-suspenders: a bug in the cascade must not block the agent.
      decision = { verdict: 'ask', computed: 'ask', tier: 'default', reason: 'overseer error' };
    }
    try {
      this.deps.audit?.(event, decision);
    } catch {
      /* audit is best-effort */
    }
    return decision;
  }

  // ----- internals -----------------------------------------------------------

  private async run(event: OverseerToolEvent): Promise<OverseerDecision> {
    const cfg = this.deps.getConfig();
    // Caller (the route) should already gate on isArmed(), but double-check so a
    // direct decide() in tests honours `off` too.
    if (cfg.mode === 'off') {
      return { verdict: 'ask', computed: 'ask', tier: 'default', reason: 'overseer off' };
    }

    const dryRun = cfg.mode === 'dryRun';
    const finalize = (computed: OverseerVerdict, tier: OverseerTier, reason: string): OverseerDecision => ({
      // In dryRun we observe but never act: always hand back `ask`.
      verdict: dryRun ? 'ask' : computed,
      computed,
      tier,
      reason
    });

    const flat = flattenInput(event.toolInput);

    // Tier 1 — deny / guardrails. First match wins; LLM never runs.
    const guard = this.guardHit(event.toolName, flat, cfg.denyPatterns, event.toolInput);
    if (guard) return finalize('ask', 'deny-guard', guard);

    // Tier 2 — static allow-list.
    if (READ_ONLY_TOOLS.has(event.toolName)) {
      return finalize('allow', 'allow-list', `${event.toolName} is read-only`);
    }
    if (event.toolName === 'Bash' && bashLooksSafe(bashCommand(event.toolInput))) {
      return finalize('allow', 'allow-list', 'safe read-only shell command');
    }

    // Tier 2b — path-confinement (deterministic, zero-latency). A Write/Edit is
    // safe to auto-approve when its target realpath-confines inside the session
    // cwd (rule 2): the agent could make that same edit behind an approved
    // prompt anyway, and the guardrail tier above already rejected sensitive
    // paths (.env, .ssh, and every `.zcc/` path except the agent-data subtree —
    // library/followups/goals — which the agent can already write via MCP)
    // regardless of where they sit. A write that escapes the tree (or a tool we
    // can't pin a single path on) falls through.
    if (CONFINABLE_WRITE_TOOLS.has(event.toolName) && this.deps.confinePath) {
      const target = writeTargetPath(event.toolName, event.toolInput);
      if (target && this.safeConfine(target, event.cwd)) {
        return finalize('allow', 'confine', `${event.toolName} confined to project dir`);
      }
    }

    // Tier 3 — LLM judgment (opt-in), two escalating passes:
    //   3a. FAST judge (cheap model). Returns safe → allow, unsafe → ask, or
    //       escalate → "plausibly safe but I'm not sure, ask someone smarter".
    //   3b. DEEP judge (stronger model, larger thinking budget) — runs ONLY on
    //       an escalate and only when the deep tier is enabled. Same bar; it can
    //       only turn an escalate into `allow`, never below the guardrail floor.
    // Absent deps or a non-confident reply at either stage fall through to `ask`.
    if (cfg.llmTierEnabled && this.deps.runJudge) {
      const dedupeKey = `overseer:${event.toolName}:${flat.slice(0, 64)}`;
      const fast = await this.deps.runJudge(event, dedupeKey);
      if (fast.ok) {
        const triage = parseTriage(fast.text);
        if (triage?.outcome === 'safe') {
          return finalize('allow', 'llm', triage.reason || 'judged safe');
        }
        if (
          triage?.outcome === 'escalate' &&
          cfg.deepTierEnabled &&
          this.deps.runJudgeDeep
        ) {
          const deep = await this.deps.runJudgeDeep(event, `deep:${dedupeKey}`);
          if (deep.ok) {
            const parsed = parseJudge(deep.text);
            if (parsed?.safe) {
              return finalize('allow', 'deep', parsed.reason || 'judged safe (deep)');
            }
          }
        }
      }
    }

    return finalize('ask', 'default', 'no rule matched — handed to you');
  }

  /**
   * Never-throw wrapper around the injected path-confinement check. A resolver
   * that throws (e.g. a realpath on a path that can't be stat'd) must not block
   * the agent — treat any failure as "not confined" so the call falls through to
   * the LLM tier or the normal prompt.
   */
  private safeConfine(target: string, cwd: string): boolean {
    try {
      return this.deps.confinePath ? this.deps.confinePath(target, cwd) === true : false;
    } catch {
      return false;
    }
  }

  /**
   * Return the guardrail reason if this call hits the deny floor, else null.
   * Checks the operator's deny patterns and the built-in guardrail substrings
   * against both the tool name and the flattened input.
   */
  private guardHit(
    toolName: string,
    flat: string,
    denyPatterns: string[],
    input: Record<string, unknown>
  ): string | null {
    const name = toolName.toLowerCase();
    // Operator deny patterns are absolute — no exemption, checked first.
    for (const p of denyPatterns) {
      const needle = p.trim().toLowerCase();
      if (needle && (name.includes(needle) || flat.includes(needle))) {
        return `matches deny pattern "${p.trim()}"`;
      }
    }
    // A confinable write into a `.zcc/` AGENT-DATA subtree (library/followups/
    // goals) is exempt from the blunt `.zcc/` guardrail only — the agent can
    // already write these via MCP, and the write must still clear the downstream
    // path-confinement tier. Every OTHER guardrail substring (incl. `.zcc/` for a
    // sensitive control-plane path like config.json/control.token/projects.json)
    // still applies. The exemption is scoped to `.zcc/` so a write that ALSO
    // trips another guardrail (a secret, a network verb) stays denied.
    const zccExempt = isZccAgentDataWrite(toolName, input);
    for (const g of GUARDRAIL_SUBSTRINGS) {
      if (!flat.includes(g)) continue;
      if (g === '.zcc/' && zccExempt) continue;
      return `guardrail: input contains "${g}"`;
    }
    return null;
  }
}
