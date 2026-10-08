/** happy-dom windows for the kit's tests. */
import { Window } from 'happy-dom';
import { afterEach, vi } from 'vitest';
import type { KitWindow } from '../dom.js';

const windows: Window[] = [];
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.close();
  vi.restoreAllMocks();
});

export function newWindow(url = 'https://pages.example/report/index.html', prefersColorScheme: 'light' | 'dark' = 'light'): KitWindow {
  const happy = new Window({
    url,
    width: 1024,
    height: 768,
    settings: {
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
      navigation: { disableMainFrameNavigation: true },
      device: { prefersColorScheme }
    }
  });
  windows.push(happy);
  return happy as unknown as KitWindow;
}

/** Put a parsed fixture page in place of the window's document element. */
export function load(win: KitWindow, markup: string): void {
  const parsed = new win.DOMParser().parseFromString(markup, 'text/html');
  const root = win.document.importNode(parsed.documentElement, true);
  win.document.documentElement.remove();
  win.document.appendChild(root);
}

/** A page with `body` as its body. */
export function page(body: string, url?: string): KitWindow {
  const win = newWindow(url);
  load(win, `<!doctype html><html><head></head><body>${body}</body></html>`);
  return win;
}

export function rect(element: Element, box: Partial<DOMRect>): void {
  const full = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...box };
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ ...full, toJSON: () => full } as DOMRect);
}

export function texts(nodes: Iterable<Element>): string[] {
  return [...nodes].map((node) => (node.textContent ?? '').trim());
}
