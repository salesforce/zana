import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveExpansionLatch } from './expansion-latch.js';
import { ExpandableTimelineRow } from './ExpandableTimelineRow.js';
import { TimelineDetailScroll } from './TimelineDetailScroll.js';
import { TimelineRows } from './TimelineRows.js';
import type { ThreadTimelineViewRow, TimelineViewWorkRow } from '@zana-ai/zcc-thread-view';

const expansion = {
  liveFrontierRowIds: new Set<string>(),
  terminalFrontierRowIds: new Set<string>()
};

const base = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1
};

describe('expansion latch', () => {
  it('keeps terminal auto-expand after the frontier signal drops', () => {
    expect(resolveExpansionLatch({
      expandable: true,
      terminalLatch: true,
      autoExpanded: false,
      terminalAutoExpanded: false
    })).toBe(true);
  });

  it('lets a user collapse win over live auto-expand', () => {
    expect(resolveExpansionLatch({
      expandable: true,
      autoExpanded: true,
      manualOverride: false
    })).toBe(false);
  });

  it('lets forceExpanded win over a manual collapse', () => {
    expect(resolveExpansionLatch({
      expandable: true,
      forceExpanded: true,
      manualOverride: false
    })).toBe(true);
  });

  it('renders a button header instead of native details', () => {
    const html = renderToStaticMarkup(
      <ExpandableTimelineRow summary="Ran ls" expandable autoExpanded>
        <pre>out</pre>
      </ExpandableTimelineRow>
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('out');
    expect(html).not.toContain('<details');
  });
});

describe('timeline detail scroll', () => {
  it('caps non-expandable bundle children', () => {
    const search: TimelineViewWorkRow = {
      ...base,
      id: 'w1',
      kind: 'work',
      workKind: 'web-search',
      status: 'completed',
      callId: 'w1',
      queries: ['alpha'],
      completedAt: 2
    };
    const bundle: ThreadTimelineViewRow = {
      ...base,
      id: 'bundle',
      kind: 'bundle-summary',
      status: 'completed',
      children: [search]
    };
    const html = renderToStaticMarkup(
      <TimelineRows
        rows={[bundle]}
        now={0}
        expansion={expansion}
      />
    );
    expect(html).toContain('thread-detail-scroll');
    expect(html).toContain('data-size="summary"');
  });

  it('always caps delegation children', () => {
    const child: TimelineViewWorkRow = {
      ...base,
      id: 'c1',
      kind: 'work',
      workKind: 'command',
      status: 'completed',
      callId: 'c1',
      command: 'ls',
      cwd: null,
      source: null,
      output: 'a',
      exitCode: 0,
      completedAt: 2,
      approvalStatus: null,
      activityIntents: []
    };
    const delegation: TimelineViewWorkRow = {
      ...base,
      id: 'del',
      kind: 'work',
      workKind: 'delegation',
      status: 'completed',
      callId: 'del',
      toolName: 'spawnAgent',
      subagentType: 'explore',
      description: 'Look',
      childRows: [child],
      output: '',
      completedAt: 2
    };
    const html = renderToStaticMarkup(
      <TimelineRows
        rows={[delegation]}
        now={0}
        expansion={expansion}
      />
    );
    expect(html).toContain('data-size="delegation"');
    expect(renderToStaticMarkup(
      <TimelineDetailScroll size="base" contentKey="k">body</TimelineDetailScroll>
    )).toContain('is-base');
  });
});
