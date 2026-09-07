import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ProjectModePane.tsx', import.meta.url), 'utf8');

describe('ProjectModePane', () => {
  it('hosts every project destination including terminals portal parking', () => {
    expect(source).toContain('data-testid="project-mode-pane"');
    expect(source).toContain('projectTerminalsAnchorId(paneId)');
    expect(source).toContain('<TabBar');
    expect(source).toContain('<ExplorerView project={project} />');
    expect(source).toContain('<SchedulerPanel projectId={project.id} />');
    expect(source).toContain('<ProjectFeedView project={project} />');
    expect(source).toContain('<ProjectGoalsView project={project} />');
    expect(source).toContain('<ProjectFollowUpsView project={project} />');
    expect(source).toContain('<AgentsBoard scope={{ kind: \'project\', project }} />');
    expect(source).toContain('<ProjectExtensionTab');
    expect(source).toContain('slotTab.component');
    expect(source).toContain('decodeRouteParam(mode)');
    expect(source).toContain('<SplitPaneHeaderActions />');
    expect(source).toContain('<ProjectStatusbarItems');
    expect(source).not.toContain('<AgentLauncher');
  });
});
