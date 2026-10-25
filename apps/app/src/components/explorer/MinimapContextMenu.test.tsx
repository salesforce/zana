// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPLORER_MINIMAP_DEFAULTS, type ExplorerMinimapPrefs } from '@zana-ai/zcc-domain/product';
import { MinimapContextMenu } from './MinimapContextMenu.js';

afterEach(cleanup);

function setup(prefs: Partial<ExplorerMinimapPrefs> = {}, autoHidden = false) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <MinimapContextMenu
      prefs={{ ...EXPLORER_MINIMAP_DEFAULTS, ...prefs }}
      autoHidden={autoHidden}
      x={100}
      y={100}
      onChange={onChange}
      onClose={onClose}
    />
  );
  return { onChange, onClose };
}

describe('MinimapContextMenu', () => {
  it('shows checkbox state and focuses the first item', () => {
    setup({ renderCharacters: false });
    expect(screen.getByRole('menuitemcheckbox', { name: 'Minimap' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Render Characters' }).getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: 'Minimap' }));
  });

  it('toggles the minimap and closes', () => {
    const { onChange, onClose } = setup();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Minimap' }));
    expect(onChange).toHaveBeenCalledWith({ explorerMinimapEnabled: false });
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles render characters', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Render Characters' }));
    expect(onChange).toHaveBeenCalledWith({ explorerMinimapRenderCharacters: false });
  });

  it.each([
    ['Width', 'Wide', { explorerMinimapWidth: 'wide' }],
    ['Vertical size', 'Fill', { explorerMinimapVerticalSize: 'fill' }],
    ['Slider', 'Always', { explorerMinimapSlider: 'always' }],
    ['Side', 'Left', { explorerMinimapSide: 'left' }]
  ])('%s submenu: picking %s saves the patch and closes', (menu, choice, patch) => {
    const { onChange, onClose } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(menu) }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: choice }));
    expect(onChange).toHaveBeenCalledWith(patch);
    expect(onClose).toHaveBeenCalled();
  });

  it('marks the current choice and opens a submenu on hover', () => {
    setup({ side: 'left' });
    const wrap = screen.getByRole('menuitem', { name: /Side/ }).parentElement!;
    fireEvent.mouseEnter(wrap);
    expect(screen.getByRole('menuitemradio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Right' }).getAttribute('aria-checked')).toBe('false');
  });

  it('disables dependent rows when the minimap is off', () => {
    setup({ enabled: false });
    expect((screen.getByRole('menuitemcheckbox', { name: 'Render Characters' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: /Width/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitemcheckbox', { name: 'Minimap' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Width/ }).parentElement!);
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });

  it('notes when the preview is too narrow', () => {
    setup({}, true);
    expect(screen.getByText('Hidden — preview too narrow')).toBeTruthy();
  });

  it('hides the note otherwise', () => {
    setup();
    expect(screen.queryByText('Hidden — preview too narrow')).toBeNull();
  });

  it('navigates with the keyboard', () => {
    const { onClose } = setup();
    const menu = screen.getByRole('menu', { name: 'Minimap' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: 'Render Characters' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Side/ }));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Right' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Left' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.queryByRole('menuitemradio')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Side/ }));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menuitemradio')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(menu.querySelector('button')!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on an outside mousedown but not an inside one', () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByRole('menuitemcheckbox', { name: 'Minimap' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on window blur and removes its listeners on unmount', () => {
    const { onClose } = setup();
    fireEvent.blur(window);
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clamps into the viewport', () => {
    const onChange = vi.fn();
    render(
      <MinimapContextMenu prefs={EXPLORER_MINIMAP_DEFAULTS} autoHidden={false} x={99999} y={99999} onChange={onChange} onClose={vi.fn()} />
    );
    const style = (screen.getAllByRole('menu')[0] as HTMLElement).style;
    expect(parseInt(style.left, 10)).toBeLessThan(window.innerWidth);
    expect(parseInt(style.top, 10)).toBeLessThan(window.innerHeight);
  });
});
