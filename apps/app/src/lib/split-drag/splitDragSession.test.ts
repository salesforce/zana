/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginSplitDrag, type SplitDragConfig } from './splitDragSession.js';

let pane: HTMLElement;
let source: HTMLElement;
let cancel: (() => void) | undefined;
const move = (x = 350, y = 250, pointerId = 1) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId }));
const up = (x = 350, y = 250, pointerId = 1) => window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId }));
function start(overrides: Partial<SplitDragConfig> = {}) {
  const config: SplitDragConfig = {
    pointerId: 1, ghostLabel: 'Inbox', sourceEl: source,
    shouldEngage: (x) => x > 200,
    decide: (_id, zone) => ({ zone, label: 'Split view' }),
    onDrop: vi.fn(), onEnd: vi.fn(), ...overrides
  };
  cancel = beginSplitDrag(config);
  return config;
}

beforeEach(() => {
  vi.useFakeTimers();
  source = document.createElement('a');
  pane = document.createElement('div');
  pane.dataset.splitPaneId = 'pane-2';
  document.body.append(source, pane);
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(250, 100, 400, 400));
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn((x: number) => x >= 250 && x < 650 ? [pane] : []) });
});
afterEach(() => {
  cancel?.();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.style.cssText = '';
});

describe('split drag lifecycle', () => {
  it('preserves clicks below threshold and ignores other pointers', () => {
    const config = start();
    move(100);
    move(350, 250, 2);
    expect(document.querySelector('.split-drag-ghost')).toBeNull();
    up(350, 250, 2);
    move();
    expect(document.querySelector('.split-drag-ghost')?.textContent).toBe('Inbox');
    up();
    expect(config.onDrop).toHaveBeenCalledWith({ paneId: 'pane-2', zone: 'left' });
    expect(config.onEnd).toHaveBeenCalledExactlyOnceWith({ dropped: true });
  });

  it('drops at the release position and suppresses the synthetic click only once', () => {
    const config = start();
    move();
    up(620);
    expect(config.onDrop).toHaveBeenCalledWith({ paneId: 'pane-2', zone: 'right' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    source.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const nextClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    source.dispatchEvent(nextClick);
    expect(nextClick.defaultPrevented).toBe(false);
    expect(document.querySelector('.split-drag-overlay')).toBeNull();
  });

  it('does not drop a stale target outside the workspace', () => {
    const config = start();
    move();
    up(700);
    expect(config.onDrop).not.toHaveBeenCalled();
    expect(config.onEnd).toHaveBeenCalledExactlyOnceWith({ dropped: false });
  });

  it('revalidates a rejected drop on release', () => {
    const decide = vi.fn().mockReturnValue({ zone: 'center', label: 'Swap views' });
    const config = start({ decide });
    move();
    expect(document.querySelector<HTMLElement>('.split-drag-overlay')?.style.display).toBe('block');
    decide.mockReturnValue(null);
    move();
    expect(document.querySelector<HTMLElement>('.split-drag-overlay')?.style.display).toBe('none');
    up();
    expect(config.onDrop).not.toHaveBeenCalled();
  });

  it.each(['Escape', 'blur', 'pointercancel', 'owner cleanup'])('cancels on %s and restores existing styles', (reason) => {
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'text';
    source.style.opacity = '0.8';
    const config = start({ cancelSidebarReorderOnEngage: true });
    move();
    if (reason === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (reason === 'pointercancel') window.dispatchEvent(new PointerEvent(reason, { pointerId: 1 }));
    else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else cancel?.();
    up();
    cancel?.();
    expect(config.onDrop).not.toHaveBeenCalled();
    expect(config.onEnd).toHaveBeenCalledExactlyOnceWith({ dropped: false });
    expect(document.body.style.cursor).toBe('crosshair');
    expect(document.body.style.userSelect).toBe('text');
    expect(source.style.opacity).toBe('0.8');
    expect(document.querySelector('.split-drag-ghost')).toBeNull();
  });

  it('ignores unrelated keys and other pointer cancellations', () => {
    const config = start();
    move();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 2 }));
    up();
    expect(config.onDrop).toHaveBeenCalledOnce();
  });

  it('cleans up an unengaged session and replaces any previous session', () => {
    const first = start();
    const second = start();
    move();
    up();
    expect(first.onDrop).not.toHaveBeenCalled();
    expect(first.onEnd).not.toHaveBeenCalled();
    expect(second.onDrop).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('.split-drag-ghost')).toHaveLength(0);
  });

  it('cancels an engaged previous session before starting another', () => {
    const first = start();
    move();
    start();
    expect(first.onEnd).toHaveBeenCalledExactlyOnceWith({ dropped: false });
    expect(document.querySelectorAll('.split-drag-ghost')).toHaveLength(0);
  });

  it('supports a single-pane fallback and optional callbacks', () => {
    vi.mocked(document.elementsFromPoint).mockReturnValue([]);
    const config = start({ fallback: { paneId: 'fallback', container: pane }, sourceEl: null, pointerId: undefined, onEnd: undefined });
    move();
    expect(document.querySelector('.split-drag-overlay-label')?.textContent).toBe('Split view');
    up();
    expect(config.onDrop).toHaveBeenCalledWith({ paneId: 'fallback', zone: 'left' });
  });

  it('falls back only inside the container and ignores non-pane elements', () => {
    vi.mocked(document.elementsFromPoint).mockReturnValue([source]);
    const config = start({ fallback: { paneId: 'fallback', container: pane } });
    move(700);
    up(700);
    expect(config.onDrop).not.toHaveBeenCalled();
  });

  it('prevents native HTML dragging while a pointer session is pending', () => {
    start();
    const event = new Event('dragstart', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    cancel?.();
    const after = new Event('dragstart', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
