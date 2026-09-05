import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadTodoChecklist } from './thread-todo-checklist.js';

describe('ThreadTodoChecklist', () => {
  it('renders a status glyph and wrapping text for each item', () => {
    const html = renderToStaticMarkup(
      <ThreadTodoChecklist
        items={[
          { id: '1', text: 'Write tests', status: 'in_progress' },
          { id: '2', text: 'Ship', status: 'pending' },
          { id: '3', text: 'Done', status: 'completed' },
          { id: '4', text: 'Stuck', status: 'blocked', blockedReason: 'interrupted' }
        ]}
      />
    );
    expect(html).toContain('class="thread-todo-checklist"');
    expect(html).toContain('class="thread-todo-checklist-item"');
    expect(html).toContain('class="thread-todo-checklist-text"');
    expect(html).toContain('data-status="in_progress"');
    expect(html).toContain('data-status="pending"');
    expect(html).toContain('data-status="completed"');
    expect(html).toContain('data-status="blocked"');
    expect(html).toContain('Write tests');
    expect(html).toContain('Stuck (interrupted)');
    expect(html).toContain('aria-label="In progress: Write tests"');
    expect(html).toContain('aria-label="Completed: Done"');
    expect(html).toContain('aria-label="Blocked: Stuck"');
  });

  it('renders nothing when there are no items', () => {
    expect(renderToStaticMarkup(<ThreadTodoChecklist items={[]} />)).toBe('');
  });
});
