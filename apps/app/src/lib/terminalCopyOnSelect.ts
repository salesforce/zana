// Copy on select for the embedded terminal (AppConfig.terminalCopyOnSelectEnabled).
//
// When a left-button mouse selection that started inside the terminal ends,
// the selected text goes to the system clipboard, like Windows Terminal's
// `copyOnSelect`, PuTTY and most Linux terminals. It copies once per gesture,
// on mouseup, never on each selection change while dragging.
//
// What it never copies:
// - an empty selection (a plain click clears the selection; that must not
//   overwrite the clipboard);
// - selections made without the mouse: a find-in-terminal match or a
//   programmatic `select()`. Only a mousedown inside the terminal arms a copy;
// - selections from other mouse buttons (a right-click keeps the selection);
// - a selection the gesture didn't change. With mouse tracking on, a plain
//   click goes to the program and leaves xterm's old selection in place;
//   copying it again would overwrite whatever was copied elsewhere since.
//
// Programs with mouse tracking on (Claude Code, Codex, vim, tmux `mouse on`)
// take plain drags, so xterm only selects with Shift+drag (Option+drag on
// macOS). Those selections arrive through the same mouseup and are copied too.
//
// Ctrl+C is untouched: the key handler still leaves it to xterm, which sends
// `^C` (SIGINT) even while text is selected.

/** The slice of xterm's Terminal this helper reads. */
export interface CopyOnSelectTerminal {
  hasSelection(): boolean;
  getSelection(): string;
  onSelectionChange(listener: () => void): { dispose(): void };
}

export interface CopyOnSelectOptions {
  /** Read live on each gesture, so a Settings change applies to open terminals. */
  enabled: () => boolean;
  copy: (text: string) => Promise<void>;
  onError: (err: unknown) => void;
}

const LEFT_BUTTON = 0;

/**
 * Arm on a left mousedown inside `host` (capture phase, so a program's mouse
 * tracking can't hide it), then read the selection after the matching mouseup.
 * The mouseup listener sits on the document because a drag can end outside the
 * terminal. xterm finalises the selection in its own document mouseup listener,
 * which may run after ours, so the read waits one task.
 */
export function registerCopyOnSelect(
  term: CopyOnSelectTerminal,
  host: HTMLElement,
  opts: CopyOnSelectOptions
): { dispose(): void } {
  const doc = host.ownerDocument;
  let armed = false;
  let changed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const copySelection = () => {
    timer = undefined;
    if (disposed || !changed || !opts.enabled() || !term.hasSelection()) return;
    const text = term.getSelection();
    if (!text) return;
    opts.copy(text).catch((err: unknown) => {
      if (!disposed) opts.onError(err);
    });
  };

  const onMouseDown = (event: MouseEvent) => {
    armed = event.button === LEFT_BUTTON;
    if (armed) changed = false;
  };
  const selectionListener = term.onSelectionChange(() => {
    changed = true;
  });
  const onMouseUp = (event: MouseEvent) => {
    if (!armed || event.button !== LEFT_BUTTON) return;
    armed = false;
    clearTimeout(timer);
    timer = setTimeout(copySelection, 0);
  };

  host.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('mouseup', onMouseUp, true);
  return {
    dispose() {
      disposed = true;
      clearTimeout(timer);
      selectionListener.dispose();
      host.removeEventListener('mousedown', onMouseDown, true);
      doc.removeEventListener('mouseup', onMouseUp, true);
    }
  };
}
