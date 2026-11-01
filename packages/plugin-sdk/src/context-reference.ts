import {
  parseContextReference, contextReferencePrompt, contextReferenceLocation,
  MAX_CONTEXT_REFERENCE_TEXT, MAX_CONTEXT_REFERENCES, MAX_CONTEXT_REFERENCES_TEXT,
  parseContextReferences, type ContextReference
} from '@zana-ai/zcc-domain/context-reference';
import { editorSelectionFromClipboard, editorSelectionLabel, parseEditorSelection, EDITOR_SELECTION_MIME, type EditorSelection } from './editor-selection.js';

export { parseContextReference, parseContextReferences, contextReferencePrompt, contextReferenceLocation,
  MAX_CONTEXT_REFERENCE_TEXT, MAX_CONTEXT_REFERENCES, MAX_CONTEXT_REFERENCES_TEXT, type ContextReference };
export const CONTEXT_REFERENCE_MIME = 'application/x-zcc-context-reference';

export function contextReferenceFromEditorSelection(selection: EditorSelection): ContextReference {
  return { version: 1, label: editorSelectionLabel(selection), text: selection.text,
    source: { kind: 'file', path: selection.path, ...(selection.startLine === undefined ? {} : { startLine: selection.startLine, endLine: selection.endLine }) } };
}

export function contextReferenceFromClipboard(data: Pick<DataTransfer, 'getData'> | null): ContextReference | null {
  if (!data) return null;
  try {
    const raw = data.getData(CONTEXT_REFERENCE_MIME);
    if (raw) {
      if (raw.length > MAX_CONTEXT_REFERENCE_TEXT * 6 + 32_768) return null;
      const reference = parseContextReference(JSON.parse(raw));
      return reference && reference.text.replace(/\r\n?/g, '\n') === data.getData('text/plain').replace(/\r\n?/g, '\n') ? reference : null;
    }
    const legacy = editorSelectionFromClipboard(data);
    return legacy ? contextReferenceFromEditorSelection(legacy) : null;
  } catch { return null; }
}

/** Call synchronously inside the source's copy event, including inside an iframe. */
export function writeContextReference(event: Pick<ClipboardEvent, 'clipboardData' | 'preventDefault'>, value: ContextReference): boolean {
  const reference = parseContextReference(value);
  if (!reference || !event.clipboardData) return false;
  try {
    event.clipboardData.setData(CONTEXT_REFERENCE_MIME, JSON.stringify(reference));
    const source = reference.source;
    if (source?.kind === 'file') {
      const legacy = parseEditorSelection({ version: 1, ...source, text: reference.text });
      if (legacy) event.clipboardData.setData(EDITOR_SELECTION_MIME, JSON.stringify(legacy));
    }
    event.clipboardData.setData('text/plain', reference.text);
    event.preventDefault();
    return true;
  } catch { return false; }
}

/** Opt in one DOM surface; unrelated selections and editable fields keep native copy. */
export function copyContextSelection(
  event: Pick<ClipboardEvent, 'clipboardData' | 'preventDefault'>,
  root: HTMLElement,
  reference: Omit<ContextReference, 'text'>
): boolean {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return false;
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
    if (element?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return false;
  }
  return writeContextReference(event, { ...reference, text: selection.toString() });
}
