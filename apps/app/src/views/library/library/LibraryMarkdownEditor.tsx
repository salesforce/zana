import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { isNodeSelection, type ChainedCommands, type Editor } from '@tiptap/core';
import {
  Bold,
  Code,
  Heading2,
  Italic,
  List,
  ListChecks,
  Quote,
  SquareCode
} from 'lucide-react';
import {
  joinLibraryMarkdown,
  libraryMarkdownExtensions,
  splitLibraryMarkdown
} from './library-markdown.js';

export interface LibraryMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  autofocus?: boolean;
  placeholder?: string;
}

interface BubbleAction {
  id: string;
  label: string;
  icon: typeof Bold;
  isActive: (editor: Editor) => boolean;
  run: (chain: ChainedCommands) => ChainedCommands;
}

const BUBBLE_ACTIONS: BubbleAction[] = [
  {
    id: 'bold',
    label: 'Bold',
    icon: Bold,
    isActive: (editor) => editor.isActive('bold'),
    run: (chain) => chain.toggleBold()
  },
  {
    id: 'italic',
    label: 'Italic',
    icon: Italic,
    isActive: (editor) => editor.isActive('italic'),
    run: (chain) => chain.toggleItalic()
  },
  {
    id: 'code',
    label: 'Inline code',
    icon: Code,
    isActive: (editor) => editor.isActive('code'),
    run: (chain) => chain.toggleCode()
  },
  {
    id: 'heading',
    label: 'Heading',
    icon: Heading2,
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    run: (chain) => chain.toggleHeading({ level: 2 })
  },
  {
    id: 'bulletList',
    label: 'Bullet list',
    icon: List,
    isActive: (editor) => editor.isActive('bulletList'),
    run: (chain) => chain.toggleBulletList()
  },
  {
    id: 'taskList',
    label: 'Checklist',
    icon: ListChecks,
    isActive: (editor) => editor.isActive('taskList'),
    run: (chain) => chain.toggleTaskList()
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    icon: SquareCode,
    isActive: (editor) => editor.isActive('codeBlock'),
    run: (chain) => chain.toggleCodeBlock()
  },
  {
    id: 'blockquote',
    label: 'Quote',
    icon: Quote,
    isActive: (editor) => editor.isActive('blockquote'),
    run: (chain) => chain.toggleBlockquote()
  }
];

const BUBBLE_MENU_OPTIONS = { placement: 'top' as const, offset: 8 };

function appendLibraryBubbleTo(): HTMLElement {
  return document.body;
}

export function shouldShowLibraryBubble({
  editor,
  state,
  from,
  to
}: {
  editor: Editor;
  state: Editor['state'];
  from: number;
  to: number;
}): boolean {
  if (!editor.isEditable || state.selection.empty) return false;
  if (isNodeSelection(state.selection)) return false;
  return state.doc.textBetween(from, to).trim().length > 0;
}

export function LibraryMarkdownBubbleToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="library-md-bubble" role="toolbar" aria-label="Formatting">
      {BUBBLE_ACTIONS.map((action) => {
        const Icon = action.icon;
        const active = action.isActive(editor);
        return (
          <button
            key={action.id}
            type="button"
            className={`library-edit-btn${active ? ' active' : ''}`}
            aria-label={action.label}
            aria-pressed={active}
            title={action.label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              action.run(editor.chain().focus()).run();
            }}
          >
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * WYSIWYG markdown editor for library docs. Front-matter is hidden from the
 * editor and reattached on every change so agent-authored metadata survives.
 */
export function LibraryMarkdownEditor({
  value,
  onChange,
  autofocus = false,
  placeholder = 'Start writing…'
}: LibraryMarkdownEditorProps) {
  const initial = splitLibraryMarkdown(value);
  const headerRef = useRef(initial.header);
  const lastEmittedRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  headerRef.current = splitLibraryMarkdown(value).header;

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    extensions: libraryMarkdownExtensions(placeholder),
    content: initial.body || { type: 'doc', content: [{ type: 'paragraph' }] },
    contentType: initial.body ? 'markdown' : 'json',
    autofocus: autofocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'library-md-editor-surface',
        'data-testid': 'library-md-editor-surface'
      }
    },
    onUpdate: ({ editor: current }) => {
      const next = joinLibraryMarkdown(headerRef.current, current.getMarkdown());
      lastEmittedRef.current = next;
      onChangeRef.current(next);
    }
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === lastEmittedRef.current) return;
    const next = splitLibraryMarkdown(value);
    headerRef.current = next.header;
    lastEmittedRef.current = value;
    if (next.body) {
      editor.commands.setContent(next.body, { contentType: 'markdown' });
    } else {
      editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    }
  }, [editor, value]);

  if (!editor) {
    return <div className="library-md-editor" data-testid="library-md-editor" />;
  }

  return (
    <div className="library-md-editor" data-testid="library-md-editor">
      <BubbleMenu
        editor={editor}
        appendTo={appendLibraryBubbleTo}
        options={BUBBLE_MENU_OPTIONS}
        shouldShow={shouldShowLibraryBubble}
      >
        <LibraryMarkdownBubbleToolbar editor={editor} />
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
