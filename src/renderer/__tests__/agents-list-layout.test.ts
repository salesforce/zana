import { describe, expect, it } from 'vitest';
import type { AgentsBoardView } from '../store';
import { shouldHideListPane } from '../util/agentsLayout';

describe('Agents List layout', () => {
  it('gives the global List monitor the full content area', () => {
    expect(shouldHideListPane('agents', 'list', false)).toBe(true);
  });

  it.each<AgentsBoardView>(['board', 'flow'])('keeps the quick-agent list beside the %s view', (boardView) => {
    expect(shouldHideListPane('agents', boardView, false)).toBe(false);
  });

  it('preserves the existing project-workspace behavior', () => {
    expect(shouldHideListPane('projects', 'board', true)).toBe(true);
    expect(shouldHideListPane('inbox', 'list', true)).toBe(false);
  });
});
