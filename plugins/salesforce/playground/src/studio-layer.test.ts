/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioLayer, CURSOR_DEBOUNCE_MS } from './studio-layer.js';

class Range {
  constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
}

/** Minimal in-memory Monaco: a text model, decoration collections, view zones, widgets and edit application. */
function createFake(initial: string) {
  let text = initial;
  const contentListeners: Array<() => void> = [];
  const cursorListeners: Array<() => void> = [];
  const mouseListeners: Array<(e: any) => void> = [];
  const lines = () => text.split('\n');
  const offset = (line: number, col: number) => lines().slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  const model = {
    getValue: () => text,
    getLineCount: () => lines().length,
    getLineLength: (n: number) => lines()[n - 1]!.length,
    getLineContent: (n: number) => lines()[n - 1] ?? '',
    getValueInRange: (s: any) => s.text
  };
  const makeCollection = () => ({ set: vi.fn(), clear: vi.fn() });
  const collections: Array<ReturnType<typeof makeCollection>> = [];
  const zones = new Map<string, any>();
  let zoneSeq = 0;
  const widgets = new Set<any>();
  const container = document.createElement('div');
  const parent = document.createElement('div');
  parent.appendChild(container);
  let selection: any = null;
  let position: any = { lineNumber: 2, column: 3 };
  const editor: any = {
    createDecorationsCollection: () => { const c = makeCollection(); collections.push(c); return c; },
    onDidChangeCursorSelection: (cb: () => void) => { cursorListeners.push(cb); return { dispose: vi.fn() }; },
    onDidChangeModelContent: (cb: () => void) => { contentListeners.push(cb); return { dispose: vi.fn() }; },
    onMouseDown: (cb: (e: any) => void) => { mouseListeners.push(cb); return { dispose: vi.fn() }; },
    addCommand: vi.fn(),
    getModel: () => model,
    changeViewZones: (fn: (a: any) => void) => fn({
      addZone: (zone: any) => { const id = `z${++zoneSeq}`; zones.set(id, zone); return id; },
      removeZone: (id: string) => { zones.delete(id); }
    }),
    addContentWidget: (w: any) => widgets.add(w),
    removeContentWidget: (w: any) => widgets.delete(w),
    getContainerDomNode: () => container,
    getSelection: () => selection,
    getPosition: () => position,
    executeEdits: vi.fn((_source: string, edits: any[]) => {
      for (const edit of [...edits].reverse()) {
        const r = edit.range;
        const start = offset(r.startLineNumber, r.startColumn);
        const end = offset(r.endLineNumber, r.endColumn);
        text = text.slice(0, start) + edit.text + text.slice(end);
      }
      contentListeners.forEach(cb => cb());
    })
  };
  const monaco: any = {
    KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyS: 49 }, Range,
    editor: { ContentWidgetPositionPreference: { ABOVE: 1, BELOW: 2 }, MouseTargetType: { GUTTER_GLYPH_MARGIN: 2, CONTENT_TEXT: 6 } }
  };
  return {
    monaco, editor, zones, widgets, parent, collections, mouseListeners, cursorListeners, contentListeners,
    text: () => text,
    setText(next: string) { text = next; contentListeners.forEach(cb => cb()); },
    setSelection(s: any, ...p: any[]) { selection = s; if (p.length) position = p[0]; },
    del: () => collections[0]!, marks: () => collections[1]!
  };
}

let fake: ReturnType<typeof createFake>;
let post: any;
let layer: StudioLayer;
const propose = (content: string, id = 'p1') => layer.setProposal({ proposalId: id, content, summary: 'tidy', actor: 'Agent' });
const bar = () => fake.parent.querySelector('.sf-proposal-bar') as HTMLElement | null;
const click = (root: Element, label: string) => (Array.from(root.querySelectorAll('button')).find(b => b.textContent === label) as HTMLButtonElement).click();
const widgetFor = (index: number) => Array.from(fake.widgets).find(w => w.getId().endsWith(`.${index}`));

beforeEach(() => {
  fake = createFake('a\nb\nc\nd');
  post = vi.fn();
  layer = new StudioLayer(fake.monaco, fake.editor, post);
});
afterEach(() => { vi.useRealTimers(); });

it('registers the save command', () => {
  const [keys, handler] = fake.editor.addCommand.mock.calls[0];
  expect(keys).toBe(2048 | 49);
  handler();
  expect(post).toHaveBeenCalledWith({ type: 'saveRequest' });
});

it('renders a proposal as decorations, spacer + add zones, hunk widgets and a bar before the editor', () => {
  propose('a\nB\nc\nd\nnew');
  expect(fake.del().set).toHaveBeenCalledTimes(1);
  const decos = fake.del().set.mock.calls[0][0];
  expect(decos).toHaveLength(1);
  expect(decos[0].options.className).toBe('sf-del');
  expect(decos[0].range.startLineNumber).toBe(2);
  expect(fake.zones.size).toBeGreaterThanOrEqual(3);
  expect(bar()?.textContent).toContain('Agent: tidy');
  expect(bar()?.textContent).toContain('2 changes');
  expect(fake.parent.firstElementChild).toBe(bar());
  expect(fake.widgets.size).toBe(2);
  const pos = widgetFor(0).getPosition();
  expect(pos).toEqual({ position: { lineNumber: 1, column: 1 }, preference: [2] });
  expect(widgetFor(0).getDomNode().textContent).toBe('AcceptReject');
});

it('positions the widget ABOVE line 1 for a hunk at the top, with blank add lines rendered as spaces', () => {
  propose('x\n\na\nb\nc\nd');
  const widget = widgetFor(0);
  expect(widget.getPosition()).toEqual({ position: { lineNumber: 1, column: 1 }, preference: [1] });
  const addZone = Array.from(fake.zones.values()).find(z => z.domNode.className === 'sf-add-zone');
  expect(addZone.domNode.children[1].textContent).toBe(' ');
});

it('accepts a single hunk, keeping the rest pending, then resolves when none remain', () => {
  propose('a\nB\nc\nD');
  click(widgetFor(0).getDomNode(), 'Accept');
  expect(fake.text()).toBe('a\nB\nc\nd');
  expect(fake.editor.executeEdits.mock.calls[0][0]).toBe('agent-proposal');
  expect(bar()?.textContent).toContain('1 change');
  expect(post).not.toHaveBeenCalled();
  click(widgetFor(0).getDomNode(), 'Accept');
  expect(fake.text()).toBe('a\nB\nc\nD');
  expect(bar()).toBeNull();
  expect(fake.widgets.size).toBe(0);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'proposalResolved', proposalId: 'p1', outcome: 'accepted', acceptedHunks: 2, rejectedHunks: 0, content: 'a\nB\nc\nD' }));
});

it('rejects a hunk and reports a partial outcome', () => {
  propose('a\nB\nc\nD');
  click(widgetFor(0).getDomNode(), 'Reject');
  expect(fake.text()).toBe('a\nb\nc\nd');
  click(widgetFor(0).getDomNode(), 'Accept');
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'partial', acceptedHunks: 1, rejectedHunks: 1 }));
});

it('accept all and reject all from the bar', () => {
  propose('a\nB\nc\nD');
  click(bar()!, 'Accept all');
  expect(fake.text()).toBe('a\nB\nc\nD');
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'accepted', acceptedHunks: 2 }));
  propose('a\nX\nc\nD', 'p2');
  click(bar()!, 'Reject all');
  expect(fake.text()).toBe('a\nB\nc\nD');
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ proposalId: 'p2', outcome: 'rejected', rejectedHunks: 1 }));
  expect(bar()).toBeNull();
});

it('ignores actions without a session, unknown hunks, and clearProposal for another id', () => {
  layer.acceptHunk(0); layer.acceptAll(); layer.rejectHunk(0); layer.rejectAll(); layer.onFileSwitched();
  layer.clearProposal('nope');
  expect(fake.editor.executeEdits).not.toHaveBeenCalled();
  propose('a\nB\nc\nd');
  layer.acceptHunk(9); layer.rejectHunk(9);
  layer.clearProposal('other');
  expect(bar()).not.toBeNull();
  expect(fake.editor.executeEdits).not.toHaveBeenCalled();
  layer.clearProposal('p1');
  expect(bar()).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('supersedes an open proposal and reports it with a note', () => {
  propose('a\nB\nc\nd');
  propose('a\nb\nC\nd', 'p2');
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ proposalId: 'p1', outcome: 'rejected', note: 'superseded by a newer proposal' }));
  expect(fake.parent.querySelectorAll('.sf-proposal-bar')).toHaveLength(1);
});

it('reports file switches, and re-diffs after foreign edits (but not its own)', () => {
  propose('a\nB\nc\nd');
  fake.setText('a\nB\nc\nd');
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'accepted', acceptedHunks: 0 }));
  post.mockClear();
  propose('a\nB\nc\nd2');
  layer.onFileSwitched();
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ note: 'file changed' }));
});

it('bounds the anchor to the line count and handles a deletion at the end of the file', () => {
  propose('a\nb\nc');
  expect(fake.del().set.mock.calls[0][0][0].range.startLineNumber).toBe(4);
  click(bar()!, 'Accept all');
  expect(fake.text()).toBe('a\nb\nc');
  propose('a\nb\nc\nd\ne', 'p2');
  click(bar()!, 'Accept all');
  expect(fake.text()).toBe('a\nb\nc\nd\ne');
});

it('renders comment glyphs, toggles inline bodies on gutter click and posts comment actions', () => {
  const comment = { id: 'c1', path: 'x', line: 2, endLine: 3, quote: 'q', body: 'fix this', author: { kind: 'user', name: 'Ann' }, createdAt: 1 } as any;
  layer.setComments([comment]);
  expect(fake.marks().set.mock.calls[0][0][0].options.glyphMarginClassName).toBe('sf-comment-glyph');
  expect(fake.zones.size).toBe(0);
  const gutter = (line: number | undefined) => fake.mouseListeners[0]!({ target: { type: 2, position: line ? { lineNumber: line } : undefined } });
  gutter(2);
  expect(post).toHaveBeenLastCalledWith({ type: 'commentAction', kind: 'open', line: 2, endLine: 3, quote: 'q' });
  expect(fake.zones.size).toBe(1);
  const zone = Array.from(fake.zones.values())[0];
  expect(zone.domNode.textContent).toContain('Ann - L2-3');
  expect(zone.domNode.textContent).toContain('fix this');
  gutter(2);
  expect(fake.zones.size).toBe(0);
  gutter(4);
  expect(post).toHaveBeenLastCalledWith({ type: 'commentAction', kind: 'add', line: 4, endLine: 4, quote: 'd' });
  gutter(undefined);
  fake.mouseListeners[0]!({ target: { type: 6, position: { lineNumber: 1 } } });
  expect(post).toHaveBeenCalledTimes(3);
  // single-line comment label and empty quote fallback
  layer.setComments([{ ...comment, line: 1, endLine: 1, quote: '' }]);
  gutter(1);
  expect(post).toHaveBeenLastCalledWith({ type: 'commentAction', kind: 'open', line: 1, endLine: 1, quote: 'a' });
  expect(Array.from(fake.zones.values())[0].domNode.textContent).toContain('Ann - L1fix');
  layer.setHits([3]);
  expect(fake.marks().set.mock.calls.at(-1)![0]).toHaveLength(2);
});

it('debounces cursor reports and shows a selection chip with actions', () => {
  vi.useFakeTimers();
  const selection = { isEmpty: () => false, text: 'sel', startLineNumber: 1, endLineNumber: 2, getEndPosition: () => ({ lineNumber: 2, column: 2 }) };
  fake.setSelection(selection, { lineNumber: 2, column: 2 });
  fake.cursorListeners[0]!(); fake.cursorListeners[0]!();
  vi.advanceTimersByTime(CURSOR_DEBOUNCE_MS);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith({ type: 'cursor', line: 2, column: 2, selection: { startLine: 1, endLine: 2, text: 'sel' } });
  const chip = Array.from(fake.widgets).find(w => w.getId() === 'sf.selection.chip');
  expect(chip.getPosition().position).toEqual({ lineNumber: 2, column: 2 });
  const node: HTMLElement = chip.getDomNode();
  const labels = Array.from(node.querySelectorAll('button')).map(b => b.textContent!);
  expect(labels.length).toBeGreaterThanOrEqual(2);
  node.querySelectorAll('button')[0]!.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
  for (const button of Array.from(node.querySelectorAll('button'))) button.click();
  const types = post.mock.calls.map((c: any[]) => c[0] as any);
  expect(types.some((t: any) => t.type === 'commentAction' && t.kind === 'add' && t.quote === 'sel')).toBe(true);
  expect(types.some((t: any) => t.type === 'askSelection')).toBe(true);
  expect(fake.widgets.size).toBe(0);
  // collapsed selection clears the chip; missing position is ignored
  fake.setSelection({ ...selection, isEmpty: () => true });
  fake.cursorListeners[0]!(); vi.advanceTimersByTime(CURSOR_DEBOUNCE_MS);
  expect(post).toHaveBeenLastCalledWith({ type: 'cursor', line: 2, column: 2 });
  fake.setSelection(selection);
  fake.cursorListeners[0]!(); vi.advanceTimersByTime(CURSOR_DEBOUNCE_MS);
  expect(fake.widgets.size).toBe(1);
  fake.cursorListeners[0]!(); vi.advanceTimersByTime(CURSOR_DEBOUNCE_MS);
  expect(fake.widgets.size).toBe(1);
  fake.setSelection(null, null);
  const before = post.mock.calls.length;
  fake.cursorListeners[0]!(); vi.advanceTimersByTime(CURSOR_DEBOUNCE_MS);
  expect(post.mock.calls.length).toBe(before);
});

it('dispose clears visuals, the chip and pending cursor reports', () => {
  vi.useFakeTimers();
  propose('a\nB\nc\nd');
  fake.setSelection({ isEmpty: () => false, text: 's', startLineNumber: 1, endLineNumber: 1, getEndPosition: () => ({ lineNumber: 1, column: 1 }) }, { lineNumber: 1, column: 1 });
  fake.cursorListeners[0]!(); vi.advanceTimersByTime(CURSOR_DEBOUNCE_MS);
  post.mockClear();
  fake.cursorListeners[0]!();
  layer.dispose();
  vi.advanceTimersByTime(CURSOR_DEBOUNCE_MS);
  expect(post).not.toHaveBeenCalled();
  expect(fake.widgets.size).toBe(0);
  expect(bar()).toBeNull();
  new StudioLayer(fake.monaco, fake.editor, post).dispose();
});
