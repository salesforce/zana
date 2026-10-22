/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsHelp } from './ShortcutsHelp.js';

afterEach(cleanup);

describe('ShortcutsHelp', () => {
  it('lists the remappable split shortcuts', () => {
    render(<ShortcutsHelp onClose={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Split (remappable in Settings → Shortcuts)' })).toBeTruthy();
    for (const label of ['Close focused pane', 'Focus the pane in that direction', 'Next pane', 'Previous pane']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('lists the Inbox shortcuts', () => {
    render(<ShortcutsHelp onClose={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy();
    for (const label of ['Next / previous message', 'Reply to the open message', 'Send the reply', 'Leave the reply box and keep reading', 'Delete the open message']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('lists the agent question shortcut under Thread', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    render(<ShortcutsHelp onClose={() => undefined} />);
    const label = screen.getByText('Agent question: Next, or Submit on the last question');
    expect(label.closest('section')?.querySelector('h4')?.textContent).toBe('Thread');
    const keys = [...label.closest('.shortcut-row')!.querySelectorAll('kbd')].map((kbd) => kbd.textContent);
    expect(keys).toEqual(['Ctrl', 'Enter']);
    vi.restoreAllMocks();
  });

  it('closes on Escape, the close button and the backdrop, but not inside the modal', () => {
    const onClose = vi.fn();
    const { container, unmount } = render(<ShortcutsHelp onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.mouseDown(container.querySelector('.shortcuts-modal')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.mouseDown(container.querySelector('.palette-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
