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
    expect(app).toContain('onLaunched={nav === \'agents\' ? stayOnAgentsBoard : undefined}');
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
    expect(emptyBranch).toContain('<HomeAgentComposer project={scopedProject} />');
    expect(emptyBranch).toContain('No agents running');
    expect(emptyBranch).toContain('No agents yet');
    expect(emptyBranch).not.toContain('New agent');

    const filterBranch = board.slice(filterStart, board.indexOf('<AgentBoardLanes', filterStart));
    expect(filterBranch).not.toContain('<AuroraGrid');
    expect(filterBranch).not.toContain('<HomeAgentComposer');
  });
});
