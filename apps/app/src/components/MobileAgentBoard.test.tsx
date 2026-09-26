// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileAgentBoard, type MobileAgentLane } from './MobileAgentBoard.js';

afterEach(cleanup);
const lanes: MobileAgentLane[] = [
  { key: 'blocked', label: 'Needs you', count: 0, icon: null },
  { key: 'working', label: 'Working', count: 1, icon: null },
  { key: 'idle', label: 'Idle', count: 2, icon: null }
];
const renderLane = (key: string) => <button>Open {key} agent</button>;

it('selects a populated column when agents arrive after the initial load', () => {
  const { rerender } = render(<MobileAgentBoard lanes={lanes.map((lane) => ({ ...lane, count: 0 }))} renderLane={renderLane} />);
  rerender(<MobileAgentBoard lanes={lanes} renderLane={renderLane} />);
  expect(screen.getByRole('tabpanel', { name: 'Working 1' })).toBeTruthy();
});

it('starts with the first populated column and keeps a chosen empty column selected', () => {
  const { rerender } = render(<MobileAgentBoard lanes={lanes} renderLane={renderLane} />);
  expect(screen.getByRole('tab', { name: 'Working 1' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Open working agent' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Idle 2' }));
  expect(screen.queryByRole('button', { name: 'Open working agent' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Open idle agent' })).toBeTruthy();
  rerender(<MobileAgentBoard lanes={lanes.map((lane) => lane.key === 'idle' ? { ...lane, count: 0 } : lane)} renderLane={renderLane} />);
  expect(screen.getByRole('tab', { name: 'Idle 0' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('No agents in this column')).toBeTruthy();
});

it('supports arrow keys, wraparound, Home and End without putting every tab in the tab order', () => {
  render(<MobileAgentBoard lanes={lanes} renderLane={renderLane} />);
  const working = screen.getByRole('tab', { name: 'Working 1' });
  const idle = screen.getByRole('tab', { name: 'Idle 2' });
  const blocked = screen.getByRole('tab', { name: 'Needs you 0' });
  fireEvent.keyDown(working, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(idle);
  fireEvent.keyDown(idle, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(blocked);
  fireEvent.keyDown(blocked, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(idle);
  fireEvent.keyDown(idle, { key: 'Home' });
  expect(document.activeElement).toBe(blocked);
  fireEvent.keyDown(blocked, { key: 'End' });
  expect(document.activeElement).toBe(idle);
  fireEvent.keyDown(idle, { key: 'Tab' });
  expect(idle.tabIndex).toBe(0);
  expect(working.tabIndex).toBe(-1);
  expect(blocked.tabIndex).toBe(-1);
  const panel = screen.getByRole('tabpanel', { name: 'Idle 2' });
  expect(idle.getAttribute('aria-controls')).toBe(panel.id);
});

it('falls back to a populated column when the selected column is removed', () => {
  const { rerender } = render(<MobileAgentBoard lanes={lanes} renderLane={renderLane} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Idle 2' }));
  rerender(<MobileAgentBoard lanes={lanes.slice(0, 2)} renderLane={renderLane} />);
  expect(screen.getByRole('tabpanel', { name: 'Working 1' })).toBeTruthy();
});

it('handles empty columns and no available lanes without rendering phantom cards', () => {
  const content = vi.fn(renderLane);
  const { rerender } = render(<MobileAgentBoard lanes={lanes.map((lane) => ({ ...lane, count: 0 }))} renderLane={content} />);
  expect(screen.getByRole('tab', { name: 'Needs you 0' }).getAttribute('aria-selected')).toBe('true');
  expect(content).not.toHaveBeenCalled();
  rerender(<MobileAgentBoard lanes={[]} renderLane={content} />);
  expect(screen.queryByRole('tabpanel')).toBeNull();
});
