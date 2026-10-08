import { describe, expect, it, vi } from 'vitest';
import { bindDialog, bindDialogTrigger, bindScrollSpy, bindTabs } from './widgets.js';
import { page, rect } from './test-window.js';

const SITE = `
  <header class="site-header"><nav>
    <a href="#overview">Overview</a><a href="#runs">Runs</a><a href="#method">Method</a><a href="#gone">Gone</a><a href="/elsewhere">Away</a>
  </nav></header>
  <section id="overview"></section><section id="runs"></section><section id="method"></section>`;

describe('scroll spy', () => {
  it('marks the section under the header, and the last one at the bottom', () => {
    const win = page(SITE);
    const doc = win.document;
    rect(doc.querySelector('.site-header')!, { bottom: 56 });
    const tops: Record<string, number> = { overview: 0, runs: 400, method: 900 };
    for (const id of Object.keys(tops)) vi.spyOn(doc.getElementById(id)!, 'getBoundingClientRect').mockImplementation(() => ({ top: tops[id]! }) as DOMRect);
    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(win, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    const cancel = vi.spyOn(win, 'cancelAnimationFrame');

    const stop = bindScrollSpy(win, doc);
    const active = () => [...doc.querySelectorAll('nav a.active')].map((link) => link.textContent);
    expect(active()).toEqual(['Overview']);
    expect(doc.querySelector('nav a.active')!.getAttribute('aria-current')).toBe('location');

    tops.overview = -800;
    tops.runs = 60;
    tops.method = 500;
    win.dispatchEvent(new win.Event('scroll'));
    win.dispatchEvent(new win.Event('scroll'));
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    expect(active()).toEqual(['Runs']);
    expect(doc.querySelector('a[href="#overview"]')!.hasAttribute('aria-current')).toBe(false);

    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 700, configurable: true });
    win.dispatchEvent(new win.Event('resize'));
    frames.shift()!(0);
    expect(active()).toEqual(['Method']);

    win.dispatchEvent(new win.Event('scroll'));
    stop();
    expect(cancel).toHaveBeenCalled();
    win.dispatchEvent(new win.Event('scroll'));
    expect(frames).toHaveLength(1);
  });

  it('counts a section a nav jump left at its scroll margin as reached', () => {
    const win = page(SITE);
    const doc = win.document;
    rect(doc.querySelector('.site-header')!, { bottom: 54.6 });
    // A jump to #runs stops at its scroll-margin-top, below the header plus slack.
    doc.getElementById('runs')!.style.scrollMarginTop = '72px';
    const tops: Record<string, number> = { overview: -500, runs: 72, method: 600 };
    for (const id of Object.keys(tops)) vi.spyOn(doc.getElementById(id)!, 'getBoundingClientRect').mockImplementation(() => ({ top: tops[id]! }) as DOMRect);
    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 5000, configurable: true });

    bindScrollSpy(win, doc);
    expect([...doc.querySelectorAll('nav a.active')].map((link) => link.textContent)).toEqual(['Runs']);
  });

  it('does nothing without in-page links', () => {
    const win = page('<header class="site-header"><nav><a href="/a">A</a></nav></header>');
    const stop = bindScrollSpy(win, win.document);
    expect(() => stop()).not.toThrow();
  });

  it('works without a header and stops cleanly when no frame is pending', () => {
    const win = page('<nav class="site-header"><nav><a href="#a">A</a></nav></nav><section id="a"></section>');
    win.document.querySelector('.site-header')!.className = '';
    const stop = bindScrollSpy(win, win.document);
    stop();
  });
});

const TABS = `
  <div class="tabs">
    <div class="tab-list"><button data-tab="chart">Chart</button><button data-tab="table" id="own-id">Table</button><button data-tab="notes">Notes</button></div>
    <div data-tab-panel="chart"></div><div data-tab-panel="table" id="table-panel"></div>
  </div>`;

describe('tabs', () => {
  it('wires roles, shows one panel, and moves with the keyboard', () => {
    const win = page(TABS);
    const doc = win.document;
    const list = doc.querySelector<HTMLElement>('.tab-list')!;
    const shown: string[] = [];
    list.addEventListener('kit:tab', (event) => shown.push((event as CustomEvent).detail.tab));
    bindTabs(win, list);
    const [chart, table, notes] = [...list.querySelectorAll<HTMLButtonElement>('button')];
    const panels = [...doc.querySelectorAll<HTMLElement>('[data-tab-panel]')];

    expect(list.getAttribute('role')).toBe('tablist');
    expect(chart!.getAttribute('role')).toBe('tab');
    expect(table!.id).toBe('own-id');
    expect(table!.getAttribute('aria-controls')).toBe('table-panel');
    expect(panels[1]!.getAttribute('aria-labelledby')).toBe('own-id');
    expect(panels[0]!.getAttribute('role')).toBe('tabpanel');
    expect(notes!.hasAttribute('aria-controls')).toBe(false);
    expect(chart!.getAttribute('aria-selected')).toBe('true');
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true]);

    table!.click();
    expect(panels.map((panel) => panel.hidden)).toEqual([true, false]);
    expect([chart!.tabIndex, table!.tabIndex]).toEqual([-1, 0]);

    const key = (target: HTMLElement, name: string) => {
      const event = new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(key(table!, 'ArrowRight')).toBe(true);
    expect(doc.activeElement).toBe(notes);
    key(notes!, 'ArrowDown');
    expect(doc.activeElement).toBe(chart);
    key(chart!, 'ArrowLeft');
    expect(doc.activeElement).toBe(notes);
    key(notes!, 'ArrowUp');
    key(table!, 'Home');
    expect(doc.activeElement).toBe(chart);
    key(chart!, 'End');
    expect(doc.activeElement).toBe(notes);
    expect(key(notes!, 'a')).toBe(false);
    expect(key(list, 'ArrowRight')).toBe(false);
    expect(shown).toEqual(['chart', 'table', 'notes', 'chart', 'notes', 'table', 'chart', 'notes']);
  });

  it('opens the tab the page marked, else the one the URL names', () => {
    const marked = page(TABS.replace('data-tab="notes"', 'data-tab="notes" aria-selected="true"'));
    bindTabs(marked, marked.document.querySelector<HTMLElement>('.tab-list')!);
    expect(marked.document.querySelector('[data-tab="notes"]')!.getAttribute('aria-selected')).toBe('true');

    const byName = page(TABS, 'https://pages.example/report/#table');
    bindTabs(byName, byName.document.querySelector<HTMLElement>('.tab-list')!);
    expect(byName.document.querySelector('[data-tab="table"]')!.getAttribute('aria-selected')).toBe('true');

    const byPanel = page(TABS.replace('id="table-panel"', 'id="raw"').replace('data-tab-panel="chart"', 'data-tab-panel="chart" id="first"'), 'https://pages.example/report/#raw');
    bindTabs(byPanel, byPanel.document.querySelector<HTMLElement>('.tab-list')!);
    expect(byPanel.document.querySelector('[data-tab="table"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('skips a list without tabs, and a list with no parent uses the body', () => {
    const win = page('<div class="tab-list"></div>');
    bindTabs(win, win.document.querySelector<HTMLElement>('.tab-list')!);
    expect(win.document.querySelector('.tab-list')!.hasAttribute('role')).toBe(false);
    const detached = win.document.createElement('div');
    const tab = win.document.createElement('button');
    tab.dataset.tab = 'x';
    detached.append(tab);
    bindTabs(win, detached);
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});

describe('dialogs', () => {
  it('opens from a trigger and closes on the backdrop or a close button', () => {
    const win = page(`
      <button data-dialog="#about">About</button><button data-dialog="#[">Bad</button><button data-dialog="#text">Not a dialog</button>
      <dialog id="about"><p>Hi</p><button data-dialog-close><span>Close</span></button></dialog><p id="text"></p>`);
    const doc = win.document;
    const dialog = doc.querySelector<HTMLDialogElement>('dialog')!;
    const show = vi.spyOn(dialog, 'showModal');
    for (const trigger of doc.querySelectorAll<HTMLElement>('[data-dialog]')) bindDialogTrigger(win, trigger);
    doc.querySelector<HTMLElement>('[data-dialog="#["]')!.click();
    doc.querySelector<HTMLElement>('[data-dialog="#text"]')!.click();
    expect(show).not.toHaveBeenCalled();

    doc.querySelector<HTMLElement>('[data-dialog="#about"]')!.click();
    expect(dialog.open).toBe(true);
    doc.querySelector<HTMLElement>('[data-dialog="#about"]')!.click();
    expect(show).toHaveBeenCalledTimes(1);
    doc.querySelector('dialog p')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(true);
    doc.querySelector('dialog span')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(false);

    dialog.showModal();
    bindDialog(dialog);
    const close = vi.spyOn(dialog, 'close');
    dialog.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('ignores a trigger without a target', () => {
    const win = page('<button data-dialog>Open</button>');
    const trigger = win.document.querySelector<HTMLElement>('button')!;
    trigger.removeAttribute('data-dialog');
    bindDialogTrigger(win, trigger);
    expect(() => trigger.click()).not.toThrow();
  });
});
