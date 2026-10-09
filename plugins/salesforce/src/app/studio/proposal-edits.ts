export interface LineEdit { startLine: number; endLine: number; text: string }

/**
 * Applies the agent's 1-based, inclusive line edits to `source`. Edits must not overlap and must stay inside the file;
 * an empty `text` deletes the lines. Throws a readable Error for anything out of range so the proposal fails fast.
 */
export function applyProposalEdits(source: string, edits: readonly LineEdit[]): string {
  const lines = source.split('\n');
  const ordered = [...edits].sort((a, b) => b.startLine - a.startLine);
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of ordered) {
    if (!Number.isInteger(edit.startLine) || !Number.isInteger(edit.endLine) || edit.startLine < 1 || edit.endLine < edit.startLine || edit.endLine > lines.length) {
      throw new Error(`Edit lines ${edit.startLine}-${edit.endLine} are outside the file (${lines.length} lines).`);
    }
    if (edit.endLine >= floor) throw new Error('Proposed edits overlap.');
    floor = edit.startLine;
    lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...(edit.text === '' ? [] : edit.text.split('\n')));
  }
  return lines.join('\n');
}
