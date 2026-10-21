export interface TerminalFinder {
  findNext: (q: string, opts: { caseSensitive: boolean }) => boolean;
  findPrev: (q: string, opts: { caseSensitive: boolean }) => boolean;
  clear: () => void;
}

export interface TerminalHandle {
  /** Clear the xterm scrollback buffer for this session. */
  clear: () => void;
  /** Scrape http(s) URLs from the visible buffer (deduped, most-recent-first). */
  getUrls?: () => string[];
}

const finders = new Map<string, TerminalFinder>();
const handles = new Map<string, TerminalHandle>();

export function registerFinder(sessionId: string, f: TerminalFinder) {
  finders.set(sessionId, f);
  return () => {
    if (finders.get(sessionId) === f) finders.delete(sessionId);
  };
}

export function getFinder(sessionId: string | undefined): TerminalFinder | null {
  if (!sessionId) return null;
  return finders.get(sessionId) ?? null;
}

export function registerTerminal(sessionId: string, h: TerminalHandle) {
  handles.set(sessionId, h);
  return () => {
    if (handles.get(sessionId) === h) handles.delete(sessionId);
  };
}

let activeTerminalId: string | null = null;

/** Record `sessionId` as the terminal that currently owns keyboard focus. */
export function markActiveTerminal(sessionId: string): void {
  activeTerminalId = sessionId;
}

/** Clear the active terminal, but only if `sessionId` is still the active one,
 *  so a late release from a previous terminal cannot clobber its successor. */
export function releaseActiveTerminal(sessionId: string): void {
  if (activeTerminalId === sessionId) activeTerminalId = null;
}

/** The session id of the terminal that currently owns focus, or null. */
export function getActiveTerminalId(): string | null {
  return activeTerminalId;
}

export function getTerminal(sessionId: string | undefined): TerminalHandle | null {
  if (!sessionId) return null;
  return handles.get(sessionId) ?? null;
}
