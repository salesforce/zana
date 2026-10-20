import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { ThreadViewTarget } from '@zana-ai/zcc-desktop-contract';

/**
 * A thread view window shows one thread and its side panel on its own, outside
 * the main shell. Main cannot see threads from every runtime (they live in the
 * product server), so it checks what it can know — the target's shape and a
 * registered project — and the window's renderer shows a missing state for a
 * thread that is gone.
 */
export const THREAD_VIEW_SURFACE = 'thread-view';
/** How far a thread window steps from another one already at its spot. */
export const THREAD_VIEW_CASCADE_PX = 36;

const THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MAX_PROJECT_ID = 256;

export type ThreadViewBounds = NonNullable<AppConfig['threadViewWindowBounds']>;
type WindowBounds = NonNullable<AppConfig['windowBounds']>;

export type ThreadViewDenial = 'invalid' | 'unknown-project';

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Validate a renderer-supplied thread target. Anything malformed is `null`. */
export function parseThreadViewTarget(input: unknown): ThreadViewTarget | null {
  if (!input || typeof input !== 'object') return null;
  const { threadId, projectId } = input as Record<string, unknown>;
  if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) return null;
  if (projectId === undefined || projectId === null) return { threadId };
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > MAX_PROJECT_ID) return null;
  if (hasControlCharacter(projectId)) return null;
  return { threadId, projectId };
}

/** One window per thread, whatever project the request named. */
export function sameThreadView(a: ThreadViewTarget | undefined, b: ThreadViewTarget): boolean {
  return !!a && a.threadId === b.threadId;
}

/** Main's checks before it opens a thread window (Rule 1: the renderer is untrusted). */
export function authorizeThreadView(
  input: unknown,
  known: { projectIds: Iterable<string> }
): { ok: true; target: ThreadViewTarget } | { ok: false; reason: ThreadViewDenial } {
  const target = parseThreadViewTarget(input);
  if (!target) return { ok: false, reason: 'invalid' };
  if (target.projectId !== undefined && ![...known.projectIds].includes(target.projectId)) {
    return { ok: false, reason: 'unknown-project' };
  }
  return { ok: true, target };
}

/**
 * Search params for the thread window's renderer. A `projectId` also makes it a
 * scoped window, so it never owns session restore.
 */
export function threadViewRendererParams(target: ThreadViewTarget): Record<string, string> {
  return {
    surface: THREAD_VIEW_SURFACE,
    threadId: target.threadId,
    ...(target.projectId ? { projectId: target.projectId } : {})
  };
}

/** The open thread windows, in registry order, for `windows:listThreadViews`. */
export function listThreadViews(
  entries: Iterable<{ threadView?: ThreadViewTarget; live: boolean }>
): ThreadViewTarget[] {
  const views: ThreadViewTarget[] = [];
  for (const entry of entries) {
    if (entry.threadView && entry.live) views.push({ ...entry.threadView });
  }
  return views;
}

export function readThreadViewBounds(
  saved: AppConfig['threadViewWindowBounds'] | undefined
): { bounds?: WindowBounds; maximized: boolean } {
  return { bounds: saved?.bounds, maximized: saved?.maximized === true };
}

/** The shared thread window geometry after one window moved, resized or (un)maximized. */
export function writeThreadViewBounds(
  previous: AppConfig['threadViewWindowBounds'] | undefined,
  state: Pick<AppConfig, 'windowBounds' | 'windowMaximized'>
): ThreadViewBounds {
  const bounds = state.windowBounds ?? previous?.bounds;
  return {
    ...(bounds ? { bounds: { ...bounds } } : {}),
    ...(state.windowMaximized === true ? { maximized: true } : {})
  };
}

/**
 * Step a new thread window off any open one that sits at the same spot, so
 * windows opened one after another do not hide each other exactly.
 */
export function cascadeThreadViewPosition(
  position: { x: number; y: number },
  occupied: ReadonlyArray<{ x: number; y: number }>,
  step = THREAD_VIEW_CASCADE_PX
): { x: number; y: number } {
  let next = { ...position };
  // Bounded by the number of open windows: each step clears at most one of them.
  for (let i = 0; i <= occupied.length; i += 1) {
    if (!occupied.some((spot) => spot.x === next.x && spot.y === next.y)) return next;
    next = { x: next.x + step, y: next.y + step };
  }
  return next;
}
