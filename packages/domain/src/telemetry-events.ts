/**
 * Typed telemetry / usage events — privacy-safe *by construction* (WARP R2 C11).
 *
 * The usage/cost dashboard (B7) rolls up per-session data, and its most
 * dangerous surface is the "top expensive sessions" list: it's one careless
 * field away from leaking a prompt preview, a file path, or a session title into
 * an aggregate view. Rather than rely on a review-time policy ("don't add a
 * preview"), this module makes the leak *representable-nowhere*:
 *
 *   1. Every telemetry event is a variant of the {@link TelemetryEvent}
 *      discriminated union, and every variant's fields are scalars, enums, or
 *      opaque identifiers — there is NO free-text/content field anywhere in the
 *      union. A session is identified by id + project + persona + model, never
 *      by anything it *said* or *touched*.
 *   2. {@link containsUgc} is an EXHAUSTIVE `switch` over `kind`. Today it
 *      returns `false` for every variant (the union is UGC-free). If someone
 *      adds a variant, the `never` exhaustiveness check fails to compile until
 *      they add a case — and if that variant introduced a content field, the
 *      honest case returns `true`, which trips the guard test. So the leak
 *      becomes a loud, deliberate act, not an accident.
 *   3. {@link assertUgcFree} is the RUNTIME backstop for data that crosses an
 *      untyped boundary (e.g. a persona label read off disk): it rejects any
 *      key outside the per-variant allowlist and any string value longer than
 *      {@link MAX_IDENTIFIER_LEN} (an identifier/label, never prose).
 *
 * Pure: no I/O, no React, no Node. Shared by main (constructs events) and the
 * renderer (renders them).
 */

/** Identifier/label strings are short; anything longer is prose we refuse to
 *  treat as an identifier. A persona/model/project label sits well under this. */
export const MAX_IDENTIFIER_LEN = 200;

/**
 * One session's usage, stripped to a privacy-safe descriptor. This is the row
 * that backs the "top sessions" list. We deliberately track ACTIVITY counters
 * (tokens, prompts, tool/MCP calls) rather than a dollar cost — a cost estimate
 * depends on model rates that drift, whereas these counts are ground truth from
 * the transcript. Deliberately absent: firstUserPrompt, title, file paths, any
 * transcript text.
 */
export interface UsageSessionEvent {
  kind: 'usage.session';
  /** Opaque session id (the claude session id or pty id). */
  sessionId: string;
  /** Canonical project id (a registry key, not a path). */
  projectId: string;
  /** Human project label — short identifier, guarded by {@link assertUgcFree}. */
  projectName: string;
  /** Persona id/label if the session ran under one (short identifier). */
  persona?: string;
  /** Model id of the last assistant turn (e.g. `claude-opus-4-8`). */
  model?: string;
  /** Lifetime token total (all buckets summed) — a single scalar. */
  totalTokens?: number;
  /** How many prompts the human sent (typed user turns). */
  promptCount?: number;
  /** Total tool invocations across the session. */
  toolCalls?: number;
  /** The MCP subset of {@link toolCalls} (tools named `mcp__…`). */
  mcpCalls?: number;
  /** Wall-clock span of the session in ms (last-active − started). */
  durationMs?: number;
}

/**
 * An aggregate rollup bucket (by project, by model, …) — a label + scalar
 * totals only. Used for the dashboard's bar charts.
 */
export interface UsageRollupEvent {
  kind: 'usage.rollup';
  /** What the bucket groups by. */
  dimension: 'project' | 'model' | 'persona';
  /** The bucket's label (a project name, model id, or persona) — short. */
  label: string;
  /** Total tokens across the bucket — the metric bars are scaled to. */
  totalTokens: number;
  /** Total prompts across the bucket. */
  promptCount: number;
  /** Total tool invocations across the bucket. */
  toolCalls: number;
  /** Total MCP invocations across the bucket. */
  mcpCalls: number;
  /** How many sessions fell in the bucket. */
  sessionCount: number;
}

/**
 * The full telemetry event union. New telemetry concepts (feature-usage counts,
 * etc.) are added HERE as variants — each MUST stay UGC-free (scalars / enums /
 * identifiers only), which {@link containsUgc}'s exhaustiveness check enforces.
 */
export type TelemetryEvent = UsageSessionEvent | UsageRollupEvent;

/** The allowlisted keys per variant — the runtime guard rejects anything else. */
const ALLOWED_KEYS: Record<TelemetryEvent['kind'], ReadonlySet<string>> = {
  'usage.session': new Set([
    'kind',
    'sessionId',
    'projectId',
    'projectName',
    'persona',
    'model',
    'totalTokens',
    'promptCount',
    'toolCalls',
    'mcpCalls',
    'durationMs'
  ]),
  'usage.rollup': new Set([
    'kind',
    'dimension',
    'label',
    'totalTokens',
    'promptCount',
    'toolCalls',
    'mcpCalls',
    'sessionCount'
  ])
};

/**
 * Exhaustive switch: does this event kind carry user-generated content? Every
 * current variant is UGC-free by design → `false`. The `never` default makes
 * adding a variant a compile error until it's classified here — so a new event
 * that DID carry content (a message preview, a file path) would have to
 * honestly return `true`, which the guard test asserts against for the usage
 * variants. Pure.
 */
export function containsUgc(event: TelemetryEvent): boolean {
  switch (event.kind) {
    case 'usage.session':
      return false;
    case 'usage.rollup':
      return false;
    default: {
      // Exhaustiveness: if a new variant is added without a case above, `event`
      // is not `never` here and this fails to compile.
      const _exhaustive: never = event;
      return Boolean(_exhaustive);
    }
  }
}

/**
 * Runtime backstop for events built from data that crossed an untyped boundary.
 * Throws when the event has a key outside its variant's allowlist, or a string
 * value that's too long to be an identifier (i.e. it looks like prose/UGC).
 * Numbers/undefined pass through. Returns the event for chaining. Pure.
 *
 * This is belt-and-suspenders alongside the type-level guarantee: the compiler
 * stops a *declared* content field; this stops a *smuggled* one (e.g. a project
 * "name" that's actually a 4KB pasted path).
 */
export function assertUgcFree<E extends TelemetryEvent>(event: E): E {
  const allowed = ALLOWED_KEYS[event.kind];
  for (const [key, value] of Object.entries(event)) {
    if (!allowed.has(key)) {
      throw new Error(`telemetry ${event.kind}: unexpected key "${key}" (possible UGC leak)`);
    }
    if (typeof value === 'string' && value.length > MAX_IDENTIFIER_LEN) {
      throw new Error(
        `telemetry ${event.kind}: field "${key}" is ${value.length} chars — too long for an identifier (possible UGC leak)`
      );
    }
  }
  return event;
}

/** True when {@link assertUgcFree} would pass — the non-throwing predicate form. */
export function isUgcFree(event: TelemetryEvent): boolean {
  try {
    assertUgcFree(event);
    return true;
  } catch {
    return false;
  }
}

/**
 * The full cost/usage rollup the dashboard renders — composed ENTIRELY of the
 * UGC-free events above, so the whole payload is privacy-safe by construction.
 * There is no field here that isn't a scalar total or one of those events.
 */
export interface UsageSummary {
  /** When this rollup was computed (ms epoch) — stamped by the service's clock. */
  generatedAt: number;
  /** How many sessions contributed (those that carried any usage). */
  sessionCount: number;
  /** Summed lifetime tokens across all sessions. */
  totalTokens: number;
  /** Summed human prompts across all sessions. */
  totalPromptCount: number;
  /** Summed tool invocations across all sessions. */
  totalToolCalls: number;
  /** Summed MCP invocations across all sessions. */
  totalMcpCalls: number;
  /** Activity buckets grouped by project, descending by tokens. */
  byProject: UsageRollupEvent[];
  /** Activity buckets grouped by model, descending by tokens. */
  byModel: UsageRollupEvent[];
  /**
   * The busiest sessions, descending by tokens, capped at
   * {@link TOP_SESSIONS_MAX}. Each is a bare {@link UsageSessionEvent} — id +
   * project + persona + model + activity counters ONLY, never a preview.
   */
  topSessions: UsageSessionEvent[];
}

/** How many sessions the "top sessions" list surfaces (privacy cap + UI cap —
 *  the list is a leaderboard, not an audit log). */
export const TOP_SESSIONS_MAX = 10;

/**
 * Fold a flat list of per-session events into the dashboard's {@link UsageSummary}
 * — totals, by-project + by-model rollups, and the top-N busiest sessions.
 * Pure (clock injected via `generatedAt`); the privacy guarantee is inherited
 * from the input events, which carry no UGC. Rollup buckets are sorted by token
 * total desc (then label asc for a stable tie-break); topSessions by tokens desc.
 */
export function aggregateUsage(
  sessions: UsageSessionEvent[],
  generatedAt: number,
  topN: number = TOP_SESSIONS_MAX
): UsageSummary {
  let totalTokens = 0;
  let totalPromptCount = 0;
  let totalToolCalls = 0;
  let totalMcpCalls = 0;

  // dimension → label → accumulating bucket.
  const projectBuckets = new Map<string, UsageRollupEvent>();
  const modelBuckets = new Map<string, UsageRollupEvent>();

  const bump = (
    buckets: Map<string, UsageRollupEvent>,
    dimension: UsageRollupEvent['dimension'],
    label: string,
    tokens: number,
    prompts: number,
    tools: number,
    mcp: number
  ) => {
    const existing = buckets.get(label);
    if (existing) {
      existing.totalTokens += tokens;
      existing.promptCount += prompts;
      existing.toolCalls += tools;
      existing.mcpCalls += mcp;
      existing.sessionCount += 1;
    } else {
      buckets.set(label, {
        kind: 'usage.rollup',
        dimension,
        label,
        totalTokens: tokens,
        promptCount: prompts,
        toolCalls: tools,
        mcpCalls: mcp,
        sessionCount: 1
      });
    }
  };

  for (const s of sessions) {
    const tokens = s.totalTokens ?? 0;
    const prompts = s.promptCount ?? 0;
    const tools = s.toolCalls ?? 0;
    const mcp = s.mcpCalls ?? 0;
    totalTokens += tokens;
    totalPromptCount += prompts;
    totalToolCalls += tools;
    totalMcpCalls += mcp;
    bump(projectBuckets, 'project', s.projectName, tokens, prompts, tools, mcp);
    bump(modelBuckets, 'model', s.model ?? 'unknown', tokens, prompts, tools, mcp);
  }

  // tokens desc, then label asc — deterministic without a clock or random.
  const byTokensThenLabel = (a: UsageRollupEvent, b: UsageRollupEvent) =>
    b.totalTokens - a.totalTokens || a.label.localeCompare(b.label);

  const topSessions = [...sessions]
    .sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0) || a.sessionId.localeCompare(b.sessionId))
    .slice(0, Math.max(0, topN));

  return {
    generatedAt,
    sessionCount: sessions.length,
    totalTokens,
    totalPromptCount,
    totalToolCalls,
    totalMcpCalls,
    byProject: [...projectBuckets.values()].sort(byTokensThenLabel),
    byModel: [...modelBuckets.values()].sort(byTokensThenLabel),
    topSessions
  };
}
