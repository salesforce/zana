/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommentsPane } from './CommentsPane.js';
import type { StudioComment } from '../../../lib/studio-contract.js';

afterEach(cleanup);
const c = (id: string, line: number, extra: Partial<StudioComment> = {}): StudioComment => ({ id, path: 'a.agent', line, endLine: line, quote: 'q1\nq2\nq3\nq4', body: `body ${id}`, author: { kind: 'user', name: 'You' }, createdAt: 1, ...extra });
const props = { pluginId: 'salesforce', projectId: 'p', path: 'a.agent' };

it('lists open comments in line order, jumps to a line and resolves with a required note', () => {
  const onReveal = vi.fn(); const onResolve = vi.fn(); const onAddress = vi.fn();
  render(<CommentsPane {...props} comments={[c('b', 9, { endLine: 11 }), c('a', 2), c('x', 1, { path: 'other.agent' })]} onReveal={onReveal} onResolve={onResolve} onAddressWithAgent={onAddress} />);
  const bodies = screen.getAllByText(/^body/).map(n => n.textContent);
  expect(bodies).toEqual(['body a', 'body b']);
  expect(screen.getByText('Open (2)')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Jump to line 9'));
  expect(onReveal).toHaveBeenCalledWith(9);
  expect(screen.getByText('L9-11')).toBeTruthy();
  fireEvent.click(screen.getByText('Address with agent')); expect(onAddress).toHaveBeenCalled();
  fireEvent.click(screen.getAllByText('Resolve')[0]!);
  const input = screen.getByLabelText('Resolution note');
  const submit = screen.getAllByText('Resolve').find(n => n.className.includes('is-primary')) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.keyDown(input, { key: 'Enter' }); expect(onResolve).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '  fixed  ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onResolve).toHaveBeenCalledWith('a', 'fixed');
  expect(screen.queryByLabelText('Resolution note')).toBeNull();
});

it('cancels a pending resolve, shows resolved comments and empty states', () => {
  render(<CommentsPane {...props} comments={[c('a', 2), c('r', 5, { resolved: { at: 1, note: 'did it', by: 'agent:t' } })]} />);
  fireEvent.click(screen.getByText('Resolve'));
  fireEvent.keyDown(screen.getByLabelText('Resolution note'), { key: 'Escape' });
  expect(screen.queryByLabelText('Resolution note')).toBeNull();
  fireEvent.click(screen.getByText('Resolve')); fireEvent.click(screen.getByText('Cancel'));
  expect(screen.getByText('Address with agent').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByText('Resolved (1)'));
  expect(screen.getByText(/Resolved by agent:t: did it/)).toBeTruthy();
  cleanup();
  render(<CommentsPane {...props} comments={[]} />);
  expect(screen.getByText(/No open comments/)).toBeTruthy();
  fireEvent.click(screen.getByText('Resolved (0)'));
  expect(screen.getByText('Nothing resolved yet.')).toBeTruthy();
});

it('shows every path when no file is open', () => {
  render(<CommentsPane pluginId="s" path={null} comments={[c('x', 1, { path: 'z.agent' })]} />);
  expect(screen.getByText('body x')).toBeTruthy();
});
