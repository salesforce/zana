import { shortcutForCommand } from './keyboard-shortcut-settings.js';

/**
 * Routes the `thread.find` shortcut (⌘F / Ctrl+F) to the thread view the user
 * is in. Several threads can be mounted at once (split panes, the thread
 * modal, embedded chats), so each one registers here and the key press picks
 * one by focus:
 *
 * - focus (or, with nothing focused, the last click) inside a thread's main
 *   column opens that thread's search;
 * - focus in a terminal, a Monaco editor, or a thread's side panel (the
 *   in-app browser keeps ⌘F for find in page) is left to that surface;
 * - anywhere else, the focused primary thread takes it.
 */
export interface ThreadFindTarget {
  /** The whole thread view, side panel included. */
  root(): HTMLElement | null;
  /** The conversation column that owns the search field. */
  main(): HTMLElement | null;
  /** Visible, focused, not embedded and not behind a modal. */
  isPrimary(): boolean;
  open(): void;
}

const targets: ThreadFindTarget[] = [];
let lastPointerTarget: Element | null = null;

const SURFACES_WITH_OWN_FIND = '.xterm, .monaco-editor';

function rememberPointer(event: PointerEvent) {
  lastPointerTarget = event.target instanceof Element ? event.target : null;
}

export function registerThreadFindTarget(target: ThreadFindTarget): () => void {
  if (targets.length === 0) document.addEventListener('pointerdown', rememberPointer, true);
  targets.push(target);
  return () => {
    const index = targets.indexOf(target);
    if (index >= 0) targets.splice(index, 1);
    if (targets.length === 0) {
      document.removeEventListener('pointerdown', rememberPointer, true);
      lastPointerTarget = null;
    }
  };
}

function contextElement(event: KeyboardEvent): Element | null {
  const target = event.target instanceof Element ? event.target : null;
  if (target && target !== document.body && target !== document.documentElement) return target;
  return lastPointerTarget?.isConnected ? lastPointerTarget : null;
}

function targetFor(event: KeyboardEvent): ThreadFindTarget | null {
  const element = contextElement(event);
  if (element?.closest(SURFACES_WITH_OWN_FIND)) return null;
  if (element) {
    // Innermost owner: a chat embedded in another thread's side panel wins.
    let owner: ThreadFindTarget | null = null;
    for (const target of targets) {
      const root = target.root();
      if (root?.contains(element) && (!owner || owner.root()!.contains(root))) owner = target;
    }
    if (owner) return owner.main()?.contains(element) ? owner : null;
  }
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    if (targets[index]!.isPrimary()) return targets[index]!;
  }
  return null;
}

/** True when this key press is `thread.find` and a thread view would take it. */
export function threadFindClaims(event: KeyboardEvent): boolean {
  return targets.length > 0 && shortcutForCommand('thread.find', event) && targetFor(event) !== null;
}

/** Opens (or refocuses) the chosen thread's search; false when none takes it. */
export function openThreadFind(event: KeyboardEvent): boolean {
  if (targets.length === 0 || !shortcutForCommand('thread.find', event)) return false;
  const target = targetFor(event);
  if (!target) return false;
  event.preventDefault();
  target.open();
  return true;
}
