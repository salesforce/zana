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
  libraryMarkdownExtensions
} from './library-markdown.js';
import { loadMarkdownBlocks, saveMarkdownBlocks, serializeMarkdownNodes, type MarkdownBlocks } from '../../../components/markdown/markdown-preservation.js';
import { MarkdownImageContext, type MarkdownImageScope } from '../../../components/markdown/markdown-editor-nodes.js';

export interface LibraryMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  autofocus?: boolean;
  placeholder?: string;
  editable?: boolean;
  imageScope?: MarkdownImageScope;
  onEditor?: (editor: Editor | null) => void;
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

/** Continuous Markdown editor adapted from BB Docs' source-preserving architecture. */
export function LibraryMarkdownEditor({
  value, onChange, autofocus = false, placeholder = 'Start writing…', editable = true,
  imageScope = { documentPath: '', localImages: false }, onEditor
}: LibraryMarkdownEditorProps) {
  const loaded = useRef<MarkdownBlocks | null>(null);
  const lastEmitted = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const didFocus = useRef(false);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    extensions: libraryMarkdownExtensions(placeholder),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editable,
    editorProps: {
      attributes: {
        class: 'library-md-editor-surface',
        'data-testid': 'library-md-editor-surface',
        role: 'textbox',
        'aria-label': 'Document content',
        'aria-multiline': 'true'
      }
    },
    onUpdate: ({ editor: current }) => {
      if (!loaded.current) return;
      const next = saveMarkdownBlocks(current, loaded.current, nodes => serializeMarkdownNodes(current, nodes));
      lastEmitted.current = next;
      onChangeRef.current(next);
    }
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || value === lastEmitted.current) return;
    loaded.current = loadMarkdownBlocks(editor, value, loaded.current ?? undefined);
    lastEmitted.current = value;
    if (autofocus && !didFocus.current) { didFocus.current = true; editor.commands.focus('end'); }
  }, [editor, value, autofocus]);
  useEffect(() => { editor?.setEditable(editable, false); }, [editor, editable]);
  useEffect(() => { onEditor?.(editor); return () => onEditor?.(null); }, [editor, onEditor]);

  return <MarkdownImageContext.Provider value={imageScope}>
    <div className="library-md-editor" data-testid="library-md-editor" onMouseDown={event => {
      if (event.button !== 0 || !editor?.isEditable || event.target !== event.currentTarget) return;
      event.preventDefault(); editor.commands.focus('end');
    }}>
      {editor && <>
        <BubbleMenu editor={editor} appendTo={appendLibraryBubbleTo} options={BUBBLE_MENU_OPTIONS} shouldShow={shouldShowLibraryBubble}>
          <LibraryMarkdownBubbleToolbar editor={editor} />
        </BubbleMenu>
        <EditorContent editor={editor} />
      </>}
    </div>
  </MarkdownImageContext.Provider>;
}
