/**
 * inbox_ask — session-scoped structured question back to the user.
 *
 * The interactive sibling of {@link registerInboxPushTool}: instead of a plain
 * markdown message, the agent poses a multiple-choice question (the Cursor-IDE
 * "Questions" panel — lettered options, an optional free-text "Other…" row, and
 * Skip / Continue). The user's choice is injected back into THIS session's pty
 * via the same `terminals.reply` channel the free-text ReplyBox uses, so an
 * agent that asks and then blocks for input gets the answer "as if typed."
 *
 * Identity model matches inbox_push: `projectId` / `sessionId` are closed over
 * from the MCP URL route, never agent-suppliable. It is **session-scoped only**
 * — without a live session there's nowhere to inject the answer, so registering
 * it on the project-only route would just show the agent a tool that can never
 * deliver. The agent supplies the question text + options; the host assigns the
 * stable A/B/C letters (the agent can't collide two options on one key).
 *
 * The question prompt is stored in the entry's `comments` (so the sidebar
 * preview, search, AI-summary, and PDF export pick it up for free); the options
 * live in the entry's `question` field.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IInboxStore, InboxInput } from './inbox-store.js';
import type { InboxNotifyLevel } from '../shared/types.js';
import type { HeldQuestionGate } from './held-questions.js';
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  buildInboxQuestion,
  questionItemSchema
} from './inbox-question-schema.js';

export const INBOX_ASK_DESCRIPTION = [
  'Ask the user one or more structured multiple-choice questions and WAIT for the answer.',
  'Use this instead of inbox_push when you need the user to choose between',
  'concrete options (an approach, a config value, a go/no-go) rather than read a',
  'status update. Renders in the inbox as a Cursor-style form: your `question`',
  'on top, the `options` as lettered rows, an optional "Other…" free-text row,',
  'and Skip / Continue.',
  '',
  'When the user answers and hits Continue, their choice is delivered to',
  'you HERE, on this session, as if they typed it at your prompt — so after',
  'calling inbox_ask you should stop and wait for that reply rather than',
  'guessing. Skip delivers nothing (the user declined to answer).',
  '',
  'Single question: pass `question` + `options`. Keep `question` to one clear',
  'line; keep each option short. Set `allowOther: true` to let the user answer',
  'outside your options, and `multiSelect: true` if more than one option can be',
  'chosen at once.',
  '',
  'Several questions at once: pass a `questions` array instead — each item has',
  'its own `prompt`, `options`, and optional `allowOther`/`multiSelect`. They',
  "stack in one card and Continue unlocks only once the user has answered every",
  'one; their answers come back together as a labelled Q/A block. Use `question`',
  '+ `options` for one, `questions` for many — do not mix the two.',
  '',
  'Optionally set `subject`: a short one-line headline for the inbox row. Without',
  "it the row falls back to the session's task title, then the question text.",
  '',
  'Optionally set `intent`: one line of CONTEXT — what you were trying to achieve',
  'and what the answer unblocks. The inbox shows it as a "Context" line and in the',
  'pinned "Needs your answer" section, so the user can triage the question without',
  "reopening the session. Falls back to the session's task title when omitted."
].join(' ');

export const inboxAskInputSchema = {
  subject: z
    .string()
    .optional()
    .describe(
      'Short one-line headline for the inbox row (author-set). Falls back to the session ' +
        'title, then the question text. Keep it to a few words.'
    ),
  intent: z
    .string()
    .optional()
    .describe(
      'One-line CONTEXT: what you were trying to achieve and what this answer unblocks. ' +
        'Shown as a "Context" line and in the pinned "Needs your answer" section; falls back ' +
        'to the session task title when omitted.'
    ),
  question: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Single-question mode: the question to ask, in one clear line (markdown allowed). ' +
        'Omit when using `questions`.'
    ),
  options: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_OPTIONS)
    .optional()
    .describe(
      'Single-question mode: the choosable answers, in display order (lettered A, B, C, …). ' +
        'Required with `question`; omit when using `questions`.'
    ),
  allowOther: z
    .boolean()
    .optional()
    .describe('Single-question mode: add a free-text "Other…" row so the user can answer outside your options.'),
  multiSelect: z
    .boolean()
    .optional()
    .describe('Single-question mode: allow more than one option to be chosen (checkboxes instead of radio).'),
  questions: z
    .array(questionItemSchema)
    .min(1)
    .max(MAX_QUESTIONS)
    .optional()
    .describe(
      'Multi-question mode: ask several questions in one card. Each item has its own `prompt` + ' +
        '`options` (+ optional `allowOther`/`multiSelect`). Use INSTEAD of `question`/`options`.'
    ),
  preamble: z
    .string()
    .min(1)
    .optional()
    .describe('Multi-question mode only: an optional intro line shown above all the questions.')
};

export interface RegisterInboxAskOpts {
  projectId: string;
  projectLabel?: string;
  /** Originating session — required (the answer is injected back into it). */
  sessionId: string;
  /** True when the originating session is a scheduled (background) run. */
  scheduled?: boolean;
  /**
   * Scheduled loudness for this session. A structured question always wants the
   * user's eyes, so a `silent`/`quiet` schedule is bumped to `loud` here rather
   * than dropped — a background run that genuinely needs a decision shouldn't
   * ask into a collapsed, badge-free group. Absent for non-scheduled sessions.
   */
  notify?: InboxNotifyLevel;
  inboxStore: IInboxStore;
  /**
   * Optional suppress-while-working gate. When present AND it decides to HOLD,
   * the question is parked (not appended) and surfaces later on the agent's
   * idle/blocked edge — see {@link HeldQuestionService}. Absent / not-holding ⇒
   * the question appends immediately as before.
   */
  heldQuestions?: HeldQuestionGate;
}

/**
 * Register the `inbox_ask` tool. The handler closes over projectId/sessionId
 * from the URL route; the agent supplies only the question + options. Host
 * assigns the option letters so the labels are deterministic and unforgeable.
 */
export function registerInboxAskTool(server: McpServer, opts: RegisterInboxAskOpts): void {
  const { projectId, projectLabel, sessionId, scheduled, inboxStore } = opts;
  // A question must reach the user — never collapse it into the quiet group.
  const notify: InboxNotifyLevel | undefined = scheduled ? 'loud' : opts.notify;

  server.registerTool(
    'inbox_ask',
    { description: INBOX_ASK_DESCRIPTION, inputSchema: inboxAskInputSchema },
    async ({ subject, intent, question, options, allowOther, multiSelect, questions, preamble }) => {
      try {
        const multiMode = Array.isArray(questions) && questions.length > 0;
        // Validate the required shape up front (the shared builder is tolerant —
        // it returns {} on empty — but for inbox_ask a question is mandatory).
        if (!multiMode && (!question || !options || options.length === 0)) {
          throw new Error('provide either `questions`, or both `question` and `options`');
        }

        // Host assigns the A/B/C letters (in the shared builder) so labels are
        // deterministic and the agent can't collide two options on one key.
        // `inbox_ask` is a genuine "I'm blocked, pick one" — default blocking so
        // it earns the pinned band unless the agent explicitly marks it soft.
        const built = buildInboxQuestion({ options, allowOther, multiSelect, questions }, true);

        // Build the entry once so the hold-vs-append decision works on the same
        // input. In multi-mode the preamble is the card's shared header; in
        // single-mode the question text is the entry's comments.
        const input: InboxInput = multiMode
          ? {
              projectId,
              projectLabel,
              subject,
              intent,
              comments: preamble,
              questions: built.questions,
              sessionId,
              scheduled,
              notify
            }
          : {
              projectId,
              projectLabel,
              subject,
              intent,
              comments: question,
              question: built.question,
              sessionId,
              scheduled,
              notify
            };

        // Suppress-while-working: if the originating agent is actively working,
        // park the question and surface it on its next idle/blocked edge instead
        // of interrupting mid-run. The gate returns true only when it parked it.
        if (opts.heldQuestions?.maybeHold(sessionId, input)) {
          const n = multiMode ? built.questions!.length : built.question!.options.length;
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Queued ${multiMode ? `${n} questions` : 'your question'} — it will appear in ` +
                  `the inbox the moment you stop working, so the user isn't interrupted mid-run. ` +
                  `Stop and wait for their answer as usual; it arrives here as if typed once they ` +
                  `respond. If you resolve it yourself before you idle, it won't bother them.`
              }
            ]
          };
        }

        const entry = await inboxStore.append(input);
        if (multiMode) {
          const n = built.questions!.length;
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Asked the user ${n} question${n === 1 ? '' : 's'} in the inbox.` +
                  ` Their answers will arrive here together as if typed. id=${entry.id}`
              }
            ]
          };
        }
        const n = built.question!.options.length;
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Asked the user in the inbox (${n} option${n === 1 ? '' : 's'}).` +
                ` Their answer will arrive here as if typed. id=${entry.id}`
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `inbox_ask failed: ${message}` }]
        };
      }
    }
  );
}
