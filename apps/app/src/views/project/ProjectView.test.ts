import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('ProjectView terminal park', () => {
  it('keeps a hidden park anchor and leaves project modes to the split workspace', () => {
    const source = readFileSync(new URL('./ProjectView.tsx', import.meta.url), 'utf8');
    const pane = readFileSync(new URL('./ProjectModePane.tsx', import.meta.url), 'utf8');
    const area = readFileSync(new URL('../thread-detail/SplitThreadArea.tsx', import.meta.url), 'utf8');
    expect(source).toContain('PROJECTS_TERMINAL_ANCHOR_ID');
    expect(source).toContain("style={{ display: 'none' }}");
    expect(source).not.toContain('<AgentLauncher');
    expect(source).not.toContain('<NewThreadView');
    expect(source).not.toContain('<ThreadDetail');
    expect(source).not.toContain('<AgentsBoard');
    expect(pane).toContain('<AgentsBoard scope={{ kind: \'project\', project }} />');
    expect(pane).toContain("viewMode === 'agents'");
    expect(pane).not.toContain('explorer-topbar-label">Agents');
    expect(area).toContain("content.kind === 'project-view'");
    expect(area).toContain('<ProjectModePane');
    expect(css).toContain('.project-body > .thread-detail-view');
    expect(css).toContain('.split-workspace .project-mode-pane');
  });
});

describe('project shell placement', () => {
  it('occupies the content track and resets when the sidebar is collapsed', () => {
    const start = css.indexOf('\n.project-shell {\n');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('\n}', start));
    expect(block).toContain('grid-column: 2 / -1;');
    expect(css).toContain(
      '.app-shell.sidebar-is-collapsed.scoped-no-list .project-shell {\n  grid-column: 1 / -1;\n}'
    );
    expect(css).toContain(
      '.app-shell.sidebar-is-collapsed.scoped-no-list {\n  grid-template-columns: minmax(0, 1fr);\n}'
    );
  });

  it('pins body and statusbar to named rows so omitting the topbar cannot shift them', () => {
    const start = css.indexOf('\n.project-shell {\n');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('\n}', start));
    expect(block).toContain('grid-template-rows: auto 1fr var(--status-h);');
    expect(block).toContain('grid-template-areas:');
    expect(block).toContain('"topbar"');
    expect(block).toContain('"body"');
    expect(block).toContain('"status"');
    expect(css).toContain('.project-topbar {\n  grid-area: topbar;');
    expect(css).toContain('.project-body {\n  grid-area: body;');
    expect(css).toContain('.project-shell > .statusbar {\n  grid-area: status;');
  });
});
