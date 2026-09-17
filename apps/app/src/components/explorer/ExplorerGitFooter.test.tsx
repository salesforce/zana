/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GitStatus } from '@zana-ai/zcc-domain/product';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExplorerGitFooter } from './ExplorerGitFooter.js';

afterEach(cleanup);

const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  branch: 'main',
  detached: false,
  ahead: 0,
  behind: 0,
  dirty: false,
  ...over
});

describe('ExplorerGitFooter', () => {
  it('shows the branch plus dirty and ahead/behind markers', () => {
    const html = renderToStaticMarkup(
      <ExplorerGitFooter
        gitStatus={status({ branch: 'feature/inbox', ahead: 2, behind: 1, dirty: true })}
        worktreeMenu={false}
        onToggleMenu={() => undefined}
      />
    );
    expect(html).toContain('feature/inbox');
    expect(html).toContain('↑2');
    expect(html).toContain('↓1');
    expect(html).toContain('●');
    expect(html).toContain('data-testid="explorer-git-footer"');
    expect(html).toContain('Working tree has uncommitted changes');
    expect(html).toContain('click to switch worktree / browse branches');
  });

  it('marks a clean tree and the open-menu state', () => {
    const html = renderToStaticMarkup(
      <ExplorerGitFooter
        gitStatus={status({ branch: 'main', dirty: false })}
        worktreeMenu
        onToggleMenu={() => undefined}
      />
    );
    expect(html).toContain('Working tree clean');
    expect(html).toContain('active');
    expect(html).not.toContain('●');
  });

  it('labels a detached HEAD and hides when there is no branch', () => {
    const detached = renderToStaticMarkup(
      <ExplorerGitFooter
        gitStatus={status({ branch: null, detached: true })}
        worktreeMenu={false}
        onToggleMenu={() => undefined}
      />
    );
    expect(detached).toContain('detached');
    expect(
      renderToStaticMarkup(
        <ExplorerGitFooter
          gitStatus={status({ branch: null, detached: false })}
          worktreeMenu={false}
          onToggleMenu={() => undefined}
        />
      )
    ).toBe('');
  });

  it('toggles the shared worktree menu without a checkout action', () => {
    const onToggleMenu = vi.fn();
    render(
      <ExplorerGitFooter
        gitStatus={status({ branch: 'main' })}
        worktreeMenu={false}
        onToggleMenu={onToggleMenu}
        menu={<div role="listbox">menu</div>}
      />
    );
    fireEvent.click(screen.getByTestId('explorer-git-footer'));
    expect(onToggleMenu).toHaveBeenCalledTimes(1);
  });
});

describe('Explorer git footer wiring', () => {
  it('hosts the worktree menu in the footer only and never checks out in place', () => {
    const source = readFileSync(
      join(process.cwd(), 'apps/app/src/views/project/ExplorerView.tsx'),
      'utf8'
    );
    expect(source).toContain('ExplorerGitFooter');
    expect(source).toContain('WorktreeMenu');
    expect(source).toContain('placement="above"');
    expect(source).not.toContain('WorktreeSwitcher');
    expect(source).not.toContain('git.checkout');
    const css = readFileSync(join(process.cwd(), 'apps/app/src/styles/global.css'), 'utf8');
    expect(css).toContain('.explorer-git-footer');
    expect(css).toContain('.explorer-worktree-menu.is-above');
    expect(css).not.toContain('.explorer-worktree-btn');
  });
});
