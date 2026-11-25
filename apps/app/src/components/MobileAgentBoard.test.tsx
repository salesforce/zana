// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileAgentBoard, type MobileAgentLane } from './MobileAgentBoard.js';

afterEach(cleanup);
const lanes: MobileAgentLane[] = [
  { key: 'blocked', label: 'Needs you', count: 0, icon: null },
  { key: 'working', label: 'Working', count: 1, icon: null },
  { key: 'idle', label: 'Idle', count: 2, icon: null }
];
const renderLane = (key?: MobileAgentLane['key']) => <button>Open {key ?? 'any'} agent</button>;
const filter = () => screen.getByRole('button', { name: /^Filter by status/ });
const sheet = () => within(screen.getByRole('dialog', { name: 'Filter by status' }));

it('defaults to all agents and keeps the status filter beside search', () => {
  render(<MobileAgentBoard lanes={lanes} renderLane={renderLane} search={<input aria-label="Filter agents" />} />);
  expect(screen.getByRole('region', { name: 'All agents' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open any agent' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Needs you/ })).toBeNull();
  expect(filter().parentElement).toBe(screen.getByRole('textbox', { name: 'Filter agents' }).parentElement);
  fireEvent.click(filter());
  expect(sheet().getByRole('button', { name: 'All agents' }).getAttribute('aria-pressed')).toBe('true');
  expect(sheet().getByRole('button', { name: 'Working 1' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(filter());
});

it('filters the roster, keeps the selection through an empty result, and returns to all agents', () => {
  const { rerender } = render(<MobileAgentBoard lanes={lanes} renderLane={renderLane} />);
  fireEvent.click(filter());
  fireEvent.click(sheet().getByRole('button', { name: 'Idle 2' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('region', { name: 'Idle' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open idle agent' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open any agent' })).toBeNull();
  rerender(<MobileAgentBoard lanes={lanes.map(lane => lane.key === 'idle' ? { ...lane, count: 0 } : lane)} renderLane={renderLane} />);
  expect(screen.getByText('No agents match your filters.')).toBeTruthy();
  expect(filter().getAttribute('aria-label')).toBe('Filter by status, Idle selected');
  fireEvent.click(filter());
  expect(sheet().getByRole('button', { name: 'Idle 0' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(sheet().getByRole('button', { name: 'All agents' }));
  expect(screen.getByRole('button', { name: 'Open any agent' })).toBeTruthy();
});

it('surfaces an actionable shortcut when a request arrives and handles its resolution', () => {
  const { rerender } = render(<MobileAgentBoard lanes={lanes} renderLane={renderLane} />);
  rerender(<MobileAgentBoard lanes={lanes.map(lane => lane.key === 'blocked' ? { ...lane, count: 1 } : lane)} renderLane={renderLane} />);
  fireEvent.click(screen.getByRole('button', { name: 'Needs you 1' }));
  expect(screen.getByRole('region', { name: 'Needs you' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open blocked agent' })).toBeTruthy();
  expect(document.activeElement).toBe(filter());
  rerender(<MobileAgentBoard lanes={lanes} renderLane={renderLane} />);
  expect(screen.getByText('No agents need you.')).toBeTruthy();
});

it('falls back to all agents when a status is removed and handles an empty roster', () => {
  const content = vi.fn(renderLane);
  const { rerender } = render(<MobileAgentBoard lanes={lanes} renderLane={content} />);
  fireEvent.click(filter());
  fireEvent.click(sheet().getByRole('button', { name: 'Idle 2' }));
  rerender(<MobileAgentBoard lanes={lanes.slice(0, 2)} renderLane={content} />);
  expect(screen.getByRole('region', { name: 'All agents' })).toBeTruthy();
  content.mockClear();
  rerender(<MobileAgentBoard lanes={[]} renderLane={content} />);
  expect(screen.getByText('No agents match your filters.')).toBeTruthy();
  expect(content).not.toHaveBeenCalled();
});
