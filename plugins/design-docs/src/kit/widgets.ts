/** Header nav that follows the scroll, tabs and dialogs. */
import type { KitWindow } from './dom.js';

/**
 * Mark the `.site-header nav` link of the section being read. A section counts
 * once its top passes under the sticky header.
 */
export function bindScrollSpy(win: KitWindow, root: ParentNode): () => void {
  const doc = win.document;
  const links = [...root.querySelectorAll<HTMLAnchorElement>('.site-header nav a[href^="#"]')]
    .map((link) => ({ link, target: doc.getElementById(decodeURIComponent(link.hash.slice(1))) }))
    .filter((entry): entry is { link: HTMLAnchorElement; target: HTMLElement } => entry.target !== null);
  if (!links.length) return () => {};
  let frame = 0;
  const update = () => {
    frame = 0;
    const header = doc.querySelector('.site-header');
    const below = header?.getBoundingClientRect().bottom ?? 0;
    let active = links[0]!;
    for (const entry of links) {
      // A nav jump stops a section at its scroll margin, which can sit lower than the header.
      const margin = Number.parseFloat(win.getComputedStyle(entry.target).scrollMarginTop) || 0;
      if (entry.target.getBoundingClientRect().top <= Math.max(below, margin) + 16) active = entry;
    }
    // At the very bottom, the last section is the one being read even if it is short.
    if (win.innerHeight + win.scrollY >= doc.documentElement.scrollHeight - 2) active = links.at(-1)!;
    for (const { link } of links) {
      const on = link === active.link;
      link.classList.toggle('active', on);
      if (on) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(update);
  };
  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('resize', schedule);
  update();
  return () => {
    win.removeEventListener('scroll', schedule);
    win.removeEventListener('resize', schedule);
    if (frame) win.cancelAnimationFrame(frame);
  };
}

let tabIds = 0;

/**
 * `.tab-list` buttons with `data-tab="name"` show the `[data-tab-panel="name"]`
 * next to them and hide the rest, with tab roles and arrow keys.
 */
export function bindTabs(win: KitWindow, list: HTMLElement): void {
  const scope = list.parentElement ?? win.document.body;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('button[data-tab]')];
  if (!tabs.length) return;
  const panelFor = (tab: HTMLButtonElement) =>
    [...scope.querySelectorAll<HTMLElement>('[data-tab-panel]')].find((panel) => panel.dataset.tabPanel === tab.dataset.tab) ?? null;
  list.setAttribute('role', 'tablist');
  for (const tab of tabs) {
    tabIds += 1;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.id ||= `kit-tab-${tabIds}`;
    const panel = panelFor(tab);
    if (panel) {
      panel.id ||= `kit-tab-panel-${tabIds}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      tab.setAttribute('aria-controls', panel.id);
    }
  }
  const select = (chosen: HTMLButtonElement, focus: boolean) => {
    for (const tab of tabs) {
      const on = tab === chosen;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = panelFor(tab);
      if (panel) panel.hidden = !on;
    }
    if (focus) chosen.focus();
    list.dispatchEvent(new win.CustomEvent('kit:tab', { bubbles: true, detail: { tab: chosen.dataset.tab } }));
  };
  for (const tab of tabs) tab.addEventListener('click', () => select(tab, false));
  list.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    select(tabs[next]!, true);
  });
  const hash = win.location.hash.slice(1);
  const initial =
    tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ??
    tabs.find((tab) => hash !== '' && (tab.dataset.tab === hash || panelFor(tab)?.id === hash)) ??
    tabs[0]!;
  select(initial, false);
}

/** `[data-dialog="#id"]` opens that `<dialog>`; `[data-dialog-close]` and a click on the backdrop close it. */
export function bindDialogTrigger(win: KitWindow, trigger: HTMLElement): void {
  trigger.addEventListener('click', (event) => {
    const selector = trigger.dataset.dialog ?? '';
    let dialog: Element | null = null;
    try {
      dialog = win.document.querySelector(selector);
    } catch {
      // Not a selector; nothing to open.
    }
    if (!(dialog instanceof win.HTMLDialogElement)) return;
    event.preventDefault();
    bindDialog(dialog);
    if (!dialog.open) dialog.showModal();
  });
}

const boundDialogs = new WeakSet<HTMLDialogElement>();

export function bindDialog(dialog: HTMLDialogElement): void {
  if (boundDialogs.has(dialog)) return;
  boundDialogs.add(dialog);
  dialog.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target === dialog || target.closest('[data-dialog-close]')) dialog.close();
  });
}
