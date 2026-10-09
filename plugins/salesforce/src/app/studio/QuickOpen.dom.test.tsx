/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fuzzyScore, QuickOpen, rankQuickOpen, type QuickOpenItem } from './QuickOpen.js';

const items: QuickOpenItem[] = [
  { id: 'file:a', label: 'SupportBot', detail: 'force-app/SupportBot.agent', kind: 'agent' },
  { id: 'node:1', label: 'RefundFlow', detail: 'flows/RefundFlow.flow-meta.xml', kind: 'flow' },
  { id: 'node:2', label: 'OrderLookup', kind: 'apex' }
];
afterEach(cleanup);

it('scores direct, subsequence and non-matching queries', () => {
  expect(fuzzyScore('SupportBot', '')).toBe(0);
  expect(fuzzyScore('SupportBot', 'bot')).toBe(7);
  expect(fuzzyScore('SupportBot', 'spb')).toBeGreaterThanOrEqual(100);
  expect(fuzzyScore('SupportBot', 'xyz')).toBeNull();
  expect(rankQuickOpen(items, '').map(item => item.id)).toEqual(['file:a', 'node:1', 'node:2']);
  expect(rankQuickOpen(items, 'refund')[0].id).toBe('node:1');
  expect(rankQuickOpen(items, 'flows/')[0].id).toBe('node:1');
  expect(rankQuickOpen(items, 'zzz')).toEqual([]);
  expect(rankQuickOpen(items, '', 2)).toHaveLength(2);
});

it('filters, navigates with the keyboard and picks with Enter', () => {
  const onPick = vi.fn(); const onClose = vi.fn();
  render(<QuickOpen items={items} onPick={onPick} onClose={onClose} />);
  const input = screen.getByRole('combobox');
  expect(document.activeElement).toBe(input);
  expect(screen.getAllByRole('option')).toHaveLength(3);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith(items[1]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('shows an empty state, closes on Escape and backdrop click, and picks on click', () => {
  const onPick = vi.fn(); const onClose = vi.fn();
  const { container } = render(<QuickOpen items={items} onPick={onPick} onClose={onClose} />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'qqq' } });
  expect(screen.getByText('No matches')).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(container.querySelector('.sf-quickopen')!);
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(container.querySelector('.sf-quickopen-backdrop')!);
  expect(onClose).toHaveBeenCalledTimes(2);
  fireEvent.change(input, { target: { value: 'order' } });
  fireEvent.mouseEnter(screen.getAllByRole('option')[0]);
  fireEvent.click(screen.getAllByRole('option')[0]);
  expect(onPick).toHaveBeenCalledWith(items[2]);
});
