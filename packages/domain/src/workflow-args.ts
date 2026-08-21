/**
 * Argument-templated workflows — the pure `{{arg}}` substitution core.
 *
 * A QuickPrompt's `prompt` body may carry `{{name}}` placeholders that are
 * filled from a small per-argument form before the text is injected into the
 * launcher (see {@link QuickPrompt.arguments}). This module is the *pure* engine
 * behind that: no I/O, no React, no Node — so it runs identically in the
 * renderer (fill-form preview) and could be reused main-side, and it's trivially
 * unit-testable.
 *
 * Syntax (a deliberately small subset of Warp's Workflow command parser):
 *   - `{{name}}`      → a substitution slot for argument `name` (name trimmed).
 *   - `{{{literal}}}` → a triple-brace ESCAPE: renders the literal text
 *                       `{{literal}}` and is NOT treated as an argument. This is
 *                       the escape hatch for a prompt that needs real double
 *                       braces (e.g. teaching `{{var}}` syntax to an agent).
 *
 * An argument name is `[A-Za-z0-9_.-]+` after trimming surrounding whitespace;
 * anything else inside `{{…}}` (empty, spaces-only, punctuation) is left
 * verbatim rather than guessed at, so a stray `{{` in prose can't silently
 * become a phantom argument.
 */

/** A single fillable slot on a parametrized {@link QuickPrompt}. */
export interface WorkflowArgument {
  /** Placeholder name as it appears in `{{name}}`; unique within a prompt. */
  name: string;
  /** Free `text` (default) or a fixed `enum` chosen from {@link enumValues}. */
  type?: 'text' | 'enum';
  /** Allowed values when `type: 'enum'`; ignored otherwise. */
  enumValues?: string[];
  /** Human hint shown beside the field. */
  description?: string;
  /** Pre-filled value; also used when the user leaves the field blank. */
  defaultValue?: string;
}

/** Matches a triple-brace escape first, then a plain double-brace slot. Ordering
 *  the escape alternative first means it wins at any given position. */
const TOKEN_RE = /\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g;

/** A trimmed placeholder body is a valid argument name only if it's a single
 *  token of word-ish chars — keeps `{{ oops here }}` or `{{}}` from becoming
 *  arguments. */
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

function argName(raw: string): string | null {
  const trimmed = raw.trim();
  return NAME_RE.test(trimmed) ? trimmed : null;
}

/**
 * Extract the ordered, de-duplicated list of argument names referenced by a
 * template. Escaped `{{{…}}}` spans and malformed `{{…}}` spans are ignored, so
 * this returns exactly the names the fill-form should collect. First-seen order
 * is preserved (stable form field order).
 */
export function parseArgumentNames(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of template.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) continue; // escaped literal — not an argument
    const name = m[2] !== undefined ? argName(m[2]) : null;
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** True when the template contains at least one real `{{arg}}` slot. */
export function hasArguments(template: string): boolean {
  return parseArgumentNames(template).length > 0;
}

/**
 * Reconcile a prompt's declared {@link WorkflowArgument} metadata with the slots
 * actually present in its body. The template is the source of truth for *which*
 * arguments exist (a declared arg with no matching `{{name}}` is dropped; a
 * `{{name}}` with no declaration gets a bare `text` arg), while declarations
 * supply type/description/default. Returns them in template (first-seen) order.
 */
export function resolveArguments(
  template: string,
  declared: WorkflowArgument[] | undefined
): WorkflowArgument[] {
  const byName = new Map<string, WorkflowArgument>();
  for (const a of declared ?? []) {
    if (a && typeof a.name === 'string' && !byName.has(a.name)) byName.set(a.name, a);
  }
  return parseArgumentNames(template).map((name) => byName.get(name) ?? { name });
}

/**
 * Build an "agent-interviews-you" prompt from a template + its argument spec —
 * the conversational alternative to the UI fill-form. Instead of the launcher
 * collecting values and injecting a fully-substituted prompt, this hands the
 * agent the ORIGINAL template (slots intact) plus a spec of every argument
 * (type, enum choices, description, default) and instructs it to ASK the user
 * for each value in the terminal, then substitute and carry the task out.
 *
 * Pure and deterministic: no I/O, argument order follows the template
 * (first-seen). Triple-brace escapes are left untouched in the embedded template
 * (the agent is told to treat `{{{x}}}` as a literal `{{x}}`, matching
 * {@link substituteArguments}). Returns the template UNCHANGED when it has no
 * real slots, so a plain prompt never grows an interview preamble.
 */
export function buildInterviewPrompt(
  template: string,
  declared?: WorkflowArgument[]
): string {
  const args = resolveArguments(template, declared);
  if (args.length === 0) return template;

  const lines = args.map((a) => {
    const parts: string[] = [`- \`${a.name}\``];
    if (a.type === 'enum' && a.enumValues && a.enumValues.length > 0) {
      parts.push(`— choose one of: ${a.enumValues.join(', ')}`);
    }
    if (a.defaultValue !== undefined && a.defaultValue !== '') {
      parts.push(`(default: ${a.defaultValue})`);
    }
    if (a.description) parts.push(`— ${a.description}`);
    return parts.join(' ');
  });

  return [
    template,
    '',
    '---',
    'The task above is a fill-in-the-blanks template: the `{{name}}` markers are',
    'placeholders you must fill before doing anything. Do NOT act on it yet.',
    'First, ask me for each value below — one question at a time, in this order,',
    'showing the choices and the default where given (I can reply with the default',
    'or just say "default"/"skip" to accept it). Treat any `{{{literal}}}` as a',
    'literal `{{literal}}`, not a value to collect.',
    '',
    ...lines,
    '',
    'Once you have my answers, substitute them for the matching `{{name}}` markers',
    'in the task above and carry it out. Confirm the filled-in task back to me',
    'before running anything with side effects.'
  ].join('\n');
}

/**
 * Fill a template with `values`, resolving triple-brace escapes to literal
 * double braces. A missing/blank value falls back to the argument's
 * `defaultValue` (via {@link resolveArguments}), then to an empty string — the
 * result is always fully substituted, never a leaked `{{name}}`.
 */
export function substituteArguments(
  template: string,
  values: Record<string, string>,
  declared?: WorkflowArgument[]
): string {
  const defaults = new Map<string, string>();
  for (const a of resolveArguments(template, declared)) {
    if (a.defaultValue !== undefined) defaults.set(a.name, a.defaultValue);
  }
  return template.replace(TOKEN_RE, (whole, escaped?: string, slot?: string) => {
    if (escaped !== undefined) return `{{${escaped}}}`;
    const name = slot !== undefined ? argName(slot) : null;
    if (!name) return whole; // malformed — leave verbatim
    const provided = values[name];
    if (provided !== undefined && provided !== '') return provided;
    return defaults.get(name) ?? '';
  });
}
