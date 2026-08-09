/**
 * complete_autonomous_run — the session-scoped tool an autonomous-team
 * ORCHESTRATOR calls when the team's goal is fully met.
 *
 * Unlike `close_session_with_summary` (which ends the caller's own tab), this
 * tool keeps the orchestrator's tab OPEN so its final summary stays on screen as
 * the answer. It hands the summary to the AutonomousRunSupervisor, which:
 *   - records the summary on the run,
 *   - tears down the WORKER tabs,
 *   - posts ONE consolidated overview to the user inbox (goal + summary + stats),
 *   - leaves the orchestrator running.
 *
 * Identity (`sessionId`, `projectId`) is filled by the MCP router from the URL
 * path and closed over here — never read from agent input. So an agent can only
 * complete the run it ITSELF orchestrates: the supervisor rejects the call when
 * the caller isn't the run's orchestrator (returns null → we surface a clear
 * "not an orchestrator" message). Registered only when the supervisor hook is
 * wired (always, for autonomous-capable builds) — gating is by whether the
 * caller actually owns a running run, enforced in the supervisor.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Max summary length forwarded to the run record / inbox overview. */
export const MAX_COMPLETE_SUMMARY_CHARS = 16_000;

export const COMPLETE_AUTONOMOUS_RUN_DESCRIPTION = [
  'Declare the autonomous team run COMPLETE because the goal is fully met. Call',
  'this ONLY as the orchestrator, and only once the goal is genuinely achieved.',
  'It records your `summary`, closes the worker agents, and posts a single',
  'consolidated overview to the user inbox — while leaving YOUR tab open so the',
  'user can review the full conversation. Write `summary` as markdown: what the',
  'team accomplished, key decisions, and anything left. If you are not the',
  'orchestrator of an active run, this call is rejected.'
].join(' ');

export const completeAutonomousRunInputSchema = {
  summary: z
    .string()
    .min(1)
    .describe(
      'Markdown overview of what the team accomplished toward the goal — a few sentences or bullets. Saved to the inbox as the run record.'
    )
};

export interface RegisterCompleteAutonomousRunOpts {
  /** Originating session (from the URL route). Absent ⇒ tool is not useful. */
  sessionId?: string;
  /**
   * Mark the run owned by this orchestrator session complete. Returns true when
   * the caller owned a running run (and it was completed), false otherwise (not
   * an orchestrator / no active run). The supervisor does the teardown + inbox.
   */
  completeRun: (orchestratorSessionId: string, summary: string) => boolean;
}

/**
 * Register `complete_autonomous_run` on the given `McpServer`. The handler
 * closes over `sessionId` from the URL match — the agent supplies only the
 * summary.
 */
export function registerCompleteAutonomousRunTool(
  server: McpServer,
  opts: RegisterCompleteAutonomousRunOpts
): void {
  const { sessionId, completeRun } = opts;

  server.registerTool(
    'complete_autonomous_run',
    {
      description: COMPLETE_AUTONOMOUS_RUN_DESCRIPTION,
      inputSchema: completeAutonomousRunInputSchema
    },
    async ({ summary }) => {
      if (!sessionId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'complete_autonomous_run failed: no originating session (this tool only works inside a live session).'
            }
          ]
        };
      }
      const clamped =
        summary.length > MAX_COMPLETE_SUMMARY_CHARS
          ? summary.slice(0, MAX_COMPLETE_SUMMARY_CHARS) + '\n\n…(summary truncated)'
          : summary;
      const ok = completeRun(sessionId, clamped);
      if (!ok) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'complete_autonomous_run failed: this session is not the orchestrator of an active autonomous run.'
            }
          ]
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Run marked complete. Workers closed; a consolidated overview was posted to the inbox. Your tab stays open for review.'
          }
        ]
      };
    }
  );
}
