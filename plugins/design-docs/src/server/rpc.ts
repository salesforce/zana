/**
 * RPC methods behind the Design Docs UI. Every mutation is attributed to the
 * user and announced on the realtime `changed` channel, exactly like agent
 * writes, so every open view refreshes.
 */
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { agentActionById, buildAgentPrompt, MAX_AGENT_PROMPT_LENGTH } from '../shared/agent-actions.js';
import { isDocStatus, type CommentStatus, type DocActor, type TextEdit } from '../shared/contract.js';
import { DESIGN_DOC_TEMPLATES } from '../shared/templates.js';
import { asInput, optionalString, requiredString } from './operations.js';
import { DesignDocError, type DesignDocStore } from './store.js';

export const UI_USER: DocActor = { kind: 'user', label: 'You', threadId: null };

export interface RpcDeps {
  store: DesignDocStore;
  changed(docId: string): void;
  sdk: Pick<ZccPluginApi['sdk'], 'threads' | 'projects'>;
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DesignDocError('invalid', `${key} must be an integer`);
  }
  return value;
}

function optionalStrings(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DesignDocError('invalid', `${key} must be an array of strings`);
  }
  return value as string[];
}

/** A title for a doc made from a chat message: its first heading, else its first line. */
export function titleFromMarkdown(text: string, fallback = 'Design doc from chat'): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,3}\s+\S/.test(line));
  const line = (heading ?? lines[0] ?? '')
    .replace(/^#+\s*|^[-*>]\s+/, '')
    .replace(/[*_`[\]]/g, '')
    .trim();
  if (!line) return fallback;
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

/** The methods as plain functions so tests can call them without a host. */
export function createRpcHandlers(deps: RpcDeps): Record<string, (args: unknown) => unknown> {
  const { store, changed } = deps;

  return {
    templates: () => DESIGN_DOC_TEMPLATES.map(({ id, label, description, files }) => ({
      id,
      label,
      description,
      files: files.map((file) => file.path)
    })),

    projects: async () => (await deps.sdk.projects.list()).map(({ id, name }) => ({ id, name })),

    list: (raw) => {
      const input = asInput(raw);
      const status = optionalString(input, 'status') ?? 'all';
      if (status !== 'all' && status !== 'active' && !isDocStatus(status)) {
        throw new DesignDocError('invalid', 'unknown status filter');
      }
      const projectId = input.projectId;
      return store.list({
        projectId: typeof projectId === 'string' && projectId ? projectId : undefined,
        query: optionalString(input, 'query'),
        status,
        limit: optionalNumber(input, 'limit') ?? 200
      });
    },

    get: (raw) => store.get(requiredString(asInput(raw), 'doc')),

    create: (raw) => {
      const input = asInput(raw);
      const projectId = optionalString(input, 'projectId');
      const status = optionalString(input, 'status');
      if (status !== undefined && !isDocStatus(status)) throw new DesignDocError('invalid', 'unknown status');
      const detail = store.create(
        {
          title: requiredString(input, 'title'),
          summary: optionalString(input, 'summary'),
          template: optionalString(input, 'template'),
          tags: optionalStrings(input, 'tags'),
          status,
          projectId: projectId || null
        },
        UI_USER
      );
      changed(detail.id);
      return detail;
    },

    update: (raw) => {
      const input = asInput(raw);
      const status = optionalString(input, 'status');
      if (status !== undefined && !isDocStatus(status)) throw new DesignDocError('invalid', 'unknown status');
      const projectId = input.projectId;
      if (projectId !== undefined && projectId !== null && typeof projectId !== 'string') {
        throw new DesignDocError('invalid', 'projectId must be a string or null');
      }
      const summary = store.update(
        requiredString(input, 'doc'),
        {
          title: optionalString(input, 'title'),
          summary: optionalString(input, 'summary'),
          status,
          tags: optionalStrings(input, 'tags'),
          entryPath: optionalString(input, 'entryPath'),
          projectId: projectId === undefined ? undefined : projectId || null
        },
        UI_USER
      );
      changed(summary.id);
      return summary;
    },

    remove: (raw) => {
      const doc = store.summary(requiredString(asInput(raw), 'doc'));
      store.remove(doc.id);
      changed(doc.id);
      return { ok: true };
    },

    readFile: (raw) => {
      const input = asInput(raw);
      return store.readFile(requiredString(input, 'doc'), requiredString(input, 'path'));
    },

    writeFile: (raw) => {
      const input = asInput(raw);
      const content = input.content;
      if (typeof content !== 'string') throw new DesignDocError('invalid', 'content must be a string');
      const result = store.writeFile(
        requiredString(input, 'doc'),
        {
          path: requiredString(input, 'path'),
          content,
          encoding: input.encoding === 'base64' ? 'base64' : undefined,
          baseRevision: optionalNumber(input, 'baseRevision'),
          note: optionalString(input, 'note')
        },
        UI_USER
      );
      changed(result.docId);
      return result;
    },

    editFile: (raw) => {
      const input = asInput(raw);
      if (!Array.isArray(input.edits)) throw new DesignDocError('invalid', 'edits must be an array');
      const result = store.editFile(
        requiredString(input, 'doc'),
        {
          path: requiredString(input, 'path'),
          edits: input.edits as TextEdit[],
          baseRevision: optionalNumber(input, 'baseRevision'),
          note: optionalString(input, 'note')
        },
        UI_USER
      );
      changed(result.docId);
      return result;
    },

    deleteFile: (raw) => {
      const input = asInput(raw);
      const doc = store.summary(requiredString(input, 'doc'));
      store.deleteFile(doc.id, requiredString(input, 'path'), UI_USER, {
        baseRevision: optionalNumber(input, 'baseRevision')
      });
      changed(doc.id);
      return { ok: true };
    },

    renameFile: (raw) => {
      const input = asInput(raw);
      const result = store.renameFile(
        requiredString(input, 'doc'),
        requiredString(input, 'from'),
        requiredString(input, 'to'),
        UI_USER
      );
      changed(result.docId);
      return result;
    },

    history: (raw) => {
      const input = asInput(raw);
      return store.history(requiredString(input, 'doc'), {
        path: optionalString(input, 'path'),
        limit: optionalNumber(input, 'limit')
      });
    },

    revision: (raw) => {
      const input = asInput(raw);
      return store.revisionContent(requiredString(input, 'doc'), input.id);
    },

    restore: (raw) => {
      const input = asInput(raw);
      const result = store.restoreRevision(requiredString(input, 'doc'), input.id, UI_USER);
      changed(result.docId);
      return result;
    },

    addComment: (raw) => {
      const input = asInput(raw);
      const comment = store.addComment(
        requiredString(input, 'doc'),
        { body: requiredString(input, 'body'), path: optionalString(input, 'path'), quote: optionalString(input, 'quote') },
        UI_USER
      );
      changed(comment.docId);
      return comment;
    },

    setCommentStatus: (raw) => {
      const input = asInput(raw);
      const status = requiredString(input, 'status') as CommentStatus;
      const comment = store.setCommentStatus(requiredString(input, 'doc'), input.id, status, UI_USER);
      changed(comment.docId);
      return comment;
    },

    deleteComment: (raw) => {
      const input = asInput(raw);
      const doc = store.summary(requiredString(input, 'doc'));
      store.deleteComment(doc.id, input.id, UI_USER);
      changed(doc.id);
      return { ok: true };
    },

    unlinkThread: (raw) => {
      const input = asInput(raw);
      const doc = store.summary(requiredString(input, 'doc'));
      store.unlinkThread(doc.id, requiredString(input, 'threadId'));
      changed(doc.id);
      return { ok: true };
    },

    /**
     * "Save as design doc" on a chat message. The project comes from the
     * thread itself, never from the renderer.
     */
    createFromMessage: async (raw) => {
      const input = asInput(raw);
      const threadId = requiredString(input, 'threadId');
      const text = requiredString(input, 'text');
      const thread = await deps.sdk.threads.get({ threadId });
      if (!thread) throw new Error(`Thread ${threadId} was not found.`);
      const detail = store.create(
        {
          title: optionalString(input, 'title')?.trim() || titleFromMarkdown(text),
          projectId: thread.projectId ?? null,
          files: [{ path: 'README.md', content: text }]
        },
        UI_USER
      );
      store.linkThread(detail.id, threadId, thread.title?.trim() || 'Agent thread', 'assistant');
      changed(detail.id);
      return store.summary(detail.id);
    },

    /** Start an agent thread already briefed on this doc and link it. */
    askAgent: async (raw) => {
      const input = asInput(raw);
      const doc = store.summary(requiredString(input, 'doc'));
      const actionId = optionalString(input, 'action');
      const action = actionId ? agentActionById(actionId) : null;
      if (actionId && !action) throw new DesignDocError('invalid', `unknown agent action ${actionId}`);
      const prompt = optionalString(input, 'prompt')?.trim() ?? '';
      if (!action && !prompt) throw new DesignDocError('invalid', 'pick an action or write a request');
      if (prompt.length > MAX_AGENT_PROMPT_LENGTH) {
        throw new DesignDocError('invalid', `request must be at most ${MAX_AGENT_PROMPT_LENGTH} characters`);
      }
      const projectId = doc.projectId ?? (optionalString(input, 'projectId') || null);
      if (!projectId) {
        throw new DesignDocError('invalid', 'this doc is global; choose a project for the agent to run in');
      }
      const title = `${action ? action.label : 'Design doc'} · ${doc.title}`.slice(0, 120);
      const providerId = optionalString(input, 'providerId');
      const thread = await deps.sdk.threads.spawn({
        projectId,
        prompt: buildAgentPrompt({ doc, action, prompt, path: optionalString(input, 'path') }),
        title,
        ...(providerId ? { providerId } : {}),
        visibility: 'visible',
        pluginMetadata: { designDocId: doc.id, ...(action ? { action: action.id } : {}) }
      });
      store.linkThread(doc.id, thread.id, title, action?.id === 'review' ? 'reviewer' : 'assistant');
      changed(doc.id);
      return { threadId: thread.id, projectId };
    }
  };
}

export function registerRpc(zcc: Pick<ZccPluginApi, 'rpc'>, deps: RpcDeps): void {
  for (const [name, handler] of Object.entries(createRpcHandlers(deps))) {
    zcc.rpc.method(name, handler);
  }
}
