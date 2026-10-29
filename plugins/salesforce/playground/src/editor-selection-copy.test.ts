// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { bindEditorSelectionCopy } from './editor-selection-copy.js';
import { EDITOR_SELECTION_MIME, MAX_EDITOR_SELECTION_TEXT } from '@zana-ai/zcc-plugin-sdk/app';
function setup() {
  const root = document.createElement('div');
  const range = { isEmpty: () => false, startLineNumber: 2, endLineNumber: 4, endColumn: 1 };
  const state = { path: 'force-app/Review.agent' as string | null, text: 'unsaved\ncode\n', range: range as typeof range | null, multiple: false, model: true };
  const instance = { getModel: () => state.model ? { getValueInRange: () => state.text } : null, getSelection: () => state.range, getSelections: () => state.multiple ? [range, range] : [range] };
  const release = bindEditorSelectionCopy(root, instance as never, () => state.path);
  const copy = (withData = true, throws = false) => {
    const data = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: withData ? { setData: (key: string, value: string) => { if (throws) throw Error('clipboard unavailable'); data.set(key, value); } } : null });
    root.dispatchEvent(event);
    return { data, event };
  };
  return { state, copy, release };
}
describe('AgentScript selection copy', () => {
  it('copies unsaved text and correct line bounds, follows file switches, and disposes', () => {
    const { state, copy, release } = setup();
    const first = copy();
    expect(first.event.defaultPrevented).toBe(true);
    expect(first.data.get('text/plain')).toBe(state.text);
    expect(JSON.parse(first.data.get(EDITOR_SELECTION_MIME)!)).toMatchObject({ path: state.path, startLine: 2, endLine: 3, text: state.text });
    state.path = 'other.agent'; state.range!.endColumn = 4;
    expect(JSON.parse(copy().data.get(EDITOR_SELECTION_MIME)!)).toMatchObject({ path: 'other.agent', endLine: 4 });
    release(); expect(copy().data.size).toBe(0);
  });
  it('leaves native copy alone when there is no single valid selection or clipboard', () => {
    const { state, copy, release } = setup();
    expect(copy(false).event.defaultPrevented).toBe(false);
    expect(copy(true, true).event.defaultPrevented).toBe(false);
    for (const patch of [{ multiple: true }, { path: null }, { range: null }, { model: false }, { text: 'x'.repeat(MAX_EDITOR_SELECTION_TEXT + 1) }, { range: { ...state.range!, isEmpty: () => true } }]) {
      const before = { ...state }; Object.assign(state, patch);
      expect(copy().event.defaultPrevented).toBe(false);
      Object.assign(state, before);
    }
    release();
  });
});
