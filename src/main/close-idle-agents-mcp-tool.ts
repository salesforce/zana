/**
 * close_idle_agents — a session-scoped tool that lets a running agent close
 * EVERY OTHER idle agent (its at-rest peers), optionally leaving a work summary
 * behind first. The operator-side counterpart of the Agents board's "Close idle"
 * button, but driven from inside an agent ("close all the idle agents and store
 * a wrap-up so we remember what they were doing").
 *
 * Trust model (same as {@link registerCloseSessionTools} / the agent registry):
 * identity (`sessionId`, `projectId`) is filled by the MCP router from the URL
 * path (`/mcp/:projectId/:sessionId`) and closed over here — never read from
 * agent input. The agent supplies only behaviour flags (`summarize`,
 * `allProjects`). It can never close ITSELF through this tool (the caller is
 * always excluded — self-close is `close_session`), and the per-project
 * confinement lives in main (the injected resolver + {@link CloseSummaryService},
 * which re-validates every id belongs to its project — CLAUDE.md #1), so an
 * agent can't use this to reach a session main wouldn't otherwise close.
 *
 * "Idle" is decided in main, authoritatively, by {@link findIdleAgents} — the
 * same predicate the Agents board's Idle lane uses: a live (non-exited) session
 * that is neither `working` nor `blocked`. We never trust an agent's idea of who
 * is idle.
 *
 * The wrap-up: when `summarize` is on (default), each closed agent's "what it
 * did / what's left" is distilled into ONE combined inbox entry per project
 * (via the shared {@link CloseSummaryService}), and that rendered markdown is
 * ALSO returned to the caller so it can persist the wrap-up elsewhere — e.g.
 * into project memory — beyond the inbox.
 *
 * Gated upstream by the `closeIdlePeersEnabled` config flag: when off the tool
 * is not registered, so the agent doesn't see it at all.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const CLOSE_IDLE_AGENTS_DESCRIPTION = [
  'Close every OTHER idle agent — the peers sitting at rest (idle, i.e. not',
  'actively working and not blocked waiting on the user). Use this to tidy up',
  'the fleet when a batch of agents has finished and is just sitting there.',
  '',
  'By default this is scoped to YOUR project. Pass `allProjects: true` to close',
  'idle agents in every project the user has open. Working and blocked agents are',
  'always left running, and you never close yourself (use close_session for',
  'that).',
  '',
  'With `summarize` (the default), each closed agent\'s work is distilled into a',
  'short "what it did / what\'s left" note and saved to the user inbox — one',
  'combined entry per project — before it is terminated. The same wrap-up text is',
  'returned to you, so you can also store it somewhere durable (e.g. project',
  'memory) to remember what those agents were doing. Set `summarize: false` to',
  'close without spending tokens on summaries.'
].join(' ');

export const closeIdleAgentsInputSchema = {
  summarize: z
    .boolean()
    .optional()
    .describe(
      'Leave a work summary in the inbox (and return it to you) before closing each agent. Defaults to true. Set false to skip the summaries and just close.'
    ),
  allProjects: z
    .boolean()
    .optional()
    .describe(
      'When true, close idle agents across ALL projects, not just your own. Defaults to false (your project only).'
    )
};

/** Result of summarizing + closing one project's idle agents. */
export interface CloseIdleProjectResult {
  closed: number;
  summarized: number;
  /** Rendered combined wrap-up markdown for this project, when summaries ran. */
  body?: string;
}

export interface RegisterCloseIdleAgentsToolsOpts {
  /** Originating session (from the URL route). Absent ⇒ the tool isn't useful. */
  sessionId?: string;
  /** Owning project (from the URL route). The default close scope. */
  projectId: string;
  /**
   * Resolve the idle peer agents to close, grouped by project, with the caller
   * already excluded. `allProjects` widens the scope past the caller's project.
   * Idle detection + project confinement live behind this (main-authoritative),
   * never trusted from the agent. Returns a map of projectId → idle session ids.
   */
  findIdleAgents: (opts: {
    callerSessionId: string;
    callerProjectId: string;
    allProjects: boolean;
  }) => Map<string, string[]>;
  /**
   * Summarize (optionally) then close one project's idle sessions — the shared
   * CloseSummaryService path, which re-confines every id to `projectId` before
   * closing (CLAUDE.md #1). Returns counts + the rendered wrap-up body.
   */
  summarizeAndClose: (
    projectId: string,
    sessionIds: string[],
    opts: { summarize: boolean }
  ) => Promise<CloseIdleProjectResult>;
}

/**
 * Register `close_idle_agents` on the given session-scoped `McpServer`. The
 * handler closes over `sessionId`/`projectId` from the URL match — the agent
 * supplies neither.
 */
export function registerCloseIdleAgentsTools(
  server: McpServer,
  opts: RegisterCloseIdleAgentsToolsOpts
): void {
  const { sessionId, projectId, findIdleAgents, summarizeAndClose } = opts;

  server.registerTool(
    'close_idle_agents',
    { description: CLOSE_IDLE_AGENTS_DESCRIPTION, inputSchema: closeIdleAgentsInputSchema },
    async ({ summarize, allProjects }) => {
      if (!sessionId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'close_idle_agents failed: no originating session (this tool only works inside a live session).'
            }
          ]
        };
      }

      const doSummarize = summarize !== false; // default true
      const wide = allProjects === true;

      // Idle set + confinement are decided in main; the caller is excluded there.
      const byProject = findIdleAgents({
        callerSessionId: sessionId,
        callerProjectId: projectId,
        allProjects: wide
      });

      const targets = [...byProject.entries()].filter(([, ids]) => ids.length > 0);
      if (targets.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: wide
                ? 'No idle agents to close in any project.'
                : 'No idle agents to close in this project.'
            }
          ]
        };
      }

      // Close per project (the service is project-scoped). Independent projects,
      // so run them concurrently; each call swallows its own summary failure.
      const results = await Promise.all(
        targets.map(async ([pid, ids]) => {
          try {
            const res = await summarizeAndClose(pid, ids, { summarize: doSummarize });
            return { projectId: pid, ...res };
          } catch {
            // A failed summarize-then-close for one project must not sink the
            // others; report it closed nothing rather than throwing.
            return { projectId: pid, closed: 0, summarized: 0 } as {
              projectId: string;
            } & CloseIdleProjectResult;
          }
        })
      );

      const totalClosed = results.reduce((n, r) => n + r.closed, 0);
      const totalSummarized = results.reduce((n, r) => n + r.summarized, 0);

      // Build a concise, structured reply: a headline count, then each project's
      // wrap-up markdown (when it produced one) so the agent can persist it.
      const lines: string[] = [];
      const projWord = results.length === 1 ? 'project' : 'projects';
      lines.push(
        `Closed ${totalClosed} idle ${totalClosed === 1 ? 'agent' : 'agents'} across ${results.length} ${projWord}.` +
          (doSummarize ? ` Summarized ${totalSummarized} to the inbox.` : '')
      );
      // Append each project's wrap-up markdown so the agent can persist it. Only
      // when summaries were requested AND at least one was actually produced — a
      // summarize run can yield no body (no readable transcripts), and pointing
      // the agent at "the wrap-up(s) above" when there are none is misleading.
      const bodies = doSummarize ? results.filter((r) => r.body) : [];
      if (bodies.length > 0) {
        for (const r of bodies) {
          lines.push('', `--- wrap-up (${r.projectId}) ---`, r.body!);
        }
        lines.push(
          '',
          'The wrap-up(s) above were saved to the inbox. If you want them remembered beyond the inbox, store them in the relevant project memory.'
        );
      } else if (doSummarize && totalClosed > 0) {
        lines.push('', 'No work summaries were produced (the closed agents had no readable transcript).');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );
}
