/**
 * @vitest-environment happy-dom
 */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductMap } from './product-map.js';
import { SURFACE_NUMBERS } from './annotation.js';
import { PaletteWireframe, SurfaceMapContext } from './wireframes.js';

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
  it('opens a card from a marker and dismisses it on pointerdown outside the dialog', () => {
    const host = mount(createElement(ProductMap));
    const marker = host.querySelector('a[href="#surface-projectTab"]');
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
