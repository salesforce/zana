// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadToolMenu } from './ThreadToolMenu.js';

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const items = () => ['Move', 'Maximize', 'Hide'].map(label => ({ id: label, label, icon: <span />, run: vi.fn(), description: label === 'Hide' ? 'Keeps tools available' : undefined }));
function setup() {
  const anchor = document.createElement('button'); document.body.append(anchor); anchor.textContent = 'Actions';
  const onClose = vi.fn(), rows = items();
  const view = render(<ThreadToolMenu anchor={anchor} label="Shell" items={rows} onClose={onClose} />);
  return { anchor, onClose, rows, view };
}
describe('ThreadToolMenu', () => {
  it('portals inside the viewport and supports keyboard navigation and actions', () => {
    const { rows, onClose } = setup();
    const menu = screen.getByRole('menu', { name: 'Shell' });
    expect(menu.parentElement).toBe(document.body);
    expect((menu as HTMLElement).style.position).toBe('fixed');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Move' }));
    for (const [key, name] of [['ArrowUp', 'Hide'], ['ArrowDown', 'Move'], ['End', 'Hide'], ['Home', 'Move']] as const) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: new RegExp(name) }));
    }
    fireEvent.keyDown(document.activeElement!, { key: 'a' }); expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /Hide/ }));
    expect(onClose).toHaveBeenCalledWith(true); expect(rows[2].run).toHaveBeenCalledOnce();
    expect(rows[0].run).not.toHaveBeenCalled();
  });
  it.each(['Escape', 'Tab'])('returns focus through the owner on %s', key => {
    const { onClose } = setup(); fireEvent.keyDown(document.activeElement!, { key });
    expect(onClose).toHaveBeenCalledWith(true);
  });
  it('dismisses on outside input, scroll and resize, and removes its listeners', () => {
    const { anchor, onClose, view } = setup();
    fireEvent.pointerDown(anchor); fireEvent.pointerDown(screen.getByRole('menu')); fireEvent.scroll(screen.getByRole('menu'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body); fireEvent.scroll(document); fireEvent.resize(window);
    expect(onClose.mock.calls).toEqual([[false], [false], [false]]);
    view.unmount(); onClose.mockClear();
    fireEvent.pointerDown(document.body); fireEvent.scroll(document); fireEvent.resize(window);
    expect(onClose).not.toHaveBeenCalled();
  });
});
