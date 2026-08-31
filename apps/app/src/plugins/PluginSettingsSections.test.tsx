/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { PluginSettingsSections } from './PluginSettingsSections.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';

afterEach(() => {
  cleanup();
  clearPluginSlots('custom-instructions');
  clearPluginSlots('memory');
});

describe('PluginSettingsSections', () => {
  it('mounts only the requested plugin’s settings section', () => {
    interpretPluginApp(
      'custom-instructions',
      definePluginApp((app) => {
        app.slots.settingsSection({
          id: 'custom-instructions',
          description: 'Host-wide extra instructions.',
          component: () => <textarea aria-label="Custom instructions" />
        });
      })
    );
    interpretPluginApp(
      'memory',
      definePluginApp((app) => {
        app.slots.settingsSection({
          id: 'memory',
          title: 'Memory',
          component: () => <p>Memory settings</p>
        });
      })
    );

    render(<PluginSettingsSections pluginId="custom-instructions" />);
    expect(screen.getByTestId('plugin-settings-sections')).toBeTruthy();
    expect(screen.getByLabelText('Custom instructions')).toBeTruthy();
    expect(screen.getByText('Host-wide extra instructions.')).toBeTruthy();
    expect(screen.queryByText('Memory settings')).toBeNull();
  });

  it('renders settingsSection title', () => {
    interpretPluginApp(
      'memory',
      definePluginApp((app) => {
        app.slots.settingsSection({
          id: 'memory',
          title: 'Memory',
          description: 'Persisted notes.',
          component: () => <p>Memory settings</p>
        });
      })
    );
    render(<PluginSettingsSections pluginId="memory" />);
    expect(screen.getByText('Memory')).toBeTruthy();
    expect(screen.getByText('Persisted notes.')).toBeTruthy();
  });
});
