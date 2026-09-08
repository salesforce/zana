import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { ComposerSettingsView } from './ComposerSettingsView.js';

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('ComposerSettingsView', () => {
  it('lists launch surfaces with CLI Agent first and gates Job Team here', () => {
    const html = renderToStaticMarkup(
      <ComposerSettingsView config={config} onUpdate={vi.fn().mockResolvedValue(undefined)} />
    );
    expect(html).toContain('settings-anchor-launch-surfaces');
    expect(html).toContain('Launch surfaces');
    expect(html).toContain('aria-label="CLI Agent"');
    expect(html).toContain('aria-label="Modern"');
    expect(html).toContain('aria-label="Autonomous Team"');
    expect(html).toContain('aria-label="Job Team"');
    expect(html.indexOf('aria-label="CLI Agent"')).toBeLessThan(html.indexOf('aria-label="Modern"'));
    expect(html).toContain('Default launch mode');
    expect(html).toContain('Reload slash commands');
    expect(html).toContain('settings-anchor-composer');
  });

  it('disables the last remaining of Modern or CLI Agent', () => {
    const html = renderToStaticMarkup(
      <ComposerSettingsView
        config={{ ...config, composerShowModern: false }}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const cliStart = html.lastIndexOf('<button', html.indexOf('aria-label="CLI Agent"'));
    const cliBtn = html.slice(cliStart, html.indexOf('</button>', cliStart));
    expect(cliBtn).toContain('aria-label="CLI Agent"');
    expect(cliBtn).toContain('disabled=""');
    const modernStart = html.lastIndexOf('<button', html.indexOf('aria-label="Modern"'));
    const modernBtn = html.slice(modernStart, html.indexOf('</button>', modernStart));
    expect(modernBtn).toContain('aria-label="Modern"');
    expect(modernBtn).not.toContain('disabled=""');
  });
});
