import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HarnessSettingsTabs, mergeBuiltinThreadProviders, ThreadProviderCatalog } from './HarnessView.js';

const catalog = [
  { id: 'claude-code', displayName: 'Claude Code', pluginId: 'provider-claude-code' },
  { id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' },
  { id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' },
  { id: 'acp-cursor', displayName: 'Cursor', pluginId: 'provider-acp' },
  { id: 'acp-opencode', displayName: 'OpenCode', pluginId: 'provider-acp' }
];

describe('ThreadProviderCatalog', () => {
  it('keeps the display name and plugin id in separate cells', () => {
    const html = renderToStaticMarkup(<ThreadProviderCatalog providers={catalog} />);

    expect(html).not.toContain('Claude Codeprovider-claude-code');
    expect(html).toContain('class="opener-row-name">Claude Code<');
    expect(html).toContain('class="thread-provider-id" title="provider-claude-code">provider-claude-code<');
    expect(html).toContain('the default thread provider.');
    expect(html).toContain('Agent Client Protocol');
    expect(html).toContain('Codex coding CLI');
    expect(html).toContain('Pi coding-agent CLI');
    expect(html).toContain('OpenCode via the Agent Client Protocol');
  });

  it('inserts OpenCode when a stale catalog omits it', () => {
    const merged = mergeBuiltinThreadProviders([
      { id: 'claude-code', displayName: 'Claude Code', pluginId: 'provider-claude-code' },
      { id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' },
      { id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' },
      { id: 'acp-cursor', displayName: 'Cursor', pluginId: 'provider-acp' }
    ]);
    expect(merged.map((row) => row.id)).toContain('acp-opencode');
    expect(merged.find((row) => row.id === 'acp-opencode')).toEqual({
      id: 'acp-opencode',
      displayName: 'OpenCode',
      pluginId: 'provider-acp'
    });
  });

  it('renders an empty catalog without a list', () => {
    const html = renderToStaticMarkup(<ThreadProviderCatalog providers={[]} />);
    expect(html).toContain('No thread providers registered.');
    expect(html).not.toContain('thread-provider-catalog');
  });

  it('falls back for unknown plugins', () => {
    const html = renderToStaticMarkup(
      <ThreadProviderCatalog
        providers={[{ id: 'other', displayName: 'Other', pluginId: 'provider-other' }]}
      />
    );
    expect(html).toContain('Registered thread provider plugin.');
    expect(html).toContain('provider-other');
    expect(html).toContain('Other');
  });
});

describe('HarnessSettingsTabs', () => {
  it('marks Thread selected by default and Legacy Agent as the other tab', () => {
    const html = renderToStaticMarkup(
      <HarnessSettingsTabs pane="thread" onPaneChange={() => undefined} />
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Thread');
    expect(html).toContain('Legacy Agent');
    expect(html).toContain('is-active');
  });

  it('marks Legacy Agent selected when that pane is active', () => {
    const html = renderToStaticMarkup(
      <HarnessSettingsTabs pane="legacy" onPaneChange={() => undefined} />
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>\s*Legacy Agent/);
  });
});
