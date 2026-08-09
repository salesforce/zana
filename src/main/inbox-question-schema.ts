/**
 * Shared structured-question schema + builder for the inbox tools.
 *
 * Both `inbox_ask` (session-scoped, blocks for the answer) and `inbox_push`
 * (project- or session-scoped status channel) can attach a structured
 * multiple-choice form to an entry: lettered options, an optional free-text
 * "Other…" row, and single- or multi-select. The RENDER + ANSWER-INJECTION are
 * identical (both feed the same {@link InboxQuestion}/`questions` fields the
 * detail pane's QuestionBlock reads), so the Zod shape and the host-side letter
 * assignment live here rather than being copied into each tool.
 *
 * The host — never the agent — assigns the stable A/B/C letters, so the ordering
 * the user sees is deterministic and an agent can't collide two options on one
 * key. See {@link InboxQuestionOption.id}.
 */

import { z } from 'zod';
import type { InboxQuestion, InboxQuestionOption } from '../shared/types.js';

// Bound the option list so a pathological call can't write a giant entry or
// exhaust the letter labels. 20 is far past any sane form (A–T).
export const MAX_OPTIONS = 20;
// Bound the number of questions in one card so a single call stays a scannable
// form, not a survey. 10 is well past any real decision point.
export const MAX_QUESTIONS = 10;

/** Letters used to label options (A, B, C, …). Bounded by {@link MAX_OPTIONS}. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** One question inside a multi-question `questions[]` payload. */
export const questionItemSchema = z
  .object({
    prompt: z
      .string()
      .min(1)
      .describe('This question, in one clear line (markdown allowed). Shown as its own heading.'),
    options: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_OPTIONS)
      .describe('The choosable answers for THIS question, in display order (lettered A, B, C, …).'),
    allowOther: z
      .boolean()
      .optional()
      .describe('When true, add a free-text "Other…" row to this question.'),
    multiSelect: z
      .boolean()
      .optional()
      .describe('When true, this question accepts more than one option (checkboxes).'),
    blocking: z
      .boolean()
      .optional()
      .describe(
        'When true, you are BLOCKED on this answer (cannot proceed without it) — it gets ' +
          'pinned in "Needs your answer". When false, it is a soft/optional follow-up that ' +
          "stays answerable but doesn't demand attention. Omit to use the tool's default."
      )
  })
  .strict();

/**
 * The raw-shape fields a tool folds into its own input schema to accept an
 * optional structured question — single-question mode (`question` + `options`)
 * or multi-question mode (`questions[]`). Spread this into the tool's schema
 * object. For `inbox_ask` these are required (the whole point is to ask); for
 * `inbox_push` they're an optional add-on to a status message.
 */
export const structuredQuestionInputShape = {
  options: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_OPTIONS)
    .optional()
    .describe(
      'Single-question mode: turn `comments` into a structured question by offering ' +
        'these choosable answers, in display order (lettered A, B, C, …). Omit when using `questions`.'
    ),
  allowOther: z
    .boolean()
    .optional()
    .describe('Single-question mode: add a free-text "Other…" row so the user can answer outside your options.'),
  multiSelect: z
    .boolean()
    .optional()
    .describe('Single-question mode: allow more than one option to be chosen (checkboxes instead of radio).'),
  blocking: z
    .boolean()
    .optional()
    .describe(
      'Single-question mode: when true, you are BLOCKED on this answer (pinned in ' +
        '"Needs your answer"). When false, it is a soft/optional follow-up. Omit to use ' +
        'the tool default (`inbox_ask` blocks, `inbox_push` does not).'
    ),
  questions: z
    .array(questionItemSchema)
    .min(1)
    .max(MAX_QUESTIONS)
    .optional()
    .describe(
      'Multi-question mode: ask several questions in one card. Each item has its own `prompt` + ' +
        '`options` (+ optional `allowOther`/`multiSelect`). Use INSTEAD of `options`.'
    )
};

/** The values {@link buildInboxQuestion} reads off a parsed tool payload. */
export interface StructuredQuestionInput {
  options?: string[];
  allowOther?: boolean;
  multiSelect?: boolean;
  blocking?: boolean;
  questions?: Array<{
    prompt: string;
    options: string[];
    allowOther?: boolean;
    multiSelect?: boolean;
    blocking?: boolean;
  }>;
}

/** Host-assign A/B/C letters to a flat option list. */
function label(opts: string[]): InboxQuestionOption[] {
  return opts.map((l, i) => ({ id: LETTERS[i] ?? String(i + 1), label: l }));
}

/**
 * Build the `{ question }` or `{ questions }` fragment to fold onto an inbox
 * entry from a tool payload, host-assigning the option letters. Returns `{}`
 * when the payload carries no options at all (a plain status push) — so a caller
 * can spread the result unconditionally. `questions` wins if both are supplied
 * (matches the {@link InboxEntry.questions} precedence).
 *
 * `defaultBlocking` is the tool's stance on whether an unspecified question
 * blocks the agent: `inbox_ask` passes true (the whole point is to block for an
 * answer), `inbox_push` passes false (an optional follow-up on a status push).
 * A per-question `blocking` in the payload always wins over this default. Only
 * the resolved `true` is persisted (false ⇒ omitted, matching the schema's
 * "absent ⇒ non-blocking" convention).
 */
export function buildInboxQuestion(
  input: StructuredQuestionInput,
  defaultBlocking = false
): { question?: InboxQuestion; questions?: InboxQuestion[] } {
  const resolveBlocking = (explicit?: boolean): true | undefined =>
    (explicit ?? defaultBlocking) ? true : undefined;
  if (Array.isArray(input.questions) && input.questions.length > 0) {
    const built: InboxQuestion[] = input.questions.map((q) => ({
      prompt: q.prompt,
      options: label(q.options),
      allowOther: q.allowOther || undefined,
      multiSelect: q.multiSelect || undefined,
      blocking: resolveBlocking(q.blocking)
    }));
    return { questions: built };
  }
  if (Array.isArray(input.options) && input.options.length > 0) {
    return {
      question: {
        options: label(input.options),
        allowOther: input.allowOther || undefined,
        multiSelect: input.multiSelect || undefined,
        blocking: resolveBlocking(input.blocking)
      }
    };
  }
  return {};
}
