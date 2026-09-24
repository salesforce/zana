// @vitest-environment happy-dom
import { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadComposerToolbar } from './ThreadComposerToolbar.js';

afterEach(cleanup);

function toolbar(overrides: Partial<Parameters<typeof ThreadComposerToolbar>[0]> = {}) {
  return (
    <ThreadComposerToolbar
      mode={<button>Agent</button>}
      model={<button>Model</button>}
      reasoning={<button>Thinking effort</button>}
      sendMode={<button>Send mode</button>}
      secondaryActions={<button>Attach files</button>}
      stop={null}
      send={<button>Send</button>}
      {...overrides}
    />
  );
}

it('links the disclosure to its controls, focuses options, and restores focus on Escape', () => {
  render(toolbar());
  const toggle = screen.getByRole('button', { name: 'Composer options' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  for (const id of toggle.getAttribute('aria-controls')!.split(' ')) {
    expect(document.getElementById(id)).toBeTruthy();
  }
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(screen.getByText('Agent'));
  fireEvent.keyDown(screen.getByText('Agent'), { key: 'ArrowDown' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(screen.getByText('Agent'), { key: 'Escape' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle);
  fireEvent.keyDown(toggle, { key: 'Escape' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

it('leaves handled picker Escape events alone and preserves controls while toggling', () => {
  const mounted = vi.fn();
  function Control() {
    const [count, setCount] = useState(0);
    useEffect(() => {
      mounted();
    }, []);
    return (
      <button onClick={() => setCount(count + 1)} onKeyDown={(e) => e.preventDefault()}>
        Mode {count}
      </button>
    );
  }
  const { rerender } = render(toolbar({ mode: <Control /> }));
  const toggle = screen.getByRole('button', { name: 'Composer options' });
  fireEvent.click(toggle);
  fireEvent.click(screen.getByText('Mode 0'));
  fireEvent.keyDown(screen.getByText('Mode 1'), { key: 'Escape' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  rerender(toolbar({ mode: <Control /> }));
  expect(screen.getByText('Mode 1')).toBeTruthy();
  expect(mounted).toHaveBeenCalledOnce();
});

it('keeps send and stop callbacks available without opening options', () => {
  const send = vi.fn();
  const stop = vi.fn();
  render(
    toolbar({
      send: <button onClick={send}>Send</button>,
      stop: <button onClick={stop}>Stop</button>
    })
  );
  fireEvent.click(screen.getByText('Send'));
  fireEvent.click(screen.getByText('Stop'));
  expect(send).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(
    screen.getByRole('button', { name: 'Composer options' }).getAttribute('aria-expanded')
  ).toBe('false');
});

it('supports unavailable optional controls and distinct instances', () => {
  render(
    <>
      {toolbar({ mode: null, reasoning: null, sendMode: null, secondaryActions: null })}
      {toolbar()}
    </>
  );
  const toggles = screen.getAllByRole('button', { name: 'Composer options' });
  expect(toggles[0].getAttribute('aria-controls')).not.toBe(
    toggles[1].getAttribute('aria-controls')
  );
  fireEvent.click(toggles[0]);
  expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
  expect(toggles[1].getAttribute('aria-expanded')).toBe('false');
});

it('collapses when writing resumes, without reacting to other fields or retaining listeners', () => {
  const { unmount } = render(
    <div className="thread-command-composer">
      <input aria-label="Message" className="thread-command-editor" />
      <input aria-label="Other field" />
      {toolbar()}
    </div>
  );
  const root = screen.getByLabelText('Message').parentElement!;
  const removed = vi.spyOn(root, 'removeEventListener');
  const toggle = screen.getByRole('button', { name: 'Composer options' });
  fireEvent.click(toggle);
  fireEvent.focusIn(screen.getByLabelText('Other field'));
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  fireEvent.focusIn(screen.getByLabelText('Message'));
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(removed).toHaveBeenCalledWith('focusin', expect.any(Function));
  fireEvent.click(toggle);
  unmount();
  expect(removed).toHaveBeenCalledTimes(2);
});
