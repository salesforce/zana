/**
 * Agent knows the screen (WS-1): the Studio publishes a bounded "what the user
 * is looking at" snapshot, the server keeps it briefly in memory, and exposes it
 * three ways - studio.view.get (sf_workbench view.state, live), a one-shot
 * contributeInstructions section, and @-mention providers.
 */
import { formatComments, formatDiagnostics } from './studio-agent-actions.js';
import { isStudioComment, isStudioViewState, STUDIO_RPC, type StudioComment, type StudioViewState } from './studio-contract.js';
import { rpcFailure, type StudioServerContext } from './studio-server-context.js';

export const VIEW_TTL_MS = 60_000;
export const VIEW_MAX_ENTRIES = 40;
export const INSTRUCTIONS_MAX_CHARS = 1200;
const PROJECT_SCOPE = 'project';
const MAX_ID_PART = 300;

interface Entry { projectId: string; threadId: string | null; state: StudioViewState; receivedAt: number }

/** In-memory, bounded, TTL'd store of the latest shared view per project (and per thread). */
export class StudioViewStore {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now) {}

  private key(projectId: string, threadId: string | null) { return `${projectId}:${threadId || PROJECT_SCOPE}`; }
  private fresh(entry: Entry | undefined): Entry | null {
    if (!entry) return null;
    if (this.now() - entry.receivedAt > VIEW_TTL_MS) { this.entries.delete(this.key(entry.projectId, entry.threadId)); return null; }
    return entry;
  }

  /** Stores the view when `share` is on; a `share:false` publish forgets what was shared. */
  publish(projectId: string, state: StudioViewState, threadId: string | null = null): boolean {
    const key = this.key(projectId, threadId);
    if (!state.share) { this.entries.delete(key); return false; }
    this.entries.delete(key);
    this.entries.set(key, { projectId, threadId, state, receivedAt: this.now() });
    this.sweep();
    return true;
  }

  private sweep() {
    for (const [key, entry] of this.entries) if (!this.fresh(entry)) this.entries.delete(key);
    while (this.entries.size > VIEW_MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
  }

  /** The thread's own view when it has one, else the project's. */
  get(projectId: string, threadId?: string | null): Entry | null {
    return (threadId ? this.fresh(this.entries.get(this.key(projectId, threadId))) : null) ?? this.fresh(this.entries.get(this.key(projectId, null)));
  }

  /** Most recently published fresh view of the project from any surface. */
  latest(projectId: string): Entry | null {
    let best: Entry | null = null;
    for (const entry of [...this.entries.values()]) {
      if (entry.projectId !== projectId || !this.fresh(entry)) continue;
      if (!best || entry.receivedAt >= best.receivedAt) best = entry;
    }
    return best;
  }

  get size() { return this.entries.size; }
}

const stores = new WeakMap<object, StudioViewStore>();
/** One store per plugin instance, shared by view + threads registrations. */
export function viewStoreFor(zcc: object, now?: () => number): StudioViewStore {
  let store = stores.get(zcc);
  if (!store) { store = new StudioViewStore(now); stores.set(zcc, store); }
  return store;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Compact human/agent-readable rendering of one view. */
export function describeView(state: StudioViewState, ageMs = 0): string {
  const lines = [
    `Surface: ${state.surface}${state.tool ? `, tool: ${state.tool}` : ''}${state.orgAlias ? `, org: ${state.orgAlias}` : ''}`,
    `File: ${state.path ?? '(unsaved draft)'}${state.dirty ? ' (unsaved edits)' : ''}`
  ];
  if (state.selection) lines.push(`Selection: lines ${state.selection.startLine}-${state.selection.endLine}: "${clip(oneLine(state.selection.text), 200)}"`);
  else if (state.cursor) lines.push(`Cursor: line ${state.cursor.line}`);
  if (state.lastRun) lines.push(`Last preview run: ${state.lastRun.runId} (${state.lastRun.engine}${state.lastRun.turn !== undefined ? `, turn ${state.lastRun.turn}` : ''})`);
  if (state.diagnostics.length) lines.push(`Problems (${state.diagnostics.length}):`, ...formatDiagnostics(state.diagnostics, 5));
  if (ageMs > 5000) lines.push(`(updated ${Math.round(ageMs / 1000)}s ago)`);
  return lines.join('\n');
}

/**
 * The single contributeInstructions section. Providers run at thread
 * create/resume only, so it is a snapshot plus a pointer to the live source.
 */
export function buildViewInstructions(store: StudioViewStore, ctx: { projectId: string; threadId?: string }): string | null {
  if (!ctx.projectId) return null;
  const entry = store.get(ctx.projectId, ctx.threadId) ?? store.latest(ctx.projectId);
  if (!entry) return null;
  const head = 'The user is currently viewing the Salesforce Studio (as of thread start). Call sf_workbench view.state for the live screen before acting on "this", "here" or "the selection".';
  const text = `${head}\n${describeView(entry.state)}`;
  return clip(text, INSTRUCTIONS_MAX_CHARS);
}

/** Open (unresolved) comments for a path, read defensively from the comments store (owned by studio-comments). */
export async function readOpenComments(kv: { get<T>(key: string): Promise<T | undefined> }, projectId: string, path: string | null): Promise<StudioComment[]> {
  try {
    const doc = await kv.get<unknown>(`studio:comments:${projectId}`);
    const rows = Array.isArray(doc) ? doc : doc && typeof doc === 'object' && Array.isArray((doc as { comments?: unknown }).comments) ? (doc as { comments: unknown[] }).comments : [];
    return rows.filter(isStudioComment).filter(c => !c.resolved && (path === null || c.path === path));
  } catch { return []; }
}

const part = (value: string) => encodeURIComponent(value.slice(0, MAX_ID_PART)).replace(/~/g, '%7E');
function parseItemId(itemId: string): { kind: string; projectId: string; path: string } {
  const [kind = '', projectId = '', path = ''] = itemId.split('~');
  const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return ''; } };
  return { kind, projectId: decode(projectId), path: decode(path) };
}

export function registerStudioContext(studio: StudioServerContext): void {
  const { zcc } = studio;
  const store = viewStoreFor(zcc);
  const projectOf = () => studio.contexts.current()?.projectId ?? '';
  const record = (args: unknown) => (args && typeof args === 'object' ? args as Record<string, unknown> : {});

  studio.registerRpc(STUDIO_RPC.viewPublish, args => {
    const projectId = projectOf();
    if (!projectId) return rpcFailure('project_required', 'Choose a project to share the Studio view.');
    const input = record(args);
    const state = input.state;
    if (!isStudioViewState(state)) return rpcFailure('invalid_input', 'Invalid Studio view state.');
    const threadId = typeof input.threadId === 'string' && input.threadId.length <= 200 ? input.threadId : null;
    return { ok: true, shared: store.publish(projectId, state, threadId) };
  });

  studio.registerRpc(STUDIO_RPC.viewGet, args => {
    const projectId = projectOf();
    if (!projectId) return rpcFailure('project_required', 'Choose a project to read the Studio view.');
    const input = record(args);
    const threadId = typeof input.threadId === 'string' ? input.threadId : null;
    const entry = store.get(projectId, threadId) ?? store.latest(projectId);
    if (!entry) return { ok: true, shared: false, state: null, note: 'The Studio is not open or the user is not sharing their view.' };
    const ageMs = Math.max(0, Date.now() - entry.receivedAt);
    return { ok: true, shared: true, state: entry.state, ageMs, summary: describeView(entry.state, ageMs) };
  });

  try {
    zcc.agents.contributeInstructions(ctx => {
      try { return buildViewInstructions(store, ctx); } catch { return null; }
    });
  } catch (error) { zcc.log.warn(`studio view instructions not registered: ${error instanceof Error ? error.message : String(error)}`); }

  zcc.ui.registerMentionProvider({
    id: 'sf-agent',
    label: 'Salesforce agent file',
    search(raw) {
      const ctx = typeof raw === 'string' ? { query: raw, projectId: undefined } : raw;
      const projectId = ctx.projectId ?? '';
      if (!projectId) return [];
      const query = ctx.query.trim().toLowerCase();
      const path = store.latest(projectId)?.state.path;
      if (!path || (query && !path.toLowerCase().includes(query) && !'comments diagnostics problems'.includes(query))) return [];
      const base = path.split('/').pop() ?? path;
      return [
        { id: `file~${part(projectId)}~${part(path)}`, label: `${base} - agent file, comments and problems` },
        { id: `comments~${part(projectId)}~${part(path)}`, label: `${base} - open comments` }
      ];
    },
    async resolve(itemId) {
      const { kind, projectId, path } = parseItemId(itemId);
      if (!projectId || !path || (kind !== 'file' && kind !== 'comments')) throw new Error('Unknown Salesforce agent reference.');
      const comments = await readOpenComments(zcc.storage.kv, projectId, path);
      const state = store.get(projectId)?.state ?? store.latest(projectId)?.state;
      const diagnostics = kind === 'file' && state?.path === path ? state.diagnostics : [];
      return { context: [
        `The user referenced the Agent Script file ${path} (read it with sf_workbench files.read).`,
        comments.length ? `Open comments:\n${formatComments(comments, 20).join('\n')}` : 'No open comments.',
        diagnostics.length ? `Problems:\n${formatDiagnostics(diagnostics).join('\n')}` : ''
      ].filter(Boolean).join('\n\n') };
    }
  });

  zcc.ui.registerMentionProvider({
    id: 'sf-view',
    label: 'Salesforce Studio',
    search(raw) {
      const ctx = typeof raw === 'string' ? { query: raw, projectId: undefined } : raw;
      const projectId = ctx.projectId ?? '';
      if (!projectId || !store.latest(projectId)) return [];
      if (ctx.query && !'current screen studio view'.includes(ctx.query.trim().toLowerCase())) return [];
      return [{ id: `view~${part(projectId)}`, label: 'Current Studio screen' }];
    },
    resolve(itemId) {
      const { projectId } = parseItemId(itemId);
      const entry = projectId ? store.latest(projectId) : null;
      if (!entry) return { context: 'The Studio view is not being shared right now. Call sf_workbench view.state if you need it.' };
      return { context: `The user referenced their current Studio screen:\n${describeView(entry.state, Date.now() - entry.receivedAt)}` };
    }
  });
}
