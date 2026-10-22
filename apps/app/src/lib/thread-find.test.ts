// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openThreadFind, registerThreadFindTarget, threadFindClaims, type ThreadFindTarget } from './thread-find.js';

const unregister: Array<() => void> = [];

function threadView(primary = true) {
  const root = document.createElement('section');
  const main = document.createElement('div');
  const composer = document.createElement('textarea');
  const side = document.createElement('div');
  const sideInput = document.createElement('input');
  main.append(composer);
  side.append(sideInput);
  root.append(main, side);
  document.body.append(root);
  const target: ThreadFindTarget & { open: ReturnType<typeof vi.fn> } = {
    root: () => root,
    main: () => main,
    isPrimary: () => primary,
    open: vi.fn()
  };
  unregister.push(registerThreadFindTarget(target));
  return { root, main, composer, sideInput, target };
}

function overlay({ role = 'dialog', modal = false, inside = document.body }: { role?: string; modal?: boolean; inside?: Element } = {}) {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', role);
  if (modal) dialog.setAttribute('aria-modal', 'true');
  dialog.append(document.createElement('input'));
  inside.append(dialog);
  return dialog;
}

function pressFind(target: EventTarget, init: KeyboardEventInit = { key: 'f', ctrlKey: true }) {
  const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
  let opened = false;
  let claimed = false;
  target.addEventListener('keydown', (e) => {
    claimed = threadFindClaims(e as KeyboardEvent);
    opened = openThreadFind(e as KeyboardEvent);
  }, { once: true });
  target.dispatchEvent(event);
  return { opened, claimed, prevented: event.defaultPrevented };
}

beforeEach(() => {
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  localStorage.clear();
});

afterEach(() => {
  while (unregister.length) unregister.pop()!();
  document.body.replaceChildren();
});

describe('thread find routing', () => {
  it('does nothing while no thread view is registered', () => {
    const input = document.createElement('input');
    document.body.append(input);
    expect(pressFind(input)).toEqual({ opened: false, claimed: false, prevented: false });
  });

  it('opens the thread whose conversation column has focus', () => {
    const first = threadView();
    const second = threadView();
    expect(pressFind(first.composer)).toEqual({ opened: true, claimed: true, prevented: true });
    expect(first.target.open).toHaveBeenCalledTimes(1);
    expect(second.target.open).not.toHaveBeenCalled();
  });

  it('only answers the bound chord', () => {
    const view = threadView();
    expect(pressFind(view.composer, { key: 'g', ctrlKey: true }).opened).toBe(false);
    expect(pressFind(view.composer, { key: 'f', ctrlKey: true, shiftKey: true }).opened).toBe(false);
    expect(view.target.open).not.toHaveBeenCalled();
  });

  it('follows a rebinding from Settings → Shortcuts', () => {
    localStorage.setItem('zcc.keyboard-overrides', JSON.stringify([{
      command: 'thread.find',
      shortcut: { key: 'g', mod: true, meta: false, control: false, alt: false, shift: false }
    }]));
    const view = threadView();
    expect(pressFind(view.composer).opened).toBe(false);
    expect(pressFind(view.composer, { key: 'g', ctrlKey: true }).opened).toBe(true);
  });

  it('leaves the side panel, terminals and editors their own find', () => {
    const view = threadView();
    expect(pressFind(view.sideInput)).toEqual({ opened: false, claimed: false, prevented: false });
    for (const surface of ['xterm', 'monaco-editor']) {
      const host = document.createElement('div');
      host.className = surface;
      const field = document.createElement('textarea');
      host.append(field);
      view.main.append(host);
      expect(pressFind(field).opened).toBe(false);
    }
    expect(view.target.open).not.toHaveBeenCalled();
  });

  it('gives a chat embedded in a side panel its own search, whichever mounted first', () => {
    const outer = threadView();
    const inner = threadView();
    outer.root.querySelector('div:last-child')!.append(inner.root);
    expect(pressFind(inner.composer).opened).toBe(true);
    expect(inner.target.open).toHaveBeenCalledTimes(1);
    expect(outer.target.open).not.toHaveBeenCalled();
    expect(pressFind(outer.composer).opened).toBe(true);
    expect(outer.target.open).toHaveBeenCalledTimes(1);
  });

  it('uses the last click when nothing has focus', () => {
    const first = threadView();
    const second = threadView();
    first.composer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(pressFind(document.body).opened).toBe(true);
    expect(first.target.open).toHaveBeenCalledTimes(1);
    second.sideInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(pressFind(document.body).opened).toBe(false);
  });

  it('falls back to the newest primary thread for focus outside any thread', () => {
    const background = threadView();
    const hidden = threadView(false);
    const outside = document.createElement('button');
    document.body.append(outside);
    expect(pressFind(outside).opened).toBe(true);
    expect(background.target.open).toHaveBeenCalledTimes(1);
    expect(hidden.target.open).not.toHaveBeenCalled();
    unregister.shift()!();
    expect(pressFind(outside).opened).toBe(false);
  });

  it('leaves the palette, dialogs and popovers in charge of their own focus', () => {
    const view = threadView();
    const palette = overlay({ modal: true });
    const settings = overlay({ role: 'alertdialog' });
    const popover = overlay({ inside: view.main });
    for (const dialog of [palette, settings, popover]) {
      expect(pressFind(dialog.querySelector('input')!)).toEqual({ opened: false, claimed: false, prevented: false });
    }
    expect(view.target.open).not.toHaveBeenCalled();
  });

  it('hides the threads behind an open modal when nothing has focus', () => {
    const view = threadView();
    const palette = overlay({ modal: true });
    // A closed palette that stays mounted (display: none) has no boxes.
    palette.getClientRects = () => [] as unknown as DOMRectList;
    expect(pressFind(document.body).opened).toBe(true);
    palette.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList;
    expect(pressFind(document.body).opened).toBe(false);
    expect(view.target.open).toHaveBeenCalledTimes(1);
  });

  it('still opens a thread shown inside a modal', () => {
    const background = threadView();
    const modal = overlay({ modal: true });
    modal.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList;
    const shown = threadView();
    modal.append(shown.root);
    expect(pressFind(shown.composer).opened).toBe(true);
    expect(pressFind(modal.querySelector('input')!).opened).toBe(true);
    expect(pressFind(document.body).opened).toBe(true);
    expect(shown.target.open).toHaveBeenCalledTimes(3);
    expect(background.target.open).not.toHaveBeenCalled();
  });

  it('drops the click tracker once the last thread unregisters', () => {
    const view = threadView();
    view.composer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    unregister.pop()!();
    const again = threadView(false);
    expect(pressFind(document.body).opened).toBe(false);
    expect(again.target.open).not.toHaveBeenCalled();
  });
});
