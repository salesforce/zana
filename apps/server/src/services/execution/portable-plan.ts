import type { ExecutionWorkUnitInput } from './store.js';

/**
 * Deterministic parser for the portable-executable Markdown plan format so a
 * "Plan provided in goal" Team launch can seed work units BEFORE launch instead
 * of forcing the coordinator model to derive the DAG at runtime (the observed
 * 30s–5min stall). The grammar mirrors the authoring contract documented in
 * portable execution plans: each machine-executable step is an H3 heading
 * carrying an `<!-- executable-step -->` marker, whose text is
 * `<stable-kebab-id>: <Title>`, followed by fixed bullet labels
 * (Depends on, Execution class, Mode, Read scope, Write scope, Excludes, Work,
 * Verification, Completion criteria, Stop conditions, Outputs / handoff).
 *
 * This is intentionally a raw structural parser only: it maps recognised labels
 * onto `ExecutionWorkUnitInput` and leaves DAG/cycle/completeness validation to
 * `normalizeExecutionPlan`. A plan that is absent, unmarked, or malformed yields
 * `{ ok: false }` so the caller can fall back to coordinator-derived planning.
 */

export type PortablePlanParse =
  | { ok: true; units: ExecutionWorkUnitInput[] }
  | { ok: false; reason: string };

const STEP_MARKER = /<!--\s*executable-step\s*-->/i;
const HEADING = /^\s*###\s+(.*)$/;
const SECTION_BREAK = /^\s*(#{1,3})\s+/; // next H1/H2/H3 ends a step block
// Two shapes count as a field LABEL:
//   (a) BULLET_LABEL — a leading list marker + space at any indent (`- **Work:**`,
//       `  - **Work:**`).
//   (b) BARE_LABEL — an UNINDENTED, non-bulleted top-level `**Work:**`. The prior
//       grammar accepted this and real/persisted plans still use it (e.g.
//       `**Work:** inspect only`); requiring a marker regressed those to
//       "missing Work" and collapsed the whole plan to coordinator-derive.
// An INDENTED `**...:**` with no list marker (`  **Purpose / why:**`) is NOT a
// label: it is an inner sub-bold on a continuation line, folded into the current
// label's multi-line value. Same for a `**bold**` inside prose (no `:` inside).
const BULLET_LABEL = /^\s*[-*]\s+\*\*([^:*]+):\*\*\s*(.*)$/;
const BARE_LABEL = /^\*\*([^:*]+):\*\*\s*(.*)$/;
const FENCE = /^\s*(```|~~~)/; // fenced-code delimiter: freeze label detection inside

/** Match a field-label line (bulleted at any indent, or an unindented bare label). */
function matchLabel(raw: string): { key: string; rest: string } | null {
  const bullet = BULLET_LABEL.exec(raw);
  if (bullet) return { key: bullet[1].trim().toLowerCase(), rest: bullet[2] };
  const bare = BARE_LABEL.exec(raw);
  if (bare) return { key: bare[1].trim().toLowerCase(), rest: bare[2] };
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

function stripInlineComment(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function stripBackticks(value: string): string {
  return value.replace(/`/g, '').trim();
}

/** `None` (case-insensitive, possibly back-ticked) → empty; else comma-split + de-ticked. */
function parseList(value: string): string[] {
  const cleaned = stripBackticks(value);
  if (!cleaned || cleaned.toLowerCase() === 'none') return [];
  return cleaned
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== 'none');
}

interface PlanStepBlock {
  heading: string;
  body: string[];
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
function parseStepLabels(body: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const fence = new FenceTracker();
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (current !== null) labels.set(current, buffer.join('\n').trim());
    current = null;
    buffer = [];
  };
  for (const raw of body) {
    const inFence = fence.step(raw);
    const label = inFence ? null : matchLabel(raw);
    if (label) {
      flush();
      current = label.key;
      buffer = [label.rest];
    } else if (current !== null) {
      buffer.push(raw);
    }
  }
  flush();
  return labels;
}

/** Map one executable-step block onto a work unit, or explain why it is invalid. */
function parseStep(block: PlanStepBlock): { ok: true; unit: ExecutionWorkUnitInput } | { ok: false; reason: string } {
  const headingText = stripInlineComment(block.heading);
  const colon = headingText.indexOf(':');
  if (colon <= 0) return { ok: false, reason: `step heading missing "id: title": ${headingText}` };
  const id = headingText.slice(0, colon).trim();
  const title = headingText.slice(colon + 1).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { ok: false, reason: `invalid step id: ${id}` };
  if (!title) return { ok: false, reason: `step ${id} missing title` };

  const labels = parseStepLabels(block.body);

  const task = labels.get('work');
  if (!task) return { ok: false, reason: `step ${id} missing Work` };

  const dependencies = parseList(labels.get('depends on') ?? 'None');
  const files = parseList(labels.get('write scope') ?? 'None');
  const verificationText = labels.get('verification');
  const readOnly = /read[-\s]?only/i.test(labels.get('mode') ?? '');
  const executionClass = stripBackticks(labels.get('execution class') ?? '').toLowerCase();
  const minimumLevel = EXECUTION_CLASS_LEVEL[executionClass];

  return {
    ok: true,
    unit: {
      id,
      title,
      task,
      dependencies,
      ...(files.length ? { files } : {}),
      ...(verificationText ? { verification: [verificationText] } : {}),
      ...(readOnly ? { readOnly: true } : {}),
      ...(minimumLevel ? { routing: { version: 1, minimumLevel } } : {})
    }
  };
}

export function parsePortablePlan(text: string): PortablePlanParse {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty plan text' };
  const lines = text.split(/\r?\n/);

  // Collect (headingLine, bodyLines) blocks for every executable-step H3.
  const blocks: Array<{ heading: string; body: string[] }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = HEADING.exec(lines[i]);
    if (!headingMatch || !STEP_MARKER.test(lines[i])) continue;
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
    blocks.push({ heading: headingMatch[1], body });
    i = j - 1;
  }
  if (!blocks.length) return { ok: false, reason: 'no executable steps found' };

  const units: ExecutionWorkUnitInput[] = [];
  for (const block of blocks) {
    const parsed = parseStep(block);
    if (!parsed.ok) return parsed;
    units.push(parsed.unit);
  }

  return { ok: true, units };
}
