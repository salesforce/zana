import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { mergeExecutionsPage } from './AgentsBoard';

const board = readFileSync(new URL('./AgentsBoard.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('./AgentsView.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../project/ProjectModePane.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const closeIdle = readFileSync(
  new URL('../../components/CloseIdleAgentsDialog.tsx', import.meta.url),
  'utf8'
);

describe('AgentsBoard', () => {
  it('is the only board: global and project are scope flags', () => {
    expect(view).toContain('<AgentsBoard scope={{ kind: \'global\' }} />');
    expect(workspace).toContain('<AgentsBoard scope={{ kind: \'project\', project }} />');
    expect(board).not.toContain('<AgentLauncher');
    expect(board).toContain('setLauncherOpen(true)');
    expect(board).toContain('aria-label="New agent"');
    expect(board).not.toContain('aria-label="Legacy PTY agent"');
    expect(board).not.toContain('aria-label="New thread/agent"');
    expect(app).toContain("{launcherOpen && (nav !== 'projects' || !focusedProjectId || splitWorkspaceShowing) && (");
    expect(app).not.toContain("nav !== 'home'");
  });

  it('uses the standard panel surface without AuroraGrid', () => {
    expect(board).not.toContain('aurora-host');
    expect(board).not.toContain('<AuroraGrid');
    expect(board).not.toContain('<HomeAgentComposer');
    expect(board).toContain('No agents');
    expect(board).toContain('No agents yet');
    expect(board).toContain('setLauncherOpen(true)');
    expect(board).toContain('data-testid="agents-board-new-thread"');
    expect(board).toContain('{showToolbar && (');
    expect(board).toContain('const showToolbar = fleet.length > 0 || executions.length > 0 || !includeScheduled');
    expect(board).toContain('<ScheduledColumnToggle />');

    const emptyStart = board.indexOf('fleet.length === 0 && executions.length === 0 ? (');
    const filterStart = board.indexOf('isGlobal && visibleFleet.length === 0');
    expect(emptyStart).toBeGreaterThan(-1);
    expect(filterStart).toBeGreaterThan(emptyStart);
    const emptyBranch = board.slice(emptyStart, filterStart);
    expect(emptyBranch).not.toContain('<HomeAgentComposer');
    expect(emptyBranch).toContain('agents-board-empty--launch');
    expect(emptyBranch).toContain('<PaneEmptyState');

    const filterBranch = board.slice(filterStart, board.indexOf('<AgentBoardLanes', filterStart));
    expect(filterBranch).not.toContain('<HomeAgentComposer');
  });

  it('portals the close-idle dialog out of the board stacking context', () => {
    expect(closeIdle).toContain('return createPortal(node, document.body)');
    expect(closeIdle).toContain('className="modal-backdrop"');
  });

  it('merges visible threads into lanes while keeping close-idle PTY-only', () => {
    expect(board).toContain('threadFleetItem');
    expect(board).toContain('fleetAgentCards(visibleFleet)');
    expect(board).toContain('item.kind === \'thread\'');
    expect(board).toContain('openThreadModal(item.id)');
    expect(board).toContain('getThreadRoutePath(item.id, threadProjectId)');
    expect(board).toContain('threadIdFromPath');
    expect(board).toContain('setCloseIdleTarget(reclaimableAgents)');
    expect(board).toContain('<AgentMonitor\n          cards={visibleFleet}');
    expect(board).toContain('projectRemote: Boolean(project.remote)');
    expect(board).toContain('schedulesForAgentView');
    expect(board).toContain('openScheduleFromAgents');
    expect(board).toContain('item.kind === \'schedule\'');
    expect(board).toContain('getAgentSessionRoutePath(item.card.session.id, item.projectId)');
    expect(board).toContain('item.card.session.scheduled');
  });
});

function fakeExecution(id: string, createdAt: number): ExecutionBoardProjection {
  return {
    executionId: id,
    projectId: 'p1',
    jobTitle: `Job ${id}`,
    state: 'RUNNING',
    attempt: 1,
    createdAt,
    updatedAt: createdAt
  };
}

describe('AgentsBoard poll refresh — mergeExecutionsPage', () => {
  it('keeps a brand-new first-page execution and prior paginated-in executions', () => {
    // Simulate: user loaded a second page (older executions e2 beyond the
    // first page), then a poll refresh's first page comes back containing a
    // NEW execution (e3) the client never saw before. Both must survive —
    // the new one because it's fresh, the old one because it was paginated in.
    const prev = [fakeExecution('e1', 300), fakeExecution('e2', 200)];
    const freshFirstPage = [fakeExecution('e3', 400), fakeExecution('e1', 300)];

    const merged = mergeExecutionsPage(prev, freshFirstPage);

    expect(merged.map((e) => e.executionId)).toEqual(['e3', 'e1', 'e2']);
  });

  it('drops nothing and adds nothing when the fresh page matches prior state exactly', () => {
    const prev = [fakeExecution('e1', 300)];
    const merged = mergeExecutionsPage(prev, [fakeExecution('e1', 300)]);
    expect(merged.map((e) => e.executionId)).toEqual(['e1']);
  });

  it('replaces a stale entry\'s data with the fresh version rather than keeping the old copy', () => {
    const prev = [{ ...fakeExecution('e1', 300), state: 'RUNNING' as const }];
    const freshFirstPage = [{ ...fakeExecution('e1', 300), state: 'COMPLETED' as const }];
    const merged = mergeExecutionsPage(prev, freshFirstPage);
    expect(merged).toHaveLength(1);
    expect(merged[0].state).toBe('COMPLETED');
  });

  it('starts from an empty prior list without throwing', () => {
    const merged = mergeExecutionsPage([], [fakeExecution('e1', 100)]);
    expect(merged.map((e) => e.executionId)).toEqual(['e1']);
  });
});

describe('AgentsBoard poll refresh — single-flight + guarded pagination', () => {
  it('guards loadMoreExecutions against a null scoped project instead of asserting', () => {
    expect(board).not.toContain('scopedProject!.id');
    expect(board).toContain('if (!scopedProject || loadingMore || !hasMoreExecutions || executions.length === 0) return;');
  });

  it('skips an overlapping refresh tick and logs a failed refresh instead of throwing unhandled', () => {
    expect(board).toContain('let inFlight = false;');
    expect(board).toContain('if (inFlight) return;');
    expect(board).toContain('inFlight = true;');
    expect(board).toContain("console.error('[AgentsBoard] executionBoard.listProject refresh failed', error);");
    expect(board).toContain('inFlight = false;');
  });
});

const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('AgentsBoard compact chrome contract', () => {
  it('keeps actions in a toolbar without a page title or live count', () => {
    expect(board).toContain('className="agents-board-toolbar"');
    expect(board).toContain('className="agents-board-btn-label"');
    expect(board).toContain('aria-label="New agent"');
    expect(board).toContain('data-testid="agents-board-new-thread"');
    expect(board).toContain('btn primary agents-board-new');
    expect(board).toContain('<ScheduledColumnToggle />');
    expect(board).not.toContain('agents-board-header');
    expect(board).not.toContain('<h1>Agents</h1>');
    expect(board).not.toContain('agents-board-count');
    expect(board).not.toContain('item live');
    expect(board).not.toContain('agents-board-legacy');
    expect(board).not.toContain('getNewThreadRoutePath');
    expect(board).toContain('listAgentsBoardActions');
    expect(board).toContain('agents-board-plugin-action');
  });

  it('uses a named board container to compact the toolbar then wrap the filter', () => {
    expect(css).toContain('container-name: agents-board;');
    expect(css).toContain('@container agents-board (max-width: 820px)');
    expect(css).toContain('.agents-board-btn-label {\n    display: none;');
    expect(css).toContain('.agents-board-new,\n  .agents-board-close-idle,\n  .agents-board-plugin-action');
    expect(css).toContain('@container agents-board (max-width: 560px)');
    expect(css).toContain('.agents-board-filter {\n    flex: 1 1 100%;');
    expect(css).not.toContain('.agents-board-count-extra');
  });

  it('clears the collapsed-sidebar trigger on the full-width board toolbar', () => {
    expect(css).toContain('.app-shell.sidebar-is-collapsed .agents-board-toolbar {\n  padding-left: var(--shell-leading-reserve);\n}');
  });

  it('keeps a small gap between the toolbar and the list, board, or flow', () => {
    expect(css).toContain(
      '.agents-board-toolbar {\n  display: flex;\n  min-width: 0;\n  flex: 0 0 auto;\n  align-items: center;\n  justify-content: flex-end;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 8px 12px 12px;\n}'
    );
  });

  it('narrows the list-view monitor columns on a compact board', () => {
    expect(css).toContain('@container agents-board (max-width: 920px)');
    expect(css).toContain(
      'grid-template-columns: minmax(160px, 28%) minmax(0, 1fr) minmax(180px, 26%);'
    );
    expect(css).toContain(
      'grid-template-columns: minmax(160px, 28%) minmax(0, 1fr);'
    );
  });

  it('keeps the empty list-view monitor as a centered stack, not the 3-column grid', () => {
    expect(css).toMatch(/\.agent-monitor\.agent-monitor--empty\s*\{[^}]*display:\s*flex/s);
    const lastEmpty = css.lastIndexOf('.agent-monitor.agent-monitor--empty');
    const lastGrid = css.lastIndexOf('.agent-monitor {\n  flex: 1');
    expect(lastEmpty).toBeGreaterThan(lastGrid);
    const emptyBlock = css.slice(lastEmpty, css.indexOf('}', lastEmpty));
    expect(emptyBlock).toContain('display: flex');
  });

  it('does not span a launch composer across the workbench', () => {
    expect(board).not.toContain('<HomeAgentComposer');
    expect(css).not.toContain('.agents-board > .home-agent-composer {');
  });

  it('paints the board on the standard panel surface', () => {
    expect(css).not.toContain('.agents-board.aurora-host');
    expect(css).toContain('.agents-board {\n  flex: 1;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  background: var(--bg-panel);');
    expect(css).toContain(
      '.agents-board-empty--launch {\n  overflow: auto;\n  gap: 20px;\n  justify-content: center;\n  padding: 48px 24px 56px;\n  background: transparent;'
    );
  });

  it('paints lane accents as an inset top stripe, not a recolored header divider', () => {
    expect(css).toContain('.zcc-kanban-col.lane-blocked { box-shadow: inset 0 2px 0 var(--danger); }');
    expect(css).toContain('.zcc-kanban-col.lane-working { box-shadow: inset 0 2px 0 var(--accent-gold); }');
    expect(css).not.toContain('.zcc-kanban-col.lane-blocked .zcc-kanban-col-header { border-bottom-color:');
    expect(css).not.toContain('.zcc-kanban-col.lane-working .zcc-kanban-col-header { border-bottom-color:');
  });
});
