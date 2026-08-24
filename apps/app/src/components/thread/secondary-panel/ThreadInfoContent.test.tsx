import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { environmentLabel, ThreadInfoContent, ThreadInfoRows } from './ThreadInfoContent.js';

describe('ThreadInfoRows', () => {
  it('renders Local environment and a copyable directory without a parent control', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd="/Users/me/project"
          branchName={null}
          workspaceStatus={null}
          pullRequest={null}
        />
      </MemoryRouter>
    );
    expect(html).not.toContain('data-testid="thread-info-parent"');
    expect(html).not.toContain('Assign parent thread');
    expect(html).not.toContain('data-testid="thread-info-forks"');
    expect(html).toContain('data-testid="thread-info-environment"');
    expect(html).toContain('Local');
    expect(html).toContain('data-testid="thread-info-directory"');
    expect(html).toContain('/Users/me/project');
    expect(html).toContain('data-testid="thread-info-copy-directory"');
  });

  it('hides empty git/PR/file rows and labels a worktree checkout', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree
          cwd={null}
          branchName={null}
          workspaceStatus={null}
          pullRequest={null}
        />
      </MemoryRouter>
    );
    expect(html).toContain('This checkout');
    expect(html).not.toContain('data-testid="thread-info-directory"');
    expect(html).not.toContain('data-testid="thread-info-git"');
    expect(html).not.toContain('data-testid="thread-info-pr"');
    expect(html).not.toContain('data-testid="thread-info-files"');
  });

  it('uses This checkout vs Local from isWorktree', () => {
    expect(environmentLabel(false)).toBe('Local');
    expect(environmentLabel(true)).toBe('This checkout');
    expect(environmentLabel(false, 'Staging')).toBe('Staging');
  });

  it('renders git, PR, and changed-file rows when present', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          environmentName="Staging"
          cwd="/tmp/proj"
          branchName="feat/panel"
          workspaceStatus={{
            dirty: true,
            files: [{ path: 'src/a.ts', kind: 'modified' }]
          } as never}
          pullRequest={{ url: 'https://example.com/pr/1', number: 1, state: 'open' } as never}
        />
      </MemoryRouter>
    );
    expect(html).not.toContain('Parent thread');
    expect(html).not.toContain('data-testid="thread-info-forks"');
    expect(html).toContain('Staging');
    expect(html).toContain('feat/panel');
    expect(html).toContain('data-testid="thread-info-git"');
    expect(html).toContain('data-testid="thread-info-pr"');
    expect(html).toContain('#1');
    expect(html).toContain('data-testid="thread-info-files"');
    expect(html).toContain('a.ts');
  });

  it('renders Model and Reasoning with human labels', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd={null}
          branchName={null}
          workspaceStatus={null}
          pullRequest={null}
          model="claude-sonnet-5"
          reasoningLevel="xhigh"
          providerId="claude-code"
        />
      </MemoryRouter>
    );
    expect(html).toContain('data-testid="thread-info-model"');
    expect(html).toContain('Sonnet 5');
    expect(html).toContain('data-testid="thread-info-reasoning"');
    expect(html).toContain('X-High');
    expect(html).not.toContain('xhigh');
  });

  it('renders the Info content shell before async hydration', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoContent
          threadId="t1"
          projectId={null}
          isWorktree={false}
          cwd="/tmp/proj"
          branchName={null}
          environmentId={null}
        />
      </MemoryRouter>
    );
    expect(html).toContain('data-testid="thread-info-tab"');
    expect(html).not.toContain('None');
    expect(html).toContain('Local');
    expect(html).toContain('/tmp/proj');
  });
});
