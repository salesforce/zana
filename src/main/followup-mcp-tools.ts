/**
 * followup_* — let a running agent file, list, and resolve {@link FollowUp}
 * records in ITS OWN project: questions / decisions it wants to park for the
 * human instead of blocking. The agent-facing counterpart of the renderer's
 * `window.cc.followups.*` IPC + FollowUpsPanel UI.
 *
 * Trust model (same as {@link registerGoalTools} / {@link registerLibraryTools}):
 * identity — the `projectId` these tools operate on, and the `sessionId` stamped
 * as provenance — is closed over here from the MCP URL route
 * (`/mcp/:projectId/:sessionId`), NEVER read from agent input. An agent therefore
 * cannot create / enumerate / resolve follow-ups for any OTHER project, and the
 * `origin` is host-stamped `{ source: 'agent', sessionId }` so provenance can't
 * be spoofed.
 *
 * Gated upstream by the `followupAgentApi` dep being present in McpServerOptions:
 * absent ⇒ the tools are not registered, so the agent doesn't see them.
 * Session-scoped only (filing / resolving are actions worth attributing).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FollowUp, FollowUpCreateInput, FollowUpStatus } from '../shared/types.js';

/**
 * The project-locked slice of FollowUpManager the tools call. `projectId` and the
 * agent `sessionId` are supplied by the tool wiring (from the route), not the agent.
 */
export interface FollowUpAgentApi {
  /** Follow-ups for one project (the route's projectId). */
  agentList(projectId: string): FollowUp[];
  /** Create a follow-up under one project. `scope`/`origin` forced by the wiring. */
  agentCreate(projectId: string, input: FollowUpCreateInput): FollowUp;
  /** Resolve / dismiss a follow-up the agent owns within its project. */
  agentSetStatus(
    projectId: string,
    id: string,
    status: FollowUpStatus,
    resolution?: string
  ): FollowUp | null;
}

export const FOLLOWUP_CREATE_DESCRIPTION = [
  'File a Follow-up in THIS project: a question or decision you are parking for the',
  'human because you genuinely cannot proceed without them. This is a HIGH bar, not',
  'a default. File ONLY when ALL THREE hold: (1) you truly cannot proceed or decide',
  'without a person; (2) it is NOT something you can settle yourself by reading the',
  'repo, running a command, or making a reasonable judgement call; and (3) it is',
  'worth surviving this session ending. Do NOT file for: things you can answer or',
  'try yourself, routine choices (whether to commit / run tests / lint / pick an',
   'obvious default), or anything you are about to say in your response anyway.',
  'If you already surfaced this via inbox_push this session, do NOT also file a',
  'follow-up — pick one. Before filing, prefer followup_list: if an open follow-up',
  'already covers this question, filing a near-identical one in the same session',
  'just refreshes that record (it does not pile up), so keep the wording consistent.',
  'Keep `title` to the actual question in one line. ALWAYS populate `detail` with',
  'the context a person — or an agent later spawned to pick this up — needs to act',
  'without you: what you were doing, what you found, the concrete options with',
  'their trade-offs, relevant file paths / commands / links, and what a good answer',
  'looks like. A bare title with no detail is rarely enough. Write it so someone',
  'with zero prior context could act on it. Set `kind: "decision"` for go/no-go choices.',
  'If the answer is a choice between concrete options, pass `options`: they render',
  'as a lettered picker and the human clicking one resolves the follow-up with that',
  'choice recorded as the outcome.',
  'The loop CLOSES back to you: when the human answers, their answer is delivered',
  'to THIS session if you are still running (so if you can afford to wait, staying',
  'alive lets you receive it in-place and continue); if you have exited, answering',
  'resumes your exact conversation, or spawns a fresh agent seeded with the question',
  '+ answer. Either way the follow-up is auto-resolved with their answer recorded.'
].join(' ');

export const FOLLOWUP_LIST_DESCRIPTION = [
  'List the Follow-ups in THIS project: id, title, kind, status, and when each',
  'was created / resolved. Read-only; takes no arguments. Call it BEFORE filing a',
  'new one: if an open follow-up already covers your question, don’t file a second',
  '(a near-identical one in the same session just refreshes the existing record).',
  'Also use it to find the id of one to resolve.'
].join(' ');

export const FOLLOWUP_RESOLVE_DESCRIPTION = [
  'Resolve or dismiss a Follow-up in THIS project once the question is answered',
  'or no longer relevant. Pass the follow-up `id` (from followup_list),',
  '`status: "resolved"` (answered/decided) or `"dismissed"` (moot), and an',
  'optional one-line `resolution` recording the outcome.'
].join(' ');

export const followupCreateInputSchema = {
  title: z.string().min(1).describe('The question or decision, in one line.'),
  detail: z
    .string()
    .optional()
    .describe(
      'Context (markdown) a human — or an agent spawned to pick this up — needs to act without you: what you were doing, what you found, the options and their trade-offs, relevant file paths / commands / links, and what a good answer looks like. Strongly recommended; a bare title is rarely enough.'
    ),
  options: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Optional concrete answer choices. When present they render as a lettered ' +
        'picker in the Follow-ups panel; the human clicking one RESOLVES the ' +
        'follow-up with that choice as the recorded outcome. Use for a decision ' +
        'with clear options; omit for an open-ended question.'
    ),
  kind: z
    .enum(['question', 'decision'])
    .optional()
    .describe('"question" (default) for an open question; "decision" for a go/no-go choice.')
};

export const followupResolveInputSchema = {
  id: z.string().min(1).describe('The follow-up id (from followup_list).'),
  status: z
    .enum(['resolved', 'dismissed'])
    .describe('"resolved" once answered/decided, or "dismissed" if no longer relevant.'),
  resolution: z
    .string()
    .optional()
    .describe('Optional one-line note recording the outcome.')
};

export interface RegisterFollowUpToolsOpts {
  /** Owning project from the URL route — the only scope these tools touch. */
  projectId: string;
  /** Originating session from the URL route — gates registration + stamps provenance. */
  sessionId?: string;
  /** The project-locked FollowUpManager slice. Absent ⇒ tools not registered. */
  followupAgentApi: FollowUpAgentApi;
}

/** A FollowUp projected to the compact fields the list tool echoes. */
function summarize(followUp: FollowUp) {
  return {
    id: followUp.id,
    title: followUp.title,
    kind: followUp.kind,
    status: followUp.status,
    createdAt: followUp.createdAt,
    resolvedAt: followUp.resolvedAt,
    resolution: followUp.resolution
  };
}

/**
 * Register followup_create / followup_list / followup_resolve on the given
 * session-scoped `McpServer`. Each handler closes over projectId + sessionId from
 * the route; the agent supplies only the follow-up's fields.
 */
export function registerFollowUpTools(server: McpServer, opts: RegisterFollowUpToolsOpts): void {
  const { projectId, sessionId, followupAgentApi } = opts;
  const fail = (tool: string, err: unknown) => ({
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: `${tool} failed: ${err instanceof Error ? err.message : String(err)}`
      }
    ]
  });

  server.registerTool(
    'followup_create',
    { description: FOLLOWUP_CREATE_DESCRIPTION, inputSchema: followupCreateInputSchema },
    async ({ title, detail, options, kind }) => {
      try {
        const followUp = followupAgentApi.agentCreate(projectId, {
          // projectId + scope + origin are forced by the wiring to the route's
          // project/session — the agent cannot target another project or spoof
          // provenance.
          projectId,
          scope: { projectId },
          title,
          detail,
          options,
          kind: kind ?? 'question',
          origin: sessionId ? { source: 'agent', sessionId } : { source: 'user' },
          sessionId
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Filed follow-up "${followUp.title}" (${followUp.kind}) in this project. id=${followUp.id}`
            }
          ]
        };
      } catch (err) {
        return fail('followup_create', err);
      }
    }
  );

  server.registerTool(
    'followup_list',
    { description: FOLLOWUP_LIST_DESCRIPTION, inputSchema: {} },
    async () => {
      try {
        const followups = followupAgentApi.agentList(projectId).map(summarize);
        return { content: [{ type: 'text' as const, text: JSON.stringify(followups, null, 2) }] };
      } catch (err) {
        return fail('followup_list', err);
      }
    }
  );

  server.registerTool(
    'followup_resolve',
    { description: FOLLOWUP_RESOLVE_DESCRIPTION, inputSchema: followupResolveInputSchema },
    async ({ id, status, resolution }) => {
      try {
        const updated = followupAgentApi.agentSetStatus(
          projectId,
          id,
          status as FollowUpStatus,
          resolution
        );
        if (!updated) {
          return {
            isError: true as const,
            content: [
              { type: 'text' as const, text: `followup_resolve: no follow-up ${id} in this project` }
            ]
          };
        }
        return {
          content: [
            { type: 'text' as const, text: `Follow-up ${updated.id} is now ${updated.status}.` }
          ]
        };
      } catch (err) {
        return fail('followup_resolve', err);
      }
    }
  );
}
