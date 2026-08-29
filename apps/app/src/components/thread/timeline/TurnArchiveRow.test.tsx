import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTimelineRowTitle } from '@zana-ai/zcc-thread-view';
import { TurnArchiveRow } from './TurnArchiveRow.js';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';

const expansion = { liveFrontierRowIds: new Set<string>(), terminalFrontierRowIds: new Set<string>() };

const turn: Extract<ThreadTimelineViewRow, { kind: 'turn' }> = {
  id: 'turn-row',
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 4,
  startedAt: Date.now() - 8000,
  createdAt: Date.now() - 8000,
  kind: 'turn',
  status: 'completed',
  summaryCount: 3,
  completedAt: Date.now() - 2000,
  children: null
};

describe('TurnArchiveRow', () => {
  it('renders a Worked for header instead of unwrapping children', () => {
    const title = buildTimelineRowTitle(turn, { summaryStyle: 'bundle', workStyle: 'default' });
    const html = renderToStaticMarkup(
      <TurnArchiveRow
        row={turn}
        title={title}
        now={Date.now()}
        expansion={expansion}
        threadId="t1"
      />
    );
    expect(html).toContain('thread-turn-summary');
    expect(html).toContain('Worked for');
    expect(html).not.toContain('thread-timeline-turn');
  });
});

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    threads: {
      timelineTurnSummaryDetails: vi.fn(async () => ({ rows: [] }))
    }
  }
}));
