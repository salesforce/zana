// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PROJECT_COLORS } from '@zana-ai/zcc-domain/project-colors';
import { ProjectAppearanceMenuHost, useProjectAppearanceMenu, useProjectAppearanceMenuStore } from './project-appearance-menu.js';
import { useData } from '../store.js';

vi.mock('../store.js', async () => {
  const { create } = await import('zustand');
  return { useData: create(() => ({ projects: [] as unknown[], updateProject: vi.fn() })) };
});

const updateProject = vi.fn();
const projects = [
  { id: 'a', name: 'Alpha', path: '/a', icon: 'Cloud' },
  { id: 'q', name: 'Scratch', path: '/q', quickAgent: true }
];
const hook = () => renderHook(useProjectAppearanceMenu).result.current;
const open = (id: string) => { const menu = hook(); act(() => menu.open(id, { x: 10, y: 20 })); };

beforeEach(() => {
  updateProject.mockReset();
  useData.setState({ projects, updateProject } as never);
  useProjectAppearanceMenuStore.getState().close();
});
afterEach(cleanup);

it('renders nothing until opened, then shows icon and color editors', () => {
  render(<ProjectAppearanceMenuHost />);
  expect(document.querySelector('.project-menu')).toBeNull();
  open('a');
  expect(screen.getByText('Icon')).toBeTruthy();
  expect(document.querySelector('.project-menu-swatches')).toBeTruthy();
  expect(document.querySelectorAll('.project-swatch')).toHaveLength(PROJECT_COLORS.length + 1);
});

it('picks an icon and closes', () => {
  render(<ProjectAppearanceMenuHost />);
  open('a');
  fireEvent.click(screen.getByRole('button', { name: 'Use Rocket icon' }));
  expect(updateProject).toHaveBeenCalledWith('a', { icon: 'Rocket' });
  expect(document.querySelector('.project-menu')).toBeNull();
});

it('picks a color and resets it', () => {
  render(<ProjectAppearanceMenuHost />);
  open('a');
  fireEvent.click(screen.getByRole('button', { name: `Set color ${PROJECT_COLORS[1]}` }));
  expect(updateProject).toHaveBeenLastCalledWith('a', { color: PROJECT_COLORS[1] });
  expect(document.querySelector('.project-menu')).toBeNull();
  open('a');
  fireEvent.click(screen.getByRole('button', { name: 'Reset color' }));
  expect(updateProject).toHaveBeenLastCalledWith('a', { color: undefined });
});

it('dismisses on Escape and on outside mousedown, but not on inside mousedown', () => {
  render(<ProjectAppearanceMenuHost />);
  open('a');
  fireEvent.mouseDown(screen.getByText('Color'));
  expect(document.querySelector('.project-menu')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(document.querySelector('.project-menu')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(document.querySelector('.project-menu')).toBeNull();
  open('a');
  fireEvent.mouseDown(document.body);
  expect(document.querySelector('.project-menu')).toBeNull();
  expect(updateProject).not.toHaveBeenCalled();
});

it('ignores unknown project ids and invalid positions', () => {
  render(<ProjectAppearanceMenuHost />);
  open('missing');
  act(() => useProjectAppearanceMenuStore.getState().open('a', { x: Number.NaN, y: 1 }));
  act(() => useProjectAppearanceMenuStore.getState().open(undefined as never, { x: 1, y: 1 }));
  expect(document.querySelector('.project-menu')).toBeNull();
});

it('hides the Icon section for scratch workspace projects', () => {
  render(<ProjectAppearanceMenuHost />);
  open('q');
  expect(screen.queryByText('Icon')).toBeNull();
  expect(screen.getByText('Color')).toBeTruthy();
});

it('closes if the project is removed while open', () => {
  render(<ProjectAppearanceMenuHost />);
  open('a');
  act(() => useData.setState({ projects: [] } as never));
  expect(document.querySelector('.project-menu')).toBeNull();
  expect(useProjectAppearanceMenuStore.getState().target).toBeNull();
});
