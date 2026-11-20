// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExplorerContextMenu } from './ExplorerContextMenu.js';

afterEach(cleanup);
const base = {
  entry: { name: 'src', path: '/repo/src', kind: 'dir' as const }, x: 0, y: 0, isRemote: false,
  onViewInEditor: vi.fn(), onSendToTerminal: vi.fn(), onCopyPath: vi.fn(), onRename: vi.fn(), onDelete: vi.fn()
};

it('shows Add to chat for folders and fires it', () => {
  const onAddToChat = vi.fn();
  render(<ExplorerContextMenu {...base} onAddToChat={onAddToChat} />);
  fireEvent.click(screen.getByText('Add to chat'));
  expect(onAddToChat).toHaveBeenCalledTimes(1);
});

it('hides Add to chat without a handler', () => {
  render(<ExplorerContextMenu {...base} />);
  expect(screen.queryByText('Add to chat')).toBeNull();
});
