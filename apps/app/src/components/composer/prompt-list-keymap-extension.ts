import { Extension } from '@tiptap/core';

/**
 * In the prompt composer plain Enter submits, so the list extension's own
 * Enter → new-item binding never fires. Bind Shift+Enter instead: inside a list
 * it starts the next item and leaves the list from an empty item; elsewhere it falls through to HardBreak's
 * line break. The high priority puts it ahead of HardBreak's Shift+Enter.
 */
export const PromptListKeymapExtension = Extension.create({
  name: 'promptListKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Shift-Enter': ({ editor }) => {
        if (!editor.isActive('listItem')) return false;
        const { $from, empty } = editor.state.selection;
        // An empty item ends the list, like Enter does in a normal editor.
        if (empty && $from.parent.content.size === 0) return editor.commands.liftListItem('listItem');
        return editor.commands.splitListItem('listItem');
      }
    };
  }
});
