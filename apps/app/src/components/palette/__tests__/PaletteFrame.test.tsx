// @vitest-environment happy-dom
import { createRef, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaletteFrame, paletteOptionProps } from '../PaletteFrame.js';

afterEach(cleanup);
function setup(overrides: Partial<ComponentProps<typeof PaletteFrame>> = {}) {
  const props: ComponentProps<typeof PaletteFrame> = {
    query: '', onQuery: vi.fn(), placeholder: 'Search anything', scope: 'all', onScope: vi.fn(),
    activeIndex: 0, rowCount: 1, total: 1, inputRef: createRef(), listRef: createRef(),
    onInputKeyDown: vi.fn(), onClose: vi.fn(),
    children: <button {...paletteOptionProps(0, 0)}>Design system</button>, ...overrides
  };
  return { ...render(<PaletteFrame {...props} />), props };
}

describe('palette frame', () => {
  it('labels the dialog and combobox, connects the selected option, and announces result counts', () => {
    setup();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { selected: true }).id);
    expect(screen.getByRole('status').textContent).toBe('1 result');
  });

  it('changes the query and category without losing input focus', () => {
    const { props } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Review' } });
    expect(props.onQuery).toHaveBeenCalledWith('Review');
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    expect(props.onScope).toHaveBeenCalledWith('threads');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('traps Tab across controls while keeping result options out of the tab sequence', () => {
    setup();
    const input = screen.getByRole('combobox');
    const last = screen.getByRole('button', { name: 'Commands' });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('option').tabIndex).toBe(-1);
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true);
  });

  it('preserves mode-specific key handling and closes with Escape from any control', () => {
    const { props } = setup({ onInputKeyDown: (event) => { if (event.key === 'Tab') event.preventDefault(); } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Projects' }), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes only for backdrop or close-button interactions', () => {
    const { container, props } = setup();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector('.palette-backdrop')!);
    fireEvent.click(screen.getByRole('button', { name: 'Close command palette' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('restores the opener on dismiss and tolerates a removed opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const first = setup();
    first.unmount();
    expect(document.activeElement).toBe(opener);
    const second = setup();
    opener.remove();
    expect(() => second.unmount()).not.toThrow();
  });

  it('shows mode context, hides category filters, and keeps focus trapped', () => {
    setup({ modeLabel: 'Files in Design system', total: 8, rowCount: 2 });
    expect(screen.getByText('Files in Design system')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Search categories' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('2 of 8 results');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close command palette' }));
  });

  it('does not announce a nonexistent active result', () => {
    setup({ rowCount: 0, total: 0, children: <div>No results</div> });
    expect(screen.getByRole('combobox').hasAttribute('aria-activedescendant')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('0 results');
    expect(paletteOptionProps(1, 0)['aria-selected']).toBe(false);
  });
});
