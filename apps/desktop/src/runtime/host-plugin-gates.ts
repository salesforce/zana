import { inventoryDemandsVeto } from './native-tool-policy.js';
import type { MainDispatchRefusal, PtyDispatchAdmissionInput } from './dispatch-admission.js';
import { dispatchOriginForCallerClass } from './dispatch-admission.js';

/**
 * Behaviour-preserving pieces of host.ts's plugin gates (dispatch admission, native-tool
 * veto, PTY plugin instructions/tools, squad refusal release, approval-sheet window
 * resolution). They live here, behind injected dependencies, so the fail-closed
 * branches are unit-tested instead of only reachable at the built-Electron boundary.
 */

type Channel<Req> = (request: Req) => Promise<unknown>;

type Method<S, K extends keyof S> = S[K] extends (...args: infer A) => Promise<unknown> ? A[0] : never;

/** One named method of the supervised runtime as a channel, read per call; null when no supervisor runs. */
export function supervisedChannel<S, K extends keyof S>(
  getSupervisor: () => S | null | undefined,
  method: K
): () => Channel<Method<S, K>> | null {
  return () => {
    const supervisor = getSupervisor();
    if (!supervisor) return null;
    const call = supervisor[method] as unknown as (request: Method<S, K>) => Promise<unknown>;
    return (request) => call.call(supervisor, request);
  };
}

/** The signed product route, offered only in electron-vite dev (ELECTRON_RENDERER_URL set). */
export function devProductRoute<T>(
  route: T,
  env: { ELECTRON_RENDERER_URL?: string | undefined } = process.env
): () => T | null {
  return () => (env.ELECTRON_RENDERER_URL ? route : null);
}

/** Supervised channel first; only without a supervisor, the dev product route. */
export function supervisedOrDevRoute<S, K extends keyof S>(
  getSupervisor: () => S | null | undefined,
  method: K,
  route: Channel<Method<S, K>>,
  env: { ELECTRON_RENDERER_URL?: string | undefined } = process.env
): () => Channel<Method<S, K>> | null {
  const supervised = supervisedChannel(getSupervisor, method);
  const dev = devProductRoute(route, env);
  return () => supervised() ?? dev();
}

/** A console.warn logger with a fixed bracketed prefix. */
export function prefixedWarn(tag: string): (message: string) => void {
  return (message) => console.warn(`[${tag}] ${message}`);
}

/** Remember that an allowed native tool call started, so its settled event can report a duration. */
export function recordAllowedToolStart(tracker: { started(invocationId: string): void }): (invocationId: string) => void {
  return (invocationId) => tracker.started(invocationId);
}

/**
 * Whether the native-tool veto must be reachable for a provider spawn (OBL-018).
 * A non-empty `required` inventory means some enabled plugin owns tool policy. If
 * no source answers, or the read throws, fail closed (required) so a torn or
 * unreachable inventory never silently drops the veto.
 */
export function createNativeToolPolicyRequiredResolver(deps: {
  source(): ((request: undefined) => Promise<unknown>) | null;
  log(message: string): void;
}): () => Promise<boolean> {
  return async () => {
    try {
      const read = deps.source();
      return inventoryDemandsVeto(read ? await read(undefined) : null);
    } catch (err) {
      deps.log(`tool-policy inventory read failed; failing closed: ${String(err)}`);
      return true;
    }
  };
}

/** A plain shell runs no provider agent; a provider launch defaults to the veto being required. */
export function providerNativeToolPolicyRequired(profile: string, requested: boolean | undefined): boolean {
  return profile !== 'shell' && (requested ?? true);
}

/** Main-resolved spawn bindings: only present, non-empty values are carried. */
export function mainSpawnBindings(opts: { threadId?: string; pluginInstructions?: string } | undefined): {
  pluginInstructions?: string;
  threadId?: string;
} {
  return {
    ...(opts?.pluginInstructions ? { pluginInstructions: opts.pluginInstructions } : {}),
    ...(opts?.threadId ? { threadId: opts.threadId } : {})
  };
}

/**
 * Standing plugin instructions for one provider launch; undefined for a shell or
 * when no plugin contributes any, so the caller can spread/assign it directly.
 */
export async function resolveLaunchPluginInstructions<Profile extends string>(
  resolve: (request: { sessionId: string; threadId?: string; projectId: string; profile: Profile }) => Promise<string>,
  launch: { sessionId: string; threadId?: string | undefined; projectId: string; profile: Profile }
): Promise<string | undefined> {
  if (launch.profile === 'shell') return undefined;
  const instructions = await resolve({
    sessionId: launch.sessionId,
    ...(launch.threadId ? { threadId: launch.threadId } : {}),
    projectId: launch.projectId,
    profile: launch.profile
  });
  return instructions || undefined;
}

type Admit = (input: PtyDispatchAdmissionInput) => Promise<MainDispatchRefusal | null>;

/** A Job Team dispatch into a live PTY: refused by dispatch admission means not delivered. */
export async function replyJobTeamPty(
  deps: { admit: Admit; reply(sessionId: string, text: string): boolean | Promise<boolean> },
  session: { id: string; projectId: string },
  text: string
): Promise<boolean> {
  const refusal = await deps.admit({ sessionId: session.id, projectId: session.projectId, entry: 'job-team-dispatch', origin: 'system', promptText: text });
  if (refusal) return false;
  return deps.reply(session.id, text);
}

/** `zcc terminal reply`: an unknown session passes through to reply; a known one is admitted first. */
export function createAdmittedTerminalReply(deps: {
  getSession(sessionId: string): { projectId: string } | null | undefined;
  admit: Admit;
  reply(sessionId: string, text: string): boolean | Promise<boolean>;
}) {
  return async (sessionId: string, text: string, callerClass?: string): Promise<boolean | { refused: MainDispatchRefusal }> => {
    const session = deps.getSession(sessionId);
    if (!session) return deps.reply(sessionId, text);
    const refusal = await deps.admit({
      sessionId, projectId: session.projectId, entry: 'reply', origin: dispatchOriginForCallerClass(callerClass), promptText: text
    });
    return refusal ? { refused: refusal } : deps.reply(sessionId, text);
  };
}

/**
 * Admission refused a squad start before the runtime created anything, so there is no
 * member to stop or verify: release the reserved slot now. If the release itself fails,
 * fall back to marking the slot uncertain rather than holding it silently.
 */
export async function releaseRefusedSquadStart(
  deps: {
    integration: { reconcileModernWorkers(entries: Array<{ recordId: string; slotId: string; generation: number; threadId: string; state: 'terminal' }>): Promise<unknown> };
    lifecycle: { markModernWorkerUncertain(recordId: string, slotId: string, generation: number, threadId: string): Promise<unknown> };
    logError(message: string, error: unknown): void;
  },
  slot: { recordId: string; slotId: string; generation: number; threadId: string }
): Promise<void> {
  try {
    await deps.integration.reconcileModernWorkers([{ ...slot, state: 'terminal' }]);
  } catch (releaseError) {
    deps.logError(`squad start refusal release failed (thread ${slot.threadId})`, releaseError);
    await deps.lifecycle.markModernWorkerUncertain(slot.recordId, slot.slotId, slot.generation, slot.threadId);
  }
}

interface ToolWindowRecord<W> {
  win: W & { isDestroyed(): boolean };
  projectId?: string | undefined;
  threadView?: { threadId?: string } | null | undefined;
}

/**
 * The window a plugin tool-approval sheet attaches to. Only a visible, un-archived thread
 * of a local project on this host, read from the loopback product server, qualifies;
 * anything else answers null and the sheet is refused.
 */
export function createToolWindowResolver<W>(deps: {
  productServerUrl(): string;
  store: { listProjects(): Array<{ id: string; remote?: unknown; hostId?: string | undefined }> };
  localHostId(): string | null | undefined;
  windows: { values(): Iterable<ToolWindowRecord<W>> };
  mainWindow(): W | null;
  fetchImpl?: typeof fetch;
}): (threadId: string, projectId: string) => Promise<W | null> {
  const doFetch = deps.fetchImpl ?? fetch;
  return async (threadId, projectId) => {
    const base = new URL(deps.productServerUrl());
    if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost'].includes(base.hostname)) return null;
    const project = deps.store.listProjects().find((row) => row.id === projectId);
    const hostId = deps.localHostId();
    if (!hostId || !project || project.remote || (project.hostId && project.hostId !== hostId)) return null;
    const response = await doFetch(new URL(`api/v1/threads/${encodeURIComponent(threadId)}`, base), {
      redirect: 'error', signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const { thread } = await response.json() as {
      thread?: { id?: string; projectId?: string; hostId?: string; visibility?: string; archivedAt?: number | null };
    };
    if (!thread || thread.id !== threadId || thread.projectId !== projectId || thread.hostId !== hostId
      || thread.visibility !== 'visible' || thread.archivedAt !== null) return null;
    const scoped = [...deps.windows.values()].find((row) => !row.win.isDestroyed()
      && (row.threadView?.threadId === threadId || row.projectId === projectId));
    return scoped?.win ?? deps.mainWindow();
  };
}
