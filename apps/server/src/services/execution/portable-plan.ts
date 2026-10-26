import type { ExecutionWorkUnitInput } from './store.js';

/**
 * Deterministic parser for the portable-executable Markdown plan format so a
 * "Plan provided in goal" Team launch can seed work units BEFORE launch instead
 * of forcing the coordinator model to derive the DAG at runtime (the observed
 * 30s–5min stall). The grammar mirrors the authoring contract documented in
 * portable execution plans: each machine-executable step is an H3 heading
 * carrying an `<!-- executable-step -->` marker, whose text is
 * `<stable-kebab-id>: <Title>`, followed by fixed bullet labels
 * (Depends on, Execution class, Required role, Mode, Read scope, Write scope, Excludes, Work,
 * Verification, Completion criteria, Stop conditions, Outputs / handoff).
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

/**
 * `normalizations` describes every repair (for logs and correction prose);
 * `idRenames` is the structured subset agents need to address units by their
 * registered ids. Both are omitted when empty.
 */
export type PortablePlanParse =
  | { ok: true; units: ExecutionWorkUnitInput[]; normalizations?: string[]; idRenames?: PortablePlanIdRename[] }
  | { ok: false; reason: string };

type StepParse =
  | { ok: true; unit: ExecutionWorkUnitInput; rawId: string; normalizations: string[] }
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
    if (knownOrNearMiss && indent <= labelIndent) return { key, rest: plainBullet[2], indent };
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
  'verification', 'completion criteria', 'stop conditions', 'outputs / handoff', 'requires'
] as const;

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
 * executable step. Keep invalid-plan callers on this grammar so they cannot
 * silently fall back to inferred planning for marker spelling variants.
 */
export function hasPortablePlanStep(text: string): boolean {
  return text.split(/\r?\n/).some(isPortablePlanStepLine);
}

function isPortablePlanStepLine(line: string): boolean {
  return HEADING.test(line) && STEP_MARKER.test(line);
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
function parseStepLabels(body: string[]): Map<string, StepLabel> {
  const labels = new Map<string, StepLabel>();
  const fence = new FenceTracker();
  let current: string | null = null;
  let currentAtLabelIndent = true;
  let buffer: string[] = [];
  let labelIndent = Number.POSITIVE_INFINITY;
  const flush = (): void => {
    if (current !== null) labels.set(current, { value: buffer.join('\n').trim(), atLabelIndent: currentAtLabelIndent });
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
  rawLabels: Map<string, StepLabel>,
  id: string,
  normalizations: string[]
): { ok: true; labels: Map<string, string> } | { ok: false; reason: string } {
  const labels = new Map<string, string>();
  const sources = new Map<string, string>();
  for (const [key, { value, atLabelIndent }] of rawLabels) {
    const intended = nearMissLabel(key);
    if (intended && !atLabelIndent) {
      return { ok: false, reason: `step ${id} has unrecognised label "${key}" (did you mean "${intended}"?)` };
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
  return { ok: true, labels };
}

type Failure = { ok: false; reason: string };

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

/** The routing level an `Execution class` pins; an unknown class fails rather than silently routing at any level. */
function parseExecutionClass(value: string | undefined, id: string): { ok: true; minimumLevel?: 'low' | 'medium' | 'high' } | Failure {
  // Coordinators write sentence-style values (`Routine.`); only the first line
  // names the class, so continuation prose beneath it cannot fail the lookup.
  const raw = stripSentencePeriod((value ?? '').split('\n')[0]);
  const executionClass = raw.toLowerCase();
  if (!executionClass) return { ok: true };
  const builtinWorkerLevel = /^builtin:squad-worker-(low|medium|high)$/.exec(executionClass)?.[1] as 'low' | 'medium' | 'high' | undefined;
  if (!Object.hasOwn(EXECUTION_CLASS_LEVEL, executionClass) && !builtinWorkerLevel) {
    return { ok: false, reason: `step ${id}: could not pin minimumLevel for execution class "${raw}" (expected Routine, Standard, or Expert)` };
  }
  return { ok: true, minimumLevel: builtinWorkerLevel ?? EXECUTION_CLASS_LEVEL[executionClass] };
}

/** Map one executable-step block onto a work unit, or explain why it is invalid. */
function parseStep(block: PlanStepBlock): StepParse {
  const normalizations: string[] = [];
  const heading = parseStepHeading(block.heading, normalizations);
  if (!heading.ok) return heading;
  const { rawId, id, title } = heading;

  const canonical = canonicalizeLabels(parseStepLabels(block.body), id, normalizations);
  if (!canonical.ok) return canonical;
  const labels = canonical.labels;

  const task = labels.get('work');
  if (!task) return { ok: false, reason: `step ${id} missing Work` };
  const dependencies = parseDependencies(labels.get('depends on'), id, normalizations);
  const executionClass = parseExecutionClass(labels.get('execution class'), id);
  if (!executionClass.ok) return executionClass;
  const parsedRequires = parseRequires(labels.get('requires') ?? '', id);
  if (!parsedRequires.ok) return parsedRequires;
  return { ok: true, rawId, normalizations, unit: buildWorkUnit(id, title, task, dependencies, labels, executionClass.minimumLevel, parsedRequires.requires) };
}

function buildWorkUnit(
  id: string,
  title: string,
  task: string,
  dependencies: string[],
  labels: Map<string, string>,
  minimumLevel: 'low' | 'medium' | 'high' | undefined,
  requires: ExecutionWorkUnitInput['requires'] | undefined
): ExecutionWorkUnitInput {
  const files = parseList(labels.get('write scope') ?? 'None');
  const verificationText = labels.get('verification');
  const readOnly = /read[-\s]?only/i.test(labels.get('mode') ?? '');
  const requiredRole = stripBackticks(labels.get('required role') ?? '');
  return {
    id,
    title,
    task,
    dependencies,
    ...(files.length ? { files } : {}),
    ...(verificationText ? { verification: [verificationText] } : {}),
    ...(readOnly ? { readOnly: true } : {}),
    ...(minimumLevel || requiredRole
      ? { routing: { version: 1, ...(minimumLevel ? { minimumLevel } : {}), ...(requiredRole ? { requiredRole } : {}) } }
      : {}),
    ...(requires ? { requires } : {})
  };
}

export function parsePortablePlan(text: string): PortablePlanParse {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty plan text' };
  const lines = text.split(/\r?\n/);

  // Collect (headingLine, bodyLines) blocks for every executable-step H3.
  const blocks: Array<{ heading: string; body: string[] }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = HEADING.exec(lines[i]);
    if (!headingMatch || !isPortablePlanStepLine(lines[i])) continue;
    const body: string[] = [];
    let j = i + 1;
    // Track fenced-code state while collecting so a `#`-prefixed line INSIDE a
    // code block (e.g. a shell/BUILD comment) is not mistaken for the next
    // heading. Without this the step block truncates mid-fence and drops every
    // label after the code (Verification, Completion criteria, …), which then
    // fails DAG completeness even though the plan is well-formed.
    const fence = new FenceTracker();
    for (; j < lines.length; j += 1) {
      const inFence = fence.step(lines[j]);
      if (!inFence && SECTION_BREAK.test(lines[j])) break;
      body.push(lines[j]);
    }
    if (fence.open) {
      return { ok: false, reason: `step contains an unterminated code fence: ${stripInlineComment(headingMatch[1])}` };
    }
    blocks.push({ heading: headingMatch[1], body });
    i = j - 1;
  }
  if (!blocks.length) return { ok: false, reason: 'no executable steps found' };

  const units: ExecutionWorkUnitInput[] = [];
  const normalizations: string[] = [];
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
    normalizations.push(...parsed.normalizations);
    if (parsed.rawId !== id) idRenames.push({ from: parsed.rawId, to: id });
  }

  return {
    ok: true,
    units,
    ...(normalizations.length ? { normalizations } : {}),
    ...(idRenames.length ? { idRenames } : {})
  };
}
