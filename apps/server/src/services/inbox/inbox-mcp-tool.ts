/**
 * inbox_push — project-scoped outbound channel to the user's inbox.
 *
 * This is a **project-scoped tool factory**. The agent inside a project
 * sees only `{ docs?, comments? }` in the schema; the projectId is filled
 * by the MCP router from the URL path (`/mcp/:projectId`) and closed over
 * by the factory's `register()` at request time. Hiding projectId from the
 * schema is deliberate: it makes forgery impossible (agent can't push to
 * a different project's inbox) and removes a projectId parameter the agent
 * would otherwise have to manage.
 *
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IInboxStore, InboxInput } from './inbox-store.js';
import type { InboxNotifyLevel, InboxOrigin } from '@zana-ai/zcc-domain/product';
import type { HeldQuestionGate } from './held-questions.js';
import { buildInboxQuestion, structuredQuestionInputShape } from './inbox-question-schema.js';

/** Description shown to the LLM. */
export const INBOX_PUSH_DESCRIPTION = [
  "Push an update to the user's inbox from this project.",
  'Use this when you have something the user should see —',
  'a finished analysis (point to the report file via `docs`),',
  'a question back to the user (write it as `comments`),',
  'a blocked task that needs input, or a status check-in.',
  '',
  '`docs` are paths relative to this project root. Each one',
  'is rendered live in the inbox UI when the user opens the',
  'entry — no snapshot is taken, so later edits to the file',
  'will be reflected on subsequent reads.',
  '',
  '`comments` is markdown — your voice to the user about what',
  'you did or want to ask. Keep it short and direct; if more',
  'detail is needed put it in a doc and reference it.',
  '',
  'If your message is a QUESTION you want answered by picking between concrete',
  'choices, attach `options` (a single question): they render as a lettered form',
  '(an optional "Other…" row via `allowOther`, checkboxes via `multiSelect`) under',
  "the message, and — when this push is on a live session — the user's pick comes",
  'back to you HERE as if typed. For several questions at once, pass `questions`',
  'instead. Leave them off for a plain status update. (When you specifically need',
  'to BLOCK and wait for a decision, prefer `inbox_ask`.)',
  '',
  'Set `report: true` when this push is a finished DELIVERABLE the user will want',
  'to find again — a completed analysis, an RCA, an audit, a design writeup (the',
  'kind of thing you point at with `docs`). Flagged reports get a "Report" badge,',
  'their own Reports tab, and a Reports filter in the inbox, so they surface fast',
  'and stand apart from routine status check-ins. Leave it off (the default) for a',
  'plain progress update or a question — over-flagging routine pings defeats the',
  'purpose.',
  '',
  'Optionally set `subject`: a short one-line headline for the inbox row (a few',
  'words — what this is about). It becomes the row title; without it the row',
  "falls back to the session's task title, then the first line of `comments`. Set",
  'it when the first line of `comments` would be a poor heading.',
  '',
  'Optionally set `intent`: one line of CONTEXT — what you (or the user) were',
  'trying to achieve when this came up (the goal behind the message). The inbox',
  "shows it as a \"Context\" line so the user can tell at a glance what a message is",
  'about without opening it. Especially valuable on a QUESTION — say what the',
  "answer unblocks. When omitted the inbox falls back to the session's task title,",
  'so always prefer a specific intent over the generic fallback.',
  '',
  'At least one of `docs` or `comments` must be present.'
].join(' ');

/**
 * Tool input schema as a `ZodRawShape` (the SDK wraps it in `z.object`
 * itself). Note the absence of `projectId`: the agent cannot supply or
 * forge one — the router closes over it from the URL path.
 */
export const inboxPushInputSchema = {
  subject: z
    .string()
    .optional()
    .describe(
      'Short one-line headline for the inbox row (author-set). Becomes the row title; ' +
        'falls back to the session title, then the first line of comments. Keep it to a few words.'
    ),
  intent: z
    .string()
    .optional()
    .describe(
      'One-line CONTEXT: what you/the user were trying to achieve (the goal behind this message). ' +
        'Shown as a "Context" line in the inbox; falls back to the session task title when omitted. ' +
        'Especially useful on a question — say what the answer unblocks.'
    ),
  docs: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "Relative path to a file inside this project, e.g. 'docs/report.md'."
          )
      })
    )
    .optional()
    .describe(
      'Project files to surface in the inbox entry. Rendered live, not snapshotted.'
    ),
  comments: z
    .string()
    .optional()
    .describe(
      "Your message to the user (markdown). Renders below docs in the inbox detail pane."
    ),
  report: z
    .boolean()
    .optional()
    .describe(
      'Mark this entry as a finished REPORT/deliverable (analysis, RCA, audit, design). ' +
        'Flagged reports get a badge, a dedicated Reports tab, and a Reports filter so they ' +
        'surface fast. Default false — leave off for routine status updates and questions.'
    ),
  // Optional structured-question add-on. When present, `comments` becomes the
  // question prompt and these render as a lettered answer form (see inbox_ask
  // for the same shape). Omit for a plain status push.
  ...structuredQuestionInputShape
};

export interface RegisterInboxPushOpts {
  projectId: string;
  /** Display label snapshot. Optional; readers fall back to projectId. */
  projectLabel?: string;
  /**
   * Originating terminal session, when the MCP route is session-scoped
   * (`/mcp/:projectId/:sessionId`). Stamped onto the inbox entry so the
   * UI can route the "Open" click back to that exact tab. Absent when
   * the agent connects on the project-scoped legacy route.
   */
  sessionId?: string;
  /**
   * Resume/reopen coordinates for the originating agent, resolved HERE from the
   * live pty (never agent-supplied). Stamped onto the entry so the inbox "Open"
   * action can `--resume` the exact conversation, or spawn a fresh seeded agent,
   * after the {@link sessionId} pty is gone. Absent when the session identity
   * isn't known (project-scoped legacy route) or the resolver yields nothing.
   */
  origin?: InboxOrigin;
  /** True when the originating session is a scheduled (background) run. */
  scheduled?: boolean;
  /**
   * Scheduled loudness for this session's pushes. `silent` drops the push
   * (recorded as success to the agent, but nothing written); `quiet`/`loud`
   * are stamped onto the entry. Absent for non-scheduled sessions, whose
   * pushes are always written and treated as loud.
   */
  notify?: InboxNotifyLevel;
  /**
   * Optional fix-at-source normalizer for doc paths. Agents commonly `cd` into
   * a subdir, write a file there, then report its path relative to that subdir
   * — so the stored path 404s under the project root. When provided, each
   * doc's reported path is rewritten to its project-root-relative location
   * BEFORE the entry is persisted, so the entry is correct from the start
   * (the render-time fallback in the inbox still covers older entries). Given a
   * reported path, returns the corrected relative path, or the input unchanged
   * when it can't be improved. Host-resolved (project root + origin cwd), never
   * agent-supplied. Never throws.
   */
  normalizeDocPath?: (reportedPath: string) => string;
  inboxStore: IInboxStore;
  /**
   * Optional suppress-while-working gate for QUESTION-bearing pushes. A plain
   * status report always writes immediately; only a push that carries a question
   * (options/questions) can be held until the originating agent's idle/blocked
   * edge — see {@link HeldQuestionService}. Absent / not-holding ⇒ append now.
   */
  heldQuestions?: HeldQuestionGate;
}

/**
 * Register the `inbox_push` tool on the given `McpServer`. The handler
 * closes over `projectId` (from the URL match) and `projectLabel` (from
 * the project registry) at register-time. Re-built per-request so a
 * deleted-then-recreated project doesn't bleed identity across requests.
 */
export function registerInboxPushTool(server: McpServer, opts: RegisterInboxPushOpts): void {
  const { projectId, projectLabel, sessionId, origin, scheduled, notify, normalizeDocPath, inboxStore } = opts;

  server.registerTool(
    'inbox_push',
    {
      description: INBOX_PUSH_DESCRIPTION,
      inputSchema: inboxPushInputSchema
    },
    async ({ subject, intent, docs, comments, report, options, allowOther, multiSelect, questions }) => {
      try {
        // A `silent` schedule suppresses inbox entirely. Report success so the
        // agent doesn't retry or treat its check-in as failed — the schedule
        // simply opted out of surfacing.
        if (notify === 'silent') {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Suppressed: this scheduled run has inbox notifications set to silent.'
              }
            ]
          };
        }
        // Optional structured question — {} when no options were supplied (a plain
        // status push), so the spread is a no-op. Host assigns the A/B/C letters.
        // `inbox_push` options are a soft follow-up on a status message — default
        // NON-blocking (`defaultBlocking` omitted ⇒ false) so a report doesn't
        // hijack the pinned band; an agent can opt in per-question via `blocking`.
        const built = buildInboxQuestion({ options, allowOther, multiSelect, questions });
        // Fix-at-source: rewrite each doc's reported path to its actual
        // project-root-relative location so the entry points at the file from
        // the start. Best-effort — a normalizer that can't improve a path (or
        // isn't wired) leaves it unchanged.
        const normalizedDocs = normalizeDocPath
          ? docs?.map((d) => ({ ...d, path: normalizeDocPath(d.path) }))
          : docs;
        const input: InboxInput = {
          projectId,
          projectLabel,
          subject,
          intent,
          docs: normalizedDocs,
          comments,
          ...(report ? { report: true } : {}),
          ...built,
          sessionId,
          origin,
          scheduled,
          notify
        };

        // Suppress-while-working. The gate holds ONLY a BLOCKING question fired
        // while the agent is still working (a plain report or a soft question
        // always surfaces now — the gate self-checks and returns false), letting
        // it surface on the agent's idle/blocked edge instead of interrupting
        // mid-run. Returns true only when it actually parked the entry.
        if (opts.heldQuestions?.maybeHold(sessionId, input)) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Report noted; its question is queued until you stop working, so the user ` +
                  `isn't interrupted mid-run. It surfaces in the inbox the moment you go idle. ` +
                  `Keep working — if you resolve it yourself first, it won't bother them.`
              }
            ]
          };
        }

        const entry = await inboxStore.append(input);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Pushed to inbox. id=${entry.id} ts=${entry.ts}`
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `inbox_push failed: ${message}`
            }
          ]
        };
      }
    }
  );
}
