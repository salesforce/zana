/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import type { PluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';
import { PluginDefinedSettings, PluginSettingsForm } from './PluginDefinedSettings.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';

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
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('type="checkbox"');
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

describe('PluginDefinedSettings', () => {
  afterEach(() => {
    cleanup();
    clearPluginSlots('custom-instructions');
  });

  it('hides the define() form when the plugin mounts its own settings section', () => {
    interpretPluginApp(
      'custom-instructions',
      definePluginApp((app) => {
        app.slots.settingsSection({
          id: 'custom-instructions',
          component: () => <textarea aria-label="Custom instructions" />
        });
      })
    );
    render(<PluginDefinedSettings pluginId="custom-instructions" />);
    expect(screen.queryByText('Plugin settings')).toBeNull();
    expect(screen.queryByText('Persisted on the server for this plugin.')).toBeNull();
  });
});
