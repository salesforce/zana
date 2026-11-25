// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ apply: vi.fn(), set: vi.fn(() => Promise.resolve()) }));
vi.mock('../../lib/product-client.js', () => ({ product: { config: { set: h.set } } }));
vi.mock('../../store.js', () => ({
  applyListPaneWidth: h.apply,
  LIST_PANE_MIN: 200,
  LIST_PANE_MAX: 600
}));

import { ListPaneResizer } from '../ListPaneResizer.js';

afterEach(() => {
  document.body.innerHTML = '';
  h.apply.mockClear();
  h.set.mockClear();
});

async function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ListPaneResizer />));
  return host.querySelector<HTMLElement>('.list-pane-resizer')!;
}

describe('ListPaneResizer nav offset', () => {
  it('subtracts --col-nav from .app-shell (rail width) when dragging', async () => {
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    shell.style.setProperty('--col-nav', '52px');
    document.body.appendChild(shell);
    const el = await mount();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 352 }));
    expect(h.apply).toHaveBeenLastCalledWith(300);
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(document.body.classList.contains('resizing-col')).toBe(false);
  });

  it('falls back to 0 offset and clamps to min without .app-shell', async () => {
    const el = await mount();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 }));
    expect(h.apply).toHaveBeenLastCalledWith(200);
    window.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('double-click resets width and persists', async () => {
    const el = await mount();
    await act(async () => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(h.apply).toHaveBeenCalledWith(280);
    expect(h.set).toHaveBeenCalledWith({ listPaneWidth: 280 });
  });
});
