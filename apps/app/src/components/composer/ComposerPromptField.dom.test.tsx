// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it, vi } from 'vitest';
import { ComposerPromptField } from './ComposerPromptField.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('anchors suggestions to the prompt field and releases the portal when closed', () => {
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
  const editor = new Editor({ extensions: [StarterKit], content: '<p>Review /</p>' });
  const onApply = vi.fn();
  const toggle = vi.fn();
  const suggestion = { kind: 'command' as const, name: '/review', description: 'Review code' };
  const props = {
    editor, imageInputProps: { type: 'file' }, images: [], onRemoveImage: vi.fn(),
    expanded: false, onToggleExpanded: toggle, expandTestId: 'expand',
    menuOpen: false, suggestions: [suggestion], selectedIndex: 0,
    triggerKind: 'command' as const, onApply
  };
  try {
    const { container, rerender, unmount } = render(<ComposerPromptField {...props} />);
    expect(screen.queryByRole('listbox')).toBeNull();
    const anchor = container.querySelector('.thread-command-editor-slot')!;
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ left: 24, top: 100, bottom: 180, width: 400 } as DOMRect);
    act(() => editor.view.dom.focus());
    rerender(<ComposerPromptField {...props} menuOpen />);
    const menu = screen.getByRole('listbox');
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(menu.style.left).toBe('24px');
    expect(menu.style.width).toBe('400px');
    expect(menu.style.top).toBe('188px');
    fireEvent.mouseDown(screen.getByRole('option'));
    expect(onApply).toHaveBeenCalledWith(suggestion);
    expect(editor.isFocused).toBe(true);
    rerender(<ComposerPromptField {...props} />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('expand'));
    expect(toggle).toHaveBeenCalledOnce();
    rerender(<ComposerPromptField {...props} expanded />);
    expect(screen.getByRole('button', { name: 'Make prompt box smaller' }).getAttribute('aria-expanded')).toBe('true');
    unmount();
  } finally {
    editor.destroy();
  }
});
