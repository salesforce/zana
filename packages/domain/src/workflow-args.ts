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

/** One `{{{escaped}}}` literal or `{{slot}}` span found in a template. */
interface Token {
  start: number;
  end: number;
  /** Body of a triple-brace escape; undefined for a slot. */
  escaped?: string;
  /** Body of a double-brace slot; undefined for an escape. */
  slot?: string;
}

/**
 * Find every token, left to right. A triple-brace escape wins over a slot at
 * the same position, and each body ends at the first closing run (`}}}` or
 * `}}`), so a body may contain braces and newlines.
 *
 * This is the hand-written form of
 * `/\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g`, whose lazy body rescans to
 * the end of the string from every `{{` when there is no closer (quadratic on
 * "{{{{{{…"). Here `lastIndexOf` rules out a missing closer up front, so each
 * `indexOf` that runs finds its match and the scan never revisits text.
 */
function scanTokens(template: string): Token[] {
  const tokens: Token[] = [];
  const lastTriple = template.lastIndexOf('}}}');
  const lastDouble = template.lastIndexOf('}}');
  let i = 0;
  for (;;) {
    i = template.indexOf('{{', i);
    if (i === -1) break;
    if (template.startsWith('{{{', i) && lastTriple >= i + 3) {
      const close = template.indexOf('}}}', i + 3);
      tokens.push({ start: i, end: close + 3, escaped: template.slice(i + 3, close) });
      i = close + 3;
      continue;
    }
    // No `}}` after this point means none after any later `{{` either.
    if (lastDouble < i + 2) break;
    const close = template.indexOf('}}', i + 2);
    tokens.push({ start: i, end: close + 2, slot: template.slice(i + 2, close) });
    i = close + 2;
  }
  return tokens;
}

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
  for (const token of scanTokens(template)) {
    if (token.escaped !== undefined) continue; // escaped literal — not an argument
    const name = token.slot !== undefined ? argName(token.slot) : null;
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
  let out = '';
  let position = 0;
  for (const token of scanTokens(template)) {
    out += template.slice(position, token.start);
    position = token.end;
    if (token.escaped !== undefined) {
      out += `{{${token.escaped}}}`;
      continue;
    }
    const name = token.slot !== undefined ? argName(token.slot) : null;
    if (!name) {
      out += template.slice(token.start, token.end); // malformed — leave verbatim
      continue;
    }
    const provided = values[name];
    if (provided !== undefined && provided !== '') out += provided;
    else out += defaults.get(name) ?? '';
  }
  return out + template.slice(position);
}
