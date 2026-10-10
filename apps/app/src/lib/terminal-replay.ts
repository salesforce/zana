import { readTerminalSnapshot } from './terminal-read-queue.js';
export interface TerminalOutputCursor { startOffset: number; endOffset: number }
type Snapshot = string | (TerminalOutputCursor & { text: string });
/** Where the user was looking before a destructive redraw, so it can be restored. */
export interface TerminalViewport { following: boolean; distanceFromBottom: number }
type Chunk = { data: string; cursor?: TerminalOutputCursor };
const GAP_NOTICE = '\r\n[Some output was missed while reconnecting.]\r\n';

function validCursor(cursor: TerminalOutputCursor, length: number): boolean {
  return Number.isSafeInteger(cursor.startOffset) && cursor.startOffset >= 0
    && Number.isSafeInteger(cursor.endOffset) && cursor.endOffset - cursor.startOffset === length;
}

/** Retained-output recovery is read-only; input is never queued or replayed.
 * Offsets count UTF-16 code units, matching string slices on both sides. The
 * persisted server cursor makes overlapping HTTP snapshots / WS events exact.
 * Local legacy PTYs keep the original string-only contract.
 */
export function createTerminalReplay(read: (signal?: AbortSignal) => Promise<Snapshot>, display: {
  reset(): void; write(text: string): void; follow(previous?: TerminalViewport): void;
  /** Snapshot of the viewport, taken just before `reset()`. */
  capture?(): TerminalViewport;
}, maxPendingChars = 512 * 1024) {
  let stopped = false, ready = false, running: Promise<void> | undefined;
  let pending: Chunk[] = [], pendingChars = 0, gap = false, refreshAgain = false;
  let offset: number | undefined;
  let cancelDeadline: (() => void) | undefined;
  function show(chunk: Chunk) {
    const { data, cursor } = chunk;
    if (cursor && validCursor(cursor, data.length)) {
      if (offset !== undefined && cursor.endOffset <= offset) return;
      if (offset !== undefined && cursor.startOffset > offset) display.write(GAP_NOTICE);
      const text = data.slice(Math.max(0, (offset ?? cursor.startOffset) - cursor.startOffset));
      offset = cursor.endOffset;
      if (text) display.write(text);
    } else {
      if (data) display.write(data);
      // Never compare an older cursor after an unsequenced legacy chunk.
      offset = undefined;
    }
  }
  function queue(chunk: Chunk) {
    if (!chunk.data) return;
    pending.push(chunk); pendingChars += chunk.data.length;
    while (pendingChars > maxPendingChars || pending.length > 4096) {
      const first = pending[0]!;
      const excess = pendingChars - maxPendingChars;
      if (excess > 0 && excess < first.data.length && pending.length <= 4096) {
        first.data = first.data.slice(excess);
        if (first.cursor) first.cursor = { ...first.cursor, startOffset: first.cursor.startOffset + excess };
        pendingChars -= excess;
      } else {
        pendingChars -= first.data.length; pending.shift();
      }
      gap = true;
    }
  }
  async function replay(reset = false): Promise<void> {
    if (stopped) return;
    if (running) { refreshAgain ||= reset; return running; }
    ready = false;
    running = (async () => {
      do {
        refreshAgain = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        let viewport: TerminalViewport | undefined, redrawn = false;
        const deadline = new Promise<never>((_, reject) => {
          cancelDeadline = () => { clearTimeout(timer); controller.abort(); reject(new Error('terminal replay cancelled')); };
          timer = setTimeout(() => { controller.abort(); reject(new Error('terminal replay timed out')); }, 10_000);
        });
        try {
          const snapshot = await Promise.race([readTerminalSnapshot(() => read(controller.signal), controller.signal), deadline]);
          if (stopped) return;
          if (typeof snapshot !== 'string' && !validCursor(snapshot, snapshot.text.length)) throw new Error('Invalid terminal snapshot cursor');
          let text = typeof snapshot === 'string' ? snapshot : snapshot.text;
          if (reset && typeof snapshot !== 'string' && offset !== undefined && snapshot.startOffset <= offset) {
            // The retained window still covers what is on screen: append only
            // what was missed (nothing at all when the screen is current).
            if (snapshot.endOffset <= offset) text = '';
            else { text = text.slice(offset - snapshot.startOffset); offset = snapshot.endOffset; }
          } else {
            if (reset) { viewport = display.capture?.(); display.reset(); redrawn = true; }
            offset = typeof snapshot === 'string' ? undefined : snapshot.endOffset;
          }
          if (text) display.write(text);
          // A snapshot covers dropped queued chunks only when its cursor
          // reaches the earliest retained event. Otherwise show an explicit gap.
          if (offset !== undefined && (!pending.length || pending[0]!.cursor && pending[0]!.cursor!.startOffset <= offset)) gap = false;
        } catch { /* Keep live output when the retained tail is unavailable. */ }
        finally { clearTimeout(timer); cancelDeadline = undefined; }
        if (stopped) return;
        if (gap) display.write(GAP_NOTICE);
        for (const chunk of pending) show(chunk);
        pending = []; pendingChars = 0; gap = false;
        // A non-destructive refresh keeps the user's scroll position.
        if (!reset || redrawn) display.follow(viewport);
        reset = true;
      } while (refreshAgain && !stopped);
    })().finally(() => { running = undefined; ready = true; });
    return running;
  }
  return {
    replay,
    receive(data: string, cursor?: TerminalOutputCursor) {
      if (stopped) return;
      const chunk = { data, cursor };
      if (ready) {
        if (cursor && validCursor(cursor, data.length) && offset !== undefined && cursor.startOffset > offset) {
          queue(chunk); void replay(true); return;
        }
        show(chunk); return;
      }
      queue(chunk);
    },
    dispose() { stopped = true; pending = []; pendingChars = 0; cancelDeadline?.(); }
  };
}
