/** Clipboard metadata only: a copied snapshot never grants filesystem access. */
export const EDITOR_SELECTION_MIME = 'application/x-zcc-editor-selection';
export const MAX_EDITOR_SELECTION_TEXT = 100_000;
export interface EditorSelection {
  version: 1;
  path: string;
  /** Rendered passages may not have an exact source-line mapping. */
  startLine?: number;
  endLine?: number;
  text: string;
}

export function parseEditorSelection(value: unknown): EditorSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Partial<EditorSelection>;
  const hasLines = data.startLine !== undefined || data.endLine !== undefined;
  if (data.version !== 1 || typeof data.path !== 'string' || !data.path.trim() || data.path.length > 4096 || /[\r\n\0]/.test(data.path)
    || (hasLines && (!Number.isSafeInteger(data.startLine) || !Number.isSafeInteger(data.endLine)
    || data.startLine! < 1 || data.endLine! < data.startLine! || data.endLine! > 10_000_000))
    || typeof data.text !== 'string' || !data.text.length || data.text.length > MAX_EDITOR_SELECTION_TEXT) return null;
  return { version: 1, path: data.path, ...(hasLines ? { startLine: data.startLine, endLine: data.endLine } : {}), text: data.text };
}

export function editorSelectionFromClipboard(data: Pick<DataTransfer, 'getData'> | null): EditorSelection | null {
  if (!data) return null;
  try {
    const raw = data.getData(EDITOR_SELECTION_MIME);
    if (!raw || raw.length > MAX_EDITOR_SELECTION_TEXT * 6 + 8192) return null;
    const selection = parseEditorSelection(JSON.parse(raw));
    // Ignore stale or unrelated metadata; normal text paste remains the fallback.
    return selection && selection.text.replace(/\r\n?/g, '\n') === data.getData('text/plain').replace(/\r\n?/g, '\n') ? selection : null;
  } catch { return null; }
}

export function editorSelectionLabel(selection: EditorSelection): string {
  const file = selection.path.split(/[\\/]/).pop()!;
  return selection.startLine === undefined ? `${file} (selection)` : `${file} (${selection.startLine}${selection.endLine === selection.startLine ? '' : `–${selection.endLine}`})`;
}

/** Send the snapshot as ordinary prompt text; never ask the host to read a clipboard path. */
export function editorSelectionPrompt(selection: EditorSelection): string {
  let fenceLength = 3;
  for (const match of selection.text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = '`'.repeat(fenceLength);
  const location = selection.startLine === undefined ? selection.path : `${selection.path}:${selection.startLine}–${selection.endLine}`;
  return `\n\n${location} (copied selection)\n${fence}\n${selection.text}\n${fence}\n\n`;
}
