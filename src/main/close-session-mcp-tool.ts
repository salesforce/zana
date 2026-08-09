/**
 * close_session / close_session_with_summary — session-scoped tools that let a
 * running agent end ITS OWN session when it's finished.
 *
 * Like {@link registerScheduleReportTool} and `inbox_push`, identity
 * (`sessionId`, `projectId`) is filled by the MCP router from the URL path
 * (`/mcp/:projectId/:sessionId`) and closed over here at register-time — never
 * read from agent input. So an agent can only ever close *itself*, not a
 * sibling: forgery is impossible by construction.
 *
 * Two tools:
 *  - `close_session` — terminate this session now, no summary.
 *  - `close_session_with_summary` — write the agent's own one-line summary to
 *    the user inbox, THEN close. The agent IS the model, so it supplies the
 *    summary directly (no `claude --print` micro-call — that's the operator-side
 *    Close-idle path, which summarizes a quiet idle agent it can't ask).
 *
 * Ordering matters: the pty kill is deferred to the next tick via `setTimeout`
 * so the MCP tool RESPONSE flushes to the agent first. Killing synchronously
 * would race the agent's transport — it might never see the acknowledgement.
 *
 * Gated upstream by the `agentSelfCloseEnabled` config flag: when off, neither
 * tool is registered, so the agent doesn't see them at all.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IInboxStore } from './inbox-store.js';

/** Max summary length we persist on a self-close inbox entry. */
export const MAX_CLOSE_SUMMARY_CHARS = 16_000;

/** Delay before the deferred pty kill, so the tool response flushes first. */
const CLOSE_DEFER_MS = 250;

export const CLOSE_SESSION_DESCRIPTION = [
  'Close THIS session — terminate your own terminal. Use it when your task is',
  'fully done and nothing is left for the user to see. There is no undo: the',
  'process ends. If you have anything worth recording, use',
  '`close_session_with_summary` (or `inbox_push`) instead so it is not lost.'
].join(' ');

export const CLOSE_SESSION_WITH_SUMMARY_DESCRIPTION = [
  'Leave a short summary of what you did in the user inbox, then close THIS',
  'session. Use this when you finish and want the user to see the outcome',
  'without re-reading your terminal. Write `summary` as short markdown — what',
  'you did, what (if anything) is left. The session ends after the summary is',
  'saved; there is no undo.'
].join(' ');

/** Empty schema — close_session takes no args (identity comes from the URL). */
export const closeSessionInputSchema = {};

export const closeSessionWithSummaryInputSchema = {
  summary: z
    .string()
    .min(1)
    .describe(
      'Markdown summary of what you accomplished this session — a few sentences or bullets. Saved to the inbox before the session closes.'
    )
};

export interface RegisterCloseSessionOpts {
  /** Originating session (from the URL route). Absent ⇒ tools are not useful. */
  sessionId?: string;
  /** Owning project (from the URL route). Used to label/route the inbox entry. */
  projectId: string;
  /** Display label snapshot for the inbox entry; readers fall back to projectId. */
  projectLabel?: string;
  /** Terminate a session; returns false when the id is unknown. */
  closeTerminal: (sessionId: string) => boolean;
  /** The user inbox (for the with-summary variant). */
  inboxStore: IInboxStore;
  /**
   * Schedule the deferred close. Injected so tests run it synchronously instead
   * of waiting on a real timer. Defaults to `setTimeout`.
   */
  defer?: (fn: () => void, ms: number) => void;
}

/**
 * Register `close_session` (+ `close_session_with_summary`) on the given
 * `McpServer`. Both handlers close over `sessionId`/`projectId` from the URL
 * match — the agent supplies neither.
 */
export function registerCloseSessionTools(
  server: McpServer,
  opts: RegisterCloseSessionOpts
): void {
  const { sessionId, projectId, projectLabel, closeTerminal, inboxStore } = opts;
  const defer = opts.defer ?? ((fn, ms) => setTimeout(fn, ms));

  // Defer the kill so the tool response flushes to the agent before its pty
  // dies. Shared by both tools.
  const scheduleClose = (id: string) => {
    defer(() => {
      try {
        closeTerminal(id);
      } catch {
        /* best-effort — the session may already be gone */
      }
    }, CLOSE_DEFER_MS);
  };

  server.registerTool(
    'close_session',
    { description: CLOSE_SESSION_DESCRIPTION, inputSchema: closeSessionInputSchema },
    async () => {
      if (!sessionId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'close_session failed: no originating session (this tool only works inside a live session).'
            }
          ]
        };
      }
      scheduleClose(sessionId);
      return {
        content: [{ type: 'text' as const, text: 'Closing this session now. Goodbye.' }]
      };
    }
  );

  server.registerTool(
    'close_session_with_summary',
    {
      description: CLOSE_SESSION_WITH_SUMMARY_DESCRIPTION,
      inputSchema: closeSessionWithSummaryInputSchema
    },
    async ({ summary }) => {
      if (!sessionId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'close_session_with_summary failed: no originating session (this tool only works inside a live session).'
            }
          ]
        };
      }
      const truncated = summary.length > MAX_CLOSE_SUMMARY_CHARS;
      const clamped = truncated
        ? summary.slice(0, MAX_CLOSE_SUMMARY_CHARS) + '\n\n…(summary truncated)'
        : summary;
      try {
        // Write the summary FIRST. If the inbox write fails, do NOT close — the
        // agent gets an error and can retry or push manually, rather than losing
        // the session AND the summary.
        const entry = await inboxStore.append({
          projectId,
          projectLabel,
          comments: clamped,
          sessionId
        });
        scheduleClose(sessionId);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Summary saved (id=${entry.id}). Closing this session now. Goodbye.`
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
              text: `close_session_with_summary failed: ${message} (session left open — nothing was closed).`
            }
          ]
        };
      }
    }
  );
}
