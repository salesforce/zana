/**
 * inbox_search — project-scoped (by default) READ access to the user's inbox.
 *
 * The read counterpart to {@link registerInboxPushTool}. An agent could already
 * PUSH to the inbox but had no way to look at what's there — so it couldn't
 * answer "what's in my inbox?", find an earlier entry, or check whether it
 * already reported something.
 *
 * **Scope & trust.** Like `inbox_push`, the agent's own `projectId` is closed
 * over from the URL route, never taken from the agent — so the default read is
 * confined to this project and can't be forged to peek at another. The agent CAN
 * opt into a cross-project read by passing `allProjects: true` (for "search all
 * my inboxes" tasks); that's a deliberate widening, surfaced explicitly in the
 * schema rather than implicit. (CLAUDE.md #1: main authorizes; the route is the
 * trust anchor, the parameter is just a mode.)
 *
 * **Search.** The store does projection + pagination only, so the substring
 * `query` filter is applied here in the tool over a bounded scan window (newest
 * {@link INBOX_SEARCH_SCAN_CAP} entries) — cheap, no index, good enough for
 * "find the entry about X". Matches are case-insensitive over the entry's
 * `comments` and its `docs` paths.
 *
 * Read-only; never mutates. Returns a projected, non-internal view of each entry.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IInboxStore } from './inbox-store.js';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

/**
 * Upper bound on how many recent entries a single search scans before filtering.
 * Bounds the work (and the response) regardless of how big the inbox has grown —
 * the same spirit as the store's retention cap. A query that matches nothing in
 * the newest N simply returns empty; the agent can page with `before`.
 */
export const INBOX_SEARCH_SCAN_CAP = 500;

/** Default number of matched entries returned when the agent doesn't ask for a specific `limit`. */
export const INBOX_SEARCH_DEFAULT_LIMIT = 25;

export const INBOX_SEARCH_DESCRIPTION = [
  "Search and read the user's inbox — the entries surfaced in the app's Inbox",
  'view (agent check-ins, finished-analysis pointers, questions, status notes).',
  '',
  'By default this reads only THIS project\'s inbox. Pass `allProjects: true` to',
  'search across every project\'s inbox (use this only when the task is explicitly',
  'about searching all inboxes).',
  '',
  '`query` is an optional case-insensitive substring filter over each entry\'s',
  'subject, message text, and document paths — omit it to list the most recent entries.',
  'Results are newest-first. Use `limit` to cap how many come back and `before`',
  '(an entry id) to page into older entries.',
  '',
  'Read-only: this never creates, edits, or removes inbox entries.'
].join(' ');

export const inboxSearchInputSchema = {
  query: z
    .string()
    .optional()
    .describe(
      'Case-insensitive substring to match against each entry\'s subject, comments, and doc paths. Omit to list recent entries.'
    ),
  allProjects: z
    .boolean()
    .optional()
    .describe(
      'When true, search every project\'s inbox instead of just this one. Defaults to false (this project only).'
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(INBOX_SEARCH_SCAN_CAP)
    .optional()
    .describe(`Max number of matching entries to return (default ${INBOX_SEARCH_DEFAULT_LIMIT}).`),
  before: z
    .string()
    .optional()
    .describe('Entry id to page before — return entries older than this one. Omit for the newest page.')
};

export interface RegisterInboxSearchOpts {
  /** The agent's own project, from the URL route. The default (confined) read scope. */
  projectId: string;
  inboxStore: IInboxStore;
}

/** The non-internal projection of an entry returned to the agent. */
interface InboxSearchHit {
  id: string;
  ts: number;
  projectId: string;
  projectLabel?: string;
  subject?: string;
  intent?: string;
  comments?: string;
  docs?: string[];
  occurrences?: number;
  report?: boolean;
}

function projectEntry(e: InboxEntry): InboxSearchHit {
  return {
    id: e.id,
    ts: e.ts,
    projectId: e.projectId,
    ...(e.projectLabel ? { projectLabel: e.projectLabel } : {}),
    ...(e.subject ? { subject: e.subject } : {}),
    ...(e.intent ? { intent: e.intent } : {}),
    ...(e.comments ? { comments: e.comments } : {}),
    ...(e.docs && e.docs.length > 0 ? { docs: e.docs.map((d) => d.path) } : {}),
    ...((e.occurrences ?? 1) > 1 ? { occurrences: e.occurrences } : {}),
    ...(e.report ? { report: true } : {})
  };
}

/** Case-insensitive substring match over the entry's subject + intent + comments + doc paths. */
function matchesQuery(e: InboxEntry, needle: string): boolean {
  if (e.subject && e.subject.toLowerCase().includes(needle)) return true;
  if (e.intent && e.intent.toLowerCase().includes(needle)) return true;
  if (e.comments && e.comments.toLowerCase().includes(needle)) return true;
  if (e.docs) {
    for (const d of e.docs) {
      if (d.path.toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

/**
 * Register the `inbox_search` tool. Rebuilt per request like the other tools.
 * Closes over the route's `projectId` (the default, confined scope) and the
 * shared store.
 */
export function registerInboxSearchTool(server: McpServer, opts: RegisterInboxSearchOpts): void {
  const { projectId, inboxStore } = opts;

  server.registerTool(
    'inbox_search',
    {
      description: INBOX_SEARCH_DESCRIPTION,
      inputSchema: inboxSearchInputSchema
    },
    async ({ query, allProjects, limit, before }) => {
      try {
        // Default: confined to this project (route-anchored). Only widen when the
        // agent explicitly asks. projectId is NEVER taken from the agent — it's
        // the route's id or nothing (all projects).
        const readScope = allProjects === true ? undefined : projectId;
        // Scan a bounded window of the newest entries, then filter in-process.
        const { entries, hasMore } = await inboxStore.read({
          ...(readScope ? { projectId: readScope } : {}),
          ...(before ? { before } : {}),
          limit: INBOX_SEARCH_SCAN_CAP
        });

        const needle = (query ?? '').trim().toLowerCase();
        const filtered = needle ? entries.filter((e) => matchesQuery(e, needle)) : entries;
        const cap = limit ?? INBOX_SEARCH_DEFAULT_LIMIT;
        const hits = filtered.slice(0, cap).map(projectEntry);

        const payload = {
          scope: readScope ? `project:${readScope}` : 'all-projects',
          query: needle || null,
          count: hits.length,
          // True when there is more to page through (more in the store beyond the
          // scan window, OR matches truncated by `limit`).
          hasMore: hasMore || filtered.length > hits.length,
          entries: hits
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `inbox_search failed: ${message}` }]
        };
      }
    }
  );
}
