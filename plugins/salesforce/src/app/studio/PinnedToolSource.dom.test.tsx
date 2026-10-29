/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = { doc: null as null | { text: string | null; tooLarge?: boolean }, error: null as string | null };
const read = vi.fn((..._args: unknown[]) => state);
vi.mock('../agent-doc/useAgentScriptDoc.js', () => ({ useAgentScriptDoc: (...args: unknown[]) => read(...args) }));
import { PinnedToolSource } from './PinnedToolSource.js';
afterEach(() => { cleanup(); state.doc = null; state.error = null; read.mockClear(); });

it('loads the pinned owner as a viewer and forwards its live unsaved source', () => {
  const onSource = vi.fn(), onOpen = vi.fn();
  const props = { pluginId: 'p', projectId: 'proj', path: 'A.agent', onSource, onOpen };
  const view = render(<PinnedToolSource {...props} ready={false} />);
  expect(read).toHaveBeenCalledWith('p', 'proj', 'A.agent');
  expect(screen.getByRole('status').textContent).toContain('Loading');
  state.doc = { text: 'unsaved draft' };
  view.rerender(<PinnedToolSource {...props} ready={false} />);
  expect(onSource).toHaveBeenLastCalledWith('A.agent', 'unsaved draft');
  view.rerender(<PinnedToolSource {...props} ready />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('offers the owner editor when source is unavailable or too large', () => {
  const onOpen = vi.fn();
  const props = { pluginId: 'p', path: 'A.agent', onSource: vi.fn(), onOpen, ready: false };
  state.error = 'File no longer exists';
  const view = render(<PinnedToolSource {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open agent' }));
  expect(onOpen).toHaveBeenCalledWith('A.agent');
  state.error = null; state.doc = { text: null, tooLarge: true };
  view.rerender(<PinnedToolSource {...props} />);
  expect(screen.getByRole('status').textContent).toContain('Open this agent');
  expect(props.onSource).not.toHaveBeenCalled();
});
