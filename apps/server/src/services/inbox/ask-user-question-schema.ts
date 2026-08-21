/**
 * Pure mapper: Claude's built-in `AskUserQuestion` tool_input payload →
 * {@link InboxQuestion}[], the shape the in-app Questions component (the
 * lettered picker) already renders.
 *
 * This is the seam that lets the EXPERIMENTAL `askUserQuestionUiEnabled` feature
 * REUSE the inbox_ask loop instead of building a second question UI. The
 * question-forwarding PreToolUse hook (see `buildClaudeHookSettings`) POSTs the raw
 * tool-call JSON to `/hook/question/:projectId/:sessionId`; the handler pulls
 * out `tool_input` and hands it here, then appends the result to the inbox
 * exactly like inbox_ask does (`inboxStore.append({ sessionId, questions })`).
 *
 * `AskUserQuestion`'s payload shape differs from the inbox schema, so we
 * translate:
 *   - `question`   → `prompt`         (the per-question heading line)
 *   - `header`     → folded into the prompt as a bold lead-in (the inbox
 *                     schema has no separate header field)
 *   - `options[].description` → folded into the option `label` (an
 *                     {@link InboxQuestionOption} is only `{ id, label }`, so a
 *                     description has nowhere else to go)
 *   - `multiSelect` → passed through unchanged
 * The host still assigns the stable A/B/C letters (via {@link buildInboxQuestion}),
 * so the ordering the user sees is deterministic. Pure + exported for unit tests.
 */

import type { InboxQuestion } from '@zana-ai/zcc-domain/product';
import { buildInboxQuestion, MAX_OPTIONS, MAX_QUESTIONS } from './inbox-question-schema.js';

/** One choosable answer in an `AskUserQuestion` question. */
export interface AskUserQuestionOption {
  label: string;
  /** Optional longer explanation of the option (folded into the inbox label). */
  description?: string;
}

/** One question inside an `AskUserQuestion` tool call. */
export interface AskUserQuestionItem {
  /** The question text (becomes the inbox question's `prompt`). */
  question: string;
  /** Optional short category/heading (folded into the prompt as a bold lead-in). */
  header?: string;
  /** When true, more than one option may be chosen (checkboxes). */
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
}

/** The `tool_input` payload of a Claude `AskUserQuestion` tool call. */
export interface AskUserQuestionInput {
  questions?: AskUserQuestionItem[];
}

/**
 * Fold an option's description into its display label (`label — description`).
 * Exported so a sibling mapper (e.g. {@link mapOpencodeQuestion}) can recompute
 * the SAME fold to translate a folded label back to its raw source label.
 */
export function foldOption(opt: AskUserQuestionOption): string | null {
  const label = typeof opt?.label === 'string' ? opt.label.trim() : '';
  if (!label) return null;
  const description = typeof opt?.description === 'string' ? opt.description.trim() : '';
  return description ? `${label} — ${description}` : label;
}

/** Fold a `question` + optional `header` into one prompt (bold lead-in line). */
function foldQuestionAndHeader(question: unknown, header: unknown): string {
  const q = typeof question === 'string' ? question.trim() : '';
  const h = typeof header === 'string' ? header.trim() : '';
  if (h && q) return `**${h}**\n\n${q}`;
  return h || q;
}

/** Fold a question's header into its prompt as a bold lead-in line. */
function foldPrompt(item: AskUserQuestionItem): string {
  return foldQuestionAndHeader(item?.question, item?.header);
}

/**
 * Map an `AskUserQuestion` tool_input payload into the inbox `questions[]`,
 * host-assigning option letters via {@link buildInboxQuestion}. Tolerant of a
 * malformed payload: any question with no usable prompt or no valid options is
 * dropped, and an empty/absent `questions` array yields `[]` (so the caller can
 * simply skip the append). Never throws.
 */
export function mapAskUserQuestion(input: AskUserQuestionInput | null | undefined): InboxQuestion[] {
  if (!input || !Array.isArray(input.questions) || input.questions.length === 0) {
    return [];
  }
  const questions = input.questions
    // Clamp the question count so a pathological payload can't write a giant
    // card; the inbox schema bounds it too, but bound here at the trust edge.
    .slice(0, MAX_QUESTIONS)
    .map((item) => {
      const prompt = foldPrompt(item);
      const options = Array.isArray(item?.options)
        ? item.options
            // Clamp per-question options to the inbox's letter budget (A–…).
            .slice(0, MAX_OPTIONS)
            .map(foldOption)
            .filter((o): o is string => o !== null)
        : [];
      if (!prompt || options.length === 0) return null;
      return {
        prompt,
        options,
        ...(item?.multiSelect === true ? { multiSelect: true } : {})
      };
    })
    .filter((q): q is { prompt: string; options: string[]; multiSelect?: boolean } => q !== null);

  if (questions.length === 0) return [];
  // buildInboxQuestion host-assigns the A/B/C letters and normalizes the shape;
  // in multi-question mode it returns `{ questions }`.
  return buildInboxQuestion({ questions }).questions ?? [];
}

// ---------------------------------------------------------------------------
// opencode's native `question` tool — near-identical shape, one sibling mapper
// ---------------------------------------------------------------------------

/** One choosable answer in an opencode `question` tool call. */
export interface OpencodeQuestionOption {
  label: string;
  description?: string;
}

/** One question inside an opencode `question.asked` event's `questions[]`. */
export interface OpencodeQuestionItem {
  question: string;
  header?: string;
  /** opencode's name for {@link AskUserQuestionItem.multiSelect}. */
  multiple?: boolean;
  /** When true, a free-text "Other…" answer is also allowed — opencode has no equivalent on `AskUserQuestion`. */
  custom?: boolean;
  options: OpencodeQuestionOption[];
}

/**
 * Map opencode's native `question` tool payload (`question.asked`'s
 * `questions[]`) into {@link InboxQuestion}[] — field-for-field identical to
 * {@link mapAskUserQuestion}'s input (`question`/`header`/
 * `options[].label+description`) apart from `multiple` (their `multiSelect`)
 * and `custom` (their `allowOther`, which Claude's tool has no equivalent
 * for). Kept as its own function rather than adapted through
 * {@link mapAskUserQuestion} so `custom` → `allowOther` isn't lost. Same
 * tolerance: a malformed item is dropped, never throws.
 */
export function mapOpencodeQuestion(questions: OpencodeQuestionItem[] | null | undefined): InboxQuestion[] {
  if (!Array.isArray(questions) || questions.length === 0) return [];
  const built = questions
    .slice(0, MAX_QUESTIONS)
    .map((item) => {
      const prompt = foldQuestionAndHeader(item?.question, item?.header);
      const options = Array.isArray(item?.options)
        ? item.options.slice(0, MAX_OPTIONS).map(foldOption).filter((o): o is string => o !== null)
        : [];
      if (!prompt || options.length === 0) return null;
      return {
        prompt,
        options,
        ...(item?.multiple === true ? { multiSelect: true } : {}),
        ...(item?.custom === true ? { allowOther: true } : {})
      };
    })
    .filter(
      (q): q is { prompt: string; options: string[]; multiSelect?: boolean; allowOther?: boolean } => q !== null
    );

  if (built.length === 0) return [];
  return buildInboxQuestion({ questions: built }).questions ?? [];
}
