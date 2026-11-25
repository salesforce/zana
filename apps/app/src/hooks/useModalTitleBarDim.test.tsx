/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalTitleBarDim } from './useModalTitleBarDim.js';

function Probe() {
  useModalTitleBarDim();
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('useModalTitleBarDim', () => {
  const setModalOpen = vi.fn(async (_open: boolean) => undefined);
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

  it('treats an aria-modal dialog as a modal and reports each change once', async () => {
    render(<Probe />);
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    await flush();
    dialog.className = 'still-open';
    await flush();
    expect(setModalOpen.mock.calls).toEqual([[false], [true]]);
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
