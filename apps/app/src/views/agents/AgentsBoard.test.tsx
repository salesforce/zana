import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const board = readFileSync(new URL('./AgentsBoard.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('./AgentsView.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../project/ProjectView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

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

  it('embeds AuroraGrid on both empty scopes and keeps create off the board', () => {
    const emptyStart = board.indexOf('fleet.length === 0 ? (');
    const filterStart = board.indexOf('isGlobal && visibleFleet.length === 0');
    expect(emptyStart).toBeGreaterThan(-1);
    expect(filterStart).toBeGreaterThan(emptyStart);
    const emptyBranch = board.slice(emptyStart, filterStart);
    expect(emptyBranch).toContain('<AuroraGrid />');
    expect(emptyBranch).not.toContain('<HomeAgentComposer');
    expect(emptyBranch).toContain('No agents');
    expect(emptyBranch).toContain('No agents yet');
    expect(emptyBranch).toContain('setLauncherOpen(true)');
    expect(emptyBranch).toContain('data-testid="agents-board-new-thread"');
    expect(board).toContain('{showToolbar && (');
    expect(board).toContain('const showToolbar = fleet.length > 0 || !includeScheduled');
    expect(board).toContain('<ScheduledColumnToggle />');
    expect(board).not.toContain('<HomeAgentComposer');

    const filterBranch = board.slice(filterStart, board.indexOf('<AgentBoardLanes', filterStart));
    expect(filterBranch).not.toContain('<AuroraGrid');
    expect(filterBranch).not.toContain('<HomeAgentComposer');
  });

  it('merges visible threads into lanes while keeping close-idle PTY-only', () => {
    expect(board).toContain('threadFleetItem');
    expect(board).toContain('fleetAgentCards(visibleFleet)');
    expect(board).toContain('item.kind === \'thread\'');
    expect(board).toContain('openThreadModal(item.id)');
    expect(board).toContain('getThreadRoutePath(item.id, threadProjectId)');
    expect(board).toContain('threadIdFromPath');
    expect(board).toContain('setCloseIdleTarget(reclaimableAgents)');
    expect(board).toContain('<AgentMonitor cards={visibleFleet}');
    expect(board).toContain('projectRemote: Boolean(project.remote)');
    expect(board).toContain('schedulesForAgentView');
    expect(board).toContain('revealSchedule(item.task.id)');
    expect(board).toContain('item.kind === \'schedule\'');
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

  it('narrows the list-view monitor columns on a compact board', () => {
    expect(css).toContain('@container agents-board (max-width: 920px)');
    expect(css).toContain(
      'grid-template-columns: minmax(160px, 28%) minmax(0, 1fr) minmax(180px, 26%);'
    );
    expect(css).toContain(
      'grid-template-columns: minmax(160px, 28%) minmax(0, 1fr);'
    );
  });

  it('does not span a launch composer across the workbench', () => {
    expect(board).not.toContain('<HomeAgentComposer');
    expect(css).not.toContain('.agents-board > .home-agent-composer {');
  });
});
