import { describe, expect, it, vi } from 'vitest';
import type { KitWindow } from './dom.js';
import { createKit, KIT_VERSION } from './index.js';
import { page } from './test-window.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function serve(win: KitWindow, files: Record<string, { body: string; type?: string; status?: number }>) {
  const fetch = vi.fn(async (path: string) => {
    const file = files[path];
    if (!file) return new win.Response('missing', { status: 404 });
    return new win.Response(file.body, { status: file.status ?? 200, headers: file.type ? { 'content-type': file.type } : {} });
  });
  Object.defineProperty(win, 'fetch', { value: fetch, configurable: true });
  return fetch;
}

function quietErrors(win: KitWindow) {
  const report = vi.fn();
  Object.defineProperty(win, 'reportError', { value: report, configurable: true });
  return report;
}

const REPORT = `
  <header class="site-header"><nav><a href="#runs">Runs</a></nav><button data-kit-theme></button></header>
  <section id="runs">
    <div class="tab-list"><button data-tab="a">A</button><button data-tab="b">B</button></div>
    <div data-tab-panel="a"></div><div data-tab-panel="b"></div>
    <input data-filter="#t">
    <table id="t" class="sortable"><thead><tr><th>Name</th></tr></thead>
      <tbody><tr class="clickable"><td><a href="#x">b</a></td></tr><tr><td>a</td></tr></tbody></table>
    <button data-dialog="#d">Open</button><dialog id="d"></dialog>
    <figure class="chart" id="inline"><script type="application/json">{"type":"bar","labels":["A","B"],"series":[{"name":"S","values":[1,2]}]}</script></figure>
    <figure class="chart" id="file" data-chart="spec.json"></figure>
    <figure class="chart" id="broken"><script type="application/json">{"type":</script></figure>
    <figure class="chart" id="invalid"><script type="application/json">{"type":"pie"}</script></figure>
    <figure class="chart" id="unloaded" data-chart="nope.json"></figure>
    <figure class="chart" id="bad-data"><script type="application/json">{"type":"bar","data":"nope.csv","x":"a","y":"b"}</script></figure>
    <figure class="chart" id="plain"></figure>
    <span data-spark="1,2,,4" data-format="integer" aria-label="Runs"></span>
    <span data-spark="[0.1, null, 0.3]" id="json-spark"></span>
  </section>`;

describe('the kit', () => {
  it('wires a page from its markup alone, once however often it is asked', async () => {
    const win = page(REPORT);
    const doc = win.document;
    serve(win, { 'spec.json': { body: '{"type":"line","labels":["A","B"],"series":[{"name":"S","values":[1,2]}]}', type: 'application/json' } });
    const report = quietErrors(win);
    const kit = createKit(win);
    expect(kit.version).toBe(KIT_VERSION);
    kit.enhance();
    await flush();
    await flush();

    expect(doc.querySelector('.tab-list')!.getAttribute('role')).toBe('tablist');
    expect(doc.querySelectorAll('th button.sort')).toHaveLength(1);
    expect(doc.querySelector('[data-kit-theme]')!.getAttribute('aria-label')).toBe('Switch to dark theme');
    expect(doc.querySelector('nav a')!.classList.contains('active')).toBe(true);
    expect(doc.querySelectorAll('#inline path.chart-mark')).toHaveLength(2);
    expect(doc.querySelector('#file path.chart-line')).not.toBeNull();
    expect(doc.querySelector('#broken .callout.critical')!.textContent).toMatch(/the chart's JSON does not parse/);
    expect(doc.querySelector('#invalid .callout.critical')!.textContent).toMatch(/type must be/);
    expect(doc.querySelectorAll('#invalid .callout.critical')).toHaveLength(1);
    expect(doc.querySelector('#unloaded .callout.critical')!.textContent).toMatch(/nope\.json answered 404/);
    expect(doc.querySelector('#bad-data .callout.critical')!.textContent).toMatch(/nope\.csv answered 404/);
    expect(doc.querySelector('#plain')!.children).toHaveLength(0);
    expect(doc.querySelector('[data-spark] svg')!.getAttribute('aria-label')).toBe('Runs: 1 to 4');
    expect(doc.querySelector('#json-spark svg')!.getAttribute('aria-label')).toBe('Trend: 0.1 to 0.3');
    expect(report).toHaveBeenCalledTimes(4);

    const show = vi.spyOn(doc.querySelector<HTMLDialogElement>('#d')!, 'showModal');
    doc.querySelector<HTMLElement>('[data-dialog]')!.click();
    expect(show).toHaveBeenCalledTimes(1);
    const follow = vi.fn((event: Event) => event.preventDefault());
    doc.querySelector('a[href="#x"]')!.addEventListener('click', follow);
    doc.querySelector<HTMLElement>('tr.clickable')!.click();

    kit.enhance();
    kit.enhance(doc.querySelector('section')!);
    await flush();
    expect(doc.querySelectorAll('th button.sort')).toHaveLength(1);
    expect(doc.querySelectorAll('#inline svg')).toHaveLength(1);
    doc.querySelector<HTMLElement>('[data-dialog]')!.click();
    doc.querySelector<HTMLElement>('tr.clickable')!.click();
    expect(follow).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(4);
  });

  it('reports a bad spark and keeps wiring the rest', () => {
    const win = page('<span data-spark="[1,"></span><table class="sortable"><thead><tr><th>A</th></tr></thead></table>');
    const report = quietErrors(win);
    createKit(win).enhance();
    expect(report).toHaveBeenCalledWith(expect.any(SyntaxError));
    expect(win.document.querySelector('th button.sort')).not.toBeNull();
  });

  it('falls back to the console when the page cannot report errors', () => {
    const win = page('<span data-spark="[1,"></span>');
    Object.defineProperty(win, 'reportError', { value: undefined, configurable: true });
    const error = vi.spyOn(win.console, 'error').mockImplementation(() => {});
    createKit(win).enhance();
    expect(error).toHaveBeenCalled();
  });

  it('draws charts and sparklines on request, and formats and sorts', () => {
    const win = page('<div id="c"></div><span id="s"></span><table id="t"><tbody><tr><td>2</td></tr><tr><td>10</td></tr></tbody></table>');
    const kit = createKit(win);
    const chart = kit.chart('#c', { type: 'bar', labels: ['A'], series: [{ name: 'S', values: [1] }] });
    expect(chart.element.querySelector('svg')).not.toBeNull();
    expect(kit.sparkline('#s', [1, 2]).tagName.toLowerCase()).toBe('svg');
    expect(kit.format(0.5, 'percent')).toMatch(/50/);
    expect(kit.format(null)).toBe('–');
    const table = win.document.querySelector<HTMLTableElement>('#t')!;
    kit.sortTable(table, 0, false);
    expect(table.querySelector('td')!.textContent).toBe('10');
    kit.sortTable(table, 0);
    expect(table.querySelector('td')!.textContent).toBe('2');
  });
});

describe('Kit.load', () => {
  it('reads JSON and CSV, by extension or content type, and caches each file', async () => {
    const win = page('');
    const fetch = serve(win, {
      'data/runs.csv?v=2': { body: 'week,score\nW1,1\n' },
      'data/feed': { body: 'a\n1\n', type: 'text/csv; charset=utf-8' },
      'data/spec.json': { body: '{"ok":true}' }
    });
    const kit = createKit(win);
    expect(await kit.load('data/runs.csv?v=2')).toEqual([{ week: 'W1', score: 1 }]);
    expect(await kit.load('data/feed')).toEqual([{ a: 1 }]);
    expect(await kit.load('data/spec.json')).toEqual({ ok: true });
    expect(await kit.load('data/spec.json')).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('says what went wrong, and forgets a failed load so a retry fetches again', async () => {
    const win = page('');
    const files: Record<string, { body: string; status?: number }> = { 'bad.json': { body: '{oops' }, 'gone.json': { body: '', status: 500 } };
    const fetch = serve(win, files);
    const kit = createKit(win);
    await expect(kit.load('')).rejects.toThrow('Kit.load: give the path of a JSON or CSV file');
    await expect(kit.load(42 as unknown as string)).rejects.toThrow(/give the path/);
    await expect(kit.load('bad.json')).rejects.toThrow(/^Kit\.load: bad\.json is not valid JSON \(/);
    await expect(kit.load('gone.json')).rejects.toThrow('Kit.load: gone.json answered 500');
    files['gone.json'] = { body: '[1]' };
    await flush();
    expect(await kit.load('gone.json')).toEqual([1]);
    expect(fetch.mock.calls.filter(([path]) => path === 'gone.json')).toHaveLength(2);
  });

  it('keeps at most 50 files', async () => {
    const win = page('');
    const files: Record<string, { body: string }> = {};
    for (let index = 0; index <= 50; index += 1) files[`f${index}.json`] = { body: String(index) };
    const fetch = serve(win, files);
    const kit = createKit(win);
    for (let index = 0; index <= 50; index += 1) await kit.load(`f${index}.json`);
    await kit.load('f50.json');
    expect(fetch).toHaveBeenCalledTimes(51);
    await kit.load('f0.json');
    expect(fetch).toHaveBeenCalledTimes(52);
  });

  it('turns a non-Error JSON failure into text', async () => {
    const win = page('');
    serve(win, { 'x.json': { body: '1' } });
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'nope';
    });
    await expect(createKit(win).load('x.json')).rejects.toThrow('Kit.load: x.json is not valid JSON (nope)');
  });
});
