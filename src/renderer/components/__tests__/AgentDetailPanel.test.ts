import { describe, expect, it } from 'vitest';
import { agentDirectoryFacts, shouldShowTranscriptInsights } from '../AgentDetailPanel.js';

describe('agentDirectoryFacts', () => {
  it('shows original project and checkout paths for a worktree session', () => {
    expect(agentDirectoryFacts({
      cwd: '/home/me/zcc-worktrees/proj/task',
      worktree: { path: '/home/me/zcc-worktrees/proj/task', branch: 'zcc/task' }
    }, '/src/proj')).toEqual([
      { label: 'Project directory', path: '/src/proj' },
      { label: 'Worktree directory', path: '/home/me/zcc-worktrees/proj/task' }
    ]);
  });

  it('keeps one generic directory for a normal session', () => {
    expect(agentDirectoryFacts({ cwd: '/src/proj' }, '/src/proj')).toEqual([
      { label: 'Directory', path: '/src/proj' }
    ]);
  });
});

describe('shouldShowTranscriptInsights', () => {
  it.each(['claude', 'opencode', 'codex'] as const)(
    'shows insights for %s transcript capability',
    (profile) => {
      expect(shouldShowTranscriptInsights(profile, null)).toBe(true);
    }
  );

  it.each(['cursor', 'pi', 'shell'] as const)(
    'does not show a blank transcript scaffold for %s without stats',
    (profile) => {
      expect(shouldShowTranscriptInsights(profile, null)).toBe(false);
    }
  );

  it('shows supplied normalized stats even when capability is unavailable', () => {
    expect(shouldShowTranscriptInsights('shell', { files: [], queue: [], model: 'host-provided' })).toBe(true);
  });
});
