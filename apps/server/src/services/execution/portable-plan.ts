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
// A LABEL bullet REQUIRES a leading list marker + space. This is what separates a
// real field (`- **Work:**`) from an inner sub-bold on a continuation line
// (`  **Purpose / why:**`) or a `**bold**` inside prose — those carry no list
// marker and are folded into the current label's multi-line value.
const LABEL = /^\s*[-*]\s+\*\*([^:*]+):\*\*\s*(.*)$/;
const FENCE = /^\s*(```|~~~)/; // fenced-code delimiter: freeze label detection inside

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

/** Map one executable-step block onto a work unit, or explain why it is invalid. */
function parseStep(block: PlanStepBlock): { ok: true; unit: ExecutionWorkUnitInput } | { ok: false; reason: string } {
  const headingText = stripInlineComment(block.heading);
  const colon = headingText.indexOf(':');
  if (colon <= 0) return { ok: false, reason: `step heading missing "id: title": ${headingText}` };
  const id = headingText.slice(0, colon).trim();
  const title = headingText.slice(colon + 1).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { ok: false, reason: `invalid step id: ${id}` };
  if (!title) return { ok: false, reason: `step ${id} missing title` };

  // Accumulate MULTI-LINE label values: a label bullet opens a value; every
  // following non-label line (continuation prose, indented sub-bold, fenced code)
  // extends it until the next label bullet or the step block ends. This is why a
  // real plan's `- **Work:**` with the body on the lines beneath it parses (the
  // old single-line grammar read the empty inline remainder and rejected the step
  // as "missing Work", collapsing the whole plan to the coordinator-derive path).
  const labels = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  let inFence = false;
  const flush = (): void => {
    if (current !== null) labels.set(current, buffer.join('\n').trim());
    current = null;
    buffer = [];
  };
  for (const raw of block.body) {
    if (FENCE.test(raw)) inFence = !inFence;
    const labelMatch = inFence ? null : LABEL.exec(raw);
    if (labelMatch) {
      flush();
      current = labelMatch[1].trim().toLowerCase();
      buffer.push(labelMatch[2]);
    } else if (current !== null) {
      buffer.push(raw);
    }
  }
  flush();

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
    let inFence = false;
    for (; j < lines.length; j += 1) {
      if (FENCE.test(lines[j])) inFence = !inFence;
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
