// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessageActionBar } from './MessageActionBar.js';

vi.mock('../../../lib/product-client.js', () => ({
  product: { threads: { fork: vi.fn() } }
}));

afterEach(cleanup);

it('copies a link to the selected message, encoding the thread id and preserving sequence zero', () => {
  const onCopy = vi.fn();
  const view = render(<MessageActionBar text="Done" threadId="thread/with spaces" sourceSeqEnd={0} onCopy={onCopy} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy message link' }));
  expect(onCopy).toHaveBeenCalledWith(new URL('/threads/thread%2Fwith%20spaces?message=0', window.location.origin).href);
  fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
  expect(onCopy).toHaveBeenLastCalledWith('Done');
  view.rerender(<MessageActionBar text="Done" threadId="t1" onCopy={onCopy} />);
  expect(screen.queryByRole('button', { name: 'Copy message link' })).toBeNull();
});
