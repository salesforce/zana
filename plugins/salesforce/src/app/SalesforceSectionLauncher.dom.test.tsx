/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SalesforceSectionLauncher } from './SalesforceSectionLauncher.js';

afterEach(cleanup);
const trigger = () => screen.getByRole('button', { name: 'Open Salesforce tools' });
const open = () => { fireEvent.click(trigger()); return screen.getByRole('dialog', { name: 'Salesforce tools' }); };

describe('Salesforce section launcher', () => {
  it('keeps the current section visible, filters by description, and selects a tool', () => {
    const onSelect = vi.fn();
    render(<SalesforceSectionLauncher value="agentforce" onSelect={onSelect} />);
    expect(trigger().textContent).toContain('Agentforce');
    const popup = open();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search Salesforce tools' }));
    expect(within(popup).getByRole('button', { name: /Agentforce/ }).getAttribute('aria-current')).toBe('page');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  SOQL  ' } });
    expect(within(popup).queryByRole('button', { name: /Overview/ })).toBeNull();
    fireEvent.click(within(popup).getByRole('button', { name: /Data Objects/ }));
    expect(onSelect).toHaveBeenCalledWith('data');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('supports empty search, escape, dismiss, toggle and focus restoration', () => {
    render(<SalesforceSectionLauncher value="data" onSelect={vi.fn()} />);
    open();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } });
    expect(screen.getByRole('status').textContent).toContain('No tools match');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close Salesforce tools' }));
    expect(document.activeElement).toBe(trigger());
    open(); fireEvent.click(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.getByRole('textbox').getAttribute('value')).toBe('');
  });

  it('moves through results with arrows and Home/End, and cycles focus with Tab', () => {
    render(<SalesforceSectionLauncher value="overview" onSelect={vi.fn()} />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const popup = screen.getByRole('dialog');
    const input = screen.getByRole('textbox');
    const first = within(popup).getByRole('button', { name: /Overview/ });
    const last = within(popup).getByRole('button', { name: /Agentforce/ });
    fireEvent.keyDown(input, { key: 'ArrowUp' }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'ArrowDown' }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowLeft' }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'End' }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Home' }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowUp' }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    const dismiss = screen.getByRole('button', { name: 'Close Salesforce tools' });
    expect(document.activeElement).toBe(dismiss);
    fireEvent.keyDown(dismiss, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
    input.focus(); fireEvent.keyDown(input, { key: 'ArrowDown' }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab' }); expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('dismisses on outside pointer or iframe/window blur and removes listeners on unmount', () => {
    const onSelect = vi.fn();
    const { unmount } = render(<SalesforceSectionLauncher value="agentforce" onSelect={onSelect} />);
    const popup = open();
    fireEvent.pointerDown(popup); expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body); expect(screen.queryByRole('dialog')).toBeNull();
    open(); fireEvent.blur(window); expect(screen.queryByRole('dialog')).toBeNull();
    open(); unmount(); fireEvent.pointerDown(document.body); fireEvent.blur(window);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers compact-header actions and dismisses the launcher after an action', () => {
    const action = vi.fn();
    render(<SalesforceSectionLauncher value="agentforce" onSelect={vi.fn()} actions={<button onClick={action}>Org details</button>} />);
    const popup = open();
    fireEvent.click(within(popup).getByRole('button', { name: 'Org details' }));
    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps hidden compact-header actions out of the keyboard focus loop', () => {
    render(<><style>{'.sf-section-footer { display:none; }'}</style><SalesforceSectionLauncher value="agentforce" onSelect={vi.fn()} actions={<button>Org details</button>} /></>);
    const popup = open();
    const last = within(popup).getByRole('button', { name: /Agentforce/ });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    const close = within(popup).getByRole('button', { name: 'Close Salesforce tools' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('marks external tools and hands off their exact section without changing its own label', () => {
    const onSelect = vi.fn();
    render(<SalesforceSectionLauncher value="agentforce" external={['data', 'apex', 'deployments', 'overview']} onSelect={onSelect} />);
    const popup = open();
    expect(within(popup).getAllByLabelText('Opens in main window')).toHaveLength(4);
    fireEvent.click(within(popup).getByRole('button', { name: /Apex & logs/ }));
    expect(onSelect).toHaveBeenCalledWith('apex');
    expect(trigger().textContent).toContain('Agentforce');
  });
});
