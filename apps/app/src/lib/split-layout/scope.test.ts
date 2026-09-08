import { describe, expect, it } from 'vitest';
import { GLOBAL_SPLIT_SCOPE_KEY, projectSplitScopeKey, splitLayoutScopeKey } from './scope.js';

describe('splitLayoutScopeKey', () => {
  it('uses a dedicated project window over the route', () => {
    expect(
      splitLayoutScopeKey({
        scopedProjectId: 'p1',
        nav: 'home',
        focusedProjectId: null
      })
    ).toBe(projectSplitScopeKey('p1'));
  });

  it('uses the project rail while a project workspace is focused', () => {
    expect(
      splitLayoutScopeKey({
        scopedProjectId: null,
        nav: 'projects',
        focusedProjectId: 'p2'
      })
    ).toBe(projectSplitScopeKey('p2'));
    expect(
      splitLayoutScopeKey({
        scopedProjectId: null,
        nav: 'inbox',
        focusedProjectId: 'p2'
      })
    ).toBe(projectSplitScopeKey('p2'));
  });

  it('stays global on Home, Agents, Scheduler, and Extensions even if a project is selected', () => {
    expect(
      splitLayoutScopeKey({
        scopedProjectId: null,
        nav: 'home',
        focusedProjectId: 'p2'
      })
    ).toBe(GLOBAL_SPLIT_SCOPE_KEY);
    expect(
      splitLayoutScopeKey({
        scopedProjectId: null,
        nav: 'agents',
        focusedProjectId: 'p2'
      })
    ).toBe(GLOBAL_SPLIT_SCOPE_KEY);
    expect(
      splitLayoutScopeKey({
        scopedProjectId: null,
        nav: 'scheduler',
        focusedProjectId: 'p2'
      })
    ).toBe(GLOBAL_SPLIT_SCOPE_KEY);
    expect(
      splitLayoutScopeKey({
        scopedProjectId: null,
        nav: 'extensions',
        focusedProjectId: 'p2'
      })
    ).toBe(GLOBAL_SPLIT_SCOPE_KEY);
  });

  it('stays global with no focused project', () => {
    expect(
      splitLayoutScopeKey({
        scopedProjectId: null,
        nav: 'projects',
        focusedProjectId: null
      })
    ).toBe(GLOBAL_SPLIT_SCOPE_KEY);
  });
});
