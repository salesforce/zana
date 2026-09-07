/**
 * Host inbox_push / inbox_search / suggest_action for conversation threads.
 *
 * Same product actions as the PTY zcc-inbox MCP tools. Identity is closed over
 * from the owning conversation row (Rule 1). inbox_push here is subject/docs/
 * comments/report only — structured questions that inject into a PTY stay ADAPT.
 */

import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  INBOX_SEARCH_DEFAULT_LIMIT,
  INBOX_SEARCH_DESCRIPTION,
  INBOX_SEARCH_SCAN_CAP
} from '../inbox/inbox-search-mcp-tool.js';
import { INBOX_PUSH_DESCRIPTION } from '../inbox/inbox-mcp-tool.js';
import type { InboxEntry, InboxInput } from '../inbox/inbox-store.js';
import { SUGGEST_ACTION_DESCRIPTION, sanitizeAction } from '../suggestions/suggest-action-mcp-tool.js';

export const INBOX_PUSH_NAME = 'inbox_push';
export const INBOX_SEARCH_NAME = 'inbox_search';
export const SUGGEST_ACTION_NAME = 'suggest_action';

const MAX_SHORT = 200;
const MAX_REASON = 280;
const DEFAULT_EXPIRY_MINUTES = 240;

export const HOST_INBOX_INSTRUCTION = [
  'Push user-visible updates with `inbox_push`; search existing rows with `inbox_search`.',
  'Propose a runnable next step with `suggest_action`. These write the same Inbox / launcher the user already sees.'
].join(' ');

const CONVERSATION_INBOX_PUSH_DESCRIPTION = [
  INBOX_PUSH_DESCRIPTION.split('If your message is a QUESTION')[0]?.trim()
    ?? INBOX_PUSH_DESCRIPTION,
  'Do not attach multiple-choice options here — this surface delivers a status or report, not a PTY inject.',
  'At least one of `docs` or `comments` must be present.'
].join(' ');

export const HOST_INBOX_TOOLS: DynamicTool[] = [
  {
    name: INBOX_PUSH_NAME,
    description: CONVERSATION_INBOX_PUSH_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string', description: 'Short one-line headline for the inbox row.' },
        intent: { type: 'string', description: 'One-line context: what you/the user were trying to achieve.' },
        docs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path'],
            properties: { path: { type: 'string', minLength: 1 } }
          },
          description: 'Project files to surface. Rendered live, not snapshotted.'
        },
        comments: { type: 'string', description: 'Your message to the user (markdown).' },
        report: { type: 'boolean', description: 'Mark this entry as a finished report/deliverable.' }
      }
    },
    presentation: {
      label: { pending: 'Pushing to inbox', completed: 'Pushed to inbox' },
      icon: { glyph: 'Inbox' }
    }
  },
  {
    name: INBOX_SEARCH_NAME,
    description: INBOX_SEARCH_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring over subject, comments, and doc paths.' },
        allProjects: { type: 'boolean', description: 'When true, search every project inbox. Defaults to this project.' },
        limit: { type: 'integer', minimum: 1, maximum: INBOX_SEARCH_SCAN_CAP },
        before: { type: 'string', description: 'Entry id to page before.' }
      }
    },
    presentation: {
      label: { pending: 'Searching inbox', completed: 'Searched inbox' },
      icon: { glyph: 'Search' }
    }
  },
  {
    name: SUGGEST_ACTION_NAME,
    description: SUGGEST_ACTION_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'reason', 'action'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        reason: { type: 'string', minLength: 1, maxLength: 280 },
        detail: { type: 'string', maxLength: 2000 },
        action: { description: 'The action to run. Polymorphic on kind; validated by the host.' },
        dedupeKey: { type: 'string', maxLength: 200 },
        expiresInMinutes: { type: 'number', exclusiveMinimum: 0, maximum: 10080 }
      }
    },
    presentation: {
      label: { pending: 'Suggesting action', completed: 'Queued suggestion' },
      icon: { glyph: 'Zap' }
    }
  }
];

function fail(name: string, error: string): ToolCallResponse {
  return pluginToolResultToResponse(name, { ok: false, error });
}

function row(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function projectLabel(ctx: ProductHttpContext, projectId: string): string | undefined {
  return ctx.toProjects().find((project) => project.id === projectId)?.name;
}

function projectEntry(e: InboxEntry) {
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

export async function invokeHostInboxTool(
  ctx: ProductHttpContext,
  args: { name: string; threadId: string; projectId: string; input: unknown }
): Promise<ToolCallResponse> {
  const { name, threadId, projectId, input } = args;
  const fields = row(input);
  try {
    if (name === INBOX_PUSH_NAME) {
      const docs = Array.isArray(fields.docs)
        ? fields.docs
          .filter((d): d is { path: string } => Boolean(d && typeof d === 'object' && typeof (d as { path?: unknown }).path === 'string'))
          .map((d) => ({ path: d.path }))
        : undefined;
      const comments = typeof fields.comments === 'string' ? fields.comments : undefined;
      const payload: InboxInput = {
        projectId,
        projectLabel: projectLabel(ctx, projectId),
        subject: typeof fields.subject === 'string' ? fields.subject : undefined,
        intent: typeof fields.intent === 'string' ? fields.intent : undefined,
        docs,
        comments,
        ...(fields.report === true ? { report: true } : {}),
        sessionId: threadId
      };
      const entry = await ctx.inbox.append(payload);
      return pluginToolResultToResponse(name, { ok: true, id: entry.id, ts: entry.ts });
    }

    if (name === INBOX_SEARCH_NAME) {
      const readScope = fields.allProjects === true ? undefined : projectId;
      const { entries, hasMore } = await ctx.inbox.read({
        ...(readScope ? { projectId: readScope } : {}),
        ...(typeof fields.before === 'string' ? { before: fields.before } : {}),
        limit: INBOX_SEARCH_SCAN_CAP
      });
      const needle = (typeof fields.query === 'string' ? fields.query : '').trim().toLowerCase();
      const filtered = needle ? entries.filter((e) => matchesQuery(e, needle)) : entries;
      const cap = typeof fields.limit === 'number' && Number.isInteger(fields.limit) && fields.limit > 0
        ? Math.min(fields.limit, INBOX_SEARCH_SCAN_CAP)
        : INBOX_SEARCH_DEFAULT_LIMIT;
      const hits = filtered.slice(0, cap).map(projectEntry);
      return pluginToolResultToResponse(name, {
        scope: readScope ? `project:${readScope}` : 'all-projects',
        query: needle || null,
        count: hits.length,
        hasMore: hasMore || filtered.length > hits.length,
        entries: hits
      });
    }

    if (name === SUGGEST_ACTION_NAME) {
      const title = typeof fields.title === 'string' ? fields.title.trim() : '';
      const reason = typeof fields.reason === 'string' ? fields.reason.trim() : '';
      if (!title || !reason) throw new Error('title and reason are required');
      const sanitized = sanitizeAction(fields.action);
      if (!sanitized) {
        return fail(
          name,
          'action must carry a payload — a standalone open-view/navigate is rejected (allowed only as a combo tail), and a combo needs at least one start-terminal/start-agent step.'
        );
      }
      const minutes = typeof fields.expiresInMinutes === 'number' && fields.expiresInMinutes > 0
        ? fields.expiresInMinutes
        : DEFAULT_EXPIRY_MINUTES;
      const entry = await ctx.suggestions.append({
        projectId,
        projectLabel: projectLabel(ctx, projectId),
        title: title.slice(0, MAX_SHORT),
        reason: reason.slice(0, MAX_REASON),
        detail: typeof fields.detail === 'string' ? fields.detail.slice(0, 2000) : undefined,
        action: sanitized,
        sessionId: threadId,
        dedupeKey: typeof fields.dedupeKey === 'string' ? fields.dedupeKey.slice(0, MAX_SHORT) : undefined,
        expiresAt: Date.now() + minutes * 60_000
      });
      return pluginToolResultToResponse(name, { ok: true, id: entry.id });
    }

    return fail(name, `Unsupported inbox tool: ${name}`);
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : `${name} failed`);
  }
}
