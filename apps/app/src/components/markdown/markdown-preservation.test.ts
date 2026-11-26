// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { createLibraryMarkdownEditor } from '../../views/library/library/library-markdown.js';
import { loadMarkdownBlocks, saveMarkdownBlocks, serializeMarkdownNodes } from './markdown-preservation.js';

const documents: Editor[] = [];
afterEach(() => { documents.splice(0).forEach(editor => editor.destroy()); });
function open(source: string) {
  const editor = createLibraryMarkdownEditor(''); documents.push(editor);
  let loaded = loadMarkdownBlocks(editor, source);
  return { editor, save: () => saveMarkdownBlocks(editor, loaded, nodes => serializeMarkdownNodes(editor, nodes)),
    reload: (next: string) => { loaded = loadMarkdownBlocks(editor, next, loaded); } };
}
function position(editor: Editor, text: string) {
  let result = -1;
  editor.state.doc.descendants((node, pos) => {
    if (result < 0 && node.isText && node.text?.includes(text)) result = pos + node.text.indexOf(text);
  });
  if (result < 0) throw new Error(`Missing ${text}`);
  return result;
}
const SOURCE = '\uFEFF---\r\ntitle: "Keep  exactly"\r\n---\r\n\r\n# Release notes ##\r\n\r\nWith _underscores_ and [the docs][ref].\r\n\r\n<!-- preserve me -->\r\n\r\n- [X] Done\r\n- [ ] Todo\r\n\r\n| a | b |\r\n|---|:-:|\r\n| one | two |\r\n\r\n![Local](pixel.png)\r\n\r\n```mermaid\r\ngraph TD; A-->B\r\n```\r\n\r\nWith $x^2$ math.\r\n\r\n<div onclick="evil()">HTML</div>\r\n\r\nOriginal body.\r\n\r\n[ref]: https://example.com "Title"\r\n';

describe('BB source-preserving continuous Markdown', () => {
  it.each([SOURCE, '', '\n\n', '[ref]: https://example.com\n', '<!-- only a comment -->', '---\nkey: value\n---\n', '1. one\n1. two\n\nPlain\n', '# Heading\n\nSame\n\nSame\n', '> quoted\n>\n> second\n'])('keeps untouched source exact: %j', source => {
    const doc = open(source); expect(doc.save()).toBe(source);
  });
  it.each(['Release notes', 'Original body.'])('rewrites only the edited block: %s', text => {
    const { editor, save } = open(SOURCE);
    editor.commands.insertContentAt(position(editor, text), 'New ');
    const expected = text === 'Release notes' ? SOURCE.replace('# Release notes ##', '# New Release notes') : SOURCE.replace('Original body.', 'New Original body.');
    expect(save()).toBe(expected);
  });
  it('edits a resolved reference without changing its hidden definition or neighboring source', () => {
    const { editor, save } = open(SOURCE);
    expect(editor.state.doc.textContent).toContain('the docs');
    editor.commands.insertContentAt(position(editor, 'underscores'), 'new ');
    expect(save()).toContain('[ref]: https://example.com "Title"');
    expect(save()).toContain('[the docs](https://example.com');
    expect(save()).toContain('<!-- preserve me -->\r\n\r\n- [X] Done');
  });
  it('inserts and deletes whole paragraphs and restores original source with native undo', () => {
    const { editor, save } = open('First\n\nSecond\n\nThird\n');
    editor.commands.insertContentAt(7, { type: 'paragraph', content: [{ type: 'text', text: 'Inserted' }] });
    expect(save()).toBe('First\n\nInserted\n\nSecond\n\nThird\n');
    expect(editor.commands.undo()).toBe(true);
    expect(save()).toBe('First\n\nSecond\n\nThird\n');
    expect(editor.commands.redo()).toBe(true);
    expect(save()).toContain('Inserted');
    editor.commands.selectAll(); editor.commands.deleteSelection();
    expect(save()).toBe('\n');
  });
  it('merges and splits blocks through one selection', () => {
    const { editor, save } = open('First paragraph\n\nSecond paragraph\n\nUntouched _source_.\n');
    editor.commands.insertContentAt({ from: position(editor, 'paragraph'), to: position(editor, 'Second') + 6 }, 'joined');
    expect(save()).toBe('First joined paragraph\n\nUntouched _source_.\n');
    editor.commands.setTextSelection(position(editor, 'joined'));
    editor.commands.splitBlock();
    expect(save()).toBe('First \n\njoined paragraph\n\nUntouched _source_.\n');
  });
  it('preserves hidden definitions while deleting and adding surrounding content', () => {
    const { editor, save } = open('[ref]: /keep\n\nText\n\nLast\n');
    editor.commands.insertContentAt(position(editor, 'Text'), 'New ');
    expect(save()).toContain('[ref]: /keep');
    editor.commands.selectAll(); editor.commands.deleteSelection(); editor.commands.insertContent('Replacement');
    expect(save()).toBe('Replacement\n\n[ref]: /keep\n');
  });
  it('keeps source syntax editable without executing HTML', () => {
    const { editor, save } = open('<script>evil()</script>\n\nWith $x$ math.\n');
    expect(editor.state.doc.firstChild?.type.name).toBe('markdownSource');
    expect(editor.view.dom.querySelector('script')).toBeNull();
    editor.commands.insertContentAt(position(editor, 'evil'), 'not_');
    expect(save()).toBe('<script>not_evil()</script>\n\nWith $x$ math.\n');
  });
  it('loads external changes with a minimal diff and reuses unchanged duplicate nodes', () => {
    const doc = open('# Heading\n\nSame\n\nSame\n\nEnd\n');
    const first = doc.editor.state.doc.child(1); const second = doc.editor.state.doc.child(2);
    doc.editor.commands.setTextSelection(position(doc.editor, 'Same') + 2);
    doc.reload('# Updated\n\nSame\n\nSame\n\nEnd\n');
    expect(doc.editor.state.doc.child(1)).toBe(first); expect(doc.editor.state.doc.child(2)).toBe(second);
    expect(doc.editor.state.selection.$from.parent.textContent).toBe('Same');
    expect(doc.save()).toBe('# Updated\n\nSame\n\nSame\n\nEnd\n');
    doc.reload('# Updated\n\nSame\n\nSame\n\nEnd\n');
    expect(doc.editor.state.doc.child(1)).toBe(first);
    doc.reload('A'); doc.reload('AB'); doc.reload('A');
    expect(doc.save()).toBe('A');
  });
  it('refreshes the rendered destination when a reference definition changes', () => {
    const doc = open('See [docs][ref].\n\n[ref]: https://old.example.com\n');
    doc.reload('See [docs][ref].\n\n[ref]: https://new.example.com\n');
    expect(doc.editor.getJSON().content?.[0]?.content?.some(node => node.marks?.some(mark => mark.attrs?.href === 'https://new.example.com'))).toBe(true);
    expect(doc.save()).toContain('https://new.example.com');
  });
  it('keeps content recoverable when the rich parser cannot represent a block', () => {
    const doc = open('Original');
    const parse = vi.spyOn(doc.editor.markdown!, 'parse').mockImplementation(() => { throw new Error('unsupported'); });
    doc.reload('Unusual syntax');
    expect(doc.editor.state.doc.firstChild?.type.name).toBe('markdownSource');
    expect(doc.save()).toBe('Unusual syntax'); parse.mockRestore();
    vi.spyOn(doc.editor.markdown!, 'parse').mockReturnValue({ type: 'doc' });
    doc.reload('Empty parse'); expect(doc.save()).toBe('Empty parse');
  });
  it('supports empty documents, tasks, aligned tables, images and new CRLF paragraphs', () => {
    const empty = open(''); empty.editor.commands.insertContent('Hello'); expect(empty.save()).toBe('Hello');
    const doc = open(SOURCE);
    expect(doc.editor.state.doc.toJSON().content?.some(node => node.type === 'table')).toBe(true);
    expect(doc.editor.state.doc.toJSON().content?.some(node => node.type === 'paragraph' && node.content?.some(child => child.type === 'image'))).toBe(true);
    doc.editor.commands.insertContentAt(position(doc.editor, 'two'), 'New ');
    const changed = doc.save(); expect(changed).toMatch(/:-+:/);
    expect(changed.replace(/\r\n/g, '')).not.toContain('\n');
    expect(changed).toContain('![Local](pixel.png)\r\n\r\n```mermaid');
  });
});
