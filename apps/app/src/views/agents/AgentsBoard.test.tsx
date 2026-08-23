import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const board = readFileSync(new URL('./AgentsBoard.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('./AgentsView.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../project/WorkspaceView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

describe('AgentsBoard', () => {
  it('is the only board: global and project are scope flags', () => {
    expect(view).toContain('<AgentsBoard scope={{ kind: \'global\' }} />');
    expect(workspace).toContain('<AgentsBoard scope={{ kind: \'project\', project }} />');
    expect(board).not.toContain('<AgentLauncher');
    expect(board).toContain('setLauncherOpen(true)');
    expect(board).toContain('aria-label="Legacy PTY agent"');
    expect(board).not.toContain('aria-label="New agent"');
    expect(app).toContain('{launcherOpen && (nav !== \'projects\' || !focusedProjectId) && (');
    expect(app).not.toContain("nav !== 'home'");
  });

  it('embeds the Home composer and AuroraGrid on both empty scopes', () => {
    const emptyStart = board.indexOf('cards.length === 0 ? (');
    const filterStart = board.indexOf('isGlobal && visibleCards.length === 0');
    expect(emptyStart).toBeGreaterThan(-1);
    expect(filterStart).toBeGreaterThan(emptyStart);
    const emptyBranch = board.slice(emptyStart, filterStart);
    expect(emptyBranch).toContain('<AuroraGrid />');
    expect(emptyBranch).not.toContain('<HomeAgentComposer');
    expect(emptyBranch).toContain('No agents running');
    expect(emptyBranch).toContain('No agents yet');
    expect(board).toContain('<HomeAgentComposer project={scopedProject} />');

    const filterBranch = board.slice(filterStart, board.indexOf('<AgentBoardLanes', filterStart));
    expect(filterBranch).not.toContain('<AuroraGrid');
    expect(filterBranch).not.toContain('<HomeAgentComposer');
  });
});

const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('AgentsBoard compact chrome contract', () => {
  it('wraps button labels and the project count so CSS can drop them', () => {
    expect(board).toContain('className="agents-board-header-actions"');
    expect(board).toContain('className="agents-board-btn-label"');
    expect(board).toContain('className="agents-board-count-extra"');
    expect(board).toContain('aria-label="Legacy PTY agent"');
    expect(board).toContain('Close ${reclaimableAgents.length} idle agents');
  });

  it('uses a named board container to compact the header then wrap the filter', () => {
    expect(css).toContain('container-name: agents-board;');
    expect(css).toContain('@container agents-board (max-width: 820px)');
    expect(css).toContain('.agents-board-btn-label {\n    display: none;');
    expect(css).toContain('.agents-board-count-extra {\n    display: none;');
    expect(css).toContain('@container agents-board (max-width: 560px)');
    expect(css).toContain('.agents-board-filter {\n    flex: 1 1 100%;');
  });

  it('clears the collapsed-sidebar trigger on the full-width board header', () => {
    expect(css).toContain('.app-shell.sidebar-is-collapsed .agents-board-header {\n  padding-left: var(--shell-leading-reserve);\n}');
  });

  it('narrows the list-view monitor columns on a compact board', () => {
    expect(css).toContain('@container agents-board (max-width: 920px)');
    expect(css).toContain(
      'grid-template-columns: minmax(160px, 28%) minmax(0, 1fr) minmax(180px, 26%);'
    );
  });

  it('spans the launch composer across the workbench with header gutters', () => {
    expect(board).toContain('<HomeAgentComposer project={scopedProject} />');
    const start = css.indexOf('.agents-board > .home-agent-composer {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('width: 100%;');
    expect(block).toContain('max-width: none;');
    expect(block).toContain('padding: 12px 16px 8px;');
    expect(block).toContain('margin: 0;');
  });
});
