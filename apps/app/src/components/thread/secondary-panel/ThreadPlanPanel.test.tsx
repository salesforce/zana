import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadPlanPanel } from './ThreadPlanPanel.js';

describe('ThreadPlanPanel', () => {
  it('renders plan markdown, prompt, and an open-file control', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel
        document={{
          markdown: 'Ship it',
          filePath: '/tmp/plans/ship.md',
          prompt: 'inspect the failing command',
          source: 'approval'
        }}
        onOpenFile={() => undefined}
      />
    );
    expect(html).toContain('data-testid="thread-plan-panel"');
    expect(html).toContain('data-testid="thread-plan-body"');
    expect(html).toContain('Ship it');
    expect(html).toContain('inspect the failing command');
    expect(html).toContain('data-testid="thread-plan-open-file"');
    expect(html).toContain('ship.md');
    expect(html).not.toContain('data-testid="thread-plan-empty"');
    expect(html).not.toContain('data-testid="thread-plan-todos"');
  });

  it('shows an empty state before the agent writes a plan', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel document={{ markdown: null, filePath: null, prompt: null, source: 'empty' }} />
    );
    expect(html).toContain('data-testid="thread-plan-empty"');
    expect(html).toContain('The agent has not written a plan yet.');
    expect(html).not.toContain('data-testid="thread-plan-body"');
  });

  it('lists todos beside the plan when present', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel
        document={{ markdown: 'Do the work', filePath: null, prompt: null, source: 'live' }}
        todos={{
          sourceSeq: 1,
          updatedAt: 1,
          items: [
            { id: '1', text: 'Write tests', status: 'in_progress' },
            { id: '2', text: 'Ship', status: 'pending' }
          ]
        }}
      />
    );
    expect(html).toContain('data-testid="thread-plan-todos"');
    expect(html).toContain('Write tests');
    expect(html).toContain('Ship');
  });

  it('renders a static file path when no opener is provided', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel
        document={{ markdown: 'Ship it', filePath: '/tmp/plan.md', prompt: null, source: 'approval' }}
      />
    );
    expect(html).toContain('/tmp/plan.md');
    expect(html).not.toContain('data-testid="thread-plan-open-file"');
  });
});
