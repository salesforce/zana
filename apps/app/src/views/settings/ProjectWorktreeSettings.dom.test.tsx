/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { ProjectWorktreeSettings } from './ProjectSettingsView.js';

const isRepo = vi.fn();
const get = vi.fn();
const set = vi.fn();

function project(patch: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Project',
    path: '/tmp/project',
    createdAt: 0,
    lastActiveAt: 0,
    ...patch
  };
}

function renderSettings(input: Project) {
  Object.defineProperty(window, 'cc', {
    configurable: true,
    value: {
      git: { isRepo },
      projectSettings: { get, set, onChanged: vi.fn(() => () => {}) }
    }
  });
  return render(<ProjectWorktreeSettings project={input} onSaved={vi.fn()} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as { cc?: unknown }).cc;
});

describe('ProjectWorktreeSettings eligibility', () => {
  it.each([
    ['remote project', project({ remote: { host: 'devbox' } })],
    ['Quick Agent project', project({ quickAgent: true })],
    ['non-Git local project', project()]
  ])('disables worktree isolation for a $0', async (_label, input) => {
    isRepo.mockResolvedValue(input.remote || input.quickAgent ? true : false);
    get.mockResolvedValue({ worktreeIsolation: true });
    const view = renderSettings(input);

    await waitFor(() => expect((view.getByLabelText('Worktree isolation') as HTMLButtonElement).disabled).toBe(true));
    expect(view.getByLabelText('Worktree isolation').textContent).toContain('Project does not support worktrees');
    expect(view.getByText('Worktrees need a local Git project. Squads here run in the project folder.')).not.toBeNull();
    expect(set).not.toHaveBeenCalled();
    if (input.remote || input.quickAgent) expect(isRepo).not.toHaveBeenCalled();
  });

  it('keeps worktree isolation enabled for an eligible local Git project', async () => {
    isRepo.mockResolvedValue(true);
    get.mockResolvedValue({ worktreeIsolation: false });
    const view = renderSettings(project());

    await waitFor(() => expect((view.getByLabelText('Worktree isolation') as HTMLButtonElement).disabled).toBe(false));
    expect(view.queryByText('Worktrees need a local Git project. Squads here run in the project folder.')).toBeNull();
    expect(isRepo).toHaveBeenCalledWith('/tmp/project');
  });
});
