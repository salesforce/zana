import { create } from 'zustand';

/**
 * Agents board toggles that show or hide the threads a plugin created. A
 * plugin's owned threads stay off the board until its toggle is on. The
 * choice is stored per plugin in localStorage (shared by every window).
 */
export const AGENTS_BOARD_THREAD_TOGGLES_KEY = 'zana.agentsBoard.shownPluginThreads';

function readShown(): Record<string, true> {
  try {
    const raw = globalThis.localStorage?.getItem(AGENTS_BOARD_THREAD_TOGGLES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return {};
    const out: Record<string, true> = {};
    for (const id of parsed) if (typeof id === 'string' && id) out[id] = true;
    return out;
  } catch {
    return {};
  }
}

function writeShown(shown: Record<string, true>): void {
  try {
    globalThis.localStorage?.setItem(AGENTS_BOARD_THREAD_TOGGLES_KEY, JSON.stringify(Object.keys(shown)));
  } catch {
    // Storage is best-effort; the in-memory choice still applies.
  }
}

interface AgentsBoardThreadToggleState {
  /** Plugin ids whose owned threads are shown on the board. */
  shown: Record<string, true>;
  setShown(pluginId: string, on: boolean): void;
}

export const useAgentsBoardThreadToggles = create<AgentsBoardThreadToggleState>((set, get) => ({
  shown: readShown(),
  setShown(pluginId, on) {
    const next = { ...get().shown };
    if (on) next[pluginId] = true;
    else delete next[pluginId];
    set({ shown: next });
    writeShown(next);
  }
}));

/**
 * True when the thread belongs to a plugin that registered a board toggle and
 * the user has not turned that toggle on.
 */
export function isThreadHiddenByPluginToggle(
  thread: { originPluginId?: string | null },
  togglePluginIds: ReadonlySet<string>,
  shown: Record<string, true>
): boolean {
  const owner = thread.originPluginId;
  return Boolean(owner && togglePluginIds.has(owner) && !shown[owner]);
}
