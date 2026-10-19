/**
 * RPC methods behind the Design Docs UI. Every mutation is attributed to the
 * user and announced on the realtime `changed` channel, exactly like agent
 * writes, so every open view refreshes.
 */
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { agentActionById, buildAgentPrompt, MAX_AGENT_PROMPT_LENGTH } from '../shared/agent-actions.js';
import { isDocStatus, type CommentStatus, type DocActor, type TextEdit } from '../shared/contract.js';
import type { PageFile } from '../shared/frame-protocol.js';
import { normalizeDocPath } from '../shared/paths.js';
import { buildPublishPrompt, parsePublishTarget, PublishTargetError } from '../shared/publish.js';
import { DESIGN_DOC_TEMPLATES } from '../shared/templates.js';
import { asInput, optionalString, requiredString } from './operations.js';
import { docPageReader, NO_KIT, renderPage, type KitReader } from './pages.js';
import { parseRenderReport, type RenderReports } from './render-reports.js';
import { siteFiles } from './site-files.js';
import { DesignDocError, type DesignDocStore } from './store.js';
import type { DesignDocPeerService } from './peer-service.js';
import type { DesignDocPairing } from './pairing.js';
import type { DesignDocBackups } from './backup.js';

export const UI_USER: DocActor = { kind: 'user', label: 'You', threadId: null };

export interface RpcDeps {
  store: DesignDocStore;
  changed(docId: string): void;
  sdk: Pick<ZccPluginApi['sdk'], 'threads' | 'projects' | 'peers'>;
  peerSync?: DesignDocPeerService;
  pairing?: DesignDocPairing;
  /** The bundled site kit behind `zcc-kit/` paths. */
  kit?: KitReader;
  /** Absolute URL of a doc page served standalone, for "Open in browser". */
  pageUrl?(docId: string, path: string): string;
  /** Where the panel's page runs are kept for agents. */
  reports?: RenderReports;
  /** Full-database backups and the restore evidence recorded at startup. */
  backups?: DesignDocBackups;
  localPeerId?(): string | null;
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

function requirePairing(deps: RpcDeps): DesignDocPairing {
  if (!deps.pairing) throw new DesignDocError('invalid', 'database group setup is unavailable');
  return deps.pairing;
}

/** Invitation RPCs take a closed set of keys, so a renderer cannot smuggle hosts, locators or credentials. */
function onlyKeys(raw: unknown, allowed: string[]): Record<string, unknown> {
  const input = asInput(raw);
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new DesignDocError('invalid', `accepts only ${allowed.join(', ')}`);
  return input;
}

/** The methods as plain functions so tests can call them without a host. */
export function createRpcHandlers(deps: RpcDeps): Record<string, (args: unknown) => unknown> {
  const { store, changed } = deps;
  /** A project the renderer picked must be one the host has registered. */
  const requireProject = async (projectId: string | null | undefined) => {
    if (!projectId) return;
    const projects = await deps.sdk.projects.list();
    if (!projects.some((project) => project.id === projectId)) {
      throw new DesignDocError('invalid', `unknown project ${projectId}`);
    }
  };
  /**
   * Every Design Docs agent goes through here: it always runs on the project's
   * AI harness and that harness's overrides (`harness: 'project-default'`); the
   * renderer cannot pick a provider.
   */
  const spawnAgent = async (
    args: Omit<Parameters<RpcDeps['sdk']['threads']['spawn']>[0], 'providerId' | 'harness'>
  ) => deps.sdk.threads.spawn({ ...args, harness: 'project-default' });

  return {
    templates: () => DESIGN_DOC_TEMPLATES.map(({ id, label, description, files }) => ({
      id,
      label,
      description,
      files: files.map((file) => file.path)
    })),

    projects: async () => (await deps.sdk.projects.list()).map(({ id, name, quickAgent }) => ({ id, name, ...(quickAgent ? { quickAgent: true } : {}) })),

    backupDatabase: async () => {
      if (!deps.backups?.available) throw new DesignDocError('invalid', 'database backup is unavailable');
      return deps.backups.create(deps.localPeerId?.() ?? null);
    },

    backups: () => deps.backups?.list() ?? { backups: [], restores: [] },

    // `connected` is what the Sync button counts: this computer plus every member with a live link.
    peerStatus: async () => {
      const local = deps.peerSync?.status() ?? null;
      if (!local?.configured) return local ?? { configured: false, members: [] };
      const connected = new Set(await deps.pairing?.connectedMembers().catch((error: unknown) => {
        console.warn('[design-docs] connectedMembers failed; showing members as disconnected:', error instanceof Error ? error.message : error);
        return [] as string[];
      }) ?? []);
      return { ...local, members: local.members.map((member) => ({ ...member, connected: member.replicaId === local.replicaId || connected.has(member.machineId) })) };
    },

    groupStatus: () => requirePairing(deps).status(),

    // Never a roster: the only accepted key is the peer id.
    enablePeer: (raw) => requirePairing(deps).enable(requiredString(onlyKeys(raw, ['peerId']), 'peerId')),

    connections: () => requirePairing(deps).connections(),

    useConnection: (raw) => requirePairing(deps).useConnection(requiredString(onlyKeys(raw, ['computerId']), 'computerId')),

    stopUsingConnection: (raw) => requirePairing(deps).stopUsingConnection(requiredString(onlyKeys(raw, ['computerId']), 'computerId')),

    repairPeer: (raw) => requirePairing(deps).repair(requiredString(onlyKeys(raw, ['peerId']), 'peerId')),

    resetPeerSync: (raw) => requirePairing(deps).resetPeer(requiredString(onlyKeys(raw, ['peerId']), 'peerId')),

    peersOutOfSync: async () => ({ outOfSync: await requirePairing(deps).outOfSync() }),

    retryIntroductions: async () => {
      const pairing = requirePairing(deps);
      await pairing.retry(true);
      return pairing.status();
    },

    removePeer: (raw) => requirePairing(deps).remove(requiredString(onlyKeys(raw, ['replicaId']), 'replicaId')),

    syncNow: async () => {
      if (!deps.peerSync) throw new DesignDocError('invalid', 'peer sync is unavailable');
      const result = await deps.peerSync.syncNow(deps.sdk.peers);
      // Peers re-check their out-of-sync notice once this side finished; not awaited, never fails the sync.
      void deps.pairing?.notifyStateChanged().catch((error: unknown) => {
        console.warn('[design-docs] peer state-change notification failed after sync:', error instanceof Error ? error.message : error);
      });
      return result;
    },

    peerConflicts: (raw) => {
      const input = asInput(raw), doc = store.summary(requiredString(input, 'doc'));
      return deps.peerSync?.conflicts(doc.id, optionalString(input, 'cursor')) ?? { remoteHeads: [], nextCursor: null };
    },

    peerConflictReview: (raw) => {
      const input = asInput(raw), doc = store.summary(requiredString(input, 'doc'));
      if (!deps.peerSync) throw new DesignDocError('invalid', 'peer sync is unavailable');
      return deps.peerSync.conflictReview(doc.id, requiredString(input, 'remoteHead'));
    },

    peerConflictFile: (raw) => {
      const input = asInput(raw), doc = store.summary(requiredString(input, 'doc'));
      if (!deps.peerSync) throw new DesignDocError('invalid', 'peer sync is unavailable');
      return deps.peerSync.conflictFile(doc.id, requiredString(input, 'remoteHead'), requiredString(input, 'path'));
    },

    resolvePeerConflict: (raw) => {
      const input = asInput(raw), doc = store.summary(requiredString(input, 'doc'));
      if (!deps.peerSync) throw new DesignDocError('invalid', 'peer sync is unavailable');
      if (input.choice !== 'merge' && input.choice !== 'local' && input.choice !== 'remote') throw new DesignDocError('invalid', 'invalid peer resolution choice');
      const head = deps.peerSync.resolveConflict({ docId: doc.id, expectedHead: requiredString(input, 'expectedHead'),
        remoteHead: requiredString(input, 'remoteHead'), choice: input.choice }, UI_USER);
      return { head };
    },

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

    create: async (raw) => {
      const input = asInput(raw);
      const projectId = optionalString(input, 'projectId');
      const status = optionalString(input, 'status');
      if (status !== undefined && !isDocStatus(status)) throw new DesignDocError('invalid', 'unknown status');
      await requireProject(projectId);
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

    update: async (raw) => {
      const input = asInput(raw);
      const status = optionalString(input, 'status');
      if (status !== undefined && !isDocStatus(status)) throw new DesignDocError('invalid', 'unknown status');
      const projectId = input.projectId;
      if (projectId !== undefined && projectId !== null && typeof projectId !== 'string') {
        throw new DesignDocError('invalid', 'projectId must be a string or null');
      }
      await requireProject(projectId);
      const alternativeTo = input.alternativeTo;
      if (alternativeTo !== undefined && alternativeTo !== null && typeof alternativeTo !== 'string') {
        throw new DesignDocError('invalid', 'alternativeTo must be a string or null');
      }
      const summary = store.update(
        requiredString(input, 'doc'),
        {
          title: optionalString(input, 'title'),
          summary: optionalString(input, 'summary'),
          status,
          tags: optionalStrings(input, 'tags'),
          entryPath: optionalString(input, 'entryPath'),
          expectedHead: input.expectedHead === null ? null : optionalString(input, 'expectedHead'),
          projectId: projectId === undefined ? undefined : projectId || null,
          alternativeTo: alternativeTo === undefined ? undefined : alternativeTo || null
        },
        UI_USER
      );
      changed(summary.id);
      return summary;
    },

    pin: (raw) => {
      const input = asInput(raw);
      if (typeof input.pinned !== 'boolean') throw new DesignDocError('invalid', 'pinned must be a boolean');
      const summary = store.setPinned(requiredString(input, 'doc'), input.pinned);
      changed(summary.id);
      return summary;
    },

    remove: (raw) => {
      const doc = store.summary(requiredString(asInput(raw), 'doc'));
      store.remove(doc.id, UI_USER);
      changed(doc.id);
      return { ok: true };
    },

    /** An HTML page bundled for the preview frame; `draft` renders unsaved edits. */
    renderPage: (raw) => {
      const input = asInput(raw);
      const draft = input.draft;
      if (draft !== undefined && typeof draft !== 'string') throw new DesignDocError('invalid', 'draft must be a string');
      return renderPage(store, deps.kit ?? NO_KIT, {
        doc: requiredString(input, 'doc'),
        path: optionalString(input, 'path'),
        draft
      });
    },

    /** A file a rendered page fetches, with the site kit behind `zcc-kit/`; null when the doc has none. */
    readPageFile: (raw): PageFile | null => {
      const input = asInput(raw);
      const doc = store.summary(requiredString(input, 'doc'));
      const requested = requiredString(input, 'path');
      let path: string;
      try {
        path = normalizeDocPath(requested);
      } catch {
        return null;
      }
      const file = docPageReader(store, doc.id, deps.kit ?? NO_KIT)(path);
      return file ? { kind: file.kind, encoding: file.encoding, content: file.content } : null;
    },

    /** The doc as `export --out` writes it, for "Download". */
    siteFiles: (raw) => {
      const doc = store.summary(requiredString(asInput(raw), 'doc'));
      return { slug: doc.slug, files: siteFiles(store.readAllFiles(doc.id), deps.kit ?? NO_KIT) };
    },

    pageLink: (raw) => {
      const input = asInput(raw);
      const doc = store.summary(requiredString(input, 'doc'));
      if (!deps.pageUrl) throw new DesignDocError('invalid', 'standalone pages are not served here');
      let path: string;
      try {
        path = normalizeDocPath(optionalString(input, 'path') ?? doc.entryPath);
      } catch (error) {
        throw new DesignDocError('invalid', (error as Error).message);
      }
      return { url: deps.pageUrl(doc.id, path) };
    },

    reportRender: (raw) => {
      const input = asInput(raw);
      const doc = store.summary(requiredString(input, 'doc'));
      deps.reports?.record(doc.id, parseRenderReport(input));
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
          baseFileId: input.baseFileId === null ? null : optionalString(input, 'baseFileId'),
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
          baseFileId: input.baseFileId === null ? null : optionalString(input, 'baseFileId'),
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
        baseRevision: optionalNumber(input, 'baseRevision'),
        baseFileId: input.baseFileId === null ? null : optionalString(input, 'baseFileId')
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
        UI_USER,
        { baseRevision: optionalNumber(input, 'baseRevision'), baseFileId: input.baseFileId === null ? null : optionalString(input, 'baseFileId') }
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
      const result = store.restoreRevision(requiredString(input, 'doc'), input.id, UI_USER, {
        baseRevision: optionalNumber(input, 'baseRevision'),
        baseFileId: input.baseFileId === null ? null : optionalString(input, 'baseFileId')
      });
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

    replyToComment: (raw) => {
      const input = asInput(raw);
      const comment = store.addReply(requiredString(input, 'doc'), input.id, requiredString(input, 'body'), UI_USER);
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
      const detail = store.createImported(
        {
          title: optionalString(input, 'title')?.trim() || titleFromMarkdown(text),
          projectId: thread.projectId ?? null,
          files: [{ path: 'README.md', content: text }]
        },
        UI_USER,
        { id: threadId, title: thread.title?.trim() || 'Agent thread' }
      );
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
      if (!doc.projectId) await requireProject(projectId);
      const title = `${action ? action.label : 'Design doc'} · ${doc.title}`.slice(0, 120);
      const thread = await spawnAgent({
        projectId,
        prompt: buildAgentPrompt({ doc, action, prompt, path: optionalString(input, 'path') }),
        title,
        visibility: 'hidden',
        pluginMetadata: { designDocId: doc.id, ...(action ? { action: action.id } : {}), panelAgent: panelAgent(doc.id) }
      });
      store.linkThread(doc.id, thread.id, title, action?.id === 'review' ? 'reviewer' : 'assistant');
      changed(doc.id);
      return { threadId: thread.id, projectId };
    },

    /** Start an agent thread that exports the doc as a site, commits and pushes it to GitHub Pages. */
    publish: async (raw) => {
      const input = asInput(raw);
      const doc = store.summary(requiredString(input, 'doc'));
      let target;
      try {
        target = parsePublishTarget(input);
      } catch (error) {
        if (error instanceof PublishTargetError) throw new DesignDocError('invalid', error.message);
        throw error;
      }
      if (!store.get(doc.id).files.some((file) => file.kind === 'html')) {
        throw new DesignDocError('invalid', 'this doc has no HTML pages to publish; add an index.html first');
      }
      const projectId = doc.projectId ?? (optionalString(input, 'projectId') || null);
      if (!projectId) {
        throw new DesignDocError('invalid', 'this doc is global; choose a project for the agent to run in');
      }
      if (!doc.projectId) await requireProject(projectId);
      const title = `Publish · ${doc.title}`.slice(0, 120);
      const thread = await spawnAgent({
        projectId,
        prompt: buildPublishPrompt({ doc, target }),
        title,
        visibility: 'hidden',
        pluginMetadata: { designDocId: doc.id, action: 'publish', panelAgent: panelAgent(doc.id) }
      });
      store.linkThread(doc.id, thread.id, title, 'assistant');
      changed(doc.id);
      return { threadId: thread.id, projectId };
    }
  };
}

/** The nav panel's path (`NAV_PATH` in the app). */
const NAV_PANEL = 'design-docs';

/**
 * Agents run in the side panel of the doc's page, not the Agents list: the
 * host lists these among the panel's conversations, grounds them in the doc's
 * view, and "Open as thread" moves one to the Agents list.
 */
function panelAgent(docId: string) {
  return { panel: NAV_PANEL, view: docId };
}

export function registerRpc(zcc: Pick<ZccPluginApi, 'rpc'>, deps: RpcDeps): void {
  for (const [name, handler] of Object.entries(createRpcHandlers(deps))) {
    zcc.rpc.method(name, handler);
  }
}
