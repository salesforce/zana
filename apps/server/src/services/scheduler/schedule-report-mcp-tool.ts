/**
 * schedule_report — session-scoped tool for a scheduled agent to leave a
 * human-readable summary of what its run did.
 *
 * Modeled exactly on `inbox-mcp-tool.ts`: the agent sees only
 * `{ summary, status? }` in the schema; the `sessionId` is filled by the MCP
 * router from the URL path (`/mcp/:projectId/:sessionId`) and closed over by
 * the factory's `register()` at request time. Hiding the session id from the
 * schema makes forgery impossible — the agent can't report against another
 * session's run.
 *
 * Unlike `inbox_push` (which writes to the user-facing inbox), this attaches
 * the summary to the originating *scheduled run* via the `onReport` callback,
 * so it shows up in that schedule's run history. It is a per-run record, not a
 * proactive nag — see the zcc-center skill for when to use which.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Max report length we persist. Keeps the per-schedule run-history ring
 *  buffer bounded on disk (retain × this). Longer summaries are truncated
 *  with a trailing marker rather than rejected. */
export const MAX_REPORT_CHARS = 16_000;

/** Description shown to the LLM. */
export const SCHEDULE_REPORT_DESCRIPTION = [
  'Leave a short, human-readable summary of what this scheduled run did.',
  'It is attached to this run in the scheduler history so the user can see',
  'the outcome at a glance — without re-reading your terminal output.',
  '',
  'Use this at the END of a scheduled run: what you checked, what you found,',
  'what you changed, and whether anything needs the user. Write `summary` as',
  'short markdown. This is a REPORT, not a log — summarize, do not paste raw',
  'output.',
  '',
  'This is distinct from `inbox_push`: a report is the always-on per-run',
  'record in the scheduler; the inbox is for proactively flagging something',
  'the user should act on. File a report on every scheduled run; push to the',
  'inbox only when you genuinely need their attention.'
].join(' ');

/**
 * Tool input schema as a `ZodRawShape`. Note the absence of any session id —
 * the agent cannot supply or forge one; the router closes over it from the URL.
 */
export const scheduleReportInputSchema = {
  summary: z
    .string()
    .min(1)
    .describe(
      'Markdown summary of what this run did. Keep it short and direct — a few sentences or bullets.'
    ),
  status: z
    .enum(['success', 'partial', 'failure'])
    .optional()
    .describe(
      "Your own assessment of the run, independent of the process exit code: 'success', 'partial', or 'failure'."
    )
};

export interface RegisterScheduleReportOpts {
  /**
   * Originating terminal session, when the MCP route is session-scoped
   * (`/mcp/:projectId/:sessionId`). The report is attached to the scheduled
   * run that owns this session. Absent on the project-scoped legacy route —
   * in which case the tool reports an error (there's no run to attach to).
   */
  sessionId?: string;
  /**
   * Called with the (clamped) summary so the scheduler can merge it onto the
   * matching run. Best-effort: the scheduler may not find a run (e.g. evicted
   * from the ring buffer), but the tool still succeeds — fire-and-forget.
   */
  onReport?: (sessionId: string, summary: string, status?: 'success' | 'partial' | 'failure') => void;
}

/**
 * Register the `schedule_report` tool on the given `McpServer`. The handler
 * closes over `sessionId` (from the URL match) at register-time.
 */
export function registerScheduleReportTool(
  server: McpServer,
  opts: RegisterScheduleReportOpts
): void {
  const { sessionId, onReport } = opts;

  server.registerTool(
    'schedule_report',
    {
      description: SCHEDULE_REPORT_DESCRIPTION,
      inputSchema: scheduleReportInputSchema
    },
    async ({ summary, status }) => {
      // Without a session id we can't attach to a run. Surface a clear error
      // rather than silently dropping the report.
      if (!sessionId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'schedule_report failed: no originating session (this tool only works inside a scheduled run).'
            }
          ]
        };
      }
      const truncated = summary.length > MAX_REPORT_CHARS;
      const clamped = truncated
        ? summary.slice(0, MAX_REPORT_CHARS) + '\n\n…(report truncated)'
        : summary;
      try {
        onReport?.(sessionId, clamped, status);
        return {
          content: [
            {
              type: 'text' as const,
              text: truncated
                ? `Report attached (truncated to ${MAX_REPORT_CHARS} characters — keep summaries short).`
                : 'Report attached to this run.'
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `schedule_report failed: ${message}` }]
        };
      }
    }
  );
}
