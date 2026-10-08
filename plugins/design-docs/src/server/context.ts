/**
 * What every agent thread learns about design docs without asking: a short
 * usage contract plus the current project's catalog (live instructions), and
 * the `@` mention provider that pulls one doc into a prompt.
 */
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { STATUS_LABELS, designDocDirective } from '../shared/contract.js';
import { formatFile, formatManifest, truncate } from './format.js';
import type { ProjectNames } from './project-names.js';
import type { DesignDocStore } from './store.js';

/** Host cap on a live instruction provider's output. */
export const INSTRUCTION_BUDGET = 4000;
const CATALOG_SIZE = 12;
const MENTION_SEARCH_LIMIT = 10;
const MENTION_ENTRY_MAX_CHARS = 24_000;

const USAGE = [
  '## Design docs',
  'The user keeps design documents (specs, RFCs, ADRs, product docs) in the Design Docs plugin. Each doc is a small set of files — markdown, mermaid `.mmd` diagrams, self-contained `.html` mockups, code samples — rendered as formatted pages the user reviews.',
  '- Use the `design_doc_*` tools (or `zcc design-docs …` from a shell) to list, read, create and edit them. Read a doc before changing it; prefer `edits` over rewriting whole files and pass `baseRevision`.',
  '- Treat open comments as review feedback: address them, then resolve each with a short `body` saying what changed. Answer a question in its thread with `replyTo` instead of opening a new comment.',
  '- When the user asks for a design, spec, RFC or plan worth keeping, offer to write it as a design doc instead of only replying in chat.',
  '- Design docs are not the Library: save notes, findings, runbooks and postmortems with the `library_*` tools, and keep design docs for specs, RFCs, ADRs and designs the user reviews.',
  `- To show a doc in your reply, write its card on its own line: ${designDocDirective('<id>')}`
].join('\n');

export function buildInstructions(store: DesignDocStore, projectId: string | null): string {
  const docs = store.list({ projectId: projectId || undefined, status: 'active', limit: CATALOG_SIZE + 1 });
  if (docs.length === 0) {
    return `${USAGE}\n\nThere are no design docs for this project yet.`;
  }
  const lines = [USAGE, '', 'Design docs for this project (newest first):'];
  let used = lines.join('\n').length;
  let shown = 0;
  for (const doc of docs.slice(0, CATALOG_SIZE)) {
    const comments = doc.openComments ? ` · ${doc.openComments} open comment${doc.openComments === 1 ? '' : 's'}` : '';
    const summary = doc.summary ? ` — ${truncate(doc.summary, 110)}` : '';
    const line = `- ${doc.id} "${truncate(doc.title, 80)}" (${STATUS_LABELS[doc.status]}${comments})${summary}`;
    if (used + line.length + 80 > INSTRUCTION_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  if (docs.length > shown) lines.push('- … more: call design_doc_list');
  return lines.join('\n');
}

export function registerAgentContext(
  zcc: Pick<ZccPluginApi, 'agents' | 'ui'>,
  store: DesignDocStore,
  log: (message: string) => void = () => {},
  projects?: ProjectNames
): void {
  zcc.agents.contributeInstructions((ctx) => {
    try {
      return buildInstructions(store, ctx.projectId || null);
    } catch (error) {
      log(`design docs instructions failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });

  zcc.ui.registerMentionProvider({
    id: 'design-doc',
    label: 'Design docs',
    search(ctx) {
      const query = typeof ctx === 'string' ? ctx : ctx.query;
      const projectId = typeof ctx === 'string' ? undefined : ctx.projectId;
      return store
        .list({ projectId: projectId || undefined, query, contents: false, status: 'active', limit: MENTION_SEARCH_LIMIT })
        .map((doc) => ({ id: doc.id, label: `${doc.title} · ${STATUS_LABELS[doc.status]}` }));
    },
    async resolve(itemId) {
      await projects?.refresh();
      const doc = store.get(itemId);
      const entry = doc.files.some((file) => file.path === doc.entryPath)
        ? store.readFile(doc.id, doc.entryPath)
        : null;
      const body = entry
        ? entry.content.length > MENTION_ENTRY_MAX_CHARS && entry.encoding === 'utf8'
          ? `${formatFile({ ...entry, content: entry.content.slice(0, MENTION_ENTRY_MAX_CHARS) })}\n(truncated — read the rest with design_doc_read)`
          : formatFile(entry)
        : '';
      return {
        context: [
          `The user referenced design doc ${doc.id}. Its current state:`,
          formatManifest(doc, { projectName: projects?.name(doc.projectId) ?? null }),
          body,
          `Read other files with design_doc_read doc="${doc.id}" path="…"; edit with design_doc_write.`
        ]
          .filter(Boolean)
          .join('\n\n')
      };
    }
  });
}
