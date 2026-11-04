// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderIcon } from './ProviderIcon.js';
import { clearPluginSlots, interpretPluginApp } from '../../../plugins/plugin-slots.js';
import codexApp from '../../../../../../plugins/provider-codex/app.tsx';
import claudeApp from '../../../../../../plugins/provider-claude-code/app.tsx';
import acpApp from '../../../../../../plugins/provider-acp/app.tsx';
import piApp from '../../../../../../plugins/provider-pi/app.tsx';

const pluginId = 'provider-icon-test';
const providerApps = [
  ['codex', codexApp],
  ['claude-code', claudeApp],
  ['acp-cursor', acpApp],
  ['acp-opencode', acpApp],
  ['acp-omp', acpApp],
  ['acp-grok', acpApp],
  ['acp-mastracode', acpApp],
  ['acp-hermes-agent', acpApp],
  ['pi', piApp]
] as const;

afterEach(() => {
  cleanup();
  clearPluginSlots(pluginId);
});

describe('ProviderIcon', () => {
  it('renders the brand mark for a known harness', () => {
    const html = renderToStaticMarkup(<ProviderIcon providerId="claude-code" size={13} />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('lucide-bot');
    expect(html).not.toContain('lucide-message-square');
  });

  it('falls back to Bot when the harness has no brand mark', () => {
    const html = renderToStaticMarkup(<ProviderIcon providerId="unknown-plugin" size={13} />);
    expect(html).toContain('lucide-bot');
  });

  it.each(providerApps)('keeps %s sized when its plugin loads, reloads and unloads', (providerId, app) => {
    const { container, rerender } = render(<ProviderIcon providerId={providerId} size={14} className="card-harness" />);
    const expectSize = (size: number) => {
      const icon = container.querySelector('svg.card-harness');
      expect(icon?.getAttribute('width')).toBe(String(size));
      expect(icon?.getAttribute('height')).toBe(String(size));
      expect(icon?.querySelector('path')).toBeTruthy();
    };
    expectSize(14);
    act(() => { interpretPluginApp(pluginId, app); });
    expect(container.querySelector('svg title')).toBeTruthy();
    expectSize(14);
    rerender(<ProviderIcon providerId={providerId} size={20} className="card-harness" />);
    expectSize(20);
    act(() => { interpretPluginApp(pluginId, app); });
    expectSize(20);
    act(() => { clearPluginSlots(pluginId); });
    expectSize(20);
  });

  it.each(providerApps)('uses a compact default size for the %s plugin icon', (providerId, app) => {
    const registration = interpretPluginApp(pluginId, app).providerIcons.find((icon) => icon.providerId === providerId)!;
    const Icon = registration.icon;
    const { container } = render(<Icon />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('14');
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('14');
  });
});
