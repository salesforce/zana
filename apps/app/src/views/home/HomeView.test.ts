import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('./HomeView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('HomeView composer dock', () => {
  it('puts Inbox/Guides in a scroll region above the docked composer', () => {
    expect(view).toContain('className="home-dashboard"');
    expect(view).toContain('className="home-grid"');
    expect(view).toContain('<HomeAgentComposer />');
    expect(view.indexOf('className="home-dashboard"')).toBeLessThan(view.indexOf('<HomeAgentComposer />'));
    expect(view.indexOf('className="home-grid"')).toBeLessThan(view.indexOf('<HomeAgentComposer />'));
    expect(view.indexOf('home-plugin-sections')).toBeLessThan(view.indexOf('<HomeAgentComposer />'));
  });

  it('fills the shell track and docks the composer to the panel footer', () => {
    const panelStart = css.indexOf('.home-panel {');
    const panel = css.slice(panelStart, css.indexOf('}', panelStart));
    expect(panel).toContain('grid-column: 2 / -1;');
    expect(panel).toContain('display: flex;');
    expect(panel).toContain('flex-direction: column;');
    expect(panel).toContain('height: 100%;');
    expect(panel).toContain('overflow: hidden;');

    const innerStart = css.indexOf('.home-panel .settings-inner {');
    const inner = css.slice(innerStart, css.indexOf('}', innerStart));
    expect(inner).toContain('display: flex;');
    expect(inner).toContain('flex-direction: column;');
    expect(inner).toContain('flex: 1 1 auto;');
    expect(inner).toContain('min-height: 0;');

    const dashStart = css.indexOf('.home-dashboard {');
    const dashboard = css.slice(dashStart, css.indexOf('}', dashStart));
    expect(dashboard).toContain('flex: 1 1 auto;');
    expect(dashboard).toContain('overflow-y: auto;');

    const composerStart = css.indexOf('.home-panel .home-agent-composer {');
    const composer = css.slice(composerStart, css.indexOf('}', composerStart));
    expect(composer).toContain('flex: 0 0 auto;');
    expect(composer).toContain('width: 100%;');
    expect(composer).toContain('margin: 0 auto;');
    expect(css).not.toContain('.agents-board > .home-agent-composer {');

    const editorStart = css.indexOf('.home-panel .thread-command-editor.ProseMirror,');
    expect(editorStart).toBeGreaterThan(-1);
    const editor = css.slice(editorStart, css.indexOf('}', editorStart));
    expect(editor).toContain('min-height: 52px;');
    expect(editor).toContain('max-height: 16rem;');
  });

  it('opens the Home mention menu above the docked prompt', () => {
    const start = css.indexOf('.home-panel .mention-popover {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('top: auto;');
    expect(block).toContain('bottom: calc(100% + 4px);');
  });
});
