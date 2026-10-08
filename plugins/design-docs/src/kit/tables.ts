/** Sortable and filterable tables, and rows that open the page they link to. */
import { html, type KitWindow } from './dom.js';
import { toNumber } from './util.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A section's own rows. (Read from `children`: not every DOM implements `section.rows`.) */
function rowsOf(section: HTMLTableSectionElement | null | undefined): HTMLTableRowElement[] {
  return [...(section?.children ?? [])].filter((node): node is HTMLTableRowElement => node.tagName === 'TR');
}

function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  return [...(rowsOf(table.tHead)[0]?.cells ?? [])];
}

function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return rowsOf(table.tBodies[0]).filter((row) => !row.classList.contains('kit-empty'));
}

/** What a cell sorts and filters by: its `data-sort` value, else its text. */
function cellValue(row: HTMLTableRowElement, column: number): string {
  const cell = row.cells[column];
  return (cell?.dataset.sort ?? cell?.textContent ?? '').trim();
}

/**
 * `table.sortable`: each header becomes a sort button (`data-sort="none"` opts a
 * column out). Columns of numbers sort as numbers; empty cells always go last.
 */
export function bindSortable(win: KitWindow, table: HTMLTableElement): void {
  const headers = headerCells(table);
  for (const header of headers) {
    if (header.dataset.sort === 'none') continue;
    const button = html(win.document, 'button', { type: 'button', class: 'sort' });
    button.append(...header.childNodes);
    header.append(button);
    button.addEventListener('click', () => {
      const ascending = header.getAttribute('aria-sort') !== 'ascending';
      sortTable(table, header.cellIndex, ascending);
      for (const other of headers) if (other !== header) other.removeAttribute('aria-sort');
      header.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
    });
  }
}

export function sortTable(table: HTMLTableElement, column: number, ascending: boolean): void {
  const body = table.tBodies[0];
  if (!body) return;
  const rows = bodyRows(table);
  const values = rows.map((row) => cellValue(row, column));
  const numeric = values.every((value) => value === '' || toNumber(value) !== null);
  const order = rows
    .map((row, index) => ({ row, value: values[index]!, index }))
    .sort((a, b) => {
      if (a.value === '' || b.value === '') return a.value === b.value ? a.index - b.index : a.value === '' ? 1 : -1;
      const compared = numeric ? toNumber(a.value)! - toNumber(b.value)! : collator.compare(a.value, b.value);
      return (ascending ? compared : -compared) || a.index - b.index;
    });
  for (const { row } of order) body.append(row);
  const empty = body.querySelector('tr.kit-empty');
  if (empty) body.append(empty);
}

interface Filter {
  column: number | null;
  exact: boolean;
  value: string;
}

const filters = new WeakMap<HTMLTableElement, Map<Element, Filter>>();

/** The column a filter control reads: `data-column` is a header's text or a 0-based index. */
function columnOf(table: HTMLTableElement, name: string | undefined): number | null {
  if (name === undefined || name === '') return null;
  const headers = headerCells(table);
  const byName = headers.findIndex((header) => header.textContent?.trim().toLowerCase() === name.trim().toLowerCase());
  if (byName >= 0) return byName;
  return /^\d+$/.test(name) ? Number(name) : null;
}

/**
 * `input[data-filter="#table"]` hides rows without every typed word;
 * `select[data-filter="#table"][data-column="Status"]` keeps rows whose
 * cell is the chosen option (an empty option shows all).
 */
export function bindFilter(win: KitWindow, control: HTMLInputElement | HTMLSelectElement): void {
  const doc = win.document;
  let table: Element | null = null;
  try {
    table = doc.querySelector(control.dataset.filter ?? '');
  } catch {
    // Not a selector.
  }
  if (!(table instanceof win.HTMLTableElement)) return;
  const target = table;
  const column = columnOf(target, control.dataset.column);
  const exact = control instanceof win.HTMLSelectElement;
  const update = () => {
    let active = filters.get(target);
    if (!active) filters.set(target, (active = new Map()));
    active.set(control, { column, exact, value: control.value.trim().toLowerCase() });
    applyFilters(win, target);
  };
  control.addEventListener(exact ? 'change' : 'input', update);
  if (control.value) update();
}

function matches(row: HTMLTableRowElement, filter: Filter): boolean {
  if (!filter.value) return true;
  const text = (filter.column === null ? (row.textContent ?? '') : cellValue(row, filter.column)).toLowerCase();
  if (filter.exact) return filter.column === null ? text.includes(filter.value) : text.trim() === filter.value;
  return filter.value.split(/\s+/).every((word) => text.includes(word));
}

function applyFilters(win: KitWindow, table: HTMLTableElement): void {
  const active = [...(filters.get(table)?.values() ?? [])];
  let shown = 0;
  const rows = bodyRows(table);
  for (const row of rows) {
    const visible = active.every((filter) => matches(row, filter));
    row.hidden = !visible;
    if (visible) shown += 1;
  }
  const body = table.tBodies[0];
  let empty = body?.querySelector<HTMLTableRowElement>('tr.kit-empty') ?? null;
  if (shown === 0 && rows.length && body) {
    if (!empty) {
      const columns = headerCells(table).length || rows[0]?.cells.length || 1;
      empty = html(win.document, 'tr', { class: 'kit-empty' }, [html(win.document, 'td', { colspan: columns, class: 'empty' }, ['No rows match.'])]);
      body.append(empty);
    }
    empty.hidden = false;
  } else if (empty) empty.hidden = true;
  table.dispatchEvent(new win.CustomEvent('kit:filter', { detail: { shown, total: rows.length } }));
}

/** A click anywhere on a `tr.clickable` follows the row's first link. */
export function bindClickableRows(table: HTMLTableElement): void {
  table.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('a, button, input, select, textarea, label, summary')) return;
    const row = target.closest('tr.clickable');
    if (!row || !table.contains(row)) return;
    // Selecting text is not a click on the row.
    const selection = table.ownerDocument.getSelection?.();
    if (selection && !selection.isCollapsed && selection.toString()) return;
    row.querySelector<HTMLAnchorElement>('a[href]')?.click();
  });
}
