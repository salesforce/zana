/** One tooltip per page, shared by every chart: value first, then the series it belongs to. */
import { html, type KitWindow } from './dom.js';

export interface TooltipRow {
  value: string;
  name: string;
  /** The series' color slot for the line key; null draws no key. */
  slot: number | null;
}

export interface Tooltip {
  readonly element: HTMLElement;
  /** `side` keeps a crosshair's points in view; `above` clears the hovered mark. */
  show(head: string, rows: TooltipRow[], at: { x: number; y: number }, placement?: 'above' | 'side'): void;
  hide(): void;
}

const tooltips = new WeakMap<Document, Tooltip>();

export function tooltipFor(win: KitWindow): Tooltip {
  const doc = win.document;
  const existing = tooltips.get(doc);
  if (existing?.element.isConnected) return existing;
  const element = html(doc, 'div', { class: 'kit-tooltip', role: 'tooltip', id: 'kit-tooltip', hidden: true });
  doc.body.append(element);
  const tooltip: Tooltip = {
    element,
    show(head, rows, at, placement = 'above') {
      element.replaceChildren(
        html(doc, 'div', { class: 'head' }, [head]),
        ...rows.map((row) => {
          const line = html(doc, 'div', { class: 'row' }, [html(doc, 'span', { class: 'v' }, [row.value]), html(doc, 'span', { class: 'k' }, [row.name])]);
          if (row.slot !== null) line.style.setProperty('--c', `var(--series-${row.slot})`);
          return line;
        })
      );
      element.hidden = false;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      let left = at.x + 14;
      if (left + width > win.innerWidth - 8) left = at.x - 14 - width;
      let top = placement === 'side' ? Math.min(at.y - height / 2, win.innerHeight - height - 8) : at.y - height - 12;
      if (top < 8) top = placement === 'side' ? 8 : at.y + 16;
      element.style.left = `${Math.max(8, left)}px`;
      element.style.top = `${Math.max(8, top)}px`;
    },
    hide() {
      element.hidden = true;
    }
  };
  tooltips.set(doc, tooltip);
  return tooltip;
}
