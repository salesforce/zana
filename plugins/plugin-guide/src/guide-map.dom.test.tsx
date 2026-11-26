/**
 * @vitest-environment happy-dom
 */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductMap } from './product-map.js';
import { FIXTURE_AUTHORED_WIDTH, MAX_FIXTURE_SCALE, SURFACE_NUMBERS, spatialFixtureGeometry } from './annotation.js';
import { PaletteWireframe, SurfaceMapContext } from './wireframes.js';
import { ProjectShellWireframe, SurfaceMapContext as WebsiteSurfaceMap } from '../../../website/lib/plugin-guide/wireframes.js';
import { ProductMap as WebsiteProductMap } from '../../../website/lib/plugin-guide/product-map.js';
import { spatialFixtureGeometry as websiteSpatialFixtureGeometry } from '../../../website/lib/plugin-guide/annotation.js';

function mount(node: ReturnType<typeof createElement>): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  (host as HTMLElement & { unmount?: () => void }).unmount = () => act(() => root.unmount());
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('palette demo', () => {
  it('closes the palette when the plugin row runs, then restores it', () => {
    vi.useFakeTimers();
    const host = mount(
      createElement(
        SurfaceMapContext.Provider,
        {
          value: {
            activeId: null,
            setActiveId: () => undefined,
            expandedId: null,
            numberOf: (id: string) => SURFACE_NUMBERS.get(id) ?? null
          }
        },
        createElement(PaletteWireframe)
      )
    );
    expect(host.querySelector('[data-guide-state="palette-open"]')).toBeTruthy();
    const row = host.querySelector('a[href="#surface-commandPaletteAction"]');
    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[data-guide-state="release-checklist-open"]')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2400);
    });
    expect(host.querySelector('[data-guide-state="palette-open"]')).toBeTruthy();
    vi.useRealTimers();
  });
});

describe('ProductMap click-away', () => {
  it('shows the contributed Agents selector only in the Agents workspace on both guides', async () => {
    const { ProjectShellWireframe: PluginProjectShell } = await import('./wireframes.js');
    for (const [Component, Context] of [[ProjectShellWireframe, WebsiteSurfaceMap], [PluginProjectShell, SurfaceMapContext]] as const) {
      const host = mount(createElement(Context.Provider, { value: { activeId: null, expandedId: null, setActiveId: () => {}, numberOf: () => null } }, createElement(Component)));
      expect(host.querySelector('[aria-label="Agents view selector"]')).toBeTruthy();
      const library = host.querySelector<HTMLAnchorElement>('a[data-guide-region="projectTab"]');
      expect(library).toBeTruthy();
      act(() => { library?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
      expect(host.querySelector('[aria-label="Agents view selector"]')).toBeNull();
      (host as HTMLElement & { unmount(): void }).unmount();
    }
  });
  it('opens the Agents view documentation from the extra view beside the built-in layouts', () => {
    const host = mount(createElement(ProductMap, { initialSlideId: 'project-shell' }));
    const selector = host.querySelector('[aria-label="Agents view selector"]');
    expect(selector?.textContent).toContain('BoardListFlow');
    const marker = selector?.querySelector('a[href="#surface-experimental_agentsView"]');
    expect(marker).toBeTruthy();
    act(() => { marker?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    const dialog = host.querySelector('[role="dialog"][aria-label="Agents view"]');
    expect(dialog?.textContent).toContain('onInspect(item.key)');
    expect(dialog?.textContent).toContain('Copy for agent');
    expect(dialog?.textContent).toContain('Installed plugins');
    (host as HTMLElement & { unmount(): void }).unmount();
  });

  it('opens a card from a marker and dismisses it on pointerdown outside the dialog', () => {
    const host = mount(createElement(ProductMap));
    const marker = host.querySelector('a[href="#surface-navPanel"]');
    act(() => {
      marker?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    act(() => {
      host.querySelector('h2')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeFalsy();
  });
});

describe('spatial fixtures', () => {
  it('lays every wireframe out at the authored width and scales it as one picture', () => {
    const host = mount(createElement(ProductMap, { initialSlideId: 'thread' }));
    const fixtures = [...host.querySelectorAll<HTMLElement>('.plugin-guide-spatial-inner')];
    expect(fixtures).toHaveLength(7);
    for (const fixture of fixtures) {
      expect(fixture.style.width).toBe(`${FIXTURE_AUTHORED_WIDTH}px`);
      expect(fixture.style.transform).toMatch(/^scale\(/);
    }
    (host as HTMLElement & { unmount(): void }).unmount();
  });

  it('marks the browser toolbar action inside the thread side panel', () => {
    const host = mount(createElement(ProductMap, { initialSlideId: 'thread' }));
    const marker = host.querySelector('a[data-guide-region="experimental_browserToolbarAction"]');
    expect(marker?.closest('.plugin-guide-browser')).toBeTruthy();
    act(() => { marker?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(host.querySelector('[role="dialog"][aria-label="Browser toolbar action"]')?.textContent).toContain('page.evaluate');
    (host as HTMLElement & { unmount(): void }).unmount();
  });
});

describe.each([
  ['plugin', spatialFixtureGeometry],
  ['website', websiteSpatialFixtureGeometry]
] as const)('%s spatialFixtureGeometry', (_label, geometry) => {
  it('scales the authored width down to the frame and centres it', () => {
    expect(geometry(480, 400)).toEqual({ scale: 0.5, height: 200, offsetX: -240 });
  });

  it('caps the scale, honours the available height and waits for layout', () => {
    expect(geometry(2400, 500).scale).toBe(MAX_FIXTURE_SCALE);
    expect(geometry(960, 800, 400)).toEqual({ scale: 0.5, height: 400, offsetX: 0 });
    expect(geometry(0, 0)).toEqual({ scale: 1, height: null, offsetX: 0 });
  });
});

describe('measured spatial fixtures', () => {
  const observers: Array<() => void> = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    observers.length = 0;
  });

  function measuredLayout(): void {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      }
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
  }

  for (const [label, Map] of [
    ['plugin', ProductMap],
    ['website', WebsiteProductMap]
  ] as const) {
    it(`sizes the ${label} frame from the scaled picture and keeps it stable`, () => {
      measuredLayout();
      const host = mount(createElement(Map, { initialSlideId: 'thread' }));
      const frame = host.querySelector<HTMLElement>('.plugin-guide-spatial');
      const inner = frame?.querySelector<HTMLElement>('.plugin-guide-spatial-inner');
      expect(frame?.dataset.guideScale).toBe('0.5000');
      expect(frame?.style.height).toBe('200px');
      expect(inner?.style.marginLeft).toBe('-240px');
      expect(inner?.style.transform).toBe('scale(0.5)');
      act(() => observers.forEach((notify) => notify()));
      expect(frame?.style.height).toBe('200px');
      (host as HTMLElement & { unmount(): void }).unmount();
    });
  }
});
