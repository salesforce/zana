import { Editor, Extension, InputRule } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { parseFrontMatter } from '@zana-ai/zcc-extension-sdk/helpers';

/**
 * Split a library markdown file into the original front-matter header (fences
 * included, byte-for-byte) and the body the WYSIWYG editor should see.
 * Documents without a header pass through as `{ header: '', body: raw }`.
 */
export function splitLibraryMarkdown(raw: string): { header: string; body: string } {
  const parsed = parseFrontMatter(raw);
  if (!parsed) return { header: '', body: raw };
  if (parsed.body.length === 0) return { header: raw, body: '' };
  return { header: raw.slice(0, raw.length - parsed.body.length), body: parsed.body };
}

/** Reattach a preserved front-matter header to a serialized markdown body. */
export function joinLibraryMarkdown(header: string, body: string): string {
  return `${header}${body}`;
}

/**
 * Typing `[ ] ` / `[x] ` at the start of a line turns into a task list item,
 * matching how the markdown source spells checkboxes (BB Docs/Tasks).
 */
export function applyMarkdownTaskInput(
  chain: () => ReturnType<Editor['chain']>,
  range: { from: number; to: number },
  marker: string
): void {
  chain().deleteRange(range).toggleTaskList().run();
  if (/[xX]/.test(marker)) chain().updateAttributes('taskItem', { checked: true }).run();
}

const MarkdownTaskInput = Extension.create({
  name: 'markdownTaskInput',
  priority: 200,
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*\[([ xX]?)\]\s$/,
        handler: ({ range, match, chain }) => {
          applyMarkdownTaskInput(chain, range, match[1] ?? '');
        }
      })
    ];
  }
});

export function libraryMarkdownExtensions(placeholder = 'Start writing…') {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true },
      trailingNode: false
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: true, lastColumnResizable: false }
    }),
    MarkdownTaskInput,
    Placeholder.configure({ placeholder }),
    Markdown
  ];
}

/** Headless TipTap editor over a markdown *body* (no front-matter). Destroy after use. */
export function createLibraryMarkdownEditor(body: string, placeholder?: string): Editor {
  return new Editor({
    extensions: libraryMarkdownExtensions(placeholder),
    ...(body
      ? { content: body, contentType: 'markdown' as const }
      : { content: { type: 'doc', content: [{ type: 'paragraph' }] } })
  });
}

/**
 * Load markdown into the library WYSIWYG stack and serialize it back.
 * Front-matter is never fed to TipTap; it is concatenated unchanged.
 */
export function roundTripLibraryMarkdown(raw: string): string {
  const { header, body } = splitLibraryMarkdown(raw);
  const editor = createLibraryMarkdownEditor(body);
  try {
    return joinLibraryMarkdown(header, editor.getMarkdown());
  } finally {
    editor.destroy();
  }
}
