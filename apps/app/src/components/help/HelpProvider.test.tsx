// @vitest-environment happy-dom
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContextualHelp } from './ContextualHelp.js';
import { HELP_ENABLED_KEY, HelpProvider, useHelp } from './HelpProvider.js';
import { HelpToggle } from './HelpToggle.js';

const tips = [{ id: 'example', selector: '[data-example]', title: 'Example control', description: 'Help owned by this page.' }];
const disconnect = vi.fn();
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = disconnect; });
  vi.stubGlobal('MutationObserver', class { observe = vi.fn(); disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, x: 0, y: 0, toJSON: () => ({})
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function Draft() { return <input data-example aria-label="Draft" />; }
function Page({ page = 'home', child = <Draft /> }: { page?: string; child?: React.ReactNode }) {
  return <HelpProvider pageKey={page}>
    <HelpToggle />
    <ContextualHelp surfaceId="example" tips={tips}>{child}</ContextualHelp>
  </HelpProvider>;
}
const invite = () => screen.getByRole('button', { name: /Need a few tips/ });
const explore = () => fireEvent.click(invite());
const dot = () => screen.getByRole('button', { name: 'Tip: Example control' });
const master = () => screen.getByTestId('mobile-help-toggle');

it('defaults to the invitation and saves the toggle', () => {
  render(<Page />);
  expect(master().getAttribute('aria-pressed')).toBe('true');
  expect(master().textContent).toBe('Help On');
  expect(invite()).toBeTruthy();
  expect(screen.queryAllByRole('button', { name: /^Tip:/ })).toHaveLength(0);
  fireEvent.click(master());
  expect(master().getAttribute('aria-pressed')).toBe('false');
  expect(master().textContent).toBe('Help Off');
  expect(localStorage.getItem(HELP_ENABLED_KEY)).toBe('0');
  expect(screen.queryByRole('button', { name: /Need a few tips/ })).toBeNull();
});

it('hides every helper without remounting controls or losing a draft, and restarts cleanly', () => {
  const mount = vi.fn();
  function ExistingDraft() { useEffect(mount, []); return <Draft />; }
  render(<Page child={<ExistingDraft />} />);
  const input = screen.getByLabelText('Draft');
  fireEvent.change(input, { target: { value: 'My unsent task' } });
  explore(); fireEvent.click(dot());
  expect(screen.getByRole('region').textContent).toContain('Help owned by this page.');
  fireEvent.click(master());
  expect(document.querySelector('[data-contextual-help-ui]')).toBeNull();
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(master());
  expect(screen.getByLabelText('Draft')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('My unsent task');
  expect(mount).toHaveBeenCalledOnce();
  fireEvent.click(master());
  expect(invite()).toBeTruthy();
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.queryAllByRole('button', { name: /^Tip:/ })).toHaveLength(0);
  explore();
  expect(screen.queryByRole('region')).toBeNull();
});

it('remembers opting out across mounting and leaves Done local to this guide', () => {
  localStorage.setItem(HELP_ENABLED_KEY, 'false');
  const first = render(<Page />);
  expect(master().getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('button', { name: /Need a few tips/ })).toBeNull();
  fireEvent.click(master()); explore(); fireEvent.click(dot());
  fireEvent.click(screen.getByRole('button', { name: /Done/ }));
  expect(master().getAttribute('aria-pressed')).toBe('true');
  expect(invite()).toBe(document.activeElement);
  expect(screen.queryByRole('region')).toBeNull();
  fireEvent.click(master()); first.unmount();
  render(<Page />);
  expect(master().getAttribute('aria-pressed')).toBe('false');
});

it('resets exploration on navigation without resetting the preference or page children', () => {
  const view = render(<Page page="first" />);
  const input = screen.getByLabelText('Draft');
  explore(); fireEvent.click(dot());
  view.rerender(<Page page="second" />);
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.getByLabelText('Draft')).toBe(input);
  view.rerender(<Page page="first" />);
  expect(invite()).toBeTruthy();
  expect(screen.queryAllByRole('button', { name: /^Tip:/ })).toHaveLength(0);
  fireEvent.click(master());
  view.rerender(<Page page="second" />);
  expect(master().getAttribute('aria-pressed')).toBe('false');
});

it('syncs a storage change before removing focused helpers and releases its listeners', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const view = render(<Page />);
  explore(); fireEvent.click(dot());
  screen.getByRole('button', { name: 'Close tip' }).focus();
  act(() => {
    localStorage.setItem(HELP_ENABLED_KEY, '0');
    window.dispatchEvent(new Event('storage'));
  });
  expect(document.activeElement).toBe(master());
  expect(document.querySelector('[data-contextual-help-ui]')).toBeNull();
  act(() => {
    localStorage.setItem(HELP_ENABLED_KEY, '1');
    window.dispatchEvent(new Event('storage'));
  });
  expect(invite()).toBeTruthy();
  expect(screen.queryByRole('region')).toBeNull();
  view.unmount();
  expect(remove.mock.calls.some(([event]) => event === 'storage')).toBe(true);
  expect(remove.mock.calls.some(([event]) => event === 'zcc-prefs')).toBe(true);
});

it('supports other page content and allows only one surface to be explored at once', () => {
  const view = render(<HelpProvider><HelpToggle />
    <ContextualHelp surfaceId="first" tips={tips} invitation="Explore first"><Draft /></ContextualHelp>
    <ContextualHelp surfaceId="second" tips={tips} invitation="Explore second" regionLabel="Second page hint"><Draft /></ContextualHelp>
  </HelpProvider>);
  const first = within(view.container.querySelector('[data-help-surface="first"]') as HTMLElement);
  const second = within(view.container.querySelector('[data-help-surface="second"]') as HTMLElement);
  fireEvent.click(first.getByRole('button', { name: /Explore first/ }));
  fireEvent.click(first.getByRole('button', { name: /^Tip:/ }));
  fireEvent.click(second.getByRole('button', { name: /Explore second/ }));
  expect(first.queryByRole('region')).toBeNull();
  expect(first.queryByRole('button', { name: /^Tip:/ })).toBeNull();
  fireEvent.click(second.getByRole('button', { name: /^Tip:/ }));
  expect(second.getByRole('region', { name: 'Second page hint' })).toBeTruthy();
});

it('returns focus to mobile navigation when the Help toggle is inside a closed drawer', () => {
  render(<><div className="sidebar-trigger-overlay"><button className="sidebar-expand-control">Open navigation</button></div><Page /></>);
  explore(); fireEvent.click(dot());
  screen.getByRole('button', { name: 'Close tip' }).focus();
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
    const width = this.hasAttribute('data-help-toggle') ? 0 : 400;
    return { left: 0, top: 0, width, height: 200, right: width, bottom: 200, x: 0, y: 0, toJSON: () => ({}) };
  });
  act(() => {
    localStorage.setItem(HELP_ENABLED_KEY, '0');
    window.dispatchEvent(new Event('storage'));
  });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open navigation' }));
});

it('requires the shared provider', () => {
  function MissingProvider() { useHelp(); return null; }
  expect(() => render(<MissingProvider />)).toThrow('Contextual help must be inside HelpProvider');
});

it.each([true, false])('keeps the session choice when storage writes fail (previously %s)', (saved) => {
  const write = vi.fn(() => { throw new Error('Storage unavailable'); });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === HELP_ENABLED_KEY ? (saved ? '1' : '0') : null,
    setItem: write
  });
  render(<Page />);
  fireEvent.click(master());
  expect(write).toHaveBeenCalledWith(HELP_ENABLED_KEY, saved ? '0' : '1');
  const expected = String(!saved);
  expect(master().getAttribute('aria-pressed')).toBe(expected);
  // Changing another preference also emits the shared preferences event.
  act(() => window.dispatchEvent(new Event('zcc-prefs')));
  expect(master().getAttribute('aria-pressed')).toBe(expected);
  fireEvent.click(master());
  expect(master().getAttribute('aria-pressed')).toBe(String(saved));
});
