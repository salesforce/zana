import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineViewWorkRow } from '@zana-ai/zcc-thread-view';
import { WorkRowBody } from './WorkRowBody.js';
import { ansiToHtml, stripAnsi } from './ansi-output.js';

const base = {
  id: 'r1',
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1,
  kind: 'work' as const,
  status: 'completed' as const,
  callId: 'r1',
  completedAt: 2
};

describe('ansi output', () => {
  it('strips CSI sequences and paints remaining color codes', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red');
    expect(ansiToHtml('\u001b[32mok\u001b[0m')).toContain('ok');
    expect(ansiToHtml('\u001b[32mok\u001b[0m')).toContain('color:');
  });
});

describe('WorkRowBody', () => {
  it('renders plan steps, search, and extension detail', () => {
    const plan: TimelineViewWorkRow = {
      ...base,
      workKind: 'plan-steps',
      steps: [{ step: 'Write tests' }, { step: 'Ship', status: 'completed' }],
      explanation: 'Next up'
    };
    const planHtml = renderToStaticMarkup(<WorkRowBody row={plan} />);
    expect(planHtml).toContain('plan-steps-body');
    expect(planHtml).toContain('Write tests');
    expect(planHtml).toContain('Next up');

    const search: TimelineViewWorkRow = {
      ...base,
      workKind: 'search',
      mode: 'content',
      query: 'alpha',
      path: 'src',
      cmd: 'rg alpha'
    };
    expect(renderToStaticMarkup(<WorkRowBody row={search} />)).toContain('alpha');

    const extension: TimelineViewWorkRow = {
      ...base,
      workKind: 'extension',
      extensionKind: 'demo/card',
      payload: { ok: true },
      presentation: {
        label: { pending: 'Showing', completed: 'Showed' },
        icon: { glyph: 'Puzzle' },
        detail: 'Plugin detail'
      }
    };
    expect(renderToStaticMarkup(<WorkRowBody row={extension} />)).toContain('Plugin detail');
  });

  it('renders command output as ANSI HTML', () => {
    const row: TimelineViewWorkRow = {
      ...base,
      workKind: 'command',
      command: 'ls',
      cwd: null,
      source: null,
      output: '\u001b[32mdone\u001b[0m',
      exitCode: 0,
      approvalStatus: null,
      activityIntents: []
    };
    const html = renderToStaticMarkup(<WorkRowBody row={row} />);
    expect(html).toContain('thread-ansi-output');
    expect(html).toContain('done');
  });
});
