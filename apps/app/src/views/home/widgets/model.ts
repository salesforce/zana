export const HOME_WIDGETS_KEY = 'zcc.basicHome.widgets.v1';
export const MAX_WIDGETS = 24;
export const MAX_GRID_ROW = MAX_WIDGETS * 7;
const MAX_STORAGE_LENGTH = 640_000;

export type Columns = 2 | 4 | 6;
export type Display = 'list' | 'count' | 'chart' | 'text' | 'checklist';
export type Source = 'personal' | 'inbox' | 'threads' | `plugin:${string}:${string}`;
export type Cell = { column: number; row: number };
export type Placement = Cell & { width: number; height: number };
export type WidgetDraft = { title: string; source: Source; display: Display; content: string };
export type HomeWidget = WidgetDraft & {
  id: string;
  width: number;
  height: number;
  cells: Partial<Record<Columns, Cell>>;
};

export const displays = {
  list: 'List',
  count: 'Count',
  chart: 'Chart',
  text: 'Text',
  checklist: 'Checklist'
} satisfies Record<Display, string>;

export const emptyDraft: WidgetDraft = { title: '', source: 'personal', display: 'text', content: '' };
export const bound = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const gridColumns = (width: number): Columns => width >= 640 ? 6 : width >= 420 ? 4 : 2;

export const builtInWidgets = [
  { title: 'Needs my attention', source: 'inbox', display: 'list', content: '' },
  { title: 'Resume work', source: 'threads', display: 'list', content: '' },
  { title: 'Quick note', source: 'personal', display: 'text', content: '' },
  { title: 'Checklist', source: 'personal', display: 'checklist', content: '' },
  { title: 'Chart', source: 'personal', display: 'chart', content: '' }
] satisfies WidgetDraft[];

export function draftFromDescription(input: string, sources: readonly WidgetDraft[]): WidgetDraft {
  const summary = input.trim();
  const lower = summary.toLowerCase();
  const explicit = sources.find(source => source.source !== 'personal' && lower.includes(source.title.toLowerCase()));
  const inferred = explicit ?? builtInWidgets.find(source =>
    source.source === 'inbox' && /\binbox\b|\bapprovals?\b/.test(lower) ||
    source.source === 'threads' && /\bthreads?\b|\bconversations?\b/.test(lower)
  );
  const display = /\b(count|how many|number of)\b/.test(lower) ? 'count'
    : /\b(chart|graph)\b/.test(lower) ? 'chart'
    : /\bchecklist\b/.test(lower) ? 'checklist'
    : /\blist\b/.test(lower) ? 'list'
    : inferred?.display ?? 'text';
  const colon = summary.indexOf(':');
  const lead = (colon < 0 ? summary : summary.slice(0, colon)).replace(/[.!?]+$/, '');
  const named = lead.match(/\b(?:called|titled)\s+(.+?)(?:\s+with)?$/i)?.[1];
  const content = colon < 0 ? '' : summary.slice(colon + 1).trim();
  return {
    source: inferred?.source ?? 'personal',
    title: (named || inferred?.title || lead).slice(0, 80),
    display: inferred && (display === 'chart' || display === 'checklist' || display === 'text') ? 'list' : display,
    content: inferred ? '' : display === 'checklist' ? content.replace(/,\s*/g, '\n') : content
  };
}

export function newWidget(id: string, draft: WidgetDraft): HomeWidget {
  return { ...draft, id, width: draft.display === 'chart' ? 4 : 3, height: 3, cells: {} };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input));
}

function validSource(input: unknown): input is Source {
  return input === 'personal' || input === 'inbox' || input === 'threads' ||
    typeof input === 'string' && /^plugin:[^:]{1,160}:[^:]{1,160}$/.test(input);
}

export function readWidgets(raw: string | null): HomeWidget[] {
  if (!raw || raw.length > MAX_STORAGE_LENGTH) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const widgets: HomeWidget[] = [];
    const ids = new Set<string>();
    for (const entry of list.slice(0, MAX_WIDGETS)) {
      if (!isRecord(entry)) continue;
      const { id, title, source, display, content, width, height, cells } = entry;
      if (typeof id !== 'string' || id.length > 80 || ids.has(id) ||
        typeof title !== 'string' || !title.trim() || !validSource(source) ||
        typeof display !== 'string' || !Object.hasOwn(displays, display) || typeof content !== 'string') continue;
      const restored: HomeWidget = {
        id, title: title.slice(0, 80), source, display: display as Display, content: content.slice(0, 4000),
        width: Number.isInteger(width) ? bound(width as number, 2, 6) : 3,
        height: Number.isInteger(height) ? bound(height as number, 2, 7) : 3,
        cells: {}
      };
      if (isRecord(cells)) {
        for (const columns of [2, 4, 6] as const) {
          const cell = cells[columns];
          if (isRecord(cell) && Number.isInteger(cell.column) && Number.isInteger(cell.row)) {
            restored.cells[columns] = {
              column: bound(cell.column as number, 0, columns - 1),
              row: bound(cell.row as number, 0, MAX_GRID_ROW)
            };
          }
        }
      }
      widgets.push(restored);
      ids.add(id);
    }
    return widgets;
  } catch {
    return [];
  }
}

export type WidgetLayout = Map<string, Placement>;
type Priority = Placement & { id: string };

export function placeWidgets(
  widgets: readonly HomeWidget[],
  columns: Columns,
  priority?: Priority,
  baseline?: WidgetLayout
): WidgetLayout {
  const layout: WidgetLayout = new Map();
  const sizeOf = (widget: HomeWidget) => ({ width: Math.min(widget.width, columns), height: widget.height });
  const fits = (box: Placement) => [...layout.values()].every(other =>
    box.column + box.width <= other.column || other.column + other.width <= box.column ||
    box.row + box.height <= other.row || other.row + other.height <= box.row
  );
  const clampPosition = (cell: Cell, size: Pick<Placement, 'width' | 'height'>): Placement => ({
    width: size.width,
    height: size.height,
    column: bound(cell.column, 0, columns - size.width),
    row: bound(cell.row, 0, MAX_GRID_ROW)
  });
  if (priority) layout.set(priority.id, clampPosition(priority, priority));

  for (const widget of widgets) {
    if (layout.has(widget.id)) continue;
    const saved = baseline?.get(widget.id) ?? widget.cells[columns];
    if (!saved) continue;
    const box = clampPosition(saved, sizeOf(widget));
    if (fits(box)) layout.set(widget.id, box);
  }
  for (const widget of widgets) {
    if (layout.has(widget.id)) continue;
    const size = sizeOf(widget);
    let box = { ...size, column: 0, row: 0 };
    while (!fits(box)) {
      box = box.column + size.width < columns
        ? { ...box, column: box.column + 1 }
        : { ...box, column: 0, row: box.row + 1 };
    }
    layout.set(widget.id, box);
  }
  return layout;
}

export function layoutBottom(layout: WidgetLayout): number {
  return Math.max(0, ...Array.from(layout.values(), box => box.row + box.height));
}

export function saveLayout(widgets: readonly HomeWidget[], columns: Columns, layout: WidgetLayout): HomeWidget[] {
  const position = (widget: HomeWidget) => layout.get(widget.id)!;
  const updated = widgets.map(widget => {
    const {column, row} = position(widget);
    return { ...widget, cells: { ...widget.cells, [columns]: { column, row } } };
  });
  if (columns === 6) updated.sort((a, b) => position(a).row - position(b).row || position(a).column - position(b).column);
  return updated;
}

export function chartValues(content: string): { name: string; value: number }[] {
  return content.split('\n').flatMap(line => {
    const divider = line.lastIndexOf(':');
    const name = line.slice(0, divider).trim();
    const number = line.slice(divider + 1).trim();
    const value = Number(number);
    return divider > 0 && name && number && value >= 0 && Number.isFinite(value) ? [{ name, value }] : [];
  }).slice(0, 20);
}
