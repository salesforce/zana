/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GitBranch, Project, Worktree } from '@zana-ai/zcc-domain/product';
import { WorktreeMenu } from './WorktreeSwitcher.js';

afterEach(cleanup);

const project = { id: 'p1', name: 'Alpha', path: '/tmp/alpha' } as Project;
const main: Worktree = {
  path: '/tmp/alpha',
  head: 'abc',
  branch: 'main',
  detached: false,
  bare: false,
  isMain: true
};
const feature: Worktree = {
  path: '/tmp/alpha-feature',
  head: 'def',
  branch: 'feature',
  detached: false,
  bare: false,
  isMain: false
};
const branches: GitBranch[] = [
  { name: 'main', current: true },
  { name: 'feature', current: false },
  { name: 'orphan', current: false }
];
const worktreeByBranch = new Map<string, Worktree>([
  ['main', main],
  ['feature', feature]
]);

function menuProps(over: Partial<Parameters<typeof WorktreeMenu>[0]> = {}) {
  return {
    project,
    worktrees: [main, feature],
    branches,
    viewRoot: '/tmp/alpha',
    worktreeByBranch,
    onSelectWorktree: vi.fn(),
    onRemoveWorktree: vi.fn(),
    ...over
  };
}

describe('WorktreeMenu', () => {
  it('lists worktrees and switches to a branch that has a checkout', () => {
    const onSelectWorktree = vi.fn();
    render(<WorktreeMenu {...menuProps({ onSelectWorktree })} />);
    expect(screen.getByRole('listbox').className).toContain('explorer-worktree-menu');
    fireEvent.click(screen.getAllByTitle('/tmp/alpha-feature')[0]);
    expect(onSelectWorktree).toHaveBeenCalledWith('/tmp/alpha-feature');
  });

  it('disables a branch with no worktree and opens upward from the footer', () => {
    const onSelectWorktree = vi.fn();
    const html = renderToStaticMarkup(
      <WorktreeMenu {...menuProps({ onSelectWorktree, placement: 'above' })} />
    );
    expect(html).toContain('is-above');
    expect(html).toContain('no worktree');
    render(<WorktreeMenu {...menuProps({ onSelectWorktree })} />);
    const orphan = screen.getByRole('option', { name: /orphan/ });
    expect(orphan).toHaveProperty('disabled', true);
    fireEvent.click(orphan);
    expect(onSelectWorktree).not.toHaveBeenCalled();
  });

  it('asks to remove a linked worktree from the row', () => {
    const onRemoveWorktree = vi.fn();
    render(<WorktreeMenu {...menuProps({ onRemoveWorktree })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove worktree feature' }));
    expect(onRemoveWorktree).toHaveBeenCalledWith(feature);
  });
});
