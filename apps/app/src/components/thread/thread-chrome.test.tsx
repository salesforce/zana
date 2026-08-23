import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadConversationToc } from './ThreadConversationToc.js';
import { ThreadWorkspaceBanner } from './ThreadWorkspaceBanner.js';
import { hunkForPath } from './thread-diff.js';
import { ExpandableTimelineRow } from './timeline/ExpandableTimelineRow.js';
import { ThreadWorkflowChips, ThreadPromptModeChip } from './timeline/ThreadBanners.js';

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

describe('workspace banner', () => {
  it('renders nothing until environment status arrives', () => {
    expect(renderToStaticMarkup(
      <ThreadWorkspaceBanner environmentId={null} onOpenDiff={() => undefined} />
    )).toBe('');
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
  });
});
