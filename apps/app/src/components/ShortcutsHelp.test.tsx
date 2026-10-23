/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsHelp } from './ShortcutsHelp.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it('shows the terminal paste chord from the live setting off macOS, defaulting to the platform', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    const { rerender } = render(<ShortcutsHelp onClose={() => undefined} ctrlVPasteEnabled />);
    expect(screen.getByText(/turn off “Ctrl\+V pastes”/)).toBeTruthy();
    rerender(<ShortcutsHelp onClose={() => undefined} ctrlVPasteEnabled={false} />);
    expect(screen.getByText(/turn on “Ctrl\+V pastes”/)).toBeTruthy();
    cleanup();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    render(<ShortcutsHelp onClose={() => undefined} />);
    expect(screen.getByText(/turn off “Ctrl\+V pastes”/)).toBeTruthy();
    cleanup();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<ShortcutsHelp onClose={() => undefined} ctrlVPasteEnabled />);
    expect(screen.queryByText(/Ctrl\+V pastes/)).toBeNull();
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
