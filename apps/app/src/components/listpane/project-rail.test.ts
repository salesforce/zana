import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { isProjectRailExpanded, pinFavoriteProjectsFirst } from './project-rail.js';

function project(id: string, favorite = false): Project {
  return {
    id,
    name: id,
    path: `/${id}`,
    createdAt: 1,
    lastActiveAt: 1,
    favorite
  } as Project;
}

describe('pinFavoriteProjectsFirst', () => {
  it('lifts starred projects while preserving relative order', () => {
    expect(
      pinFavoriteProjectsFirst([
        project('a'),
        project('b', true),
        project('c'),
        project('d', true)
      ]).map((entry) => entry.id)
    ).toEqual(['b', 'd', 'a', 'c']);
  });

  it('returns the original order when nothing is starred', () => {
    expect(pinFavoriteProjectsFirst([project('a'), project('c')]).map((entry) => entry.id))
      .toEqual(['a', 'c']);
  });
});

describe('isProjectRailExpanded', () => {
  it('auto-expands projects that have nested sessions unless the user toggled', () => {
    expect(isProjectRailExpanded(undefined, true)).toBe(true);
    expect(isProjectRailExpanded(undefined, false)).toBe(false);
    expect(isProjectRailExpanded(false, true)).toBe(false);
    expect(isProjectRailExpanded(true, false)).toBe(true);
  });
});
