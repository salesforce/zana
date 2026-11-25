/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsHelp } from './ShortcutsHelp.js';
import { registerThreadFindTarget, threadFindClaims } from '../lib/thread-find.js';

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

  it('says Archive for agent tabs and keeps Delete for plain shells', () => {
    render(<ShortcutsHelp onClose={() => undefined} />);
    expect(screen.getByText('Archive active agent tab (a plain shell is deleted)')).toBeTruthy();
    expect(screen.getByText('Stop the agent and remove the tab; its conversation stays in History')).toBeTruthy();
    expect(screen.getByText('Plain shell: end it and remove the tab')).toBeTruthy();
    expect(screen.queryByText('Delete active tab (terminates the process)')).toBeNull();
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

  it('lists the question panel keys next to its Ctrl+Enter row, per platform', () => {
    const rowKeys = (label: string) => {
      const row = screen.getByText(label).closest('.shortcut-row')!;
      expect(row.closest('section')?.querySelector('h4')?.textContent).toBe('Thread');
      return [...row.querySelectorAll('kbd')].map((kbd) => kbd.textContent);
    };
    const labels = [
      'Agent question: Next, or Submit on the last question',
      'Agent question: choose an option (focus in the panel)',
      'Agent question: Next, or Submit, from a focused option'
    ];
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    render(<ShortcutsHelp onClose={() => undefined} />);
    expect([...document.querySelectorAll('.shortcut-label')].map((el) => el.textContent).filter((text) => text?.startsWith('Agent question'))).toEqual(labels);
    expect(rowKeys(labels[1])).toEqual(['1–9']);
    expect(rowKeys(labels[2])).toEqual(['Enter']);
    cleanup();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<ShortcutsHelp onClose={() => undefined} />);
    expect(rowKeys(labels[0])).toEqual(['⌘', '↵']);
    expect(rowKeys(labels[2])).toEqual(['↵']);
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

describe('ShortcutsHelp find', () => {
  const filter = () => screen.getByRole('searchbox', { name: 'Filter shortcuts' }) as HTMLInputElement;
  const modal = () => screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  const ctrlF = { key: 'f', ctrlKey: true };
  let unregisterTarget: (() => void) | null = null;

  afterEach(() => {
    unregisterTarget?.();
    unregisterTarget = null;
  });

  function renderOnLinux(onClose: () => void = () => undefined) {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    return render(<ShortcutsHelp onClose={onClose} />);
  }

  it('Ctrl+F focuses the filter instead of thread find', () => {
    renderOnLinux();
    const target = { root: () => document.body, main: () => document.body, isPrimary: () => true, open: vi.fn() };
    unregisterTarget = registerThreadFindTarget(target);
    expect(document.activeElement).toBe(filter());
    screen.getByRole('button', { name: 'Close' }).focus();
    const event = new KeyboardEvent('keydown', { ...ctrlF, bubbles: true, cancelable: true });
    expect(threadFindClaims(event)).toBe(false);
    document.activeElement!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(filter());
  });

  it('filters by label, key combo and section, and hides empty sections', () => {
    renderOnLinux();
    fireEvent.change(filter(), { target: { value: 'toggle inbox' } });
    expect(screen.getAllByText('Toggle Inbox')).toHaveLength(1);
    expect(screen.queryByText('Next tab')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tabs' })).toBeNull();
    fireEvent.change(filter(), { target: { value: 'ctrl+shift+d' } });
    expect(screen.getByText('Duplicate active tab (same profile)')).toBeTruthy();
    expect(screen.queryByText('Toggle diff vs HEAD on open file')).toBeNull();
    fireEvent.change(filter(), { target: { value: 'CTRL + SHIFT + D' } });
    expect(screen.getByText('Duplicate active tab (same profile)')).toBeTruthy();
    fireEvent.change(filter(), { target: { value: 'explorer' } });
    expect(screen.getByText('Save edited file')).toBeTruthy();
    expect(screen.queryByText('New Chat')).toBeNull();
  });

  it("hints at a key combo and a section name in the platform's own keys", () => {
    renderOnLinux();
    expect(filter().placeholder).toBe('Filter shortcuts, e.g. Ctrl+Shift+D or Explorer');
    cleanup();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<ShortcutsHelp onClose={() => undefined} />);
    expect(filter().placeholder).toBe('Filter shortcuts, e.g. Cmd+Shift+D or Explorer');
    fireEvent.change(filter(), { target: { value: 'Cmd+Shift+D' } });
    expect(screen.getByText('Duplicate active tab (same profile)')).toBeTruthy();
  });

  it('reports the count and an empty state', () => {
    renderOnLinux();
    fireEvent.change(filter(), { target: { value: 'next tab' } });
    expect(screen.getByRole('status').textContent).toBe('1 shortcut match');
    fireEvent.change(filter(), { target: { value: 'zzzz' } });
    expect(screen.getByText('No shortcuts match “zzzz”.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('0 shortcuts match');
    fireEvent.change(filter(), { target: { value: '' } });
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByText(/No shortcuts match/u)).toBeNull();
  });

  it('Esc clears the filter and keeps the panel open, then closes on the next press', () => {
    const onClose = vi.fn();
    renderOnLinux(onClose);
    fireEvent.change(filter(), { target: { value: 'tab' } });
    filter().focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(filter().value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(filter());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('puts focus back where it was when the panel closes', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = renderOnLinux();
    expect(document.activeElement).toBe(filter());
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('matches the words people type for key caps', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<ShortcutsHelp onClose={() => undefined} />);
    fireEvent.change(filter(), { target: { value: 'cmd+shift+d' } });
    expect(screen.getByText('Duplicate active tab (same profile)')).toBeTruthy();
    fireEvent.change(filter(), { target: { value: 'option' } });
    expect(screen.getByText('Close focused pane')).toBeTruthy();
    fireEvent.change(filter(), { target: { value: 'escape' } });
    expect(screen.getByText('Close thread search')).toBeTruthy();
  });

  it('leaves Esc to an IME composition in the filter', () => {
    const onClose = vi.fn();
    renderOnLinux(onClose);
    fireEvent.change(filter(), { target: { value: 'tab' } });
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(filter().value).toBe('tab');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog', () => {
    renderOnLinux();
    const close = screen.getByRole('button', { name: 'Close' });
    filter().focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(filter());
  });
});
