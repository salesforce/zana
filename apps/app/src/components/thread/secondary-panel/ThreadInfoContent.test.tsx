import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { environmentLabel, ThreadInfoContent, ThreadInfoRows } from './ThreadInfoContent.js';
import { EnvironmentActionsView } from '../../EnvironmentActions.js';

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

  it('renders SSH host and status for remote-tool-proxy threads', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd="/Users/me/.zcc/remote-projects/abc"
          branchName="main"
          workspaceStatus={{ dirty: false, files: [] } as never}
          pullRequest={null}
          remoteToolProxy
          sshTarget="limited-pony"
          sshStatus="connected"
          remoteDirectory="/opt/workspace/core-public"
        />
      </MemoryRouter>
    );
    expect(html).toContain('Local agent · remote tools');
    expect(html).toContain('data-testid="thread-info-ssh"');
    expect(html).toContain('limited-pony');
    expect(html).toContain('Connected');
    expect(html).toContain('/opt/workspace/core-public');
    expect(html).not.toContain('data-testid="thread-info-git"');
    expect(html).not.toContain('data-testid="thread-info-branch"');
    expect(html).not.toContain('/Users/me/.zcc/remote-projects/abc');
  });

  it('shows the enrolled machine and start-path source', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd="/opt/workspace/core"
          branchName={null}
          workspaceStatus={null}
          pullRequest={null}
          sshTarget="limited-pony"
          sshStatus="connected"
          remoteDirectory="/opt/workspace/core"
          machineName="Limited Pony"
          startPathSource="Machine"
        />
      </MemoryRouter>
    );
    expect(html).toContain('data-testid="thread-info-machine"');
    expect(html).toContain('Limited Pony');
    expect(html).toContain('data-testid="thread-info-start-path"');
    expect(html).toContain('Machine');
  });

  it('marks an unreachable ControlMaster without swapping in a remote directory', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd="/Users/me/.zcc/remote-projects/abc"
          branchName={null}
          workspaceStatus={null}
          pullRequest={null}
          remoteToolProxy
          sshTarget="limited-pony"
          sshStatus="unreachable"
        />
      </MemoryRouter>
    );
    expect(html).toContain('Unreachable');
    expect(html).toContain('/Users/me/.zcc/remote-projects/abc');
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
    expect(html).toContain('Uncommitted · 1 file');
    expect(html).toContain('data-testid="thread-info-pr"');
    expect(html).toContain('#1');
    expect(html).toContain('data-testid="thread-info-files"');
    expect(html).toContain('thread-info-file-name');
    expect(html).toContain('a.ts');
    expect(html).toContain('thread-info-file-kind');
    expect(html).toContain('>M<');
    expect(html).not.toContain('>Changed files<');
  });

  it('lists untracked files full-width with the kind letter on the right', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd="/tmp/proj"
          branchName="main"
          workspaceStatus={{
            dirty: true,
            filesTruncated: false,
            files: [
              { path: '.zcc/audit.ndjson', kind: 'untracked' },
              { path: '.zcc/events.ndjson', kind: 'untracked' }
            ]
          } as never}
          pullRequest={null}
        />
      </MemoryRouter>
    );
    expect(html).toContain('Uncommitted · 2 files');
    expect(html).toContain('is-untracked');
    expect(html).toContain('audit.ndjson');
    expect(html).toContain('>?<');
    expect(html.indexOf('audit.ndjson')).toBeLessThan(html.indexOf('>?<', html.indexOf('audit.ndjson')));
    expect(html).not.toContain('More changes…');
    expect(html).not.toContain('>Changed files<');
  });

  it('caps a long dirty file list and marks the remainder', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd="/tmp/proj"
          branchName="main"
          workspaceStatus={{
            dirty: true,
            filesTruncated: true,
            files: Array.from({ length: 3 }, (_, i) => ({
              path: `src/file-${i}.ts`,
              kind: 'modified'
            }))
          } as never}
          pullRequest={null}
        />
      </MemoryRouter>
    );
    expect(html).toContain('Uncommitted · 3+ files');
    expect(html).toContain('file-0.ts');
    expect(html).toContain('More changes…');
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
          branchName="main"
          environmentId={null}
        />
      </MemoryRouter>
    );
    expect(html).toContain('data-testid="thread-info-tab"');
    expect(html).not.toContain('None');
    expect(html).toContain('Local');
    expect(html).toContain('/tmp/proj');
    expect(html).toContain('data-testid="thread-info-branch"');
    expect(html).not.toContain('data-testid="environment-actions"');
    expect(html).toMatch(/data-testid="thread-info-tab"[\s\S]*data-testid="thread-info-storage"/);
  });
});

describe('ThreadInfoContent workspace git', () => {
  it('hosts EnvironmentActions so managed worktrees get commit/PR controls', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoContent
          threadId="t1"
          projectId={null}
          isWorktree
          cwd="/tmp/proj"
          branchName="feat/panel"
          environmentId="env-1"
        />
      </MemoryRouter>
    );
    expect(html).toContain('data-testid="environment-actions"');
    expect(html).not.toContain('data-testid="thread-info-branch"');
  });

  it('keeps workspace git inside the padded info content', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd="/tmp/proj"
          branchName={null}
          workspaceStatus={null}
          pullRequest={null}
          gitHeader={<section className="environment-actions" data-testid="environment-actions" />}
        />
      </MemoryRouter>
    );
    const infoIdx = html.indexOf('data-testid="thread-info-tab"');
    const envIdx = html.indexOf('data-testid="environment-actions"');
    expect(infoIdx).toBeGreaterThan(-1);
    expect(envIdx).toBeGreaterThan(infoIdx);
    expect(html.indexOf('data-testid="thread-info-environment"')).toBeGreaterThan(envIdx);
  });

  it.each([false, true])('shows one git summary and file list with action controls (PR: %s)', (hasPr) => {
    const status = {
      dirty: true,
      branchName: 'feat/panel',
      files: Array.from({ length: 210 }, (_, i) => ({ path: `src/file-${i}.ts`, kind: 'modified' }))
    } as never;
    const pr = hasPr ? { url: 'https://example.com/pr/42', number: 42, state: 'open' } as never : null;
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadInfoRows
          isWorktree={false}
          cwd="/tmp/proj"
          branchName="feat/panel"
          workspaceStatus={status}
          pullRequest={pr}
          model="claude-sonnet-5"
          reasoningLevel="high"
          gitHeader={
            <EnvironmentActionsView
              status={status}
              pr={pr}
              busy={false}
              message={null}
              transcript={[]}
              onCancelProvision={() => {}}
              onAction={() => {}}
            />
          }
        >
          <div data-testid="storage-content" />
        </ThreadInfoRows>
      </MemoryRouter>
    );
    expect(html.match(/>file-0.ts</g)).toHaveLength(1);
    expect(html.match(/\+198 more/g)).toHaveLength(1);
    expect(html.match(/>feat\/panel</g)).toHaveLength(1);
    expect(html.match(/>Uncommitted</g)).toHaveLength(1);
    for (const row of ['branch', 'git', 'files', 'pr']) {
      expect(html).not.toContain(`data-testid="thread-info-${row}"`);
    }
    for (const row of ['environment', 'directory', 'model', 'reasoning']) {
      expect(html).toContain(`data-testid="thread-info-${row}"`);
    }
    expect(html).toContain('data-testid="storage-content"');
    expect(html).toContain('data-testid="environment-commit"');
    if (hasPr) {
      expect(html.match(/href="https:\/\/example.com\/pr\/42"/g)).toHaveLength(1);
      expect(html).toContain('Merge squash');
    } else {
      expect(html).toContain('data-testid="environment-create-pr"');
    }
  });
});
