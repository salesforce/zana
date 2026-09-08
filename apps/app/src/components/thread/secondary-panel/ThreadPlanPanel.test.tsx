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
    expect(html).toContain('data-testid="thread-plan-prompt"');
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

  it('hides the empty copy when durable tasks exist without markdown', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel
        document={{ markdown: null, filePath: null, prompt: null, source: 'durable' }}
        durablePlan={{
          markdown: null,
          revision: 0,
          progress: { completed: 0, total: 8 },
          tasks: Array.from({ length: 8 }, (_, index) => ({
            id: `task-${index}`,
            text: `Step ${index + 1}`,
            status: 'pending',
            owningThreadId: null,
            blockedReason: null
          })),
          referencedBy: [{ threadId: '6e37a024-a39d-4cf4-8c91-108c0deb72db', taskId: null }]
        }}
      />
    );
    expect(html).not.toContain('data-testid="thread-plan-empty"');
    expect(html).not.toContain('The agent has not written a plan yet.');
    expect(html).not.toContain('data-testid="thread-plan-body"');
    expect(html).toContain('data-testid="thread-plan-todos"');
    expect(html).toContain('0/8 complete');
    expect(html).toContain('Step 1');
    expect(html).toContain('Step 8');
    expect(html).toContain('data-testid="thread-plan-status"');
    expect(html).toContain('Ready');
    expect(html).toContain('Referenced by 1 Agent');
    expect(html).toContain('Untitled agent · Agent · 0 todos assigned');
    expect(html).not.toContain('6e37a024-a39d-4cf4-8c91-108c0deb72db');
  });

  it('hides the empty copy when timeline todos exist without markdown', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel
        document={{ markdown: null, filePath: null, prompt: null, source: 'empty' }}
        todos={{
          sourceSeq: 1,
          updatedAt: 1,
          items: [{ id: '1', text: 'Write tests', status: 'pending' }]
        }}
      />
    );
    expect(html).not.toContain('data-testid="thread-plan-empty"');
    expect(html).toContain('data-testid="thread-plan-todos"');
    expect(html).toContain('Write tests');
  });

  it('lists todos as checklist rows beside the plan when present', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel
        document={{ markdown: 'Do the work', filePath: null, prompt: null, source: 'empty' }}
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
    expect(html).toContain('class="thread-todo-checklist"');
    expect(html).toContain('Write tests');
    expect(html).toContain('Ship');
    expect(html).toContain('data-status="in_progress"');
    expect(html).toContain('data-status="pending"');
    expect(html).toContain('aria-label="In progress: Write tests"');
    expect(html).toContain('aria-label="Pending: Ship"');
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

  it('shows durable progress, mismatch, Building badge, and human referenced-by', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel
        document={{ markdown: null, filePath: null, prompt: null, source: 'durable' }}
        durablePlan={{
          markdown: 'Persisted plan',
          status: 'active',
          revision: 2,
          progress: { completed: 1, total: 2 },
          executionModeMismatch: true,
          requestedExecutionMode: 'plan',
          effectiveExecutionMode: 'agent',
          processing: { text: 'Ship it', owningThreadId: 't-1', startedAt: 1, latestActivity: null },
          tasks: [{ id: 'task-1', text: 'Ship it', status: 'in_progress', owningThreadId: 't-1', blockedReason: null }],
          referencedBy: [{
            threadId: 't-1',
            taskId: 'task-1',
            title: 'Pipe prefix in instructions',
            role: 'Author',
            todosAssigned: 3
          }]
        }}
      />
    );
    expect(html).toContain('data-testid="thread-plan-mode-mismatch"');
    expect(html).toContain('data-testid="thread-plan-progress"');
    expect(html).toContain('1/2 complete');
    expect(html).toContain('data-testid="thread-plan-status"');
    expect(html).toContain('Building');
    expect(html).not.toContain('data-testid="thread-plan-processing"');
    expect(html).toContain('Persisted plan');
    expect(html).toContain('Referenced by 1 Agent');
    expect(html).toContain('Pipe prefix in instructions · Author · 3 todos assigned');
    expect(html).not.toContain('>t-1<');
    expect(html).toContain('class="thread-todo-checklist"');
    expect(html).toContain('aria-label="In progress: Ship it"');
  });

  it('shows a Complete badge when every task is done', () => {
    const html = renderToStaticMarkup(
      <ThreadPlanPanel
        document={{ markdown: '# Done', filePath: null, prompt: null, source: 'durable' }}
        durablePlan={{
          markdown: '# Done',
          status: 'completed',
          revision: 1,
          progress: { completed: 1, total: 1 },
          tasks: [{ id: 'task-1', text: 'Ship it', status: 'completed', owningThreadId: null, blockedReason: null }],
          referencedBy: []
        }}
      />
    );
    expect(html).toContain('data-status="complete"');
    expect(html).toContain('Complete');
  });
});
