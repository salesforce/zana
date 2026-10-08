import { describe, expect, it, vi } from 'vitest';
import { bindClickableRows, bindFilter, bindSortable, sortTable } from './tables.js';
import { page } from './test-window.js';

const RUNS = `
  <input id="search" data-filter="#runs">
  <select id="agent" data-filter="#runs" data-column="Agent">
    <option value="">All</option><option>Claude</option><option>Codex</option>
  </select>
  <table id="runs" class="sortable">
    <thead><tr><th>Task</th><th>Agent</th><th>Score</th><th data-sort="none">Notes</th></tr></thead>
    <tbody>
      <tr><td>fix-auth-race</td><td>Claude</td><td>82%</td><td>flaky</td></tr>
      <tr><td>refactor-store</td><td>Claude</td><td>1,204</td><td></td></tr>
      <tr><td>add-cache</td><td>Codex</td><td></td><td>timed out</td></tr>
      <tr><td>Task 10</td><td>Codex</td><td>−3</td><td></td></tr>
      <tr><td>task 9</td><td>Claude</td><td data-sort="5">five</td><td></td></tr>
    </tbody>
  </table>`;

const column = (table: HTMLTableElement, index: number) =>
  [...table.tBodies[0]!.querySelectorAll<HTMLTableRowElement>(':scope > tr')].filter((row) => !row.hidden).map((row) => (row.cells[index]?.textContent ?? '').trim());

describe('sortable tables', () => {
  it('sorts numbers as numbers, empty cells last, and flips on a second click', () => {
    const win = page(RUNS);
    const table = win.document.querySelector<HTMLTableElement>('#runs')!;
    bindSortable(win, table);
    const headers = [...table.tHead!.querySelectorAll('th')];
    expect(headers.map((header) => header.querySelector('button.sort')?.textContent ?? null)).toEqual(['Task', 'Agent', 'Score', null]);

    headers[2]!.querySelector('button')!.click();
    expect(headers[2]!.getAttribute('aria-sort')).toBe('ascending');
    expect(column(table, 0)).toEqual(['Task 10', 'task 9', 'fix-auth-race', 'refactor-store', 'add-cache']);

    headers[2]!.querySelector('button')!.click();
    expect(headers[2]!.getAttribute('aria-sort')).toBe('descending');
    expect(column(table, 0)).toEqual(['refactor-store', 'fix-auth-race', 'task 9', 'Task 10', 'add-cache']);

    headers[0]!.querySelector('button')!.click();
    expect(headers[2]!.hasAttribute('aria-sort')).toBe(false);
    expect(column(table, 0)).toEqual(['add-cache', 'fix-auth-race', 'refactor-store', 'task 9', 'Task 10']);
  });

  it('keeps ties in their order and the empty-state row at the end', () => {
    const win = page(RUNS);
    const table = win.document.querySelector<HTMLTableElement>('#runs')!;
    const empty = win.document.createElement('tr');
    empty.className = 'kit-empty';
    table.tBodies[0]!.prepend(empty);
    sortTable(table, 1, true);
    expect(column(table, 0).slice(0, 3)).toEqual(['fix-auth-race', 'refactor-store', 'task 9']);
    expect(table.tBodies[0]!.lastElementChild).toBe(empty);
    sortTable(table, 3, false);
    expect(column(table, 3).slice(-3)).toEqual(['', '', '']);
    expect(table.tBodies[0]!.lastElementChild).toBe(empty);
  });

  it('leaves a table without a body alone', () => {
    const win = page('<table><thead><tr><th>A</th></tr></thead></table>');
    const table = win.document.querySelector('table')!;
    expect(() => sortTable(table, 0, true)).not.toThrow();
    bindSortable(win, page('<table></table>').document.querySelector('table')!);
  });
});

describe('table filters', () => {
  it('combines a search box and a column select, with an empty state', () => {
    const win = page(RUNS);
    const doc = win.document;
    const table = doc.querySelector<HTMLTableElement>('#runs')!;
    const search = doc.querySelector<HTMLInputElement>('#search')!;
    const agent = doc.querySelector<HTMLSelectElement>('#agent')!;
    const seen: Array<{ shown: number; total: number }> = [];
    table.addEventListener('kit:filter', (event) => seen.push((event as CustomEvent).detail));
    bindFilter(win, search);
    bindFilter(win, agent);

    agent.value = 'Claude';
    agent.dispatchEvent(new win.Event('change'));
    expect(column(table, 0)).toEqual(['fix-auth-race', 'refactor-store', 'task 9']);

    search.value = 'RE  fa';
    search.dispatchEvent(new win.Event('input'));
    expect(column(table, 0)).toEqual(['refactor-store']);

    search.value = 'codex';
    search.dispatchEvent(new win.Event('input'));
    expect(column(table, 0)).toEqual(['No rows match.']);
    const empty = table.querySelector<HTMLTableRowElement>('tr.kit-empty')!;
    expect(empty.cells[0]!.colSpan).toBe(4);
    expect(seen.at(-1)).toEqual({ shown: 0, total: 5 });

    agent.value = '';
    agent.dispatchEvent(new win.Event('change'));
    expect(empty.hidden).toBe(true);
    expect(column(table, 0)).toEqual(['add-cache', 'Task 10']);

    search.value = 'nothing';
    search.dispatchEvent(new win.Event('input'));
    expect(table.querySelectorAll('tr.kit-empty')).toHaveLength(1);
    expect(empty.hidden).toBe(false);
  });

  it('reads a column by index, applies a preset value, and matches a select anywhere without a column', () => {
    const win = page(`${RUNS}
      <select id="any" data-filter="#runs"><option value="">All</option><option selected>timed</option></select>
      <input id="third" data-filter="#runs" data-column="2" value="82">`);
    const table = win.document.querySelector<HTMLTableElement>('#runs')!;
    bindFilter(win, win.document.querySelector<HTMLSelectElement>('#any')!);
    expect(column(table, 0)).toEqual(['add-cache']);
    const third = win.document.querySelector<HTMLInputElement>('#third')!;
    third.value = '';
    bindFilter(win, third);
    third.value = '5';
    third.dispatchEvent(new win.Event('input'));
    expect(column(table, 0)).toEqual(['No rows match.']);
    const any = win.document.querySelector<HTMLSelectElement>('#any')!;
    any.value = '';
    any.dispatchEvent(new win.Event('change'));
    expect(column(table, 0)).toEqual(['task 9']);
  });

  it('ignores controls that name no table or an unknown column', () => {
    const win = page(`${RUNS}
      <input id="bad" data-filter="#[">
      <input id="missing" data-filter="#nope">
      <input id="unknown" data-filter="#runs" data-column="Owner">`);
    const doc = win.document;
    bindFilter(win, doc.querySelector<HTMLInputElement>('#bad')!);
    bindFilter(win, doc.querySelector<HTMLInputElement>('#missing')!);
    const unknown = doc.querySelector<HTMLInputElement>('#unknown')!;
    bindFilter(win, unknown);
    unknown.value = 'codex';
    unknown.dispatchEvent(new win.Event('input'));
    expect(column(doc.querySelector<HTMLTableElement>('#runs')!, 0)).toEqual(['add-cache', 'Task 10']);
  });

  it('sizes the empty row from the body when the table has no header', () => {
    const win = page('<input data-filter="#t"><table id="t"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
    const input = win.document.querySelector('input')!;
    bindFilter(win, input);
    input.value = 'zzz';
    input.dispatchEvent(new win.Event('input'));
    expect(win.document.querySelector<HTMLTableCellElement>('tr.kit-empty td')!.colSpan).toBe(2);
  });
});

describe('clickable rows', () => {
  it('follows the row link unless the click was on a control or selected text', () => {
    const win = page(`<table><tbody>
      <tr class="clickable"><td>Run 1</td><td><a href="#run-1">Open</a></td><td><button>Copy</button></td></tr>
      <tr><td>Plain</td></tr>
    </tbody></table>`);
    const doc = win.document;
    const table = doc.querySelector('table')!;
    bindClickableRows(table);
    const link = doc.querySelector('a')!;
    const follow = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', follow);

    doc.querySelector<HTMLElement>('tr.clickable td')!.click();
    expect(follow).toHaveBeenCalledTimes(1);
    doc.querySelector('button')!.click();
    link.click();
    expect(follow).toHaveBeenCalledTimes(2);
    doc.querySelector<HTMLElement>('tr:not(.clickable) td')!.click();
    expect(follow).toHaveBeenCalledTimes(2);

    vi.spyOn(doc, 'getSelection').mockReturnValue({ isCollapsed: false, toString: () => 'Run' } as Selection);
    doc.querySelector<HTMLElement>('tr.clickable td')!.click();
    expect(follow).toHaveBeenCalledTimes(2);
  });
});
