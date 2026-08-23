import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkspaceFileStatus } from '@zana-ai/zcc-domain';
import { ThreadConversationToc } from './ThreadConversationToc.js';
import {
  ThreadWorkspaceBanner,
  ThreadWorkspaceBannerView,
  workspaceFileCountLabel,
  workspaceFileStatText
} from './ThreadWorkspaceBanner.js';
import { hunkForPath } from './thread-diff.js';
import { ExpandableTimelineRow } from './timeline/ExpandableTimelineRow.js';
import { ThreadWorkflowChips, ThreadPromptModeChip, ThreadStatusBadge } from './timeline/ThreadBanners.js';

describe('thread TOC', () => {
  it('renders outline items that jump by id', () => {
    const html = renderToStaticMarkup(
      <ThreadConversationToc
        items={[
          { id: 'u1', role: 'user', preview: 'Read README.md' },
          { id: 'a1', role: 'assistant', preview: 'Done' },
          { id: 'u2', role: 'user', preview: 'Follow up' }
        ]}
        onJump={() => undefined}
      />
    );
    expect(html).toContain('thread-toc');
    expect(html).toContain('Outline');
    expect(html).toContain('Read README.md');
    expect(html).toContain('Done');
  });

  it('hides an empty or short outline so it cannot repeat a two-bubble thread', () => {
    expect(renderToStaticMarkup(
      <ThreadConversationToc items={[]} onJump={() => undefined} />
    )).toBe('');
    expect(renderToStaticMarkup(
      <ThreadConversationToc
        items={[
          { id: 'u1', role: 'user', preview: 'hello' },
          { id: 'a1', role: 'assistant', preview: 'Hello! What can I help you with today?' }
        ]}
        onJump={() => undefined}
      />
    )).toBe('');
  });

  it('falls back to role labels when preview is empty', () => {
    expect(renderToStaticMarkup(
      <ThreadConversationToc
        items={[
          { id: 'u1', role: 'user', preview: '' },
          { id: 'a1', role: 'assistant', preview: 'Done' },
          { id: 'u2', role: 'user', preview: 'Next' }
        ]}
        onJump={() => undefined}
      />
    )).toContain('User');
  });
});

function file(overrides: Partial<WorkspaceFileStatus> & Pick<WorkspaceFileStatus, 'path'>): WorkspaceFileStatus {
  return {
    kind: 'modified',
    staged: false,
    additions: null,
    deletions: null,
    ...overrides
  };
}

describe('workspace banner', () => {
  it('renders nothing until environment status arrives', () => {
    expect(renderToStaticMarkup(
      <ThreadWorkspaceBanner environmentId={null} onOpenDiff={() => undefined} />
    )).toBe('');
  });

  it('collapses dirty files into a count plus Review, listing basenames inside', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkspaceBannerView
        files={[
          file({ path: 'apps/app/src/components/AgentBoard.tsx', additions: 84, deletions: 22 }),
          file({ path: 'apps/app/src/styles/global.css', kind: 'added', additions: 52, deletions: 0 }),
          file({ path: 'gone.ts', kind: 'deleted', additions: 0, deletions: 9 }),
          file({ path: 'notes.md', kind: 'modified' }),
          file({ path: 'README.md', kind: 'untracked' })
        ]}
        onOpenDiff={() => undefined}
      />
    );
    expect(html).toContain('data-testid="thread-workspace-banner"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('5 Files');
    expect(html).toContain('data-testid="thread-workspace-review"');
    expect(html).toContain('Review');
    expect(html).toContain('AgentBoard.tsx');
    expect(html).toContain('global.css');
    expect(html).toContain('gone.ts');
    expect(html).toContain('notes.md');
    expect(html).toContain('README.md');
    expect(html).toContain('+84');
    expect(html).toContain('-22');
    expect(html).toContain('+52');
    expect(html).toContain('-9');
    expect(html).toContain('title="apps/app/src/components/AgentBoard.tsx"');
    expect(html).not.toContain('Workspace changed');
    expect(html).not.toContain('View all');
  });

  it('marks a truncated list as a lower bound and keeps the more-changes hint', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkspaceBannerView
        files={[file({ path: 'src/a.ts' })]}
        filesTruncated
        onOpenDiff={() => undefined}
      />
    );
    expect(html).toContain('1+ Files');
    expect(html).toContain('More changes…');
  });

  it('renders nothing when there are no files', () => {
    expect(renderToStaticMarkup(
      <ThreadWorkspaceBannerView files={[]} onOpenDiff={() => undefined} />
    )).toBe('');
  });
});

describe('workspace file presentation', () => {
  it('pluralizes the collapsed count and marks truncated totals', () => {
    expect(workspaceFileCountLabel(1)).toBe('1 File');
    expect(workspaceFileCountLabel(27)).toBe('27 Files');
    expect(workspaceFileCountLabel(8, true)).toBe('8+ Files');
  });

  it('prefers diff stats and falls back to the git kind letter', () => {
    expect(workspaceFileStatText(file({
      path: 'a.ts',
      additions: 66,
      deletions: 24
    }))).toBe('+66 -24');
    expect(workspaceFileStatText(file({
      path: 'b.ts',
      kind: 'added',
      additions: 12,
      deletions: 0
    }))).toBe('+12');
    expect(workspaceFileStatText(file({
      path: 'c.ts',
      kind: 'deleted',
      additions: 0,
      deletions: 0
    }))).toBe('D');
    expect(workspaceFileStatText(file({ path: 'd.ts', kind: 'modified' }))).toBe('M');
  });
});

describe('diff hunk helper', () => {
  it('returns the matching git block for a path', () => {
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n+one\ndiff --git a/README.md b/README.md\n+two\n';
    expect(hunkForPath(diff, 'README.md').modified).toContain('+two');
    expect(hunkForPath(diff, '').modified).toBe(diff);
    expect(hunkForPath(diff, 'missing.ts').modified).toBe(diff);
  });
});

describe('expandable row and chips', () => {
  it('renders a non-expandable header and workflow chips', () => {
    expect(renderToStaticMarkup(
      <ExpandableTimelineRow summary="Explored" testId="thread-work-row" dim />
    )).toContain('Explored');
    expect(renderToStaticMarkup(
      <ExpandableTimelineRow summary="Cmd" expandable open>
        <pre>out</pre>
      </ExpandableTimelineRow>
    )).toContain('out');
    expect(renderToStaticMarkup(
      <ThreadPromptModeChip mode={{ mode: 'plan', prompt: 'Write a plan' }} />
    )).toContain('plan');
    expect(renderToStaticMarkup(
      <ThreadWorkflowChips workflows={[{
        id: 'wf',
        threadId: 't',
        turnId: 'turn',
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        startedAt: 1,
        createdAt: 1,
        kind: 'work',
        workKind: 'workflow',
        status: 'pending',
        itemId: 'i',
        taskType: 'local_workflow',
        workflowName: 'Build',
        description: 'Ship',
        model: null,
        taskStatus: 'running',
        workflow: null,
        usage: null,
        summary: null,
        error: null,
        completedAt: null
      }]} />
    )).toContain('Build');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="active" />)).toContain('Active');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="active" />)).toContain('thread-status-badge is-working');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="idle" />)).toContain('is-idle');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="error" />)).toContain('is-blocked');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="error" />)).toContain('Error');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="" />)).toBe('');
  });
});
