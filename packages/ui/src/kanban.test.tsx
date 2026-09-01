import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { canvasPanIgnoresTarget, canvasPanOffset, Kanban, KanbanColumn } from './kanban.js';

describe('canvas pan', () => {
  it('ignores controls that report a matching closest() hit', () => {
    const control = {};
    expect(
      canvasPanIgnoresTarget({ closest: () => control } as unknown as EventTarget)
    ).toBe(true);
    expect(
      canvasPanIgnoresTarget({ closest: () => null } as unknown as EventTarget)
    ).toBe(false);
    expect(canvasPanIgnoresTarget(null)).toBe(false);
    expect(canvasPanIgnoresTarget({} as EventTarget)).toBe(false);
  });

  it('scrolls the surface with the pointer, canvas-style', () => {
    expect(canvasPanOffset({ x: 40, y: 10, left: 100, top: 20 }, 10, 40)).toEqual({
      left: 130,
      top: -10
    });
  });
});

describe('Kanban', () => {
  it('renders a pannable board with optional collapse', () => {
    const html = renderToStaticMarkup(
      <Kanban label="Pull requests by status" columnWidth={260}>
        <KanbanColumn
          columnId="green"
          label="Ready"
          count={1}
          badge={<span className="zcc-kanban-col-badge">2</span>}
          collapsed
          onToggleCollapse={() => undefined}
        >
          <button type="button">card</button>
        </KanbanColumn>
      </Kanban>
    );
    expect(html).toContain('zcc-kanban');
    expect(html).toContain('aria-label="Pull requests by status"');
    expect(html).toContain('data-kanban-column="green"');
    expect(html).toContain('data-board-column="green"');
    expect(html).toContain('data-collapsed="true"');
    expect(html).toContain('is-collapsed');
    expect(html).toContain('--zcc-kanban-col-width:260px');
    expect(html).not.toContain('>card<');
  });

  it('shows column body when expanded', () => {
    const html = renderToStaticMarkup(
      <Kanban label="Agents">
        <KanbanColumn columnId="idle" label="Idle" count={0}>
          <div className="zcc-kanban-col-empty" />
        </KanbanColumn>
      </Kanban>
    );
    expect(html).toContain('zcc-kanban-col-body');
    expect(html).toContain('zcc-kanban-col-empty');
    expect(html).not.toContain('zcc-kanban-col-collapse');
    expect(html).toContain('--zcc-kanban-col-flex:1 1 200px');
  });
});
