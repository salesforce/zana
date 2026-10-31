import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { closeHistory } from '@tiptap/pm/history';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { FileCode2, X } from 'lucide-react';
import { contextReferenceFromEditorSelection, contextReferenceLocation, contextReferencePrompt, parseContextReference, parseEditorSelection, type ContextReference } from '@zana-ai/zcc-plugin-sdk/app';
import './editor-selection-chip.css';

export function contextReferenceForNode(node: { attrs?: Record<string, unknown> }): ContextReference | null {
  const reference = parseContextReference(node.attrs?.reference);
  if (reference) return reference;
  const legacy = parseEditorSelection(node.attrs?.selection);
  return legacy ? contextReferenceFromEditorSelection(legacy) : null;
}

export function ContextReferenceBadge({ reference: selection, onRemove, onConvert }: {
  reference: ContextReference; onRemove?: () => void; onConvert?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; maxHeight?: number }>({ left: 8, bottom: 8 });
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!preview.current?.contains(event.target as globalThis.Node) && !chip.current?.contains(event.target as globalThis.Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); chip.current?.focus(); }
    };
    preview.current?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const label = selection.label;
  const close = () => { setOpen(false); chip.current?.focus(); };
  return (
    <span className="editor-selection-node" contentEditable={false}>
      <span className="editor-selection-chip">
        <button ref={chip} type="button" className="editor-selection-label" title={contextReferenceLocation(selection)} aria-label={`Inspect ${label}`} aria-expanded={open}
          onClick={() => {
            const box = chip.current!.getBoundingClientRect();
            const above = box.top >= 180;
            setPosition({
              left: Math.max(8, Math.min(box.left, window.innerWidth - Math.min(480, window.innerWidth - 16) - 8)),
              ...(above ? { bottom: window.innerHeight - box.top + 8, maxHeight: box.top - 16 }
                : { top: box.bottom + 8, maxHeight: Math.max(80, window.innerHeight - box.bottom - 16) })
            });
            setOpen(value => !value);
          }}>
          <FileCode2 size={13} aria-hidden /> <span>{label}</span>
        </button>
        {onRemove ? <button type="button" className="editor-selection-remove" aria-label={`Remove ${label}`} onClick={onRemove}><X size={12} aria-hidden /></button> : null}
      </span>
      {open && createPortal(
        <div ref={preview} tabIndex={-1} role="dialog" aria-label={`Copied selection: ${label}`} className="editor-selection-preview" style={position}>
          <div className="editor-selection-preview-heading"><strong>{label}</strong><button type="button" aria-label="Close selection preview" onClick={close}><X size={14} /></button></div>
          <div className="editor-selection-path">{contextReferenceLocation(selection)}</div>
          <pre tabIndex={0}>{selection.text}</pre>
          <small>Copied selection · includes edits at copy time</small>
          {onConvert ? <button type="button" className="editor-selection-convert" onClick={() => { setOpen(false); onConvert(); }}>Convert to text</button> : null}
        </div>, document.body
      )}
    </span>
  );
}

export function EditorSelectionView({ node, deleteNode, editor, getPos }: NodeViewProps) {
  const reference = contextReferenceForNode(node);
  if (!reference) return null;
  return <NodeViewWrapper as="span" className="editor-selection-node" contentEditable={false}>
    <ContextReferenceBadge reference={reference}
      onRemove={() => { editor.view.dispatch(closeHistory(editor.state.tr)); deleteNode(); editor.commands.focus(); }}
      onConvert={() => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const tr = closeHistory(editor.state.tr).replaceWith(pos, pos + node.nodeSize, editor.schema.text(reference.text));
        editor.view.dispatch(tr); editor.commands.focus();
      }} />
  </NodeViewWrapper>;
}

export const EditorSelectionExtension = Node.create({
  name: 'editorSelection',
  group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ selection: { default: null, rendered: false }, reference: { default: null, rendered: false } }),
  // Validated clipboard snapshots and plugin drafts create these nodes; arbitrary HTML does not.
  parseHTML: () => [],
  renderHTML({ node, HTMLAttributes }) {
    const selection = contextReferenceForNode(node);
    return ['span', mergeAttributes(HTMLAttributes, { class: 'editor-selection-chip' }), selection ? selection.label : ''];
  },
  renderText({ node }) {
    const selection = contextReferenceForNode(node);
    return selection ? contextReferencePrompt(selection) : '';
  },
  addNodeView: () => ReactNodeViewRenderer(EditorSelectionView)
});
