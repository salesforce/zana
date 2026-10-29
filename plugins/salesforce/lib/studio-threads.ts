/**
 * Assistant rail server half (WS-1): studio.askAgent spawns a thread briefed on
 * the open .agent file, a bounded per-project link store lists the threads that
 * work on it, and thread lifecycle events keep the list fresh.
 */
import { randomUUID } from 'node:crypto';
import { buildStudioContext, buildStudioRequest, MAX_STUDIO_REQUEST_LENGTH, roleForAction, studioActionById } from './studio-agent-actions.js';
import { isStudioDiagnostics, STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type StudioThreadLink } from './studio-contract.js';
import { rpcFailure, rpcString, type StudioServerContext } from './studio-server-context.js';
import { readOpenComments, viewStoreFor } from './studio-view.js';
import { isSafeStudioPath, panelAgentPath, studioThreadPath } from './studio-agent-binding.js';
export { isSafeStudioPath, panelAgentPath } from './studio-agent-binding.js';

export const MAX_THREAD_LINKS = 200;
const linksKey = (projectId: string) => `studio:links:${projectId}`;

interface LinkDoc { links: StudioThreadLink[] }
interface KvLike { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> }

/** Per-project link store: capped, newest activity wins, writes serialized per project. */
export class StudioLinkStore {
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(private readonly kv: KvLike, private readonly now: () => number = Date.now) {}

  private serialize<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.tails.get(projectId) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => undefined);
    this.tails.set(projectId, tail);
    void tail.then(() => { if (this.tails.get(projectId) === tail) this.tails.delete(projectId); });
    return run;
  }

  private async read(projectId: string): Promise<StudioThreadLink[]> {
    const doc = await this.kv.get<LinkDoc>(linksKey(projectId));
    return Array.isArray(doc?.links) ? doc!.links.filter(l => l && typeof l.threadId === 'string' && typeof l.path === 'string') : [];
  }

  private async write(projectId: string, links: StudioThreadLink[]) {
    const kept = [...links].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, MAX_THREAD_LINKS);
    await this.kv.set(linksKey(projectId), { links: kept } satisfies LinkDoc);
  }

  list(projectId: string, path?: string): Promise<StudioThreadLink[]> {
    return this.read(projectId).then(links => links.filter(l => !path || l.path === path).sort((a, b) => b.lastActivityAt - a.lastActivityAt));
  }

  link(projectId: string, link: Omit<StudioThreadLink, 'lastActivityAt'>): Promise<StudioThreadLink> {
    return this.serialize(projectId, async () => {
      const entry: StudioThreadLink = { ...link, lastActivityAt: this.now() };
      await this.write(projectId, [entry, ...(await this.read(projectId)).filter(l => l.threadId !== link.threadId)]);
      return entry;
    });
  }

  /** Returns true when the thread was linked and its activity/title were refreshed. */
  touch(projectId: string, threadId: string, title?: string | null): Promise<StudioThreadLink | null> {
    return this.serialize(projectId, async () => {
      const links = await this.read(projectId);
      const hit = links.find(l => l.threadId === threadId);
      if (!hit) return null;
      hit.lastActivityAt = this.now();
      if (title?.trim()) hit.title = title.trim().slice(0, 120);
      await this.write(projectId, links);
      return hit;
    });
  }

  remove(projectId: string, threadId: string): Promise<StudioThreadLink | null> {
    return this.serialize(projectId, async () => {
      const links = await this.read(projectId);
      const hit = links.find(l => l.threadId === threadId) ?? null;
      if (hit) await this.write(projectId, links.filter(l => l.threadId !== threadId));
      return hit;
    });
  }
}

/**
 * Returns `linkPanelThreads`, which registers the configure hook that links
 * side-panel conversations; the plugin calls it after its own configure hook.
 */
export function registerStudioAssistant(studio: StudioServerContext): { linkPanelThreads(): void } {
  const { zcc } = studio;
  const links = new StudioLinkStore(zcc.storage.kv);
  const views = viewStoreFor(zcc);
  const projectOf = () => studio.contexts.current()?.projectId ?? '';
  const drafts = new PendingDrafts();
  // The Studio context each conversation started with, handed back on every launch (a relaunch rebuilds instructions).
  const briefs = new BoundedMap<string>(MAX_SEEN_PANEL_THREADS);
  const changed = (projectId: string, path?: string) => {
    try { zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId, ...(path ? { path } : {}), kind: 'threads' }); } catch { /* realtime is best effort */ }
  };

  /** Validates an Ask the agent request and builds its brief, shared by the spawn and the side-panel draft. */
  const prepare = async (args: unknown) => {
    const projectId = projectOf();
    if (!projectId) return { failure: rpcFailure('project_required', 'Choose a registered project to start an agent.') };
    const path = rpcString(args, 'path');
    if (!isSafeStudioPath(path)) return { failure: rpcFailure('invalid_input', 'Choose an agent file inside this project.') };
    const actionId = rpcString(args, 'action');
    const action = actionId ? studioActionById(actionId) : null;
    if (actionId && !action) return { failure: rpcFailure('invalid_input', `Unknown agent action ${actionId}.`) };
    const prompt = rpcString(args, 'prompt');
    if (!action && !prompt) return { failure: rpcFailure('invalid_input', 'Pick an action or write a request.') };
    if (prompt.length > MAX_STUDIO_REQUEST_LENGTH) return { failure: rpcFailure('invalid_input', `Request must be at most ${MAX_STUDIO_REQUEST_LENGTH} characters.`) };
    const given = (args as { diagnostics?: unknown }).diagnostics;
    const view = views.latest(projectId, path)?.state;
    const sameFile = view?.path === path ? view : undefined;
    const diagnostics = isStudioDiagnostics(given) ? given : sameFile?.diagnostics ?? [];
    const comments = action?.id === 'address-comments' || action?.id === 'review' ? await readOpenComments(zcc.storage.kv, projectId, path) : [];
    return {
      projectId, path, action,
      title: `${action ? action.label : 'Agent script'} · ${path.split('/').pop()}`.slice(0, 120),
      request: buildStudioRequest({ path, view: sameFile, action, prompt }),
      context: buildStudioContext({ path, view: sameFile, action, comments, diagnostics })
    };
  };

  studio.registerRpc(STUDIO_RPC.askAgent, async args => {
    const request = await prepare(args);
    if ('failure' in request) return request.failure;
    const { projectId, path, action, title } = request;
    const providerId = rpcString(args, 'providerId');
    // The thread may launch before spawn returns, so the context is keyed by an id it carries.
    const briefId = randomUUID();
    briefs.set(briefId, request.context);
    const thread = await zcc.sdk.threads.spawn({
      projectId,
      prompt: request.request,
      title,
      ...(providerId ? { providerId } : {}),
      visibility: 'visible',
      pluginMetadata: { sfAgentPath: path, sfBriefId: briefId, ...(action ? { action: action.id } : {}) }
    });
    await links.link(projectId, { threadId: thread.id, title, role: roleForAction(action?.id), ...(action ? { action: action.id } : {}), path });
    changed(projectId, path);
    return { ok: true, threadId: thread.id, title };
  });

  // The side panel's composer gets the short request; the context joins the conversation the user sends from it.
  studio.registerRpc(STUDIO_RPC.draftAgent, async args => {
    const request = await prepare(args);
    if ('failure' in request) return request.failure;
    drafts.remember(request.projectId, request.path, { title: request.title, action: request.action?.id, context: request.context });
    return { ok: true, prompt: request.request, title: request.title };
  });

  studio.registerRpc(STUDIO_RPC.threads, async args => {
    const projectId = projectOf();
    if (!projectId) return rpcFailure('project_required', 'Choose a project.');
    const path = rpcString(args, 'path');
    return { ok: true, threads: await links.list(projectId, path || undefined) };
  });

  studio.registerRpc(STUDIO_RPC.unlink, async args => {
    const projectId = projectOf();
    const threadId = rpcString(args, 'threadId');
    if (!projectId || !threadId) return rpcFailure('invalid_input', 'Choose a project and thread to unlink.');
    const removed = await links.remove(projectId, threadId);
    if (removed) changed(projectId, removed.path);
    return { ok: true, removed: Boolean(removed) };
  });

  // Keep the list accurate as linked threads evolve (pattern: design-docs server.ts).
  zcc.events.on('thread.idle', async event => {
    const thread = event.thread;
    if (!thread?.projectId) return;
    const hit = await links.touch(thread.projectId, thread.id, thread.title ?? null).catch(() => null);
    if (hit) changed(thread.projectId, hit.path);
  });
  zcc.events.on('thread.deleted', async event => {
    const thread = event.thread;
    if (!thread?.projectId) return;
    // The host also sends this on archive; keep threads that can be unarchived.
    const current = await zcc.sdk.threads.get({ threadId: thread.id }).catch(() => null);
    if (current && !current.deletedAt) return;
    const hit = await links.remove(thread.projectId, thread.id).catch(() => null);
    if (hit) changed(thread.projectId, hit.path);
  });

  // A conversation sent from the side panel beside a file joins that file's list, like a spawned one.
  // configure() runs on every launch: link once so an Unlink sticks.
  const seen = new BoundedSet(MAX_SEEN_PANEL_THREADS);
  const linkPanelThreads = () => zcc.agents.configure(async ctx => {
    const threadId = ctx.thread?.id ?? ctx.threadId;
    const projectId = ctx.projectId ?? ctx.project?.id;
    const briefId = (ctx.pluginMetadata as { sfBriefId?: unknown } | undefined)?.sfBriefId;
    const ownedPath = studioThreadPath(ctx.pluginMetadata);
    if (threadId && projectId && ownedPath) views.bindThread(projectId, threadId, ownedPath);
    if (threadId && typeof briefId === 'string' && briefs.has(briefId)) { briefs.set(threadId, briefs.get(briefId)!); briefs.delete(briefId); }
    const brief = (): { instructions?: string } => { const text = threadId ? briefs.get(threadId) : undefined; return text ? { instructions: text } : {}; };
    const path = panelAgentPath(ctx.pluginMetadata);
    if (!threadId || !projectId || !path || seen.has(threadId)) return brief();
    seen.add(threadId);
    const draft = drafts.take(projectId, path);
    briefs.set(threadId, draft?.context ?? buildStudioContext({ path, view: views.latest(projectId, path)?.state }));
    const title = draft?.title || ctx.thread?.title?.trim()?.slice(0, 120) || `Agent script · ${path.split('/').pop()}`;
    try {
      await links.link(projectId, { threadId, title, role: roleForAction(draft?.action), ...(draft?.action ? { action: draft.action } : {}), path });
      changed(projectId, path);
    } catch { /* the list is a convenience; never block the launch */ }
    return brief();
  });
  return { linkPanelThreads };
}

const MAX_SEEN_PANEL_THREADS = 1000;
const MAX_PENDING_DRAFTS = 50;
const DRAFT_TTL_MS = 30 * 60_000;

/** Insertion-ordered set that forgets its oldest entries past `max`. */
export class BoundedSet {
  private readonly items = new Set<string>();
  constructor(private readonly max: number) {}
  has(value: string) { return this.items.has(value); }
  add(value: string) {
    this.items.add(value);
    while (this.items.size > this.max) this.items.delete(this.items.values().next().value as string);
  }
}

/** Insertion-ordered map that forgets its oldest entries past `max`. */
export class BoundedMap<T> {
  private readonly items = new Map<string, T>();
  constructor(private readonly max: number) {}
  has(key: string) { return this.items.has(key); }
  get(key: string) { return this.items.get(key); }
  delete(key: string) { this.items.delete(key); }
  set(key: string, value: T) {
    this.items.delete(key);
    this.items.set(key, value);
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value as string);
  }
}

/**
 * The last draft handed to the side panel per file, so the conversation the user
 * sends from it keeps the action's title and role. Capped and short-lived.
 */
export class PendingDrafts {
  private readonly items = new Map<string, { title: string; action?: string; context?: string; at: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  remember(projectId: string, path: string, draft: { title: string; action?: string; context?: string }) {
    const key = `${projectId}\0${path}`;
    this.items.delete(key);
    this.items.set(key, { ...draft, at: this.now() });
    while (this.items.size > MAX_PENDING_DRAFTS) this.items.delete(this.items.keys().next().value as string);
  }
  take(projectId: string, path: string): { title: string; action?: string; context?: string } | null {
    const key = `${projectId}\0${path}`;
    const hit = this.items.get(key);
    this.items.delete(key);
    return hit && this.now() - hit.at <= DRAFT_TTL_MS ? { title: hit.title, ...(hit.action ? { action: hit.action } : {}), ...(hit.context ? { context: hit.context } : {}) } : null;
  }
}
