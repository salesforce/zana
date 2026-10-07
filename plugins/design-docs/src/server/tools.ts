import type { PluginAgentToolContext, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { DOC_STATUSES, type DocActor } from '../shared/contract.js';
import { DESIGN_DOC_TEMPLATES } from '../shared/templates.js';
import {
  commentDoc,
  createDoc,
  listDocs,
  readDoc,
  updateDoc,
  writeDoc,
  type OperationContext
} from './operations.js';
import type { DesignDocStore } from './store.js';

const docRef = {
  type: 'string',
  description: 'Design doc id (dd_…) or slug, as shown by design_doc_list or the instructions catalog.'
} as const;

const TEMPLATE_IDS = DESIGN_DOC_TEMPLATES.map((template) => template.id);

export const TOOL_NAMES = [
  'design_doc_list',
  'design_doc_read',
  'design_doc_create',
  'design_doc_write',
  'design_doc_update',
  'design_doc_comment'
] as const;

export interface ToolDeps {
  store: DesignDocStore;
  changed(docId: string): void;
  actorFor(threadId: string): Promise<DocActor>;
}

/** Thread titles are fetched once per thread; failures fall back to "Agent". */
export function createActorResolver(
  getThread: (threadId: string) => Promise<{ title?: string | null; titleFallback?: string | null } | null>,
  maxEntries = 200
): (threadId: string) => Promise<DocActor> {
  const cache = new Map<string, string>();
  return async (threadId) => {
    let label = cache.get(threadId);
    if (label === undefined) {
      try {
        const thread = await getThread(threadId);
        label = (thread?.title || thread?.titleFallback || '').trim() || 'Agent';
      } catch {
        label = 'Agent';
      }
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
      cache.set(threadId, label);
    }
    return { kind: 'agent', label, threadId };
  };
}

export function registerDesignDocTools(zcc: Pick<ZccPluginApi, 'agents'>, deps: ToolDeps): void {
  const context = (ctx: PluginAgentToolContext): OperationContext => ({
    store: deps.store,
    changed: deps.changed,
    projectId: ctx.projectId || null
  });

  zcc.agents.registerTool({
    name: 'design_doc_list',
    description:
      'List design documents (specs, RFCs, ADRs, product docs) that the user keeps in the Design Docs plugin. ' +
      'Defaults to active docs of the current project plus global docs. Use query to search titles, summaries, tags and file contents.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search.' },
        status: {
          type: 'string',
          enum: ['active', 'all', ...DOC_STATUSES],
          description: 'active (default) hides archived docs.'
        },
        scope: { type: 'string', enum: ['project', 'all'], description: 'project (default) or every project.' },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    },
    presentation: { label: { pending: 'Listing design docs', completed: 'Listed design docs' }, icon: { glyph: 'Search' } },
    execute: (input, ctx) => listDocs(context(ctx), input)
  });

  zcc.agents.registerTool({
    name: 'design_doc_read',
    description:
      'Read a design doc. A design doc is a small project of files (markdown, mermaid .mmd diagrams, HTML mockups, code, images). ' +
      'Without path: returns the manifest (files with revisions, open review comments) and the entry file. ' +
      'With path: returns that file and its revision. includeAll=true returns every text file at once. ' +
      'Always read before editing, and treat open comments as review feedback to address.',
    parameters: {
      type: 'object',
      properties: {
        doc: docRef,
        path: { type: 'string', description: 'File path inside the doc, e.g. README.md or diagrams/flow.mmd.' },
        includeAll: { type: 'boolean', description: 'Return all text files (bounded) instead of just the entry file.' }
      },
      required: ['doc'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Reading design doc', completed: 'Read design doc' }, icon: { glyph: 'FileText' } },
    execute: (input, ctx) => readDoc(context(ctx), input)
  });

  zcc.agents.registerTool({
    name: 'design_doc_create',
    description:
      'Create a new design doc the user can review in the Design Docs panel. Pass files to write your own content, ' +
      `or a template to start from (${TEMPLATE_IDS.join(', ')}). The doc belongs to the current project unless global=true. ` +
      'Write rich GitHub-flavoured markdown: headings, tables, task lists, ```mermaid diagrams and $math$ all render. ' +
      'Put larger diagrams in .mmd files and UI mockups in self-contained .html files.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Human title, e.g. "Offline sync for mobile".' },
        summary: { type: 'string', description: 'One or two sentences shown in lists.' },
        template: { type: 'string', enum: TEMPLATE_IDS, description: 'Starter files when files is omitted.' },
        tags: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: [...DOC_STATUSES] },
        global: { type: 'boolean', description: 'Make the doc visible to every project.' },
        files: {
          type: 'array',
          description: 'Initial files. Include a README.md as the entry point.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'base64 only for images.' }
            },
            required: ['path', 'content'],
            additionalProperties: false
          }
        }
      },
      required: ['title'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Creating design doc', completed: 'Created design doc' }, icon: { glyph: 'File' } },
    execute: async (input, ctx) => createDoc(context(ctx), input, await deps.actorFor(ctx.threadId))
  });

  zcc.agents.registerTool({
    name: 'design_doc_write',
    description:
      'Change one file in a design doc. Pass exactly one of: edits (exact-match find/replace, preferred for changes), ' +
      'content (whole file; creates the file if it does not exist), delete=true, or renameTo. ' +
      'Pass baseRevision (the revision you last read) so you never overwrite a concurrent edit by the user; ' +
      'on a conflict, re-read the file and reapply. Every write is kept in history and appears live in the panel.',
    parameters: {
      type: 'object',
      properties: {
        doc: docRef,
        path: { type: 'string', description: 'File path inside the doc. New folders are created implicitly.' },
        edits: {
          type: 'array',
          description: 'Applied in order. oldText must match exactly once unless replaceAll is set.',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string' },
              newText: { type: 'string' },
              replaceAll: { type: 'boolean' }
            },
            required: ['oldText', 'newText'],
            additionalProperties: false
          }
        },
        content: { type: 'string', description: 'Full new file content.' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'base64 only for images.' },
        delete: { type: 'boolean' },
        renameTo: { type: 'string' },
        baseRevision: { type: 'integer', minimum: 0, description: 'Revision you read; 0 asserts the file is new.' },
        note: { type: 'string', description: 'Short change note shown in history.' }
      },
      required: ['doc', 'path'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Editing design doc', completed: 'Edited design doc' }, icon: { glyph: 'EditFile' } },
    execute: async (input, ctx) => writeDoc(context(ctx), input, await deps.actorFor(ctx.threadId))
  });

  zcc.agents.registerTool({
    name: 'design_doc_update',
    description:
      'Update design doc metadata: title, summary, status (draft → review → approved → implemented, or archived), tags, or the entry file.',
    parameters: {
      type: 'object',
      properties: {
        doc: docRef,
        title: { type: 'string' },
        summary: { type: 'string' },
        status: { type: 'string', enum: [...DOC_STATUSES] },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replaces the tag list.' },
        entryPath: { type: 'string', description: 'File shown first when the doc opens.' }
      },
      required: ['doc'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Updating design doc', completed: 'Updated design doc' }, icon: { glyph: 'EditFile' } },
    execute: async (input, ctx) => updateDoc(context(ctx), input, await deps.actorFor(ctx.threadId))
  });

  zcc.agents.registerTool({
    name: 'design_doc_comment',
    description:
      'Leave a review comment on a design doc (optionally anchored to a file and a quoted passage), ' +
      'or resolve / reopen an existing comment by id. Resolve comments once your edits address them, ' +
      'with body explaining what changed.',
    parameters: {
      type: 'object',
      properties: {
        doc: docRef,
        body: { type: 'string', description: 'Comment text (markdown). With resolve, posted as a reply.' },
        path: { type: 'string', description: 'File the comment is about.' },
        quote: { type: 'string', description: 'Exact passage the comment refers to.' },
        resolve: { type: 'string', description: 'Comment id to mark resolved.' },
        reopen: { type: 'string', description: 'Comment id to reopen.' }
      },
      required: ['doc'],
      additionalProperties: false
    },
    presentation: {
      label: { pending: 'Commenting on design doc', completed: 'Commented on design doc' },
      icon: { glyph: 'ListTodo' }
    },
    execute: async (input, ctx) => commentDoc(context(ctx), input, await deps.actorFor(ctx.threadId))
  });
}
