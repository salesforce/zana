/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { PluginDefinedSettings, PluginSettingsForm } from './PluginDefinedSettings.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';

const { snap } = vi.hoisted(() => ({
  snap: {
    descriptors: {
      enabled: { type: 'boolean' as const, label: 'Enabled' },
      mode: { type: 'select' as const, label: 'Mode', options: ['fast', 'slow'] },
      token: { type: 'string' as const, label: 'Token', secret: true as const }
    },
    values: { enabled: true, mode: 'fast', token: 'secret' }
  }
}));

vi.mock('../lib/product-client.js', () => ({
  product: {
    pluginApps: {
      getSettings: vi.fn(async () => snap),
      setSettings: vi.fn(async () => snap)
    }
  }
}));

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

  it('still renders the define() form when the plugin also mounts a settings section', async () => {
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
    await waitFor(() => {
      expect(screen.getByText('Plugin settings')).toBeTruthy();
    });
  });
});
