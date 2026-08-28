import { Maximize2, Minimize2 } from 'lucide-react';
import { EditorContent, type Editor } from '@tiptap/react';
import { ComposerIconButton } from '../ui/CommandComposer.js';
import { ComposerImageThumbs } from './ComposerImageThumbs.js';
import { ComposerTypeaheadMenu } from './ComposerTypeaheadMenu.js';
import type { ComposerImageAttachment } from './composer-image-attachments.js';
import type { TypeaheadSuggestion } from './types.js';

export function ComposerPromptField({
  editor,
  images,
  onRemoveImage,
  expanded,
  onToggleExpanded,
  expandTestId,
  menuOpen,
  suggestions,
  selectedIndex,
  triggerKind,
  onApply
}: {
  editor: Editor | null;
  images: readonly ComposerImageAttachment[];
  onRemoveImage: (id: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  expandTestId: string;
  menuOpen: boolean;
  suggestions: readonly TypeaheadSuggestion[];
  selectedIndex: number;
  triggerKind: 'mention' | 'command';
  onApply: (item: TypeaheadSuggestion) => void;
}) {
  return (
    <>
      <ComposerImageThumbs
        images={images.map((image) => ({
          id: image.id,
          name: image.name,
          src: image.previewSrc
        }))}
        onRemove={onRemoveImage}
      />
      <div className="thread-command-editor-slot">
        <ComposerIconButton
          className="thread-command-expand"
          aria-label={expanded ? 'Make prompt box smaller' : 'Make prompt box larger'}
          title={expanded ? 'Make prompt box smaller' : 'Make prompt box larger'}
          data-testid={expandTestId}
          onClick={onToggleExpanded}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </ComposerIconButton>
        <EditorContent editor={editor} />
      </div>
      {menuOpen && (
        <ComposerTypeaheadMenu
          suggestions={suggestions}
          selectedIndex={selectedIndex}
          triggerKind={triggerKind}
          onApply={onApply}
        />
      )}
    </>
  );
}
