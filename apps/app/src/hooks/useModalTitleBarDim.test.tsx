/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backdropAlpha, useModalTitleBarDim } from './useModalTitleBarDim.js';

function Probe() {
  useModalTitleBarDim();
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('useModalTitleBarDim', () => {
  const setModalOpen = vi.fn(async (_open: boolean, _alpha?: number) => undefined);
  beforeEach(() => {
    setModalOpen.mockClear();
    (window as unknown as { cc?: unknown }).cc = { app: { setModalOpen } };
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    delete (window as unknown as { cc?: unknown }).cc;
  });

  it('reports closed on mount, open when a backdrop appears, closed when it goes', async () => {
    render(<Probe />);
    expect(setModalOpen.mock.calls).toEqual([[false]]);
    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    document.body.appendChild(backdrop);
    await flush();
    expect(setModalOpen.mock.calls).toEqual([[false], [true]]);
    backdrop.remove();
    await flush();
    expect(setModalOpen.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('ignores an aria-modal dialog that draws no backdrop', async () => {
    render(<Probe />);
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    await flush();
    expect(setModalOpen.mock.calls).toEqual([[false]]);
  });

  it('reports a backdrop nested in an added subtree, with its alpha', async () => {
    render(<Probe />);
    const wrapper = document.createElement('div');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.55)';
    wrapper.appendChild(backdrop);
    document.body.appendChild(wrapper);
    await flush();
    expect(setModalOpen.mock.calls).toEqual([[false], [true, 0.55]]);
  });

  it('does not re-check the page for unrelated changes', async () => {
    render(<Probe />);
    const spy = vi.spyOn(document, 'querySelector');
    document.body.appendChild(document.createElement('div'));
    document.body.appendChild(document.createTextNode('text'));
    document.body.setAttribute('class', 'x');
    await flush();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  describe('backdropAlpha', () => {
    const alphaOf = (color: string) => {
      const el = document.createElement('div');
      el.style.backgroundColor = color;
      document.body.appendChild(el);
      return backdropAlpha(el);
    };
    it('reads the alpha of rgba, treats rgb as opaque, and gives up on anything else', () => {
      expect(alphaOf('rgba(0, 0, 0, 0.45)')).toBe(0.45);
      expect(alphaOf('rgb(0, 0, 0)')).toBe(1);
      expect(alphaOf('rgb(0 0 0 / 50%)')).toBe(0.5);
      expect(alphaOf('transparent')).toBeUndefined();
    });
  });

  it('restores the caption buttons when it unmounts with a modal open', async () => {
    const view = render(<Probe />);
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);
    await flush();
    view.unmount();
    expect(setModalOpen.mock.calls.at(-1)).toEqual([false]);
  });

  it('does nothing outside the desktop app', () => {
    delete (window as unknown as { cc?: unknown }).cc;
    expect(() => render(<Probe />)).not.toThrow();
  });
});
