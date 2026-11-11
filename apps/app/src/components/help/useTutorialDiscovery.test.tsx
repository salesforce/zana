// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TUTORIAL_DISCOVERY_DISMISSED_KEY, useTutorialDiscovery } from './useTutorialDiscovery.js';

function Harness({ eligible = true }: { eligible?: boolean }) {
  const discovery = useTutorialDiscovery(eligible);
  return <><output>{discovery.visible ? 'Visible' : 'Hidden'}</output><button onClick={discovery.dismiss}>Dismiss</button></>;
}
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(800); }); };
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('waits for eligibility and a quiet shell, and cancels pending work on unmount', async () => {
  const view = render(<Harness eligible={false} />);
  await settle(); expect(screen.getByText('Hidden')).toBeTruthy();
  view.rerender(<Harness />);
  await settle(); expect(screen.getByText('Visible')).toBeTruthy();
  view.rerender(<Harness eligible={false} />);
  expect(screen.getByText('Hidden')).toBeTruthy();
  view.rerender(<Harness />);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('waits behind startup dialogs and hides again when another dialog opens', async () => {
  const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); document.body.append(modal);
  try {
    render(<Harness />);
    await settle(); expect(screen.getByText('Hidden')).toBeTruthy();
    await act(async () => { modal.remove(); });
    await settle(); expect(screen.getByText('Visible')).toBeTruthy();
    await act(async () => { document.body.append(modal); });
    expect(screen.getByText('Hidden')).toBeTruthy();
    await act(async () => { modal.removeAttribute('aria-modal'); });
    await settle(); expect(screen.getByText('Visible')).toBeTruthy();
  } finally { modal.remove(); }
});

it('remembers dismissal across remounts and synchronizes a choice from another window', async () => {
  render(<Harness />); await settle();
  localStorage.setItem(TUTORIAL_DISCOVERY_DISMISSED_KEY, '1');
  act(() => { window.dispatchEvent(new StorageEvent('storage')); });
  expect(screen.getByText('Hidden')).toBeTruthy();
  cleanup(); render(<Harness />); await settle();
  expect(screen.getByText('Hidden')).toBeTruthy();
});

it('keeps dismissal for this session when storage fails or another preference changes', async () => {
  render(<Harness />); await settle();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
  fireEvent.click(screen.getByText('Dismiss'));
  act(() => { window.dispatchEvent(new Event('zcc-prefs')); });
  await settle(); expect(screen.getByText('Hidden')).toBeTruthy();
});
