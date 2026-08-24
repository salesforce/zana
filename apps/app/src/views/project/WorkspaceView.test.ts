import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('WorkspaceView launcher host', () => {
  it('mounts the project launcher as a modal for every workspace mode', () => {
    const source = readFileSync(new URL('./WorkspaceView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('{launcherOpen && project && workspaceShown && (');
    expect(source).toContain("route.nav === 'projects' && !!route.focusedProjectId");
    expect(source).not.toContain('launcherOpen && project && !isAgents');
    expect(source).toContain('<AgentLauncher');
    expect(source).not.toContain('presentation=');
    expect(source).toContain('route.isNewThread');
    expect(source).toContain('<NewThreadView project={project} />');
    expect(source).toContain('mode === \'agents\' && !!project && !isNewThread');
  });
});

describe('workspace shell placement', () => {
  it('occupies the content track and resets when the sidebar is collapsed', () => {
    const start = css.indexOf('\n.workspace {\n');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('\n}', start));
    expect(block).toContain('grid-column: 2 / -1;');
    expect(css).toContain(
      '.app-shell.sidebar-is-collapsed.scoped-no-list .workspace {\n  grid-column: 1 / -1;\n}'
    );
    expect(css).toContain(
      '.app-shell.sidebar-is-collapsed.scoped-no-list {\n  grid-template-columns: minmax(0, 1fr);\n}'
    );
  });
});
