import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectDot } from './ProjectDot.js';

describe('ProjectDot', () => {
  it('renders a saved icon with the project color and unread indicator', () => {
    const markup = renderToStaticMarkup(ProjectDot({ project: { name: 'CRM', icon: 'Cloud', color: '#3fb950' }, unread: true }));
    expect(markup).toContain('project-dot--icon');
    expect(markup).toContain('data-project-icon="Cloud"');
    expect(markup).toContain('color:#3fb950');
    expect(markup).toContain('New activity');
    expect(markup).not.toContain('background:');
  });
  it('uses the muted icon color when no project color is set', () => {
    const markup = renderToStaticMarkup(ProjectDot({ project: { name: 'CRM', icon: 'Cloud' } }));
    expect(markup).toContain('project-dot--icon');
    expect(markup).not.toContain('style="color:');
  });
  it.each(['Circle', 'unknown'])('falls back to the dot for %s', icon => {
    const markup = renderToStaticMarkup(ProjectDot({ project: { name: 'CRM', icon: icon as 'Circle', color: '#3fb950' } }));
    expect(markup).not.toContain('project-dot--icon');
    expect(markup).toContain('background:#3fb950');
  });
  it('preserves the home glyph even when a plugin sets an icon', () => {
    const markup = renderToStaticMarkup(ProjectDot({ project: { name: 'Default Project', quickAgent: true, icon: 'Cloud' } }));
    expect(markup).toContain('lucide-house');
    expect(markup).not.toContain('data-project-icon');
  });
  it('renders a home icon for the default scratch workspace', () => {
    const markup = renderToStaticMarkup(
      ProjectDot({
        project: { name: 'zcc-workspace', quickAgent: true, color: '#58a6ff' }
      })
    );
    expect(markup).toContain('project-dot--home');
    expect(markup).toContain('lucide-house');
    expect(markup).not.toContain('background');
  });

  it('treats the legacy cc-workspace folder as the default project', () => {
    const markup = renderToStaticMarkup(
      ProjectDot({ project: { name: 'cc-workspace' } })
    );
    expect(markup).toContain('project-dot--home');
  });

  it('keeps the unread pulse on the home glyph', () => {
    const markup = renderToStaticMarkup(
      ProjectDot({
        project: { name: 'zcc-workspace', quickAgent: true },
        unread: true
      })
    );
    expect(markup).toContain('project-dot--home');
    expect(markup).toContain('unread');
    expect(markup).toContain('New activity');
  });

  it('keeps the colored circle for an ordinary project', () => {
    const markup = renderToStaticMarkup(
      ProjectDot({
        project: { name: 'zana-command-center', color: '#f85149' },
        unread: true
      })
    );
    expect(markup).not.toContain('project-dot--home');
    expect(markup).not.toContain('lucide-house');
    expect(markup).toContain('background:#f85149');
    expect(markup).toContain('unread');
    expect(markup).toContain('New activity');
  });

  it('omits a fill when an ordinary project has no color', () => {
    const markup = renderToStaticMarkup(
      ProjectDot({ project: { name: 'plain-repo' } })
    );
    expect(markup).toContain('class="project-dot "');
    expect(markup).not.toContain('style=');
  });

  it('styles the home glyph as an outline icon instead of a filled circle', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.project-dot--home {\n  width: 12px;\n  height: 12px;\n  background: transparent;');
    expect(css).toContain('.overview-project-row .project-dot--home {\n  width: 12px;\n  height: 12px;\n  background: transparent;');
  });
});
