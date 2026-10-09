/**
 * Assistant rail server half (WS-1): studio.askAgent spawns a thread briefed on
 * the open .agent file, a bounded per-project link store lists the threads that
 * work on it, and thread lifecycle events keep the list fresh.
 */
import { buildStudioPrompt, MAX_STUDIO_REQUEST_LENGTH, roleForAction, studioActionById } from './studio-agent-actions.js';
import { isStudioDiagnostics, STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type StudioThreadLink } from './studio-contract.js';
import { rpcFailure, rpcString, type StudioServerContext } from './studio-server-context.js';
import { readOpenComments, viewStoreFor } from './studio-view.js';

export const MAX_THREAD_LINKS = 200;
const MAX_PATH = 500;
const linksKey = (projectId: string) => `studio:links:${projectId}`;

interface LinkDoc { links: StudioThreadLink[] }
interface KvLike { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> }

/** Relative project path of an agent file; rejects traversal, absolute paths and control characters. */
export function isSafeStudioPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= MAX_PATH
    && !path.startsWith('/') && !/[\\\0-\x1f:]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
}

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

export function registerStudioAssistant(studio: StudioServerContext): void {
  const { zcc } = studio;
  const links = new StudioLinkStore(zcc.storage.kv);
  const views = viewStoreFor(zcc);
  const projectOf = () => studio.contexts.current()?.projectId ?? '';
  const changed = (projectId: string, path?: string) => {
    try { zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId, ...(path ? { path } : {}), kind: 'threads' }); } catch { /* realtime is best effort */ }
  };

  studio.registerRpc(STUDIO_RPC.askAgent, async args => {
    const projectId = projectOf();
    if (!projectId) return rpcFailure('project_required', 'Choose a registered project to start an agent.');
    const path = rpcString(args, 'path');
    if (!isSafeStudioPath(path)) return rpcFailure('invalid_input', 'Choose an agent file inside this project.');
    const actionId = rpcString(args, 'action');
    const action = actionId ? studioActionById(actionId) : null;
    if (actionId && !action) return rpcFailure('invalid_input', `Unknown agent action ${actionId}.`);
    const prompt = rpcString(args, 'prompt');
    if (!action && !prompt) return rpcFailure('invalid_input', 'Pick an action or write a request.');
    if (prompt.length > MAX_STUDIO_REQUEST_LENGTH) return rpcFailure('invalid_input', `Request must be at most ${MAX_STUDIO_REQUEST_LENGTH} characters.`);
    const providerId = rpcString(args, 'providerId');
    const given = (args as { diagnostics?: unknown }).diagnostics;
    const view = views.get(projectId)?.state;
    const sameFile = view?.path === path ? view : undefined;
    const diagnostics = isStudioDiagnostics(given) ? given : sameFile?.diagnostics ?? [];
    const comments = action?.id === 'address-comments' || action?.id === 'review' ? await readOpenComments(zcc.storage.kv, projectId, path) : [];
    const title = `${action ? action.label : 'Agent script'} · ${path.split('/').pop()}`.slice(0, 120);
    const thread = await zcc.sdk.threads.spawn({
      projectId,
      prompt: buildStudioPrompt({ path, view: sameFile, action, prompt, comments, diagnostics }),
      title,
      ...(providerId ? { providerId } : {}),
      visibility: 'visible',
      pluginMetadata: { sfAgentPath: path, ...(action ? { action: action.id } : {}) }
    });
    await links.link(projectId, { threadId: thread.id, title, role: roleForAction(action?.id), ...(action ? { action: action.id } : {}), path });
    changed(projectId, path);
    return { ok: true, threadId: thread.id };
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
}
