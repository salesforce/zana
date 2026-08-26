import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('./HomeView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('HomeView New Chat surface', () => {
  it('is a composer-only create surface with plugin CTAs under the prompt', () => {
    expect(view).toContain('className="settings-panel home-panel aurora-host"');
    expect(view).toContain('<AuroraGrid />');
    expect(view.indexOf('<AuroraGrid />')).toBeLessThan(view.indexOf('className="settings-inner"'));
    expect(view).toContain('composePromptSeedFrom');
    expect(view).toContain('initialText={seed.initialText}');
    expect(view).toContain('autoFocus={seed.focusPrompt}');
    expect(view).toContain('allowLegacyAgent');
    expect(view).toContain('HomeAgentComposer');
    expect(view).toContain('PluginNewThreadActions');
    expect(view).toContain('projectId={null}');
    expect(view).toContain('className="home-plugin-sections"');
    expect(view).toContain('listHomepageSections');
    expect(view.indexOf('HomeAgentComposer')).toBeLessThan(
      view.indexOf('<PluginNewThreadActions')
    );
    expect(view.indexOf('<PluginNewThreadActions')).toBeLessThan(view.indexOf('home-plugin-sections'));
    expect(view).not.toContain('home-dashboard');
    expect(view).not.toContain('home-grid');
    expect(view).not.toContain('GuideModal');
    expect(view).not.toContain('CreateExtensionDialog');
    expect(view).not.toContain('new-thread-view-heading');
    expect(view).not.toContain('Inbox');
    expect(view).not.toContain('Guides');
  });

  it('centers an 820px composer column and keeps context chips below the prompt', () => {
    const panelStart = css.indexOf('.home-panel {');
    const panel = css.slice(panelStart, css.indexOf('}', panelStart));
    expect(panel).toContain('grid-column: 2 / -1;');
    expect(panel).toContain('display: flex;');
    expect(panel).toContain('flex-direction: column;');
    expect(panel).toContain('align-items: center;');
    expect(panel).toContain('justify-content: center;');
    expect(panel).toContain('height: 100%;');
    expect(panel).toContain('overflow-y: auto;');

    const innerStart = css.indexOf('.home-panel .settings-inner {');
    const inner = css.slice(innerStart, css.indexOf('}', innerStart));
    expect(inner).toContain('position: relative;');
    expect(inner).toContain('z-index: 1;');
    expect(inner).toContain('width: min(820px, 100%);');
    expect(inner).toContain('display: flex;');
    expect(inner).toContain('flex-direction: column;');
    expect(inner).toContain('flex: 0 0 auto;');
    expect(inner).toContain('padding: 0;');
    expect(inner).toContain('gap: 16px;');

    const composerStart = css.indexOf('.home-panel .home-agent-composer {');
    const composer = css.slice(composerStart, css.indexOf('}', composerStart));
    expect(composer).toContain('flex: 0 0 auto;');
    expect(composer).toContain('width: 100%;');
    expect(composer).toContain('margin: 0;');
    expect(css).not.toContain('.agents-board > .home-agent-composer {');
    expect(css).not.toContain('.home-dashboard {');
    expect(css).not.toContain('.home-grid {');

    expect(css).not.toContain('.home-panel .thread-command-composer-meta {');
    expect(css).not.toContain('.home-panel .thread-command-composer {');

    const editorStart = css.indexOf('.home-panel .thread-command-editor.ProseMirror,');
    expect(editorStart).toBeGreaterThan(-1);
    const editor = css.slice(editorStart, css.indexOf('}', editorStart));
    expect(editor).toContain('min-height: 52px;');
    expect(editor).toContain('max-height: 16rem;');
  });

  it('lets the New Chat mention menu open below the prompt', () => {
    expect(css).not.toContain('.home-panel .mention-popover {');
  });
});
