/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { product } from '../lib/product-client.js';
import { PluginDefinedSettings, PluginSettingsForm } from './PluginDefinedSettings.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';
import type { PluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';

const { snap, setSettings } = vi.hoisted(() => ({
  snap: {
    descriptors: {
      enabled: { type: 'boolean' as const, label: 'Enabled' },
      mode: { type: 'select' as const, label: 'Mode', options: ['fast', 'slow'] },
      token: { type: 'string' as const, label: 'Token', secret: true as const },
      limit: { type: 'number' as const, label: 'Limit', min: 1, max: 32 }
    },
    values: { enabled: true, mode: 'fast', token: 'secret', limit: 4 }
  } satisfies PluginSettingsSnapshot,
  setSettings: vi.fn(async (pluginId: string, values: Record<string, string | number | boolean | undefined>) => ({
    descriptors: {
      enabled: { type: 'boolean' as const, label: 'Enabled' },
      mode: { type: 'select' as const, label: 'Mode', options: ['fast', 'slow'] },
      token: { type: 'string' as const, label: 'Token', secret: true as const },
      limit: { type: 'number' as const, label: 'Limit', min: 1, max: 32 }
    },
    values: { enabled: true, mode: 'fast', token: 'secret', limit: 4, ...values }
  }))
}));

vi.mock('../lib/product-client.js', () => ({
  product: {
    pluginApps: {
      getSettings: vi.fn(async () => snap),
      setSettings
    }
  }
}));

const agentsSnap: PluginSettingsSnapshot = {
  descriptors: {
    customAgents: {
      type: 'string',
      multiline: true,
      label: 'Custom ACP agents',
      description:
        'JSON array of { id, displayName, command, args?, env? }. Ids must be unique and cannot reuse built-in providers.'
    }
  },
  values: { customAgents: '[]' }
};

describe('PluginSettingsForm', () => {
  it('renders boolean, select, and secret string fields without a nested Plugin settings heading', () => {
    const html = renderToStaticMarkup(
      <PluginSettingsForm snap={snap} onSave={() => undefined} />
    );
    expect(html).not.toContain('Plugin settings');
    expect(html).not.toContain('Persisted on the server');
    expect(html).toContain('Enabled');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('fast');
    expect(html).toContain('type="password"');
    expect(html).toContain('type="number"');
    expect(html).toContain('Limit');
    expect(html).toContain('data-control-placement="inline"');
    expect(html).toContain('plugin-setting-badge');
  });

  it('stacks a single multiline setting below its label and description', () => {
    const html = renderToStaticMarkup(
      <PluginSettingsForm snap={agentsSnap} onSave={() => undefined} />
    );
    expect(html).toContain('Custom ACP agents');
    expect(html).not.toContain('Custom ACP agentsJSON');
    expect(html).toContain('JSON array of { id, displayName, command, args?, env? }');
    expect(html).toContain('data-control-placement="below"');
    expect(html).toContain('rows="6"');
    expect(html).toContain('spellCheck="false"');
    expect(html).toContain('[]');
  });
});

describe('PluginDefinedSettings', () => {
  beforeEach(() => {
    vi.mocked(product.pluginApps.getSettings).mockReset().mockResolvedValue(snap);
    setSettings.mockReset().mockImplementation(async (_pluginId, values) => ({
      ...snap,
      values: { ...snap.values, ...values }
    }));
  });

  async function renderSettings(pluginId: string) {
    // Finish async snapshot loading and the field's initial passive effect
    // before dispatching edits; a DOM query alone can observe the first commit.
    await act(async () => { render(<PluginDefinedSettings pluginId={pluginId} />); });
  }

  afterEach(() => {
    cleanup();
    clearPluginSlots('custom-instructions');
    setSettings.mockClear();
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
    await renderSettings('custom-instructions');
    await waitFor(() => {
      expect(screen.getByText('Enabled')).toBeTruthy();
    });
    expect(screen.queryByText('Plugin settings')).toBeNull();
  });

  it('autosaves a multiline JSON setting on blur, not while typing', async () => {
    setSettings.mockImplementation(async (_pluginId, values) => ({
      ...agentsSnap,
      values: { ...agentsSnap.values, ...values }
    }));
    vi.mocked(product.pluginApps.getSettings).mockResolvedValueOnce(agentsSnap);
    await renderSettings('provider-acp');
    const agents = (await screen.findByLabelText('Custom ACP agents')) as HTMLTextAreaElement;
    expect(agents.value).toBe('[]');
    const edited = [
      '[',
      '  {',
      '    "id": "amp",',
      '    "displayName": "Amp",',
      '    "command": "amp",',
      '    "args": ["acp"]',
      '  }',
      ']'
    ].join('\n');
    fireEvent.change(agents, { target: { value: edited } });
    await waitFor(() => {
      expect(Number(agents.rows)).toBe(9);
    });
    expect(setSettings).not.toHaveBeenCalled();
    await act(async () => { fireEvent.blur(agents); });
    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith('provider-acp', { customAgents: edited });
    });
  });

  it('shows a save error under the field', async () => {
    setSettings.mockRejectedValueOnce(new Error('Custom agents must be a JSON array'));
    vi.mocked(product.pluginApps.getSettings).mockResolvedValueOnce(agentsSnap);
    await renderSettings('provider-acp');
    const agents = screen.getByLabelText('Custom ACP agents') as HTMLTextAreaElement;
    fireEvent.change(agents, { target: { value: '{}' } });
    expect(agents.value).toBe('{}');
    await act(async () => { fireEvent.blur(agents); });
    expect(setSettings).toHaveBeenCalledWith('provider-acp', { customAgents: '{}' });
    expect(screen.getByRole('alert').textContent).toContain(
      'Custom agents must be a JSON array'
    );
  });
});

describe('remote machine credentials toggle (default-on boolean plugin setting)', () => {
  const key = 'machineGitCredentialsEnabled';
  const label = 'Forward the GitHub CLI login to remote machines';
  const descriptor = {
    type: 'boolean' as const,
    label,
    description: 'Held in memory only, never saved. A GH_TOKEN already set on the machine always wins.',
    default: true
  };
  const forwardingOn: PluginSettingsSnapshot = { descriptors: { [key]: descriptor }, values: { [key]: true } };
  const forwardingOff: PluginSettingsSnapshot = { descriptors: { [key]: descriptor }, values: { [key]: false } };

  beforeEach(() => {
    vi.mocked(product.pluginApps.getSettings).mockReset();
    setSettings.mockReset().mockImplementation(async (_pluginId, values) => ({
      ...forwardingOn,
      values: { ...forwardingOn.values, ...values }
    }));
  });

  afterEach(() => {
    cleanup();
    setSettings.mockClear();
  });

  it('shows the default-on setting as an enabled switch with its description', () => {
    const html = renderToStaticMarkup(<PluginSettingsForm snap={forwardingOn} onSave={() => undefined} />);
    expect(html).toContain(label);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('never saved');
  });

  it('shows the switch off once the user turned forwarding off', () => {
    const html = renderToStaticMarkup(<PluginSettingsForm snap={forwardingOff} onSave={() => undefined} />);
    expect(html).toContain('aria-checked="false"');
  });

  it('saves the new value as soon as the switch is flipped, and again when it is flipped back', async () => {
    vi.mocked(product.pluginApps.getSettings).mockResolvedValue(forwardingOn);
    await act(async () => { render(<PluginDefinedSettings pluginId="remote-credentials-plugin" />); });
    const toggle = await screen.findByRole('switch', { name: label });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith('remote-credentials-plugin', { [key]: false });
    });
    expect(screen.getByRole('switch', { name: label }).getAttribute('aria-checked')).toBe('false');

    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: label })); });
    await waitFor(() => {
      expect(setSettings).toHaveBeenLastCalledWith('remote-credentials-plugin', { [key]: true });
    });
    expect(setSettings).toHaveBeenCalledTimes(2);
  });

  it('reports a failed save under the switch instead of pretending it was stored', async () => {
    vi.mocked(product.pluginApps.getSettings).mockResolvedValue(forwardingOn);
    setSettings.mockRejectedValueOnce(new Error('could not save'));
    await act(async () => { render(<PluginDefinedSettings pluginId="remote-credentials-plugin" />); });
    await act(async () => { fireEvent.click(await screen.findByRole('switch', { name: label })); });
    expect((await screen.findByRole('alert')).textContent).toContain('could not save');
  });
});
