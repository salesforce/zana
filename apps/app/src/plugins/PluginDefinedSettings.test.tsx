import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';
import { PluginSettingsForm } from './PluginDefinedSettings.js';

const snap: PluginSettingsSnapshot = {
  descriptors: {
    enabled: { type: 'boolean', label: 'Enabled' },
    mode: { type: 'select', label: 'Mode', options: ['fast', 'slow'] },
    token: { type: 'string', label: 'Token', secret: true }
  },
  values: { enabled: true, mode: 'fast', token: 'secret' }
};

describe('PluginSettingsForm', () => {
  it('renders boolean, select, and secret string fields', () => {
    const html = renderToStaticMarkup(
      <PluginSettingsForm snap={snap} busy={false} error={null} onSave={() => undefined} />
    );
    expect(html).toContain('Plugin settings');
    expect(html).toContain('Enabled');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('fast');
    expect(html).toContain('type="password"');
  });

  it('shows an error', () => {
    const html = renderToStaticMarkup(
      <PluginSettingsForm snap={snap} busy={true} error="nope" onSave={() => undefined} />
    );
    expect(html).toContain('nope');
    expect(html).toContain('disabled=""');
  });
});
