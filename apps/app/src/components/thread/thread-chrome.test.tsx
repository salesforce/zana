import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkspaceFileStatus } from '@zana-ai/zcc-domain';
import {
  ThreadWorkspaceBanner,
  ThreadWorkspaceBannerView,
  workspaceFileCountLabel,
  workspaceFileStatText
} from './ThreadWorkspaceBanner.js';
import {
  hunkForPath,
  diffPanelPhase,
  changeKindLetter,
  DIFF_AUTO_COLLAPSE_FILE_THRESHOLD,
  DIFF_SELECTION_OPTIONS,
  areAllDiffCardsCollapsed,
  collapseAllDiffCards,
  diffCardHeaderStats,
  diffTargetForSelection,
  filterDiffFiles,
  formatDiffCardLabel,
  formatDiffFilesLabel,
  isDiffCardInitiallyCollapsed,
  resolveDiffCardBodyKind,
  resolveDiffCardCollapsed,
  pairSplitDiffRows,
  parseUnifiedPatch,
  unmodifiedLineCountBefore,
  unmodifiedLineCountBetween,
  shouldAutoLoadPatch,
  summarizeDiffFiles
} from './thread-diff.js';
import { ThreadDiffCardBody, ThreadDiffSkeleton } from './ThreadDiffPanel.js';
import { ThreadDiffHunkView } from './ThreadDiffHunkView.js';
import { ExpandableTimelineRow } from './timeline/ExpandableTimelineRow.js';
import {
  ThreadDetailHeading,
  ThreadWorkflowChips,
  ThreadPromptModeChip,
  ThreadStatusBadge
} from './timeline/ThreadBanners.js';

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

  it('parses unified hunks and omits unmodified gaps the way BB does', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -88,4 +88,5 @@',
      ' context',
      '-old',
      '+new',
      ' keep',
      '@@ -200,2 +201,2 @@',
      ' later',
      '-gone',
      '+here'
    ].join('\n');
    const hunks = parseUnifiedPatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.oldStart).toBe(88);
    expect(unmodifiedLineCountBefore(hunks[0]!)).toBe(87);
    expect(unmodifiedLineCountBetween(hunks[0]!, hunks[1]!)).toBe(108);
    expect(hunks[0]!.lines.map((line) => line.kind)).toEqual(['context', 'del', 'add', 'context']);
    expect(unmodifiedLineCountBefore({
      header: '@@ -0,0 +1,2 @@',
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: 2,
      lines: []
    })).toBe(0);
    expect(parseUnifiedPatch('@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n')[0]!.oldCount).toBe(1);
    expect(pairSplitDiffRows([
      { kind: 'del', text: 'a', oldNo: 1, newNo: null },
      { kind: 'del', text: 'b', oldNo: 2, newNo: null },
      { kind: 'add', text: 'c', oldNo: null, newNo: 1 }
    ])).toHaveLength(2);
    const html = renderToStaticMarkup(
      <ThreadDiffHunkView path="src/a.ts" patch={patch} />
    );
    expect(html).toContain('87 unmodified lines');
    expect(html).toContain('thread-diff-hunk-line is-add');
    expect(html).toContain('thread-diff-hunk-line is-del');
    expect(renderToStaticMarkup(
      <ThreadDiffHunkView path="src/a.ts" patch={patch} splitView />
    )).toContain('is-split');
    expect(renderToStaticMarkup(
      <ThreadDiffHunkView path="src/a.ts" patch={'diff --git a/src/a.ts b/src/a.ts\n'} />
    )).toContain('No renderable diff');
  });

  it('shows an error instead of loading when the diff request fails', () => {
    expect(diffPanelPhase('git output exceeded the buffer cap', false)).toBe('error');
    expect(diffPanelPhase(null, false)).toBe('loading');
    expect(diffPanelPhase(null, true)).toBe('ready');
  });

  it('loads a file TOC and stacked per-file cards instead of one workspace diff blob', () => {
    const source = readFileSync(fileURLToPath(new URL('./ThreadDiffPanel.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('diffFiles');
    expect(source).toContain('diffPatch');
    expect(source).toContain('thread-diff-cards');
    expect(source).toContain('ThreadDiffHunkView');
    expect(source).not.toContain('from \'../DiffViewer.js\'');
    expect(source).toContain('Expand all files');
    expect(source).toContain('Search files');
    expect(source).toContain('Wrap diff lines');
    expect(source).toContain('Split diff view');
    expect(source).toContain('title={label}');
    expect(source).toContain('DiffToolbarButton');
    expect(source).toContain('Diff scope');
    expect(source).not.toContain('Show {hiddenCount} more');
    expect(source).not.toMatch(/environments\.diff\(/);
    const css = readFileSync(fileURLToPath(new URL('../../styles/global.css', import.meta.url)), 'utf8');
    expect(css).toContain('.thread-diff-card {');
    expect(css).toContain('.thread-diff-cards {');
    expect(css).toContain('.thread-diff-skeleton');
    expect(css).toContain('.thread-diff-skel');
    expect(css).not.toContain('.thread-diff-list-pane');
    expect(css).not.toContain('.thread-diff-list-search');
    expect(changeKindLetter('added')).toBe('A');
    expect(changeKindLetter('type_changed')).toBe('T');
  });

  it('collapses many-file diffs and stacks cards the way BB does', () => {
    const many = Array.from({ length: DIFF_AUTO_COLLAPSE_FILE_THRESHOLD + 1 }, (_, index) => ({
      path: `src/f${index}.ts`,
      changeKind: 'modified' as const,
      additions: 2,
      deletions: 1
    }));
    expect(isDiffCardInitiallyCollapsed(many[0]!, many.length)).toBe(true);
    expect(isDiffCardInitiallyCollapsed({ changeKind: 'deleted' }, 3)).toBe(true);
    expect(isDiffCardInitiallyCollapsed({ changeKind: 'modified' }, 3)).toBe(false);
    expect(resolveDiffCardCollapsed(true, many[0]!, many.length)).toBe(true);
    expect(resolveDiffCardCollapsed(false, many[0]!, many.length)).toBe(false);
    expect(areAllDiffCardsCollapsed(many, {})).toBe(true);
    expect(areAllDiffCardsCollapsed(many, { 'src/f0.ts': false })).toBe(false);
    expect(Object.values(collapseAllDiffCards(many, true)).every(Boolean)).toBe(true);
    expect(filterDiffFiles(many, 'f0.ts').map((file) => file.path)).toEqual(['src/f0.ts']);
    expect(filterDiffFiles(many, '  ').map((file) => file.path)).toHaveLength(many.length);
    expect(filterDiffFiles([
      { path: 'src/new.ts', previousPath: 'src/old.ts' }
    ], 'old.ts').map((file) => file.path)).toEqual(['src/new.ts']);
    expect(diffTargetForSelection('uncommitted')).toEqual({ type: 'uncommitted' });
    expect(diffTargetForSelection('all')).toBeUndefined();
    expect(DIFF_SELECTION_OPTIONS.map((option) => option.label)).toEqual([
      'Uncommitted changes',
      'All changes'
    ]);
    expect(summarizeDiffFiles(many)).toEqual({
      filesCount: DIFF_AUTO_COLLAPSE_FILE_THRESHOLD + 1,
      insertions: 22,
      deletions: 11
    });
    expect(formatDiffFilesLabel(400, true)).toBe('400+ files');
    expect(formatDiffFilesLabel(1)).toBe('1 file');
    expect(formatDiffFilesLabel(1, true)).toBe('1+ file');
    expect(formatDiffCardLabel({
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      changeKind: 'copied'
    })).toBe('src/old.ts -> src/new.ts');
    expect(areAllDiffCardsCollapsed([], {})).toBe(true);
    expect(changeKindLetter('modified')).toBe('M');
    expect(changeKindLetter('deleted')).toBe('D');
    expect(changeKindLetter('renamed')).toBe('R');
    expect(changeKindLetter('copied')).toBe('C');
    expect(shouldAutoLoadPatch({
      collapsed: true,
      visible: true,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'idle'
    })).toBe(false);
    expect(shouldAutoLoadPatch({
      collapsed: false,
      visible: false,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'idle'
    })).toBe(false);
    expect(shouldAutoLoadPatch({
      collapsed: false,
      visible: true,
      binary: true,
      loadMode: 'auto',
      patchStatus: 'idle'
    })).toBe(false);
    expect(resolveDiffCardBodyKind({
      collapsed: false,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'idle'
    })).toBe('loading');
    expect(diffCardHeaderStats({ changeKind: 'modified', additions: 4, deletions: 9 })).toEqual({
      insertions: 4,
      deletions: 9,
      hideZero: false
    });
    expect(formatDiffCardLabel({
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      changeKind: 'renamed'
    })).toBe('src/old.ts -> src/new.ts');
    expect(formatDiffCardLabel({
      path: 'src/a.ts',
      previousPath: 'src/a.ts',
      changeKind: 'renamed'
    })).toBe('src/a.ts');
    expect(diffCardHeaderStats({ changeKind: 'added', additions: 4, deletions: 9 })).toEqual({
      insertions: 4,
      deletions: 0,
      hideZero: true
    });
    expect(diffCardHeaderStats({ changeKind: 'deleted', additions: 4, deletions: 9 })).toEqual({
      insertions: 0,
      deletions: 9,
      hideZero: true
    });
    expect(shouldAutoLoadPatch({
      collapsed: false,
      visible: true,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'idle'
    })).toBe(true);
    expect(shouldAutoLoadPatch({
      collapsed: false,
      visible: true,
      binary: false,
      loadMode: 'on_demand',
      patchStatus: 'idle'
    })).toBe(false);
    expect(resolveDiffCardBodyKind({
      collapsed: true,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'idle'
    })).toBe('hidden');
    expect(resolveDiffCardBodyKind({
      collapsed: false,
      binary: true,
      loadMode: 'auto',
      patchStatus: 'idle'
    })).toBe('binary');
    expect(resolveDiffCardBodyKind({
      collapsed: false,
      binary: false,
      loadMode: 'too_large',
      patchStatus: 'idle'
    })).toBe('too_large');
    expect(resolveDiffCardBodyKind({
      collapsed: false,
      binary: false,
      loadMode: 'on_demand',
      patchStatus: 'idle'
    })).toBe('load_cta');
    expect(resolveDiffCardBodyKind({
      collapsed: false,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'error'
    })).toBe('error');
    expect(resolveDiffCardBodyKind({
      collapsed: false,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'loading'
    })).toBe('loading');
    expect(resolveDiffCardBodyKind({
      collapsed: false,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'ready',
      patchEmpty: true
    })).toBe('empty');
    expect(resolveDiffCardBodyKind({
      collapsed: false,
      binary: false,
      loadMode: 'auto',
      patchStatus: 'ready'
    })).toBe('patch');
  });

  it('renders stacked-card notices for binary, large, and on-demand files', () => {
    const file = { path: 'src/a.ts', additions: 12, deletions: 0 };
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody bodyKind="binary" file={file} patch={undefined} onLoadPatch={() => {}} />
    )).toContain('Binary file');
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody bodyKind="too_large" file={file} patch={undefined} onLoadPatch={() => {}} />
    )).toContain('Too large to display');
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody bodyKind="load_cta" file={file} patch={undefined} onLoadPatch={() => {}} />
    )).toContain('Load diff');
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody bodyKind="load_cta" file={file} patch={undefined} onLoadPatch={() => {}} />
    )).toContain('+12');
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody
        bodyKind="error"
        file={file}
        patch={{ status: 'error', error: 'offline' }}
        onLoadPatch={() => {}}
      />
    )).toContain('Retry');
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody bodyKind="empty" file={file} patch={{ status: 'ready', patch: '', truncated: false }} onLoadPatch={() => {}} />
    )).toContain('No renderable diff');
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody bodyKind="load_cta" file={{ path: 'src/a.ts', additions: 0, deletions: 0 }} patch={undefined} onLoadPatch={() => {}} />
    )).toContain('Changed file.');
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody bodyKind="hidden" file={file} patch={undefined} onLoadPatch={() => {}} />
    )).toBe('');
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody bodyKind="loading" file={file} patch={{ status: 'loading' }} onLoadPatch={() => {}} />
    )).toContain('thread-diff-skel');
    expect(renderToStaticMarkup(<ThreadDiffSkeleton />)).toContain('thread-diff-skeleton');
    expect(renderToStaticMarkup(<ThreadDiffSkeleton />)).toContain('Loading diff');
    expect(renderToStaticMarkup(<ThreadDiffSkeleton count={2} />).split('is-skeleton').length - 1).toBe(2);
    expect(renderToStaticMarkup(
      <ThreadDiffCardBody
        bodyKind="patch"
        file={file}
        patch={{ status: 'ready', patch: 'diff --git a/src/a.ts b/src/a.ts\n', truncated: true }}
        onLoadPatch={() => {}}
      />
    )).toContain('Patch truncated');
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
    expect(renderToStaticMarkup(<ThreadStatusBadge status="active" />)).toContain('Working');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="active" />)).toContain('thread-status-badge is-working');
    expect(renderToStaticMarkup(
      <ThreadStatusBadge status="active" thinking={{ id: 'th', text: '', startedAt: 1, updatedAt: 1 }} />
    )).toContain('Thinking');
    expect(renderToStaticMarkup(
      <ThreadStatusBadge status="active" thinking={{ id: 'th', text: '', startedAt: 1, updatedAt: 1 }} />
    )).toContain('thread-status-badge is-working');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="idle" />)).toContain('is-idle');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="error" />)).toContain('is-error');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="error" />)).not.toContain('is-blocked');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="error" />)).not.toContain('Needs you');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="error" />)).toContain('Error');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="error" waitingOnUser />)).toContain('Error');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="error" waitingOnUser />)).not.toContain('Needs you');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="" />)).toBe('');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="active" waitingOnUser />)).toContain('Needs you');
    expect(renderToStaticMarkup(<ThreadStatusBadge status="active" waitingOnUser />)).toContain('is-blocked');
    expect(renderToStaticMarkup(
      <ThreadStatusBadge
        status="active"
        waitingOnUser
        thinking={{ id: 'th', text: 'plan', startedAt: 1, updatedAt: 1 }}
      />
    )).toContain('Needs you');
  });

  it('keeps the thread title, overflow slot, and status on one header row', () => {
    const html = renderToStaticMarkup(
      <ThreadDetailHeading
        title="Hello"
        status="active"
        overflow={<button type="button" data-testid="thread-overflow-trigger">…</button>}
      />
    );
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('data-testid="thread-overflow-trigger"');
    expect(html).toContain('data-testid="thread-detail-status"');
    expect(html).not.toContain('data-testid="thread-agents-crumb"');

    const css = readFileSync(fileURLToPath(new URL('../../styles/global.css', import.meta.url)), 'utf8');
    const header = css.slice(
      css.indexOf('.thread-detail-header {'),
      css.indexOf('.thread-status-badge .tab-agent-dot {')
    );
    expect(header).toContain('align-items: center;');
    expect(header).toContain('font-weight: 650;');
    expect(header).toContain('.thread-detail-overflow-btn {');
    expect(header).toContain('.thread-detail-overflow-menu {');
    expect(header).toContain('z-index: 80;');
    expect(header).not.toContain('position: absolute;');
  });

  it('passes waitingOnUser through the heading status badge', () => {
    const html = renderToStaticMarkup(
      <ThreadDetailHeading title="Hello" status="active" waitingOnUser />
    );
    expect(html).toContain('Needs you');
    expect(html).toContain('is-blocked');
  });

  it('passes thinking through the heading status badge', () => {
    const html = renderToStaticMarkup(
      <ThreadDetailHeading
        title="Hello"
        status="active"
        thinking={{ id: 'th', text: 'plan', startedAt: 1, updatedAt: 1 }}
      />
    );
    expect(html).toContain('Thinking');
    expect(html).toContain('is-working');
    expect(html).not.toContain('Working');
  });

  it('opens the secondary panel Diff pin from Review', () => {
    const source = readFileSync(fileURLToPath(new URL('../../views/threads/ThreadDetailView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("selectPin('diff')");
    expect(source).toContain('thread-secondary-show');
    expect(source).toContain('<ThreadDetailHeading');
    expect(source).toContain('thinking={thinking}');
    expect(source).toContain('<ThreadDetailOverflow');
    expect(source).toContain('createCoalescedRunner');
    expect(source).toContain('<ThreadDetail key={threadId} threadId={threadId} />');
    expect(source).toContain("if ((payload as { id: unknown }).id === threadId) runner.run()");
    expect(source).not.toContain('if (cancelled || my !== gen) return;');
  });

  it('keeps the secondary panel a sibling of the main column', () => {
    const source = readFileSync(fileURLToPath(new URL('../../views/threads/ThreadDetailView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('thread-detail-main');
    expect(source).toContain('thread-detail-split');
    const panelAt = source.indexOf('<ThreadSecondaryPanel');
    const bodyAt = source.indexOf('className="thread-detail-body"');
    expect(panelAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(-1);
    expect(source.slice(bodyAt, panelAt)).not.toContain('<ThreadSecondaryPanel');
    expect(source.indexOf('thread-detail-main')).toBeLessThan(panelAt);
  });

  it('keeps the thread-detail-header in the left column of the split', () => {
    const source = readFileSync(fileURLToPath(new URL('../../views/threads/ThreadDetailView.tsx', import.meta.url)), 'utf8');
    const splitAt = source.indexOf('className="thread-detail-split"');
    const mainAt = source.indexOf('className="thread-detail-main"');
    const headerAt = source.indexOf('className="thread-detail-header"');
    const bodyAt = source.indexOf('className="thread-detail-body"');
    expect(splitAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(splitAt);
    expect(headerAt).toBeGreaterThan(mainAt);
    expect(bodyAt).toBeGreaterThan(headerAt);

    const css = readFileSync(fileURLToPath(new URL('../../styles/global.css', import.meta.url)), 'utf8');
    expect(css).toContain('.thread-detail-split {');
    expect(css).toContain('.thread-detail-view.is-secondary-maximized .thread-detail-main {\n  display: none;');
    expect(css).toContain('.thread-detail-view.is-secondary-open:not(.is-secondary-maximized) .thread-detail-split');
    expect(css).toContain('.agent-terminal-modal > .modal-header');
  });

  it('keeps the transcript, workspace banner, and composer in one column', () => {
    const source = readFileSync(fileURLToPath(new URL('../../views/threads/ThreadDetailView.tsx', import.meta.url)), 'utf8');
    const columnAt = source.indexOf('className="thread-detail-column"');
    expect(columnAt).toBeGreaterThan(-1);
    expect(source).not.toContain('ThreadConversationToc');
    const column = source.slice(columnAt);
    expect(column).toContain('<ThreadTimeline');
    expect(column).toContain('<ThreadWorkspaceBanner');
    expect(column).toContain('<ThreadCommandComposer');
    expect(column).toContain('thread-composer-dock');

    const css = readFileSync(fileURLToPath(new URL('../../styles/global.css', import.meta.url)), 'utf8');
    expect(css).toContain('.thread-timeline-row .inbox-md {\n  font-size: 15px;');
    const mentionPopover = css.slice(
      css.indexOf('.thread-detail-view .mention-popover {'),
      css.indexOf('.composer-typeahead-heading {')
    );
    expect(mentionPopover).toContain('top: auto;');
    expect(mentionPopover).toContain('bottom: calc(100% + 8px);');
    const assistantActions = css.slice(
      css.indexOf('.thread-timeline-row.is-assistant .thread-message-actions {'),
      css.indexOf('.thread-timeline-row:hover .thread-message-actions')
    );
    expect(assistantActions).toContain('position: absolute;');
    expect(assistantActions).toContain('left: 0;');
    expect(css).toContain('.thread-timeline-item:hover,\n.thread-timeline-item:focus-within {\n  z-index: 1;');
    expect(css).toContain('.thread-detail-timeline {\n  user-select: text;');
  });

  it('keeps the transcript scrollbar invisible at rest and paints it only while scrolling', () => {
    const source = readFileSync(fileURLToPath(new URL('./ThreadTimeline.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('thread-detail-timeline thread-scrollbar');
    expect(source).toContain('markTransientScrollbarScrolling');
    expect(source).toContain('clearTransientScrollbarScrolling');

    const css = readFileSync(fileURLToPath(new URL('../../styles/global.css', import.meta.url)), 'utf8');
    const scrollbar = css.slice(
      css.indexOf('.thread-scrollbar {'),
      css.indexOf('.thread-timeline-turn {')
    );
    expect(scrollbar).toContain('scrollbar-color: transparent transparent;');
    expect(scrollbar).toContain('.thread-scrollbar[data-scrollbar-scrolling="true"]');
    expect(scrollbar).toContain('color-mix(in oklab, var(--text-primary) 20%, transparent)');
    expect(scrollbar).not.toContain('scrollbar-width: none;');
  });

  it('can render the same thread surface embedded in the Agents list monitor', () => {
    const source = readFileSync(fileURLToPath(new URL('../../views/threads/ThreadDetailView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('export function ThreadDetail(');
    expect(source).toContain('embedded = false');
    expect(source).toContain('thread-detail-view--embedded');
    expect(source).toContain('thread-detail-view--modal');
    expect(source).toContain('modal = false');
    expect(source).not.toContain('data-testid="thread-modal-close"');
    expect(source).not.toContain('data-testid="thread-modal-fullscreen"');
    expect(source).toContain("data-embedded={embedded ? 'true' : undefined}");
    expect(source).toContain('void copyText(text)');
    expect(source).not.toContain('navigator.clipboard');
    expect(source).toContain('route.isProjectWorkspace ? route.focusedProjectId');
    expect(source).toContain('pendingChildThreads(threads, threadId)');
    expect(source).not.toContain('useThreads((s) => s.threads.filter');
    const css = readFileSync(fileURLToPath(new URL('../../styles/global.css', import.meta.url)), 'utf8');
    expect(css).toContain('.thread-detail-view--embedded');
    expect(css).toContain('.thread-detail-view--modal');
    expect(css).toContain('.agent-monitor.is-thread');
    expect(css).toContain('.agent-monitor.is-agent-session');
    expect(css).toContain('.agent-monitor-terminal.is-thread');
    expect(css).toContain('.agent-monitor-terminal.is-agent-session');
  });
});
