import type { ExecutionWorkUnitInput, WorkUnitLoopV1 } from './store.js';
import { LOOP_MAX_ROUNDS, LOOP_MIN_ROUNDS, LOOP_RANGE_TEXT } from './loop-constants.js';
import { RETRY_CEILING } from './retry-feedback.js';

/**
 * Deterministic parser for the portable-executable Markdown plan format so a
 * "Plan provided in goal" Team launch can seed work units BEFORE launch instead
 * of forcing the coordinator model to derive the DAG at runtime (the observed
 * 30s–5min stall). The grammar mirrors the authoring contract documented in
 * portable execution plans: each machine-executable step is an H3 heading
 * carrying an `<!-- executable-step -->` marker, whose text is
 * `<stable-kebab-id>: <Title>`, followed by fixed bullet labels
 * (Depends on, Execution class, Required role, Prefer role, Not same worker as, Mode,
 * Read scope, Write scope, Excludes, Work, Verification, Completion criteria,
 * Stop conditions, Outputs / handoff, Requires, On failure, Loop).
 *
 * Routing labels: `Required role: a, b` is a hard AND list kept verbatim in
 * `routing.requiredRole` (split on commas at match time only). `Prefer role: a, b`
 * is a soft ranking list (`routing.preferRoles`). `Not same worker as: step-a`
 * is a hard anti-affinity list (`routing.excludeSameWorkerAs`); every reference
 * must be a dependency ancestor. `Execution class` is a floor. `## Launch` may
 * carry `Squad: <id>` (an advisory declaration returned as `declaredSquad`).
 * These fields are omitted when absent, so the launch digest of a plan that
 * uses none of them is unchanged.
 *
 * Intake: an explicit ```squad-plan fenced block is the plan, taken verbatim.
 * Otherwise formatting deviations (Stop conditions, free-text Completion
 * criteria, a bare tier name as Execution class, nested near-miss labels of
 * non-safety labels, steps without the `executable-step` marker under
 * `## Execution Plan`) are normalized and reported as warnings, never rejected.
 * Substantive defects and near-misses of safety-bearing labels still reject.
 *
 * This is intentionally a raw structural parser only: it maps recognised labels
 * onto `ExecutionWorkUnitInput` and leaves DAG/cycle/completeness validation to
 * `normalizeExecutionPlan`. A plan that is absent, unmarked, or malformed yields
 * `{ ok: false }` so the caller can fall back to coordinator-derived planning.
 *
 * Defects are either recoverable or substantive. A recoverable defect has one
 * deterministic repair (a non-kebab step id, a near-miss label spelling), so it
 * is normalized in place and described in `normalizations`. Re-parsing the same
 * text always yields the same units, so the launch digest stays stable between
 * offer and approval. Every `{ ok: false }` result is substantive: the plan
 * cannot be repaired without guessing the author's intent.
 */

/** A step id the parser rewrote to its canonical kebab form. */
export interface PortablePlanIdRename {
  from: string;
  to: string;
}

/** Bump when parser output for the same text can change. Stored on offer records, never mixed into the launch digest. */
export const PARSER_VERSION = 1;

/** `repair`: formatting fixed, no semantic change. `warning`: kept, reader should look. `blocking`: unsafe or incomplete. */
export interface PortablePlanFinding {
  severity: 'repair' | 'warning' | 'blocking';
  requirement: 'format' | 'plan' | 'tier' | 'not-same-worker' | 'squad';
  stepId?: string;
  message: string;
}

export interface LaunchDeclarations {
  /** Advisory `Squad: <id>`; an explicit launch target wins. Not part of the launch options. */
  declaredSquad?: string;
  worktree?: boolean;
  onComplete?: 'leave' | 'merge' | 'delete';
  push?: boolean;
  failurePolicyDefault?: 'fail-run';
  checks?: readonly string[];
}

export type PortablePlanFailurePolicy =
  | { kind: 'fail-run' }
  | { kind: 'retry'; stepId: string; maxRetries: number; maxIterations?: number; noProgressLimit?: number };

export interface PortablePlanWorkUnitInput extends ExecutionWorkUnitInput {
  onFailure?: PortablePlanFailurePolicy;
  checks?: readonly string[];
}

export type LaunchSectionParse = { ok: true; launch: LaunchDeclarations } | { ok: false; reason: string };

/**
 * `normalizations` describes every repair (for logs and correction prose);
 * `idRenames` is the structured subset agents need to address units by their
 * registered ids. Both are omitted when empty.
 */
export type PortablePlanParse =
  | {
    ok: true; parserVersion: number; units: PortablePlanWorkUnitInput[]; launch?: LaunchDeclarations; declaredSquad?: string;
    normalizations?: string[]; idRenames?: PortablePlanIdRename[]; findings?: PortablePlanFinding[];
  }
  | { ok: false; reason: string; parserVersion: number; findings: PortablePlanFinding[] };

type StepParse =
  | { ok: true; unit: PortablePlanWorkUnitInput; rawId: string; normalizations: string[]; warnings: string[] }
  | { ok: false; reason: string };

const STEP_MARKER = /<!--\s*executable-step\s*-->/i;
const HEADING = /^\s*###\s+(.*)$/;
const SECTION_BREAK = /^\s*(#{1,3})\s+/; // next H1/H2/H3 ends a step block
// Three shapes count as a field LABEL:
//   (a) BULLET_LABEL — a leading list marker + space at any indent (`- **Work:**`,
//       `  - **Work:**`).
//   (b) PLAIN_BULLET_LABEL — a renderer-safe Markdown-stripped list label
//       (`- Work:`). The Team composer stores this form in launch requests.
//   (c) BARE_LABEL — an UNINDENTED, non-bulleted top-level `**Work:**`. The prior
//       grammar accepted this and real/persisted plans still use it (e.g.
//       `**Work:** inspect only`); requiring a marker regressed those to
//       "missing Work" and collapsed the whole plan to coordinator-derive.
// An INDENTED `**...:**` with no list marker (`  **Purpose / why:**`) is NOT a
// label: it is an inner sub-bold on a continuation line, folded into the current
// label's multi-line value. Same for a `**bold**` inside prose (no `:` inside).
const BULLET_LABEL = /^\s*[-*]\s+\*\*([^:*]+):\*\*\s*(.*)$/;
const PLAIN_BULLET_LABEL = /^\s*[-*]\s+([A-Za-z][A-Za-z /-]*):\s*(.*)$/;
const BARE_LABEL = /^\*\*([^:*]+):\*\*\s*(.*)$/;
const FENCE = /^\s*(```|~~~)/; // fenced-code delimiter: freeze label detection inside

function indentOf(raw: string): number {
  return raw.length - raw.trimStart().length;
}

/**
 * Match a field-label line from Markdown or composer-normalized plain text.
 * A plain (non-bold) bullet is a label only when its key is a known label (or a
 * near-miss spelling, so typos still fold onto their label) AND it sits at the label indent
 * (`labelIndent`, the indent of the first label in the block). Anything else
 * (`  - Run tests: x` under `**Work:**`, a nested `  - Works: x`) is
 * continuation text of the current label.
 */
function matchLabel(raw: string, labelIndent: number): { key: string; rest: string; indent: number } | null {
  const indent = indentOf(raw);
  const bullet = BULLET_LABEL.exec(raw);
  if (bullet) return { key: bullet[1].trim().toLowerCase(), rest: bullet[2], indent };
  const plainBullet = PLAIN_BULLET_LABEL.exec(raw);
  if (plainBullet) {
    const key = plainBullet[1].trim().toLowerCase();
    const normalized = key.replace(/\s+/g, ' ');
    const knownOrNearMiss = (KNOWN_LABELS as readonly string[]).includes(normalized) || nearMissLabel(key) !== undefined;
    // A plain `- Loop:` line is a label only when its first line is a real loop declaration,
    // so older Work text that merely starts a bullet with "Loop:" stays Work text.
    const loopText = isLoopKey(normalized) && !LOOP_GRAMMAR.test(plainBullet[2]);
    if (knownOrNearMiss && !loopText && indent <= labelIndent) return { key, rest: plainBullet[2], indent };
    return null;
  }
  const bare = BARE_LABEL.exec(raw);
  if (bare) return { key: bare[1].trim().toLowerCase(), rest: bare[2], indent };
  return null;
}

/**
 * Tracks fenced-code regions so label/heading detection can be frozen inside a
 * code block. A fence is closed ONLY by the delimiter that opened it (``` closes
 * ```, ~~~ closes ~~~), so a body mixing the two — a ~~~ line inside a ```-opened
 * fence, or ``` for code and ~~~ elsewhere — cannot spuriously toggle the state.
 * `step(line)` consumes one line and returns the fence state AFTER it, matching
 * the prior `inFence = !inFence` timing where the delimiter line itself is part
 * of the toggle.
 */
class FenceTracker {
  private marker: '```' | '~~~' | null = null;
  get open(): boolean { return this.marker !== null; }
  step(line: string): boolean {
    const match = FENCE.exec(line);
    if (match) {
      const delim = match[1] as '```' | '~~~';
      if (this.marker === null) this.marker = delim;
      else if (this.marker === delim) this.marker = null;
      // A non-matching delimiter while a fence is open is body text: ignore it.
    }
    return this.marker !== null;
  }
}

const EXECUTION_CLASS_LEVEL: Record<string, 'low' | 'medium' | 'high'> = {
  routine: 'low',
  standard: 'medium',
  expert: 'high'
};

const STEP_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Canonical kebab form of a step id or dependency reference (`U1` → `u1`,
 * `Home Step` → `home-step`). Idempotent and the identity on ids that already
 * match STEP_ID, so plans that were valid before keep their exact ids. Ids and
 * `Depends on` entries must share this function or the DAG check would see
 * dangling dependencies.
 */
export function normalizeStepId(raw: string): string {
  if (STEP_ID.test(raw)) return raw;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripInlineComment(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function stripBackticks(value: string): string {
  return value.replace(/`/g, '').trim();
}

/** A trailing sentence period ("None.", "`a`.") is prose, not part of the value. */
function stripSentencePeriod(value: string): string {
  return stripBackticks(value).replace(/\.$/, '').trim();
}

/** `None` (case-insensitive, possibly back-ticked) → empty; else comma-split + de-ticked. */
function parseList(value: string): string[] {
  const cleaned = stripBackticks(value);
  if (!cleaned || stripSentencePeriod(cleaned).toLowerCase() === 'none') return [];
  return stripSentencePeriod(cleaned)
    .split(',')
    .map((item) => stripSentencePeriod(item))
    .filter((item) => item && item.toLowerCase() !== 'none');
}

/** Parse `Skills: alpha, beta; MCP servers: repo` portable requirement syntax. */
function parseRequires(
  value: string,
  unitId: string
): { ok: true; requires: ExecutionWorkUnitInput['requires'] | undefined } | { ok: false; reason: string } {
  const flat = value.replace(/\s*\n\s*/g, ' ');
  if (!flat.trim() || /^none$/i.test(stripBackticks(flat))) return { ok: true, requires: undefined };
  const requires: NonNullable<ExecutionWorkUnitInput['requires']> = {};
  for (const entry of flat.split(';')) {
    const text = entry.trim();
    if (!text || /^none$/i.test(stripBackticks(text))) continue;
    const match = /^(skills|mcp\s*servers)\s*:\s*(.*)$/i.exec(text);
    if (!match) {
      return {
        ok: false,
        reason: `step ${unitId} has malformed Requires entry "${text}" (expected "Skills: a, b; MCP servers: c" or "None")`
      };
    }
    const names = parseList(match[2]);
    if (!names.length) continue;
    if (/^skills$/i.test(match[1])) requires.skills = names;
    else requires.mcpServers = names;
  }
  return { ok: true, requires: requires.skills || requires.mcpServers ? requires : undefined };
}

const KNOWN_LABELS = [
  'depends on', 'execution class', 'required role', 'mode', 'read scope', 'write scope', 'excludes', 'work',
  'verification', 'completion criteria', 'stop conditions', 'outputs / handoff', 'requires',
  'on failure', 'maxiterations', 'noprogresslimit', 'loop', 'prefer role', 'not same worker as'
] as const;

/** Labels that change what runs or who runs it; a near-miss of one is never demoted to Work text. */
const SAFETY_LABELS: ReadonlySet<string> = new Set([
  'depends on', 'execution class', 'required role', 'mode', 'read scope', 'write scope', 'excludes', 'requires',
  'on failure', 'loop', 'not same worker as', 'maxiterations', 'noprogresslimit'
]);

/** `<unit-id> until PASS, max <N>` (N in LOOP_MIN_ROUNDS..LOOP_MAX_ROUNDS); a trailing sentence period is tolerated like other label values. */
const LOOP_GRAMMAR = new RegExp(`^\\s*([a-z0-9][a-z0-9-]*)\\s+until\\s+PASS,\\s*max\\s+([${LOOP_MIN_ROUNDS}-${LOOP_MAX_ROUNDS}])\\s*\\.?\\s*$`, 'i');
const LOOP_EXPECTED = `expected "Loop: <unit-id> until PASS, max <N>" with N from ${LOOP_RANGE_TEXT}`;
const isLoopKey = (key: string): boolean => key === 'loop' || nearMissLabel(key) === 'loop';

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * The known label a near-miss spelling was probably meant to be. A misspelled
 * gating label ("Require", "Depend on", "Write scopes") would otherwise be
 * ignored and silently drop the requirement, dependency or scope it carried.
 * Only close spellings match, so unrelated labels ("Purpose / why", "Notes")
 * stay free-form. Short labels match only singular/plural variants.
 */
function nearMissLabel(key: string): string | undefined {
  const normalized = key.replace(/\s+/g, ' ').trim();
  if ((KNOWN_LABELS as readonly string[]).includes(normalized)) return undefined;
  const compact = normalized.replace(/\s/g, '');
  return KNOWN_LABELS.find((known) => {
    const knownCompact = known.replace(/\s/g, '');
    if (known.length <= 5) return compact === `${knownCompact}s` || `${compact}s` === knownCompact;
    return editDistance(compact, knownCompact) <= (known.length > 8 ? 2 : 1);
  });
}

interface PlanStepBlock {
  heading: string;
  body: string[];
}

/**
 * Whether text contains a heading the portable-plan parser will treat as an
 * executable step (marked, or marker-less under `## Execution Plan` when no step
 * is marked). Keep invalid-plan callers on this grammar so they cannot
 * silently fall back to inferred planning for marker spelling variants.
 */
export function hasPortablePlanStep(text: string): boolean {
  const extracted = extractSquadPlan(text);
  const lines = (extracted.ok ? extracted.text : text).split(/\r?\n/);
  if (lines.some(isPortablePlanStepLine)) return true;
  const found = collectBlocks(lines, markerlessStarts(lines));
  return !found.ok || found.blocks.length > 0;
}

function isPortablePlanStepLine(line: string): boolean {
  return HEADING.test(line) && STEP_MARKER.test(line);
}

const SQUAD_PLAN_OPEN = /^\s*(```|~~~)\s*squad-plan\s*$/i;

/** The body of the first explicit ```squad-plan fenced block, taken verbatim; the text itself when there is none. */
function extractSquadPlan(text: string): { ok: true; text: string; blocks: number } | Failure {
  const lines = text.split(/\r?\n/);
  let delimiter: string | undefined;
  let inner: string[] = [];
  let first: string[] | undefined;
  let blocks = 0;
  for (const line of lines) {
    if (delimiter === undefined) {
      const open = SQUAD_PLAN_OPEN.exec(line);
      if (open) { delimiter = open[1]; inner = []; }
    } else if (line.trim() === delimiter) {
      blocks += 1;
      first ??= inner;
      delimiter = undefined;
    } else {
      inner.push(line);
    }
  }
  if (delimiter !== undefined) return { ok: false, reason: 'squad-plan block is not closed (missing closing code fence)' };
  return { ok: true, text: first ? first.join('\n') : text, blocks };
}

/** Line indexes of `id: Title` H3 headings under `## Execution Plan`, outside code fences. */
function markerlessStarts(lines: readonly string[]): Set<number> {
  const starts = new Set<number>();
  const fence = new FenceTracker();
  let inPlan = false;
  lines.forEach((line, index) => {
    const wasOpen = fence.open;
    if (fence.step(line) || wasOpen) return;
    const section = /^\s*(#{1,2})\s+(.*?)\s*$/.exec(line);
    if (section) {
      inPlan = section[1] === '##' && stripInlineComment(section[2]).toLowerCase() === 'execution plan';
      return;
    }
    const heading = HEADING.exec(line);
    if (inPlan && heading && /^[A-Za-z0-9][A-Za-z0-9_-]*\s*:\s*\S/.test(stripInlineComment(heading[1]))) starts.add(index);
  });
  return starts;
}

type BlockCollection = { ok: true; blocks: PlanStepBlock[] } | Failure;

/** Step blocks starting at the given heading lines; a block ends at the next heading outside a code fence. */
function collectBlocks(lines: readonly string[], starts: ReadonlySet<number> | undefined): BlockCollection {
  const blocks: PlanStepBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = HEADING.exec(lines[i]);
    if (!headingMatch || !(starts ? starts.has(i) : isPortablePlanStepLine(lines[i]))) continue;
    const body: string[] = [];
    let j = i + 1;
    // Track fenced-code state while collecting so a `#`-prefixed line INSIDE a
    // code block (e.g. a shell/BUILD comment) is not mistaken for the next
    // heading. Without this the step block truncates mid-fence and drops every
    // label after the code (Verification, Completion criteria, ...), which then
    // fails DAG completeness even though the plan is well-formed.
    const fence = new FenceTracker();
    for (; j < lines.length; j += 1) {
      const inFence = fence.step(lines[j]);
      if (!inFence && SECTION_BREAK.test(lines[j])) break;
      body.push(lines[j]);
    }
    // A marker-less candidate counts only when it carries a Work label.
    const isStep = !starts || parseStepLabels(body).some(([key]) => key === 'work' || nearMissLabel(key) === 'work');
    if (isStep && fence.open) {
      return { ok: false, reason: `step contains an unterminated code fence: ${stripInlineComment(headingMatch[1])}` };
    }
    if (isStep) blocks.push({ heading: headingMatch[1], body });
    i = j - 1;
  }
  return { ok: true, blocks };
}

interface StepLabel {
  value: string;
  /** False when the label line sat deeper than the step's label indent (a nested bullet). */
  atLabelIndent: boolean;
}

/**
 * Accumulate MULTI-LINE label values from a step body. A label line opens a
 * value; every following non-label line (continuation prose, indented sub-bold,
 * fenced code) extends it until the next label or the body ends. This is why a
 * real plan's `- **Work:**` with the body on the lines beneath it parses (the
 * old single-line grammar read the empty inline remainder and rejected the step
 * as "missing Work", collapsing the whole plan to the coordinator-derive path).
 * Label detection is frozen inside fenced code (mixed-delimiter safe).
 */
function parseStepLabels(body: string[]): Array<[string, StepLabel]> {
  const labels: Array<[string, StepLabel]> = [];
  const fence = new FenceTracker();
  let current: string | null = null;
  let currentAtLabelIndent = true;
  let buffer: string[] = [];
  let labelIndent = Number.POSITIVE_INFINITY;
  const flush = (): void => {
    if (current !== null) labels.push([current, { value: buffer.join('\n').trim(), atLabelIndent: currentAtLabelIndent }]);
    current = null;
    buffer = [];
  };
  for (const raw of body) {
    const inFence = fence.step(raw);
    const label = inFence ? null : matchLabel(raw, labelIndent);
    if (label) {
      if (labelIndent === Number.POSITIVE_INFINITY) labelIndent = label.indent;
      flush();
      current = label.key;
      currentAtLabelIndent = label.indent <= labelIndent;
      buffer = [label.rest];
    } else if (current !== null) {
      buffer.push(raw);
    }
  }
  flush();
  return labels;
}

/**
 * Fold near-miss label spellings onto their canonical label so the value they
 * carry (a dependency, a scope, a requirement) is kept rather than dropped. A
 * step that supplies the same canonical label twice is ambiguous and fails.
 * Only a near-miss at the step's label indent folds: a nested bold bullet
 * (`  - **Completion criterion:** x` under `- **Work:**`) has already ended the
 * enclosing label's value, so folding it would silently truncate that value.
 */
function canonicalizeLabels(
  rawLabels: Array<[string, StepLabel]>,
  id: string,
  normalizations: string[],
  warnings: string[]
): { ok: true; labels: Map<string, string>; context: string[] } | { ok: false; reason: string } {
  const labels = new Map<string, string>();
  const sources = new Map<string, string>();
  const context: string[] = [];
  for (const [key, { value, atLabelIndent }] of rawLabels) {
    const intended = nearMissLabel(key);
    if (isLoopKey(key) && !atLabelIndent) {
      return { ok: false, reason: `step ${id} has a nested Loop label (${LOOP_EXPECTED})` };
    }
    if (intended && !atLabelIndent) {
      if (SAFETY_LABELS.has(intended)) {
        return { ok: false, reason: `step ${id} has unrecognised label "${key}" (did you mean "${intended}"?)` };
      }
      // A nested near-miss of a non-safety label keeps its text as Work context.
      if (value.trim()) context.push(`${key.toLowerCase()}: ${value.trim()}`);
      warnings.push(`step ${id} nested label "${key}" kept as Work text`);
      continue;
    }
    const canonical = intended ?? key;
    const prior = sources.get(canonical);
    if (prior !== undefined) {
      return { ok: false, reason: `step ${id} has conflicting labels "${prior}" and "${key}" (both read as "${canonical}")` };
    }
    sources.set(canonical, key);
    labels.set(canonical, value);
    if (intended) normalizations.push(`step ${id} label "${key}" treated as "${intended}"`);
  }
  return { ok: true, labels, context };
}

type Failure = { ok: false; reason: string };

function parseCheckReferences(value: string, subject: string): { ok: true; checks: string[] } | Failure {
  const items = value.split(',').map((item) => item.trim());
  if (!items.every((item) => /^check:[A-Za-z_][A-Za-z0-9_-]*$/.test(item))) {
    return { ok: false, reason: `${subject} requires comma-separated check:<name> references, not free text or commands` };
  }
  const checks = items.map((item) => item.slice('check:'.length));
  if (new Set(checks).size !== checks.length) return { ok: false, reason: `${subject} has duplicate check:<name> references` };
  return { ok: true, checks };
}

export function parseLaunchSection(text: string): LaunchSectionParse {
  const launch: LaunchDeclarations = {};
  const fence = new FenceTracker();
  const seen = new Set<string>();
  let active = false;
  let found = false;
  for (const raw of text.split(/\r?\n/)) {
    if (active && FENCE.test(raw)) return { ok: false, reason: 'Launch declarations must be fields, not fenced code' };
    if (fence.step(raw)) continue;
    const heading = /^\s*(#{1,3})\s+(.*?)\s*$/.exec(raw);
    if (heading) {
      active = heading[1] === '##' && stripInlineComment(heading[2]).toLowerCase() === 'launch';
      if (active && found) return { ok: false, reason: 'duplicate Launch section' };
      if (active) found = true;
      continue;
    }
    if (!active || !raw.trim()) continue;
    const label = BULLET_LABEL.exec(raw) ?? PLAIN_BULLET_LABEL.exec(raw) ?? BARE_LABEL.exec(raw);
    if (!label) return { ok: false, reason: `malformed Launch declaration: ${raw.trim()}` };
    const key = label[1].trim().toLowerCase();
    const value = label[2].trim();
    const field = key === 'capabilities' ? 'push' : key === 'check' ? 'checks' : key;
    if (seen.has(field)) return { ok: false, reason: `duplicate Launch declaration "${field}"` };
    seen.add(field);
    switch (key) {
      case 'worktree':
      case 'push':
        if (value !== 'true' && value !== 'false') return { ok: false, reason: `Launch ${key} must be true or false` };
        launch[key] = value === 'true';
        break;
      case 'oncomplete':
        if (value !== 'leave' && value !== 'merge' && value !== 'delete') return { ok: false, reason: 'Launch onComplete must be leave, merge, or delete' };
        launch.onComplete = value;
        break;
      case 'failurepolicydefault':
        if (value !== 'fail-run') return { ok: false, reason: 'Launch failurePolicyDefault must be fail-run' };
        launch.failurePolicyDefault = value;
        break;
      case 'capabilities':
        if (value !== 'push') return { ok: false, reason: 'Launch Capabilities admits only push' };
        launch.push = true;
        break;
      case 'squad': {
        const squad = stripBackticks(value);
        if (!squad || squad.length > 256 || /[\r\n]/.test(squad)) return { ok: false, reason: 'Launch Squad must be one Squad id' };
        launch.declaredSquad = squad;
        break;
      }
      case 'check':
      case 'checks': {
        const parsed = parseCheckReferences(value, 'Launch checks');
        if (!parsed.ok) return parsed;
        launch.checks = parsed.checks;
        break;
      }
      default: return { ok: false, reason: `unknown Launch declaration "${key}"` };
    }
  }
  return { ok: true, launch };
}

function positiveInteger(value: string): number | undefined {
  const number = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function parseFailurePolicy(labels: Map<string, string>, id: string): { ok: true; onFailure?: PortablePlanFailurePolicy } | Failure {
  const value = labels.get('on failure');
  const limits: { maxIterations?: number; noProgressLimit?: number } = {};
  for (const key of ['maxIterations', 'noProgressLimit'] as const) {
    const raw = labels.get(key.toLowerCase());
    if (raw === undefined) continue;
    const number = positiveInteger(raw);
    if (number === undefined) return { ok: false, reason: `step ${id} ${key} must be a positive safe integer` };
    limits[key] = number;
  }
  if (value === undefined || value === 'fail run') {
    if (Object.keys(limits).length) return { ok: false, reason: `step ${id} retry limits require On failure: retry <step> up to N with feedback` };
    return { ok: true, ...(value === undefined ? {} : { onFailure: { kind: 'fail-run' } }) };
  }
  const match = /^retry (.+?) up to (\d+) with feedback$/.exec(value);
  const stepId = match ? normalizeStepId(stripBackticks(match[1])) : '';
  const maxRetries = match ? positiveInteger(match[2]) : undefined;
  if (!STEP_ID.test(stepId) || maxRetries === undefined || maxRetries > RETRY_CEILING) {
    return { ok: false, reason: `step ${id} On failure must be "fail run" or "retry <step> up to N with feedback" with a positive safe integer cap of at most ${RETRY_CEILING}` };
  }
  return { ok: true, onFailure: { kind: 'retry', stepId, maxRetries, ...limits } };
}

/** `id: title` from a step heading, with the id normalized (a rename is noted). */
function parseStepHeading(
  heading: string,
  normalizations: string[]
): { ok: true; rawId: string; id: string; title: string } | Failure {
  const headingText = stripInlineComment(heading);
  const colon = headingText.indexOf(':');
  if (colon <= 0) return { ok: false, reason: `step heading missing "id: title": ${headingText}` };
  const rawId = headingText.slice(0, colon).trim();
  const title = headingText.slice(colon + 1).trim();
  const id = normalizeStepId(rawId);
  if (!STEP_ID.test(id)) return { ok: false, reason: `invalid step id: ${rawId}` };
  if (id !== rawId) normalizations.push(`step "${rawId}" id normalized to "${id}"`);
  if (!title) return { ok: false, reason: `step ${id} missing title` };
  return { ok: true, rawId, id, title };
}

/** `Depends on` references, each normalized like a step id when that makes it valid. */
function parseDependencies(value: string | undefined, id: string, normalizations: string[]): string[] {
  return parseList(value ?? 'None').map((reference) => {
    const normalized = normalizeStepId(reference);
    // An unrepairable reference stays as written; the DAG check names it missing.
    if (normalized === reference || !STEP_ID.test(normalized)) return reference;
    normalizations.push(`step ${id} dependency "${reference}" normalized to "${normalized}"`);
    return normalized;
  });
}

const TIER_NAME: Record<'low' | 'medium' | 'high', string> = { low: 'Routine', medium: 'Standard', high: 'Expert' };

/** The routing level an `Execution class` pins; an unknown class fails rather than silently routing at any level. */
function parseExecutionClass(
  value: string | undefined,
  id: string
): { ok: true; minimumLevel?: 'low' | 'medium' | 'high'; warning?: string } | Failure {
  // Coordinators write sentence-style values (`Routine.`); only the first line
  // names the class, so continuation prose beneath it cannot fail the lookup.
  const raw = stripSentencePeriod((value ?? '').split('\n')[0]);
  const executionClass = raw.toLowerCase();
  if (!executionClass) return { ok: true };
  if (Object.hasOwn(EXECUTION_CLASS_LEVEL, executionClass)) return { ok: true, minimumLevel: EXECUTION_CLASS_LEVEL[executionClass] };
  const tier = /^(?:builtin:squad-worker-)?(low|medium|high)$/.exec(executionClass)?.[1] as 'low' | 'medium' | 'high' | undefined;
  if (!tier) {
    return { ok: false, reason: `step ${id}: could not pin minimumLevel for execution class "${raw}" (expected Routine, Standard, or Expert)` };
  }
  return {
    ok: true,
    minimumLevel: tier,
    warning: `step ${id} Execution class "${raw}" read as ${TIER_NAME[tier]} (a minimum tier; use Routine, Standard, or Expert)`
  };
}

/** Map one executable-step block onto a work unit, or explain why it is invalid. */
function parseStep(block: PlanStepBlock): StepParse {
  const normalizations: string[] = [];
  const warnings: string[] = [];
  const heading = parseStepHeading(block.heading, normalizations);
  if (!heading.ok) return heading;
  const { rawId, id, title } = heading;

  const canonical = canonicalizeLabels(parseStepLabels(block.body), id, normalizations, warnings);
  if (!canonical.ok) return canonical;
  const labels = canonical.labels;

  const baseTask = labels.get('work');
  if (!baseTask) return { ok: false, reason: `step ${id} missing Work` };
  const dependencies = parseDependencies(labels.get('depends on'), id, normalizations);
  const executionClass = parseExecutionClass(labels.get('execution class'), id);
  if (!executionClass.ok) return executionClass;
  if (executionClass.warning) warnings.push(executionClass.warning);
  const parsedRequires = parseRequires(labels.get('requires') ?? '', id);
  if (!parsedRequires.ok) return parsedRequires;
  const failure = parseFailurePolicy(labels, id);
  if (!failure.ok) return failure;
  const extraWork = [...canonical.context];
  const stopConditions = labels.get('stop conditions')?.trim();
  if (stopConditions) {
    extraWork.push(`Stop conditions (guidance, not enforced): ${stopConditions}`);
    warnings.push(`step ${id} Stop conditions kept as guidance in Work; they are not enforced (use On failure)`);
  }
  const task = extraWork.length ? `${baseTask}\n\n${extraWork.join('\n\n')}` : baseTask;
  const completion = parseCompletion(labels.get('completion criteria'), id);
  if (!completion.ok) return completion;
  if (completion.freeText) warnings.push(`step ${id} Completion criteria is free text; moved into Verification (not a deterministic check)`);
  const parsedLoop = parseLoopLabel(labels.get('loop'), id);
  if (!parsedLoop.ok) return parsedLoop;
  const preferRoles = parseList(labels.get('prefer role') ?? '');
  const excluded = parseList(labels.get('not same worker as') ?? '').map((reference) => normalizeStepId(reference) || reference);
  return { ok: true, rawId, normalizations, warnings, unit: {
    ...buildWorkUnit(id, title, task, dependencies, labels, executionClass.minimumLevel, parsedRequires.requires, {
      verification: completion.freeText ? [completion.freeText] : undefined,
      preferRoles: preferRoles.length ? [...new Set(preferRoles)] : undefined,
      excludeSameWorkerAs: excluded.length ? [...new Set(excluded)] : undefined
    }),
    ...(failure.onFailure ? { onFailure: failure.onFailure } : {}),
    ...(completion.checks ? { checks: completion.checks } : {}),
    ...(parsedLoop.loop ? { loop: parsedLoop.loop } : {})
  } };
}

/**
 * A pure comma list of `check:<name>` entries stays deterministic (duplicates are
 * still rejected). Anything else is prose: it moves into Verification. An empty
 * value or "None" is dropped.
 */
function parseCompletion(
  value: string | undefined,
  id: string
): { ok: true; checks?: string[]; freeText?: string } | Failure {
  const text = value?.trim();
  if (!text || /^none\.?$/i.test(stripBackticks(text))) return { ok: true };
  const items = text.split(',').map((item) => item.trim());
  if (items.every((item) => /^check:[A-Za-z_][A-Za-z0-9_-]*$/.test(item))) {
    const parsed = parseCheckReferences(text, `step ${id} Completion criteria`);
    return parsed.ok ? { ok: true, checks: parsed.checks } : parsed;
  }
  return { ok: true, freeText: `Completion criteria: ${text}` };
}

/** Parse a `Loop:` label value (`<unit-id> until PASS, max <N>`); an absent label gives no loop (#583). */
export function parseLoopLabel(value: string | undefined, unitId: string): { ok: true; loop?: WorkUnitLoopV1 } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true };
  const match = LOOP_GRAMMAR.exec(value.split('\n')[0]);
  if (!match) return { ok: false, reason: `step ${unitId} has an invalid Loop label (${LOOP_EXPECTED})` };
  return { ok: true, loop: { version: 1, fixUnitId: normalizeStepId(match[1]), until: 'PASS', max: Number(match[2]) } };
}

function buildWorkUnit(
  id: string,
  title: string,
  task: string,
  dependencies: string[],
  labels: Map<string, string>,
  minimumLevel: 'low' | 'medium' | 'high' | undefined,
  requires: ExecutionWorkUnitInput['requires'] | undefined,
  extra: { verification?: string[]; preferRoles?: string[]; excludeSameWorkerAs?: string[] } = {}
): ExecutionWorkUnitInput {
  const files = parseList(labels.get('write scope') ?? 'None');
  const verificationText = labels.get('verification');
  const verification = [...(verificationText ? [verificationText] : []), ...(extra.verification ?? [])];
  const readOnly = /read[-\s]?only/i.test(labels.get('mode') ?? '');
  const requiredRole = stripBackticks(labels.get('required role') ?? '');
  return {
    id,
    title,
    task,
    dependencies,
    ...(files.length ? { files } : {}),
    ...(verification.length ? { verification } : {}),
    ...(readOnly ? { readOnly: true } : {}),
    ...(minimumLevel || requiredRole || extra.preferRoles || extra.excludeSameWorkerAs
      ? {
        routing: {
          version: 1,
          ...(minimumLevel ? { minimumLevel } : {}),
          ...(requiredRole ? { requiredRole } : {}),
          ...(extra.preferRoles ? { preferRoles: extra.preferRoles } : {}),
          ...(extra.excludeSameWorkerAs ? { excludeSameWorkerAs: extra.excludeSameWorkerAs } : {})
        }
      }
      : {}),
    ...(requires ? { requires } : {})
  };
}

/** Every transitive dependency of `id`, tolerating cycles and dangling references. */
function ancestorsOf(id: string, dependenciesById: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(dependenciesById.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(dependenciesById.get(next) ?? []));
  }
  return seen;
}

function checkNotSameWorker(units: readonly PortablePlanWorkUnitInput[]): Failure | undefined {
  const dependenciesById = new Map(units.map((unit) => [unit.id, unit.dependencies]));
  for (const unit of units) {
    const excluded = unit.routing?.excludeSameWorkerAs;
    if (!excluded?.length) continue;
    const ancestors = ancestorsOf(unit.id, dependenciesById);
    for (const reference of excluded) {
      if (ancestors.has(reference)) continue;
      const known = dependenciesById.has(reference);
      return {
        ok: false,
        reason: `step ${unit.id} Not same worker as "${reference}" ${known ? 'is not a step it depends on (directly or through other steps)' : 'names a step that does not exist'}; list only earlier steps in its Depends on chain`
      };
    }
  }
  return undefined;
}

const NO_STEPS_REASON = 'no executable steps found';
const EMPTY_PLAN_REASON = 'empty plan text';
const STEP_HEADING_SHAPE = /^\s*###\s+[A-Za-z0-9][A-Za-z0-9_-]*\s*:\s*\S/;

/** Plain words for the blocking finding: what the parser saw and what to change. Other reasons stay as they are. */
function failureMessage(reason: string, text: string): string {
  if (reason === EMPTY_PLAN_REASON) return `${reason}. The plan is empty: paste or write the plan, with one \`### <id>: <title>\` block per step.`;
  if (reason !== NO_STEPS_REASON) return reason;
  const headings = text.split(/\r?\n/).filter((line) => STEP_HEADING_SHAPE.test(line)).length;
  if (!headings) return `${reason}. The plan has no step headings: write each step as a \`### <id>: <title>\` block with a Work line under it.`;
  return `${reason}. The plan has ${headings} step heading${headings === 1 ? '' : 's'}, but none has a Work field: add a \`- **Work:** ...\` line under each step.`;
}

function withFailureMeta(failure: { ok: false; reason: string }, text: string): Extract<PortablePlanParse, { ok: false }> {
  return { ...failure, parserVersion: PARSER_VERSION, findings: [{ severity: 'blocking', requirement: 'plan', message: failureMessage(failure.reason, text) }] };
}

export function parsePortablePlan(text: string): PortablePlanParse {
  const result = parsePlanDocument(text);
  return result.ok ? result : withFailureMeta(result, typeof text === 'string' ? text : '');
}

type DocumentParse = Extract<PortablePlanParse, { ok: true }> | Failure;

function parsePlanDocument(raw: string): DocumentParse {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: EMPTY_PLAN_REASON };
  const extracted = extractSquadPlan(raw);
  if (!extracted.ok) return extracted;
  const text = extracted.text;
  const parsedLaunch = parseLaunchSection(text);
  if (!parsedLaunch.ok) return parsedLaunch;
  const lines = text.split(/\r?\n/);

  const documentNotes: PortablePlanFinding[] = [];
  if (extracted.blocks > 1) {
    documentNotes.push({ severity: 'warning', requirement: 'format', message: `${extracted.blocks} squad-plan blocks were found; only the first was used` });
  }
  // Collect (headingLine, bodyLines) blocks for every executable-step H3.
  let collected = collectBlocks(lines, undefined);
  if (!collected.ok) return collected;
  let markerless = 0;
  if (!collected.blocks.length) {
    collected = collectBlocks(lines, markerlessStarts(lines));
    if (!collected.ok) return collected;
    markerless = collected.blocks.length;
    if (markerless) {
      documentNotes.push({
        severity: 'warning',
        requirement: 'format',
        message: `${markerless} step${markerless === 1 ? '' : 's'} had no <!-- executable-step --> marker and ${markerless === 1 ? 'was' : 'were'} read from the Execution Plan section`
      });
    }
  }
  const blocks = collected.blocks;
  if (!blocks.length) return { ok: false, reason: NO_STEPS_REASON };

  const units: PortablePlanWorkUnitInput[] = [];
  const normalizations: string[] = [];
  const findings: PortablePlanFinding[] = [];
  const idRenames: PortablePlanIdRename[] = [];
  const rawIdById = new Map<string, string>();
  for (const block of blocks) {
    const parsed = parseStep(block);
    if (!parsed.ok) return parsed;
    const { id } = parsed.unit;
    const priorRawId = rawIdById.get(id);
    // Normalization must never merge two steps into one id. Repeating an
    // already-valid id verbatim is left to the DAG check, which rejects it.
    if (priorRawId !== undefined && (priorRawId !== parsed.rawId || parsed.rawId !== id)) {
      return { ok: false, reason: `step ids "${priorRawId}" and "${parsed.rawId}" both normalize to "${id}"` };
    }
    rawIdById.set(id, parsed.rawId);
    units.push(parsed.unit);
    normalizations.push(...parsed.normalizations, ...parsed.warnings);
    findings.push(
      ...parsed.normalizations.map((message): PortablePlanFinding => ({ severity: 'repair', requirement: 'format', stepId: id, message })),
      ...parsed.warnings.map((message): PortablePlanFinding => ({ severity: 'warning', requirement: message.includes('Execution class') ? 'tier' : 'format', stepId: id, message }))
    );
    if (parsed.rawId !== id) idRenames.push({ from: parsed.rawId, to: id });
  }

  for (const unit of units) {
    if (unit.onFailure?.kind === 'retry' && !rawIdById.has(unit.onFailure.stepId)) {
      return { ok: false, reason: `step ${unit.id} On failure references unknown step "${unit.onFailure.stepId}"` };
    }
  }
  const anti = checkNotSameWorker(units);
  if (anti) return anti;

  normalizations.push(...documentNotes.map((note) => note.message));
  findings.push(...documentNotes);
  const { declaredSquad, ...launch } = parsedLaunch.launch;
  return {
    ok: true,
    parserVersion: PARSER_VERSION,
    units,
    ...(Object.keys(launch).length ? { launch } : {}),
    ...(declaredSquad ? { declaredSquad } : {}),
    ...(normalizations.length ? { normalizations } : {}),
    ...(idRenames.length ? { idRenames } : {}),
    ...(findings.length ? { findings } : {})
  };
}
