import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROJECT_MARKER_ICONS, ProjectMarker } from './project-marker.js';

const render = (props: Parameters<typeof ProjectMarker>[0]) =>
  renderToStaticMarkup(<ProjectMarker {...props} />);

describe('ProjectMarker', () => {
  it('lists exactly the 12 project icons', () => {
    expect(PROJECT_MARKER_ICONS).toEqual([
      'Circle', 'Cloud', 'Folder', 'Code', 'Database', 'Globe',
      'Package', 'Rocket', 'Briefcase', 'Terminal', 'Layers', 'Wrench'
    ]);
  });

  it.each(PROJECT_MARKER_ICONS.filter((i) => i !== 'Circle'))('renders a glyph for %s', (icon) => {
    const html = render({ icon, color: '#ff0000' });
    expect(html).toContain('<svg');
    expect(html).toContain('project-marker--icon');
    expect(html).toContain(`data-project-icon="${icon}"`);
  });

  it.each([['Circle'], ['Nope'], [undefined], ['toString']])('renders a dot for %s', (icon) => {
    const html = render({ icon, color: '#00ff00' });
    expect(html).not.toContain('<svg');
    expect(html).toContain('project-marker--dot');
    expect(html).toContain('background:#00ff00');
  });

  it('uses a neutral marker without color', () => {
    const dot = render({});
    expect(dot).toContain('project-marker--neutral');
    expect(dot).not.toContain('style=');
    const glyph = render({ icon: 'Cloud' });
    expect(glyph).toContain('project-marker--neutral');
    expect(glyph).not.toContain('style=');
  });

  it('applies color to glyph text color', () => {
    const html = render({ icon: 'Rocket', color: '#123456' });
    expect(html).toContain('color:#123456');
    expect(html).not.toContain('project-marker--neutral');
  });

  it('adds unread class', () => {
    expect(render({ unread: true })).toContain('unread');
    expect(render({ icon: 'Folder', unread: true })).toContain('unread');
    expect(render({ icon: 'Folder' })).not.toContain('unread');
  });

  it('honors size for glyph and dot', () => {
    expect(render({ icon: 'Code', size: 20 })).toContain('width:20px;height:20px');
    expect(render({ icon: 'Code', size: 20 })).toContain('width="20"');
    expect(render({ icon: 'Code' })).toContain('width="12"');
    expect(render({ size: 10, color: 'red' })).toContain('width:10px;height:10px');
  });

  it('is decorative and keeps title', () => {
    const html = render({ title: 'New activity' });
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('title="New activity"');
  });

  it('appends className to the root', () => {
    expect(render({ className: 'project-dot' })).toContain('class="project-marker project-marker--dot project-marker--neutral project-dot"');
    expect(render({ icon: 'Cloud', color: 'red', className: 'x' })).toContain('project-marker--icon x"');
  });

  it('ships css with marker classes', () => {
    const css = readFileSync(new URL('./project-marker.css', import.meta.url), 'utf8');
    for (const c of [':where(.project-marker--dot.project-marker--neutral)', '.project-marker--dot', '.project-marker--icon', '.project-marker.unread']) {
      expect(css).toContain(c);
    }
  });
});
