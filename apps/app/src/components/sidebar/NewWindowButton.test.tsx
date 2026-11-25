// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NewWindowButton } from './NewWindowButton.js';

const bridge = vi.hoisted(() => ({ available: true, openNew: vi.fn() }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => bridge.available }));
vi.mock('../../lib/product-client.js', () => ({ product: { windows: bridge } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); bridge.available = true; });

it.each([undefined, 'p1'])('opens a fresh desktop window in the given context (%s)', projectId => {
  render(<NewWindowButton projectId={projectId} />);
  fireEvent.click(screen.getByRole('button', { name: 'New Window' }));
  expect(bridge.openNew).toHaveBeenCalledExactlyOnceWith(projectId);
});

it('omits the native window control on the web', () => {
  bridge.available = false;
  render(<NewWindowButton />);
  expect(screen.queryByRole('button')).toBeNull();
});
