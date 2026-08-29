/**
 * Per-project window scope. A window opened via "Open in New Window" is loaded
 * with a `?projectId=<id>` query param (set by main's `createWindow`). When that
 * param is present the renderer locks the whole shell to that one project: the
 * sidebar shows only it, focus mode is forced, and the boot-time
 * lastProject/focusedProject restore is skipped so the window can't drift to a
 * different project.
 *
 * Read ONCE at module load from `?projectId=` (set by main's `createWindow`),
 * and remember that id in `sessionStorage` so a later document load that drops
 * the query (address-bar `/inbox`, SPA fallback) still stays locked.
 * Client-side path changes also keep that query so a refresh still locks the
 * window. `null` ⇒ the normal, unscoped shell (the main window).
 *
 * SCOPE IS A DISPLAY LOCK, NOT A SECURITY/PRIVACY BOUNDARY. A scoped window runs
 * the same `window.cc` IPC surface as the main one, and main's `safeSend`
 * broadcasts every channel to every window — so a scoped window still receives
 * (and may hold in renderer memory) other projects' inbox/agent-mesh data; it
 * just doesn't display it. Don't rely on "scoped to project X" to prevent a
 * window from observing or acting on project Y. If a real isolation guarantee is
 * ever needed, filter `safeSend` per-window by the window's registered project.
 */
const SCOPED_PROJECT_STORAGE_KEY = 'zcc.scopedProjectId';

function readScopedProjectId(): string | null {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('projectId');
    if (fromQuery && fromQuery.trim()) {
      try {
        window.sessionStorage?.setItem(SCOPED_PROJECT_STORAGE_KEY, fromQuery);
      } catch {
        /* private-mode / missing storage — the query still locks this load */
      }
      return fromQuery;
    }
    const stored = window.sessionStorage?.getItem(SCOPED_PROJECT_STORAGE_KEY);
    return stored && stored.trim() ? stored : null;
  } catch {
    return null;
  }
}

const scopedProjectId: string | null = readScopedProjectId();

/** The project this window is locked to, or `null` for the unscoped shell. */
export function getScopedProjectId(): string | null {
  return scopedProjectId;
}

/** True when this window is a per-project window (locked to one project). */
export function isScopedWindow(): boolean {
  return scopedProjectId !== null;
}

/**
 * True when the shell is showing ONE project's focused view — either because
 * this is a per-project window (a hard URL lock) OR because the main window is
 * drilled into a project (`focusedProjectId` set, a soft store-driven focus).
 *
 * This is the predicate for UI that should collapse to a single-project layout
 * in BOTH cases — e.g. suppressing the Workspace's horizontal mode-toggle when
 * the left rail already promotes those modes to first-class entries.
 *
 * Distinct from {@link isScopedWindow}, which means specifically "this window is
 * locked to a project" — used for snapshot/session ownership and the
 * open-in-new-window palette action, where focused-main must NOT participate.
 * Don't conflate the two: pass the live `focusedProjectId` from the store.
 */
export function isProjectFocusedView(focusedProjectId: string | null): boolean {
  return isScopedWindow() || focusedProjectId !== null;
}
