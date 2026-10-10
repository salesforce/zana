const SESSION_LIMIT = 256 * 1024;
const TOTAL_LIMIT = 8 * 1024 * 1024;
const SLICE = 16 * 1024;
const GAP = '\r\n[Some output was omitted while this terminal was hidden or busy.]\r\n';
type Entry = { text: string; visible: boolean; busy: boolean; gap: boolean; stopped: boolean; reset?: () => void; complete?: () => void; idle: Array<() => void>; write(text: string, done: () => void): void };
const entries = new Set<Entry>();
const drained = (entry: Entry) => !entry.busy && !entry.text.length && !entry.gap;
function flushIdle(entry?: Entry) {
  if (!entry || !entry.idle.length || !drained(entry)) return;
  const callbacks = entry.idle; entry.idle = [];
  callbacks.forEach(callback => callback());
}
let total = 0, active = 0, frame = 0;
function schedule() {
  if (frame || active >= 2 || ![...entries].some(entry => entry.visible && !entry.busy && (entry.text.length || entry.gap))) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const entry of [...entries]) {
      if (active >= 2) break;
      if (!entry.visible || entry.busy || (!entry.text.length && !entry.gap) || entry.stopped) continue;
      const text = (entry.gap ? GAP : '') + entry.text.slice(0, SLICE);
      entry.gap = false; total -= Math.min(SLICE, entry.text.length); entry.text = entry.text.slice(SLICE);
      entry.busy = true; active++;
      // Rotate for fairness between visible sessions. Only two xterm parser
      // writes can be outstanding, each bounded by a small slice.
      entries.delete(entry); entries.add(entry);
      let completed = false;
      const done = () => {
        if (completed) return;
        completed = true; entry.busy = false; entry.complete = undefined; active--;
        const reset = entry.reset; entry.reset = undefined;
        if (!entry.stopped) reset?.();
        flushIdle(entry);
        schedule();
      };
      entry.complete = done;
      try { entry.write(text, done); } catch { done(); }
    }
    schedule();
  });
}
export function createTerminalWriteQueue(write: Entry['write'], visible: boolean) {
  const entry: Entry = { text: '', visible, write, busy: false, stopped: false, gap: false, idle: [] };
  entries.add(entry);
  const clear = () => { total -= entry.text.length; entry.text = ''; entry.gap = false; };
  return {
    write(text: string) {
      if (entry.stopped || !text) return;
      entry.text += text; total += text.length;
      if (entry.text.length > SESSION_LIMIT) {
        total -= entry.text.length - SESSION_LIMIT;
        entry.text = entry.text.slice(-SESSION_LIMIT); entry.gap = true;
      }
      // Prefer dropping hidden pending history; all drops are explicit on show.
      for (const other of [...entries].sort((a, b) => Number(a.visible) - Number(b.visible))) {
        if (total <= TOTAL_LIMIT) break;
        const drop = Math.min(other.text.length, total - TOTAL_LIMIT);
        other.text = other.text.slice(drop); total -= drop; other.gap ||= drop > 0;
      }
      schedule();
    },
    setVisible(value: boolean) { entry.visible = value; schedule(); },
    clear,
    /** Run `callback` once everything queued so far has been written (immediately when idle). */
    whenIdle(callback: () => void) {
      if (entry.stopped) return;
      entry.idle.push(callback); flushIdle(entry);
    },
    reset(reset: () => void) { clear(); if (entry.busy) entry.reset = reset; else if (!entry.stopped) reset(); },
    dispose() {
      if (entry.stopped) return;
      entry.stopped = true; clear(); entry.idle = []; entries.delete(entry); entry.complete?.();
      if (!entries.size && frame) { cancelAnimationFrame(frame); frame = 0; }
    }
  };
}
