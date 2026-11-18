import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrecedenceStrip } from '../PrecedenceStrip.js';
import { worktreeDefaultOrigin } from '../../lib/workspace-choice.js';

describe('PrecedenceStrip', () => {
  it('renders direction labels and layers highest first for first-defined settings', () => {
    const html = renderToStaticMarkup(h(PrecedenceStrip, { settingKey: 'harness.target' }));
    expect(html).toContain('Checked first →');
    expect(html).toContain('→ checked last');
    expect(html.indexOf('Agent')).toBeLessThan(html.indexOf('Persona'));
    expect(html.indexOf('Persona')).toBeLessThan(html.indexOf('Project'));
    expect(html.indexOf('Project')).toBeLessThan(html.indexOf('Global'));
  });

  it('renders one rule line and no arrows for last-wins and combining settings', () => {
    for (const settingKey of ['claude.permissionMode', 'tools.allowedDenied'] as const) {
      const html = renderToStaticMarkup(h(PrecedenceStrip, { settingKey }));
      expect(html).not.toContain('→');
      expect(html).not.toContain('<ol');
    }
  });
});

describe('worktreeDefaultOrigin', () => {
  it('names Project when the project sets a value, else Global', () => {
    expect(worktreeDefaultOrigin(false)).toBe('Project');
    expect(worktreeDefaultOrigin(true)).toBe('Project');
    expect(worktreeDefaultOrigin(undefined)).toBe('Global');
  });
});
