/**
 * Applies an agent's edit proposal to a text. Pure and isomorphic: the server applies an accepted proposal to
 * the file on disk, and the Studio editor applies the same proposal to its buffer.
 *
 * Conventions (identical to the editor's `applyProposalEdits` in src/app/studio/proposal-edits.ts for every edit that
 * one accepts): lines split on `\n` (a `\r\n` file keeps its line endings), a trailing newline leaves a final empty
 * line that is addressable like any other, `edits` are 1-based inclusive ranges against the ORIGINAL text applied
 * bottom-up, and an edit's `text` is split on newlines as is ('' deletes the range; a trailing newline in `text`
 * adds an empty line). Beyond the editor, which throws: `endLine = startLine - 1` inserts before `startLine`, and
 * ranges outside the text are clamped.
 */
import type { ProposeEditInput } from './studio-contract.js';

export function applyProposalText(text: string, input: ProposeEditInput): string {
  if (typeof input.content === 'string') return input.content;
  const edits = input.edits ?? [];
  if (!edits.length) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const real = lines.length;
  const ordered = edits.map((edit, index) => ({ edit, index }))
    .sort((a, b) => b.edit.startLine - a.edit.startLine || b.edit.endLine - a.edit.endLine || b.index - a.index);
  for (const { edit } of ordered) {
    const start = Math.min(Math.max(edit.startLine, 1), real + 1) - 1;
    const count = Math.max(0, Math.min(edit.endLine, real) - start);
    const body = edit.text === '' ? [] : edit.text.split(/\r?\n/);
    lines.splice(start, count, ...body);
  }
  return lines.join(eol);
}

/**
 * Why the editor (`applyProposalEdits`) would refuse these edits against `text`, or null. `agentDoc.propose` checks it so a
 * proposal is accepted or refused the same way by the Studio editor, the thread views and a disk write.
 */
export function proposalEditsError(text: string, edits: ProposeEditInput['edits']): string | null {
  const total = text.split(/\r?\n/).length;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of [...(edits ?? [])].sort((a, b) => b.startLine - a.startLine)) {
    if (!Number.isInteger(edit.startLine) || !Number.isInteger(edit.endLine) || edit.startLine < 1 || edit.endLine < edit.startLine || edit.endLine > total) {
      return `Edit lines ${edit.startLine}-${edit.endLine} are outside the file (${total} lines).`;
    }
    if (edit.endLine >= floor) return 'Proposed edits overlap.';
    floor = edit.startLine;
  }
  return null;
}
