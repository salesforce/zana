import { describe, expect, it } from 'vitest';
import { SETTINGS_SUBSECTIONS } from '../SettingsPanel.js';

describe('Settings subsection navigation', () => {
  it('lists Git worktrees under global Agent settings', () => {
    expect(SETTINGS_SUBSECTIONS.agents).toContainEqual({
      id: 'git-worktrees',
      label: 'Git worktrees'
    });
  });
});
