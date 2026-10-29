import type { editor } from 'monaco-editor';
import { EDITOR_SELECTION_MIME, parseEditorSelection } from '@zana-ai/zcc-plugin-sdk/app';

/** Keep ordinary clipboard text alongside the metadata understood by the assistant. */
export function bindEditorSelectionCopy(root: HTMLElement, instance: editor.IStandaloneCodeEditor, getPath: () => string | null): () => void {
  const copy = (event: ClipboardEvent) => {
    const model = instance.getModel();
    const range = instance.getSelection();
    const path = getPath();
    if (!event.clipboardData || !model || !range || range.isEmpty() || !path || instance.getSelections()?.length !== 1) return;
    const selection = parseEditorSelection({
      version: 1, path, startLine: range.startLineNumber,
      endLine: range.endLineNumber > range.startLineNumber && range.endColumn === 1 ? range.endLineNumber - 1 : range.endLineNumber,
      text: model.getValueInRange(range)
    });
    if (!selection) return;
    try {
      event.clipboardData.setData('text/plain', selection.text);
      event.clipboardData.setData(EDITOR_SELECTION_MIME, JSON.stringify(selection));
    } catch { return; }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  root.addEventListener('copy', copy, true);
  return () => root.removeEventListener('copy', copy, true);
}
