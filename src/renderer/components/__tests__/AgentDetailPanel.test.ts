import { describe, expect, it } from 'vitest';
import { agentDirectoryFacts } from '../AgentDetailPanel.js';

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
