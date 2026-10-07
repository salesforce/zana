// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { focusComposerControl } from './focus-composer-control.js';

afterEach(cleanup);

it('focuses tapped controls, including their icons, without scrolling or swallowing clicks', () => {
  const click = vi.fn();
  render(<div onMouseDownCapture={focusComposerControl}>
    <button onClick={click}><svg data-testid="icon" />Options</button>
    <button disabled>Unavailable</button>
    <input aria-label="Message" />
  </div>);
  const button = screen.getByRole('button', { name: 'Options' });
  const focus = vi.spyOn(button, 'focus');
  expect(fireEvent.mouseDown(screen.getByTestId('icon'))).toBe(false);
  expect(document.activeElement).toBe(button);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Unavailable' }));
  fireEvent.mouseDown(screen.getByRole('textbox'));
  expect(focus).toHaveBeenCalledTimes(1);
});

it.each(['send', 'stop', 'retry'])('keeps %s stationary until the click lands in either layout', (action) => {
  const click = vi.fn();
  render(<div onMouseDownCapture={focusComposerControl}>
    <input aria-label="Message" />
    <button className={`thread-command-${action}`} data-preserve-composer-focus={action === 'retry' ? true : undefined} onClick={click}>{action}</button>
  </div>);
  const button = screen.getByRole('button');
  const focus = vi.spyOn(button, 'focus');
  for (const writing of [false, true]) {
    if (writing) screen.getByRole('textbox').focus();
    const active = document.activeElement;
    expect(fireEvent.mouseDown(button)).toBe(false);
    expect(document.activeElement).toBe(active);
    fireEvent.click(button);
  }
  expect(focus).not.toHaveBeenCalled();
  expect(click).toHaveBeenCalledTimes(2);
});
