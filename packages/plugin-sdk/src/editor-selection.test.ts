import { describe, expect, it } from 'vitest';
import { EDITOR_SELECTION_MIME, MAX_EDITOR_SELECTION_TEXT, parseEditorSelection, editorSelectionFromClipboard, editorSelectionLabel, editorSelectionPrompt } from './editor-selection.js';
const selection = { version: 1 as const, path: 'force-app/Review.agent', startLine: 2, endLine: 3, text: '  topic main:\n    description: "Review"' };
const clipboard = (metadata: string, text = selection.text) => ({ getData: (type: string) => type === EDITOR_SELECTION_MIME ? metadata : text });
describe('editor selection clipboard', () => {
  it('preserves a bounded copied snapshot and its location', () => {
    expect(editorSelectionFromClipboard(clipboard(JSON.stringify(selection)))).toEqual(selection);
    expect(editorSelectionFromClipboard(clipboard(JSON.stringify(selection), selection.text.replace(/\n/g, '\r\n')))).toEqual(selection);
    expect(editorSelectionLabel(selection)).toBe('Review.agent (2–3)');
    expect(editorSelectionLabel({ ...selection, path: 'C:\\src\\Review.agent', endLine: 2 })).toBe('Review.agent (2)');
    expect(editorSelectionPrompt(selection)).toContain('force-app/Review.agent:2–3 (copied selection)\n```\n'+selection.text+'\n```');
    expect(editorSelectionPrompt({ ...selection, text: '```\ncode\n```' })).toContain('\n````\n```\ncode\n```\n````');
  });
  it.each([null, [], '', { ...selection, version: 2 }, { ...selection, path: '' }, { ...selection, path: 'x\ny' }, { ...selection, path: 'x'.repeat(4097) }, { ...selection, startLine: 0 }, { ...selection, startLine: 2.5 }, { ...selection, endLine: 1 }, { ...selection, endLine: 10_000_001 }, { ...selection, text: '' }, { ...selection, text: 'x'.repeat(MAX_EDITOR_SELECTION_TEXT + 1) }])('rejects malformed or oversized metadata (%#)', (value) => {
    expect(parseEditorSelection(value)).toBeNull();
  });
  it('falls back to ordinary paste for stale, missing, malformed or inaccessible metadata', () => {
    expect(editorSelectionFromClipboard(null)).toBeNull();
    expect(editorSelectionFromClipboard(clipboard(''))).toBeNull();
    expect(editorSelectionFromClipboard(clipboard('{broken'))).toBeNull();
    expect(editorSelectionFromClipboard(clipboard(JSON.stringify(selection), 'unrelated'))).toBeNull();
    expect(editorSelectionFromClipboard(clipboard(JSON.stringify({ ...selection, startLine: 0 })))).toBeNull();
    expect(editorSelectionFromClipboard(clipboard('x'.repeat(MAX_EDITOR_SELECTION_TEXT * 6 + 8193)))).toBeNull();
    expect(editorSelectionFromClipboard({ getData: () => { throw Error('unavailable'); } })).toBeNull();
  });
});
