import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export interface PromptHistoryKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

/** Leave native editing alone until an arrow would leave the whole prompt. */
export function canNavigatePromptHistory(view: EditorView, event: PromptHistoryKeyEvent): boolean {
  const direction = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : null;
  if (!direction || event.defaultPrevented || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey
    || event.isComposing || view.composing || !view.hasFocus()) return false;

  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;

  // endOfTextblock measures rendered lines (including hard breaks and wrapping),
  // but only within the current block. Check its ancestors for other blocks too.
  const { $head } = selection;
  for (let depth = $head.depth; depth > 0; depth--) {
    const index = $head.index(depth - 1);
    const parent = $head.node(depth - 1);
    if (direction === 'up' ? index > 0 : index < parent.childCount - 1) return false;
  }
  return view.endOfTextblock(direction);
}
