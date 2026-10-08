/**
 * The site kit's script, as `window.Kit`. It reads the page's markup: with no
 * script of its own a page still gets its theme toggle, tabs, sortable tables
 * and the charts it declares in `<figure class="chart">` blocks.
 */
import type { ChartSpec } from './chart-spec.js';
import { createChart, drawSparkline, type ChartHandle, type SparklineOptions } from './charts.js';
import { once, reportError, type KitWindow } from './dom.js';
import { bindClickableRows, bindFilter, bindSortable, sortTable } from './tables.js';
import { createTheme, type ThemeControl } from './theme.js';
import { formatNumber, parseCsv, type NumberFormat } from './util.js';
import { bindDialog, bindDialogTrigger, bindScrollSpy, bindTabs } from './widgets.js';

export const KIT_VERSION = '1';
const MAX_CACHED_FILES = 50;

export interface Kit {
  readonly version: string;
  readonly theme: ThemeControl;
  chart(target: Element | string, spec: ChartSpec): ChartHandle;
  sparkline(target: Element | string, values: ReadonlyArray<number | null>, options?: SparklineOptions): SVGElement;
  /** A JSON file's value, or a CSV file's rows. Paths are relative to the page. */
  load(path: string): Promise<unknown>;
  format(value: number | null | undefined, format?: NumberFormat): string;
  sortTable(table: HTMLTableElement, column: number, ascending?: boolean): void;
  /** Wire kit markup under `root`; safe to call again after adding content. */
  enhance(root?: ParentNode): void;
}

function isCsv(path: string, type: string | null): boolean {
  return /\.csv$/i.test(path.split(/[?#]/)[0] ?? '') || /text\/csv/i.test(type ?? '');
}

export function createKit(win: KitWindow): Kit {
  const doc = win.document;
  const theme = createTheme(win);
  const seen = new WeakSet<Element>();
  // Its own set: a table can be both sortable and have clickable rows.
  const clickable = new WeakSet<Element>();
  const files = new Map<string, Promise<{ text: string; type: string | null }>>();
  let spying = false;

  const fetchText = (path: string) => {
    let pending = files.get(path);
    if (!pending) {
      pending = win.fetch(path).then(async (response) => {
        if (!response.ok) throw new Error(`Kit.load: ${path} answered ${response.status}`);
        return { text: await response.text(), type: response.headers.get('content-type') };
      });
      // A failed load is not remembered, so fixing the file and calling again works.
      pending.catch(() => files.delete(path));
      if (files.size >= MAX_CACHED_FILES) files.delete(files.keys().next().value!);
      files.set(path, pending);
    }
    return pending;
  };

  const load = async (path: string): Promise<unknown> => {
    if (typeof path !== 'string' || !path) throw new Error('Kit.load: give the path of a JSON or CSV file');
    const { text, type } = await fetchText(path);
    if (isCsv(path, type)) return parseCsv(text);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Kit.load: ${path} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  };

  const chart = (target: Element | string, spec: ChartSpec) => createChart(win, target, spec, load);

  /** A `<figure class="chart">` declares its spec in a JSON script, or names a spec file in `data-chart`. */
  const declared = (figure: HTMLElement) => {
    const script = figure.querySelector<HTMLScriptElement>(':scope > script[type="application/json"]');
    const file = figure.dataset.chart;
    if (!script && !file) return;
    const fail = (error: unknown) => {
      if (!figure.querySelector(':scope > .callout.critical')) {
        const note = doc.createElement('p');
        note.className = 'callout critical';
        note.setAttribute('data-kit-part', '');
        note.textContent = `This chart could not be drawn. ${error instanceof Error ? error.message : String(error)}`;
        figure.append(note);
      }
      reportError(win, error);
    };
    const draw = (spec: unknown) => {
      try {
        chart(figure, spec as ChartSpec).ready.catch(fail);
      } catch (error) {
        fail(error);
      }
    };
    if (file) load(file).then(draw, fail);
    else {
      let spec: unknown;
      try {
        spec = JSON.parse(script!.textContent ?? '');
      } catch (error) {
        fail(new Error(`Kit.chart: the chart's JSON does not parse (${error instanceof Error ? error.message : String(error)})`));
        return;
      }
      draw(spec);
    }
  };

  const enhance = (root: ParentNode = doc) => {
    theme.bind(root);
    if (!spying && root === doc) {
      spying = true;
      bindScrollSpy(win, doc);
    }
    const each = <T extends Element>(selector: string, bind: (node: T) => void) => {
      for (const node of root.querySelectorAll<T>(selector)) {
        once(seen, node, () => {
          try {
            bind(node);
          } catch (error) {
            reportError(win, error);
          }
        });
      }
    };
    each<HTMLElement>('.tab-list', (list) => bindTabs(win, list));
    each<HTMLTableElement>('table.sortable', (table) => bindSortable(win, table));
    each<HTMLInputElement | HTMLSelectElement>('input[data-filter], select[data-filter]', (control) => bindFilter(win, control));
    for (const row of root.querySelectorAll('tr.clickable')) {
      const table = row.closest('table');
      if (table) once(clickable, table, () => bindClickableRows(table));
    }
    each<HTMLElement>('[data-dialog]', (trigger) => bindDialogTrigger(win, trigger));
    each<HTMLDialogElement>('dialog', (dialog) => bindDialog(dialog));
    each<HTMLElement>('figure.chart, [data-chart]', declared);
    each<HTMLElement>('[data-spark]', (host) => {
      const raw = host.dataset.spark ?? '';
      const values = raw.trim().startsWith('[') ? (JSON.parse(raw) as unknown[]) : raw.split(',');
      const format = host.dataset.format as NumberFormat | undefined;
      drawSparkline(win, host, values.map((value) => (value === null || String(value).trim() === '' ? null : Number(value))), {
        ...(format ? { format } : {}),
        ...(host.getAttribute('aria-label') ? { label: host.getAttribute('aria-label')! } : {})
      });
    });
  };

  return {
    version: KIT_VERSION,
    theme,
    chart,
    sparkline: (target, values, options) => drawSparkline(win, target, values, options),
    load,
    format: (value, format) => formatNumber(value, format),
    sortTable: (table, column, ascending = true) => sortTable(table, column, ascending),
    enhance
  };
}
