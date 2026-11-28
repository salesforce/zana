import { describe, expect, it } from 'vitest';
import { builtInWidgets, chartValues, draftFromDescription, gridColumns, layoutBottom, MAX_WIDGETS, newWidget, placeWidgets, readWidgets, saveLayout, type WidgetDraft } from './model.js';

const plugin: WidgetDraft = { title: 'Workday absences', source: 'plugin:people:absences', display: 'list', content: '' };
const catalogue = [...builtInWidgets, plugin];
const notes = builtInWidgets[2];
const cards = [newWidget('one', notes), newWidget('two', notes), newWidget('three', notes)];

describe('widget authoring', () => {
  it('builds an editable personal checklist from a title and items', () => {
    expect(draftFromDescription('Make a checklist called Launch with: Review, Publish', catalogue)).toEqual({
      title: 'Launch', source: 'personal', display: 'checklist', content: 'Review\nPublish'
    });
  });

  it('resolves live sources by their registered names and built-in keywords', () => {
    expect(draftFromDescription('Show Workday absences as a chart', catalogue)).toMatchObject({
      source: plugin.source, title: plugin.title, display: 'list'
    });
    expect(draftFromDescription('Count my Inbox approvals', catalogue)).toMatchObject({ source: 'inbox', display: 'count' });
    expect(draftFromDescription('Show threads', catalogue)).toMatchObject({ source: 'threads', display: 'list' });
  });

  it('supports other personal formats and rejects invalid chart data', () => {
    expect(draftFromDescription('Chart titled Pipeline: New: 20\nStarted: 14', catalogue)).toMatchObject({
      title: 'Pipeline', source: 'personal', display: 'chart'
    });
    expect(draftFromDescription('List cities: Bern', catalogue).display).toBe('list');
    expect(draftFromDescription('Remember to send the notes.', catalogue)).toMatchObject({ title: 'Remember to send the notes', display: 'text' });
    expect(chartValues('Proposal: 12\nWon: 0\nInvalid\nBad: -2\nBad: Infinity\nBad: \n: 3')).toEqual([
      { name: 'Proposal', value: 12 }, { name: 'Won', value: 0 }
    ]);
    expect(chartValues(Array(30).fill('Valid: 2').join('\n'))).toHaveLength(20);
  });
});

describe('widget storage', () => {
  it('accepts valid widgets and sanitizes dimensions and preferences', () => {
    const payload = [{ ...cards[0], width: 900, height: -1, cells: { 6: { column: 20, row: 99999 }, 4: { column: 0, row: 'bad' } } },
      { ...cards[1], width: 'wide', height: null }, { ...newWidget('people', plugin), content: 'a'.repeat(4100) }];
    const result = readWidgets(JSON.stringify(payload));
    expect(result[0]).toMatchObject({ width: 6, height: 2, cells: { 6: { column: 5, row: 168 } } });
    expect(result[0].cells[4]).toBeUndefined();
    expect(result[1]).toMatchObject({ width: 3, height: 3 });
    expect(result[2].content).toHaveLength(4000);
  });

  it('drops invalid and duplicate records and bounds the amount of saved data', () => {
    expect(readWidgets(null)).toEqual([]);
    expect(readWidgets('{')).toEqual([]);
    expect(readWidgets('{}')).toEqual([]);
    expect(readWidgets('a'.repeat(640001))).toEqual([]);
    expect(readWidgets(JSON.stringify([null, [], cards[0], cards[0], { ...cards[1], source: 'bad' },
      { ...cards[2], display: '__proto__' }, { ...cards[2], title: ' ' }]))).toEqual([cards[0]]);
    expect(readWidgets(JSON.stringify(Array.from({length: MAX_WIDGETS + 2}, (_, index) => ({
      ...cards[0], id: String(index)
    }))))).toHaveLength(MAX_WIDGETS);
  });
});

describe('grid layout', () => {
  it('keeps an empty-space target and unaffected cells', () => {
    const baseline = placeWidgets(cards, 6);
    const before = baseline.get('three');
    const layout = placeWidgets(cards, 6, { id: 'two', column: 2, row: 6, width: 3, height: 3 }, baseline);
    expect(layout.get('two')).toMatchObject({ column: 2, row: 6 });
    expect(layout.get('three')).toEqual(before);
    expect(layoutBottom(layout)).toBe(9);
    expect(layoutBottom(new Map())).toBe(0);
    const saved = saveLayout(cards, 6, layout);
    expect(saved.map(widget => widget.id)).toEqual(['one', 'three', 'two']);
    expect(placeWidgets(saved, 6).get('two')).toEqual(layout.get('two'));
  });

  it('displaces overlaps, clamps off-grid placement and packs narrower columns independently', () => {
    const layout = placeWidgets(cards, 6, { id: 'two', column: -3, row: -2, width: 3, height: 3 }, placeWidgets(cards, 6));
    expect(layout.get('two')).toMatchObject({ column: 0, row: 0 });
    expect(layout.get('one')).toMatchObject({ column: 3, row: 0 });
    expect(layout.get('three')).toMatchObject({ column: 0, row: 3 });
    const saved = saveLayout(cards, 6, layout);
    const narrow = placeWidgets(saved, 2);
    expect([...narrow.values()].map(box => [box.column, box.row, box.width])).toEqual([[0, 0, 2], [0, 3, 2], [0, 6, 2]]);
    expect(placeWidgets(saveLayout(saved, 2, narrow), 6)).toEqual(placeWidgets(saved, 6));
    expect([gridColumns(641), gridColumns(510), gridColumns(330)]).toEqual([6, 4, 2]);
  });
});
