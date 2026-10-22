/**
 * Classify a chunk the renderer wrote into a pty (`terminals.write`, i.e. xterm
 * `onData`). xterm forwards everything through that one channel: real
 * keystrokes and pastes, but also reports the TERMINAL generates on the app's
 * behalf — mouse events once an app enables mouse tracking (OpenCode turns on
 * `?1003h` any-motion + `?1006h` SGR), focus in/out (`?1004h`), cursor-position
 * device-attribute and DECRPM replies, OSC and DCS replies. Those are not a person
 * typing, so they must not hold off injected input that waits for the user to
 * go quiet.
 *
 * `draftChars` is an APPROXIMATE length of the line the user is composing,
 * kept only so a caller can tell "probably empty" from "probably has a
 * half-typed draft". It does not model the line editor:
 * - printable text (LF included: Shift+Enter / Ctrl-J is a composer newline)
 *   and paste content add their length;
 * - BS/DEL removes one, floored at zero;
 * - Enter (CR) and Ctrl-C reset to zero;
 * - Up/Down on an empty count raise it to one, because history recall puts
 *   unknown text in the prompt;
 * - Ctrl-W, Ctrl-U, Alt-Backspace, a bare Esc, and navigation keys leave it
 *   alone (they may clear only part of the line, or nothing at all).
 *
 * Chunks are classified independently. A report split across two writes may be
 * misread as key input; that only errs toward waiting longer.
 */
export interface TerminalInputClass {
  /** Anything other than terminal-generated reports was written. */
  keyInput: boolean;
  /** Approximate draft length after this chunk. */
  draftChars: number;
}

// Terminal-generated reports, matched only at the current scan position.
const TERMINAL_REPORTS: RegExp[] = [
  /\x1b\[M[\s\S]{3}/y, // X10 / normal mouse: CSI M + 3 raw bytes
  /\x1b\[<\d+;\d+;\d+[Mm]/y, // SGR mouse
  /\x1b\[\d+;\d+;\d+M/y, // urxvt mouse
  /\x1b\[[IO]/y, // focus in / out
  /\x1b\[\d+;\d+R/y, // cursor-position report
  /\x1b\[[?>][\d;]*c/y, // primary / secondary device attributes
  /\x1b\[\??\d+;\d+\$y/y, // DECRPM mode report
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y, // terminated OSC reply (4/10/11/12 color queries, ...)
  /\x1bP[\s\S]*?\x1b\\/y // DCS reply (DECRQSS, XTVERSION)
];

// Bracketed paste; an unterminated start swallows the rest of the chunk.
const PASTE = /\x1b\[200~([\s\S]*?)(?:\x1b\[201~|$)/y;
// History keys: Up/Down in CSI or SS3 (application cursor) form.
const HISTORY_KEY = /\x1b(?:\[|O)[AB]/y;
// Key escape sequences that leave the draft alone: CSI (arrows, Delete,
// modified keys), SS3 (application-mode arrows/F-keys), and Alt+key.
const KEY_ESCAPE = /\x1b(?:\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|O[\s\S]|[^\x1b])/y;

function matchAt(re: RegExp, data: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(data);
}

export function classifyTerminalInput(data: string, draftChars: number): TerminalInputClass {
  let keyInput = false;
  let count = draftChars;
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    if (ch === '\x1b') {
      const report = TERMINAL_REPORTS.map((re) => matchAt(re, data, i)).find((m) => m !== null);
      if (report) {
        i += report[0].length;
        continue;
      }
      keyInput = true;
      const paste = matchAt(PASTE, data, i);
      if (paste) {
        count += paste[1].length;
        i += paste[0].length;
        continue;
      }
      const history = matchAt(HISTORY_KEY, data, i);
      if (history) {
        count = Math.max(count, 1);
        i += history[0].length;
        continue;
      }
      // Any other key escape, or a bare Esc (end of chunk / before another Esc).
      i += matchAt(KEY_ESCAPE, data, i)?.[0].length ?? 1;
      continue;
    }
    keyInput = true;
    if (ch === '\r' || ch === '\x03') count = 0;
    else if (ch === '\x7f' || ch === '\b') count = Math.max(0, count - 1);
    else if (ch === '\n' || ch >= ' ') count += 1;
    i += 1;
  }
  return { keyInput, draftChars: count };
}
