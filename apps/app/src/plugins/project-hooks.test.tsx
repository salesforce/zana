// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PROJECT_COLORS } from '@zana-ai/zcc-domain/project-colors';
import { useProjects } from './project-hooks.js';
import { useData } from '../store.js';

vi.mock('../store.js', async () => {
  const { create } = await import('zustand');
  return { useData: create(() => ({ projects: [] as unknown[], configLoaded: false })) };
});

const set = (patch: Record<string, unknown>) => act(() => useData.setState(patch as never));
beforeEach(() => useData.setState({ projects: [], configLoaded: false } as never));
afterEach(cleanup);

it('reports loading until the first projects hydrate, independent of threads', () => {
  const { result } = renderHook(useProjects);
  expect(result.current).toEqual({ status: 'loading', projects: [] });
  set({ configLoaded: true, projects: [{ id: 'p', name: 'P', path: '/private' }] });
  expect(result.current.status).toBe('ready');
});

it('maps the bounded fields and drops paths, invalid icon and invalid color', () => {
  set({ configLoaded: true, projects: [
    { id: 'a', name: 'A', path: '/x', hostId: 'h', icon: 'Cloud', color: PROJECT_COLORS[2], quickAgent: true },
    { id: 'b', name: 'B', path: '/y', icon: 'Nope', color: '#123456', quickAgent: false },
    { id: 'c', name: 'C', path: '/z' }
  ] });
  const { result } = renderHook(useProjects);
  expect(result.current.projects).toEqual([
    { id: 'a', name: 'A', icon: 'Cloud', color: PROJECT_COLORS[2], quickAgent: true },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' }
  ]);
});

it('updates when a project is recolored in the store', () => {
  set({ configLoaded: true, projects: [{ id: 'a', name: 'A', path: '/x', color: PROJECT_COLORS[0] }] });
  const { result } = renderHook(useProjects);
  expect(result.current.projects[0].color).toBe(PROJECT_COLORS[0]);
  set({ projects: [{ id: 'a', name: 'A', path: '/x', color: PROJECT_COLORS[3] }] });
  expect(result.current.projects[0].color).toBe(PROJECT_COLORS[3]);
  set({ projects: [{ id: 'a', name: 'A', path: '/x', color: 'bad' }] });
  expect(result.current.projects[0]).not.toHaveProperty('color');
});
