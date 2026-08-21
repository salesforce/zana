/**
 * library_* — let a running agent read, write, edit, and delete durable
 * documents in ITS OWN project's `.zcc/library`. The agent-facing counterpart
 * of the renderer's `window.cc.library.*` IPC + LibraryView UI.
 *
 * Trust model (same as {@link registerInboxPushTool}): identity — the
 * `projectId` these tools operate on and the `sessionId` stamped onto each
 * write — is closed over here from the MCP URL route (`/mcp/:projectId/:sessionId`),
 * NEVER read from agent input. An agent therefore cannot:
 *   - reach the GLOBAL `~/.zcc/library` or any OTHER project (no scope param);
 *   - forge `source` attribution (host stamps `{kind:'agent', sessionId}`);
 *   - escape the library dir (the store realpath-confines every relPath and
 *     rejects dotfiles / `index.json`).
 * The actual disk + manifest work is delegated to the injected LibraryStore
 * agent surface ({@link LibraryAgentApi}), which owns the atomic writes (Rule 4)
 * and the confinement (Rules 1/2). This module is just the tool wiring.
 *
 * Gated upstream by the `libraryAgentApi` dep being present in
 * {@link McpServerOptions}: absent ⇒ the tools are not registered, so the agent
 * doesn't see them. Session-scoped only (a write needs a sessionId to stamp).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LibraryDoc } from '@zana-ai/zcc-domain/product';

/**
 * The project-locked slice of LibraryStore the tools call. `projectId`/`sessionId`
 * are supplied by the tool wiring (from the route), not the agent.
 */
export interface LibraryAgentApi {
  agentList(projectId: string): LibraryDoc[];
  agentRead(projectId: string, relPath: string): (LibraryDoc & { content: string }) | null;
  agentWrite(
    projectId: string,
    sessionId: string | undefined,
    input: { relPath: string; title?: string; content?: string; summary?: string; tags?: string[] }
  ): LibraryDoc;
  agentRemove(projectId: string, relPath: string): boolean;
}

export const LIBRARY_WRITE_DESCRIPTION = [
  "Create or update a durable document in this project's library",
  '(`.zcc/library`). Use it to persist findings, decisions, notes, or any',
  'artifact that should outlive your session and be visible to teammates and',
  'future agents working this project.',
  '',
  'Address the doc by `relPath` (e.g. `findings/auth-investigation.md`). Writing',
  'the same relPath again overwrites it (an upsert) — re-read with library_read',
  'first if you are appending. Omit `content` to update only metadata',
  '(title/summary/tags) of an existing doc. Scoped to THIS project automatically;',
  'you cannot write to another project or the global library.'
].join(' ');

export const LIBRARY_READ_DESCRIPTION = [
  "Read a document from this project's library by `relPath`, returning its full",
  'content plus metadata (title, summary, tags, kind, updatedAt). Use this to',
  're-read what you or a peer/earlier run wrote before revising it. Returns an',
  'error if the doc does not exist — list_* first if unsure of the path.'
].join(' ');

export const LIBRARY_LIST_DESCRIPTION = [
  "List the documents in this project's library: relPath, title, summary, tags,",
  'kind, and updatedAt for each. Read-only; takes no arguments. Use it to',
  'discover what has already been captured before writing something new.'
].join(' ');

export const LIBRARY_REMOVE_DESCRIPTION = [
  "Delete a document from this project's library by `relPath` (removes both the",
  'manifest entry and the file). You may only remove agent-authored docs, not',
  'ones the user or a scheduled run created.'
].join(' ');

export const libraryWriteInputSchema = {
  relPath: z
    .string()
    .min(1)
    .describe(
      'Path within the library, e.g. "findings/auth.md". Relative, no ".." or dot-prefixed segments.'
    ),
  title: z.string().optional().describe('Human title for the doc. Defaults to the relPath.'),
  content: z
    .string()
    .optional()
    .describe('Full file content. Omit to update only metadata (title/summary/tags) of an existing doc.'),
  summary: z.string().optional().describe('One-line summary shown in the library list.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tags for organization, e.g. ["findings"], ["decision"], ["thoughts"].')
};

export const libraryReadInputSchema = {
  relPath: z.string().min(1).describe('Path of the doc to read, e.g. "findings/auth.md".')
};

export const libraryRemoveInputSchema = {
  relPath: z.string().min(1).describe('Path of the doc to delete, e.g. "findings/auth.md".')
};

export interface RegisterLibraryToolsOpts {
  /** Owning project from the URL route — the only scope these tools touch. */
  projectId: string;
  /** Originating session from the URL route — stamped onto writes as source. */
  sessionId?: string;
  /** The project-locked LibraryStore slice. Absent ⇒ tools not registered. */
  libraryAgentApi: LibraryAgentApi;
}

/** A LibraryDoc projected to the non-content fields the list/write tools echo. */
function summarize(doc: LibraryDoc) {
  return {
    relPath: doc.relPath,
    title: doc.title,
    summary: doc.summary,
    tags: doc.tags,
    kind: doc.kind,
    updatedAt: doc.updatedAt
  };
}

/**
 * Register library_write / library_read / library_list / library_remove on the
 * given session-scoped `McpServer`. Each handler closes over projectId/sessionId
 * from the route; the agent supplies only the doc path + content/metadata.
 */
export function registerLibraryTools(server: McpServer, opts: RegisterLibraryToolsOpts): void {
  const { projectId, sessionId, libraryAgentApi } = opts;
  const fail = (tool: string, err: unknown) => ({
    isError: true as const,
    content: [
      { type: 'text' as const, text: `${tool} failed: ${err instanceof Error ? err.message : String(err)}` }
    ]
  });

  server.registerTool(
    'library_write',
    { description: LIBRARY_WRITE_DESCRIPTION, inputSchema: libraryWriteInputSchema },
    async ({ relPath, title, content, summary, tags }) => {
      try {
        const doc = libraryAgentApi.agentWrite(projectId, sessionId, {
          relPath,
          title,
          content,
          summary,
          tags
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Saved "${doc.relPath}" (${doc.bytes ?? 0} bytes) to the project library.`
            }
          ]
        };
      } catch (err) {
        return fail('library_write', err);
      }
    }
  );

  server.registerTool(
    'library_read',
    { description: LIBRARY_READ_DESCRIPTION, inputSchema: libraryReadInputSchema },
    async ({ relPath }) => {
      try {
        const doc = libraryAgentApi.agentRead(projectId, relPath);
        if (!doc) return fail('library_read', new Error(`no such doc: ${relPath}`));
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ...summarize(doc), content: doc.content }, null, 2)
            }
          ]
        };
      } catch (err) {
        return fail('library_read', err);
      }
    }
  );

  server.registerTool(
    'library_list',
    { description: LIBRARY_LIST_DESCRIPTION, inputSchema: {} },
    async () => {
      try {
        const docs = libraryAgentApi.agentList(projectId).map(summarize);
        return { content: [{ type: 'text' as const, text: JSON.stringify(docs, null, 2) }] };
      } catch (err) {
        return fail('library_list', err);
      }
    }
  );

  server.registerTool(
    'library_remove',
    { description: LIBRARY_REMOVE_DESCRIPTION, inputSchema: libraryRemoveInputSchema },
    async ({ relPath }) => {
      try {
        const removed = libraryAgentApi.agentRemove(projectId, relPath);
        return {
          content: [
            {
              type: 'text' as const,
              text: removed ? `Removed "${relPath}" from the project library.` : `No such doc: "${relPath}".`
            }
          ]
        };
      } catch (err) {
        return fail('library_remove', err);
      }
    }
  );
}
