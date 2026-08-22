import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GitHostPullRequest, WorkspaceStatus } from '@zana-ai/zcc-domain';
import {
  EnvironmentActionsView,
  workspaceFileBasename,
  workspaceFileKindLetter,
  workspaceStatusPresentation
} from '../EnvironmentActions.js';

function status(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    path: '/tmp/wt',
    isGitRepo: true,
    isWorktree: true,
    branchName: 'zcc/task',
    defaultBranch: 'main',
    defaultBranchRelation: 'local-ahead',
    originDefaultBranch: 'main',
    checkout: { kind: 'branch', branchName: 'zcc/task', headSha: 'abc' },
    operation: { kind: 'none' },
    ahead: 1,
    behind: 0,
    dirty: false,
    files: [],
    filesTruncated: false,
    ...overrides
  };
}

function pr(overrides: Partial<GitHostPullRequest> = {}): GitHostPullRequest {
  return {
    number: 12,
    title: 'Ship the worktree',
    state: 'open',
    url: 'https://example.test/pr/12',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'zcc/task',
    updatedAt: null,
    reviewDecision: null,
    mergeStateStatus: null,
    mergeable: null,
    ...overrides
  };
}

const noop = () => {};

function render(props: Partial<Parameters<typeof EnvironmentActionsView>[0]> = {}) {
  return renderToStaticMarkup(h(EnvironmentActionsView, {
    status: null,
    pr: null,
    busy: false,
    message: null,
    transcript: [],
    onCancelProvision: noop,
    onAction: noop,
    ...props
  }));
}

describe('workspaceStatusPresentation', () => {
  it('stays quiet while git status is still loading', () => {
    expect(workspaceStatusPresentation(null)).toEqual({ tone: 'pending', label: null });
  });

  it('names an in-progress worktree create only when provisioning', () => {
    expect(workspaceStatusPresentation(null, true)).toEqual({
      tone: 'pending',
      label: 'Creating worktree'
    });
  });

  it('labels a loaded tree as Clean or Uncommitted', () => {
    expect(workspaceStatusPresentation(status())).toEqual({ tone: 'clean', label: 'Clean' });
    expect(workspaceStatusPresentation(status({ dirty: true }))).toEqual({
      tone: 'dirty',
      label: 'Uncommitted'
    });
  });
});

describe('workspace file helpers', () => {
  it('maps git kinds to source-control letters', () => {
    expect(workspaceFileKindLetter('modified')).toBe('M');
    expect(workspaceFileKindLetter('added')).toBe('A');
    expect(workspaceFileKindLetter('untracked')).toBe('?');
    expect(workspaceFileKindLetter('deleted')).toBe('D');
    expect(workspaceFileKindLetter('renamed')).toBe('R');
  });

  it('takes the basename of a workspace path', () => {
    expect(workspaceFileBasename('src/lib/foo.ts')).toBe('foo.ts');
    expect(workspaceFileBasename('foo.ts')).toBe('foo.ts');
  });
});

describe('EnvironmentActionsView', () => {
  it('does not offer cancel or claim clean while git status is still loading', () => {
    const html = render();
    expect(html).toContain('Workspace');
    expect(html).not.toContain('Clean');
    expect(html).not.toContain('Creating worktree');
    expect(html).not.toContain('environment-cancel-provision');
    expect(html).not.toContain('environment-commit');
    expect(html).not.toContain('environment-create-pr');
  });

  it('offers Cancel only while the worktree is still being created', () => {
    const html = render({
      transcript: [{ type: 'step', key: 'worktree', text: 'Creating worktree…' }]
    });
    expect(html).toContain('Creating worktree');
    expect(html).toContain('Cancel');
    expect(html).toContain('environment-cancel-provision');
    expect(html).toContain('Creating worktree…');
    expect(html).not.toContain('Open pull request');
  });

  it('renders a clean workspace with branch, ahead count, and open-PR — not commit or cancel', () => {
    const html = render({ status: status() });
    expect(html).toContain('Clean');
    expect(html).toContain('is-clean');
    expect(html).toContain('zcc/task');
    expect(html).toContain('↑1');
    expect(html).toContain('Open pull request');
    expect(html).toContain('environment-create-pr');
    expect(html).toContain('agent-monitor-action');
    expect(html).not.toContain('environment-cancel-provision');
    expect(html).not.toContain('environment-commit');
  });

  it('lists dirty files with git letters and offers commit + squash off the default branch', () => {
    const html = render({
      status: status({
        dirty: true,
        files: [
          { path: 'src/lib/foo.ts', kind: 'modified', staged: false, additions: 2, deletions: 1 },
          { path: 'from-e2e.txt', kind: 'untracked', staged: false, additions: null, deletions: null }
        ]
      })
    });
    expect(html).toContain('Uncommitted');
    expect(html).toContain('is-dirty');
    expect(html).toContain('foo.ts');
    expect(html).toContain('>M<');
    expect(html).toContain('from-e2e.txt');
    expect(html).toContain('>?</');
    expect(html).toContain('environment-commit');
    expect(html).toContain('Squash into main');
    expect(html).toContain('Open pull request');
  });

  it('replaces open-PR with a linked PR chip and draft/merge actions', () => {
    const html = render({ status: status(), pr: pr({ isDraft: true, state: 'open' }) });
    expect(html).toContain('PR #12');
    expect(html).toContain('https://example.test/pr/12');
    expect(html).toContain('Draft');
    expect(html).toContain('Mark ready');
    expect(html).toContain('Merge squash');
    expect(html).not.toContain('Open pull request');
    expect(html).not.toContain('environment-create-pr');
  });

  it('caps the file list and notes remaining or truncated changes', () => {
    const files = Array.from({ length: 14 }, (_, i) => ({
      path: `file-${i}.ts`,
      kind: 'modified' as const,
      staged: false,
      additions: 1,
      deletions: 0
    }));
    const html = render({ status: status({ dirty: true, files }) });
    expect(html).toContain('+2 more');
    expect(html).not.toContain('file-12.ts');

    const truncated = render({
      status: status({ dirty: true, files: files.slice(0, 3), filesTruncated: true })
    });
    expect(truncated).toContain('More changes…');
  });
});
