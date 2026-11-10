import { describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { canNavigatePromptHistory, type PromptHistoryKeyEvent } from './prompt-history-navigation.js';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'inline*', group: 'block' },
  bulletList: { content: 'listItem+', group: 'block' },
  listItem: { content: 'paragraph block*' },
  text: { group: 'inline' },
  hardBreak: { inline: true, group: 'inline' },
  mention: { inline: true, group: 'inline', atom: true }
} });
const paragraph = (text = 'line') => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const event = (key = 'ArrowUp', extra: Partial<PromptHistoryKeyEvent> = {}): PromptHistoryKeyEvent => ({
  key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...extra
});
function viewFor(doc = schema.node('doc', null, [paragraph()]), pos = 1, end = pos) {
  return {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, pos, end) }),
    composing: false,
    hasFocus: vi.fn(() => true),
    endOfTextblock: vi.fn(() => true)
  };
}
const eligible = (view: ReturnType<typeof viewFor>, key = event()) => canNavigatePromptHistory(view as unknown as EditorView, key);

describe('canNavigatePromptHistory', () => {
  it.each(['ArrowUp', 'ArrowDown'])('allows %s at the visual boundary of a single block', key => {
    const view = viewFor();
    expect(eligible(view, event(key))).toBe(true);
    expect(view.endOfTextblock).toHaveBeenCalledWith(key === 'ArrowUp' ? 'up' : 'down');
  });

  it('allows an empty prompt', () => {
    expect(eligible(viewFor(schema.node('doc', null, [paragraph('')])))).toBe(true);
  });

  it.each(['ArrowUp', 'ArrowDown'])('leaves %s native when a hard-break or wrapped line remains', key => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('first'), schema.node('hardBreak'), schema.text('last')])]);
    const view = viewFor(doc, 8);
    view.endOfTextblock.mockReturnValue(false);
    expect(eligible(view, event(key))).toBe(false);
  });

  it('requires the first or last block of the whole document', () => {
    const doc = schema.node('doc', null, [paragraph('a'), paragraph('b'), paragraph('c')]);
    for (const [pos, up, down] of [[1, true, false], [4, false, false], [7, false, true]] as const) {
      expect(eligible(viewFor(doc, pos), event('ArrowUp'))).toBe(up);
      expect(eligible(viewFor(doc, pos), event('ArrowDown'))).toBe(down);
    }
  });

  it('checks list and list-item ancestors, not just the current paragraph', () => {
    const item = (texts: string[]) => schema.node('listItem', null, texts.map(text => paragraph(text)));
    const doc = schema.node('doc', null, [schema.node('bulletList', null, [item(['a', 'b']), item(['c'])])]);
    const positions: number[] = [];
    doc.descendants((node, pos) => { if (node.isTextblock) positions.push(pos + 1); });
    for (const [index, pos] of positions.entries()) {
      expect(eligible(viewFor(doc, pos), event('ArrowUp'))).toBe(index === 0);
      expect(eligible(viewFor(doc, pos), event('ArrowDown'))).toBe(index === positions.length - 1);
    }
  });

  it.each(['shiftKey', 'metaKey', 'ctrlKey', 'altKey', 'defaultPrevented', 'isComposing'] as const)('preserves %s events', flag => {
    const view = viewFor();
    expect(eligible(view, event('ArrowUp', { [flag]: true }))).toBe(false);
    expect(view.endOfTextblock).not.toHaveBeenCalled();
  });

  it('ignores other keys, composition, and unfocused toolbar events', () => {
    const view = viewFor();
    expect(eligible(view, event('ArrowLeft'))).toBe(false);
    view.composing = true;
    expect(eligible(view)).toBe(false);
    view.composing = false;
    view.hasFocus.mockReturnValue(false);
    expect(eligible(view)).toBe(false);
  });

  it('preserves text ranges and node selections', () => {
    expect(eligible(viewFor(undefined, 1, 3))).toBe(false);
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.node('mention')])]);
    const view = viewFor(doc);
    view.state = EditorState.create({ doc, selection: NodeSelection.create(doc, 1) });
    expect(eligible(view)).toBe(false);
  });
});
