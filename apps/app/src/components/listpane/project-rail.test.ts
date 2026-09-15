import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { isProjectRailExpanded, pinDefaultProjectFirst, pinFavoriteProjectsFirst } from './project-rail.js';

function project(id: string, favorite = false, extras: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    path: `/${id}`,
    createdAt: 1,
    lastActiveAt: 1,
    favorite,
    ...extras
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

describe('pinDefaultProjectFirst', () => {
  it('lifts Default Project ahead of starred rows while preserving the rest', () => {
    const scratch = project('scratch', false, { name: 'zcc-workspace', quickAgent: true });
    expect(
      pinDefaultProjectFirst(pinFavoriteProjectsFirst([
        project('a'),
        project('b', true),
        scratch,
        project('d', true)
      ])).map((entry) => entry.id)
    ).toEqual(['scratch', 'b', 'd', 'a']);
  });

  it('still pins a starred Default Project first', () => {
    const scratch = project('scratch', true, { name: 'zcc-workspace', quickAgent: true });
    expect(
      pinDefaultProjectFirst(pinFavoriteProjectsFirst([
        project('b', true),
        scratch,
        project('a')
      ])).map((entry) => entry.id)
    ).toEqual(['scratch', 'b', 'a']);
  });

  it('returns the original order when Default Project is absent', () => {
    expect(pinDefaultProjectFirst([project('a'), project('c')]).map((entry) => entry.id))
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
