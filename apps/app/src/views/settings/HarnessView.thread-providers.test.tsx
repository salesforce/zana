/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getThreadModelCatalog,
  prefetchThreadModelCatalog,
  reloadThreadProviderModels,
  resetThreadModelCatalog,
  type ThreadExecutionOptionsFetcher
} from '../../components/thread/pickers/thread-model-catalog.js';
import { HarnessSettingsTabs, mergeBuiltinThreadProviders, ThreadProviderCatalog } from './HarnessView.js';

const catalog = [
  { id: 'claude-code', displayName: 'Claude Code', pluginId: 'provider-claude-code' },
  { id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' },
  { id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' },
  { id: 'acp-cursor', displayName: 'Cursor', pluginId: 'provider-acp' },
  { id: 'acp-opencode', displayName: 'OpenCode', pluginId: 'provider-acp' }
];

type OptionsBody = Awaited<ReturnType<ThreadExecutionOptionsFetcher>>;

function modelRow(id: string, displayName = id): OptionsBody['models'][number] {
  return {
    id,
    model: id,
    displayName,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'medium' }],
    defaultReasoningEffort: 'medium',
    isDefault: false
  };
}

function providerRow(id: string, displayName = id): OptionsBody['providers'][number] {
  return {
    id,
    displayName,
    available: true,
    composerActions: [],
    capabilities: { permissionModes: ['full'] }
  };
}

afterEach(() => {
  cleanup();
  resetThreadModelCatalog();
});

describe('ThreadProviderCatalog', () => {
  it('keeps the display name and plugin id in separate cells', () => {
    const html = renderToStaticMarkup(<ThreadProviderCatalog providers={catalog} />);

    expect(html).not.toContain('Claude Codeprovider-claude-code');
    expect(html).toContain('class="opener-row-name">Claude Code<');
    expect(html).toContain('class="thread-provider-id" title="provider-claude-code">provider-claude-code<');
    expect(html).toContain('the default Modern provider.');
    expect(html).toContain('Agent Client Protocol');
    expect(html).toContain('Codex coding CLI');
    expect(html).toContain('Pi coding-agent CLI');
    expect(html).toContain('OpenCode via the Agent Client Protocol');
    expect(html).toContain('Not loaded');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('>Load<');
    expect(html).not.toContain('>Reload<');
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
    expect(html).toContain('No Modern providers registered.');
    expect(html).not.toContain('thread-provider-catalog');
  });

  it('falls back for unknown plugins', () => {
    const html = renderToStaticMarkup(
      <ThreadProviderCatalog
        providers={[{ id: 'other', displayName: 'Other', pluginId: 'provider-other' }]}
      />
    );
    expect(html).toContain('Registered Modern provider plugin.');
    expect(html).toContain('provider-other');
    expect(html).toContain('Other');
  });

  it('keeps model names and Load/Reload collapsed until the row is opened', async () => {
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => ({
      providers: [providerRow('pi', 'Pi')],
      models: query?.providerId === 'pi' ? [modelRow('openai/gpt-5.2', 'GPT-5.2')] : [],
      selectedOnlyModels: [],
      permissionCeiling: 'full',
      modelLoadError: null
    });
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();

    render(<ThreadProviderCatalog providers={[{ id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' }]} />);
    expect(screen.getByText('1 model')).toBeTruthy();
    expect(screen.queryByText('GPT-5.2')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Models for Pi' }));
    expect(screen.getByText('GPT-5.2')).toBeTruthy();
    expect(screen.getByText('openai/gpt-5.2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('shows the picker empty hint on the closed row and Load after expand', async () => {
    const fetcher: ThreadExecutionOptionsFetcher = async () => ({
      providers: [providerRow('acp-cursor', 'Cursor')],
      models: [],
      selectedOnlyModels: [],
      permissionCeiling: 'full',
      modelLoadError: { providerId: 'acp-cursor', code: 'timeout' }
    });
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();

    render(
      <ThreadProviderCatalog
        providers={[{ id: 'acp-cursor', displayName: 'Cursor', pluginId: 'provider-acp' }]}
      />
    );
    expect(screen.getByText('No models available (timeout)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Models for Cursor' }));
    expect(screen.getByRole('button', { name: 'Load' })).toBeTruthy();
  });

  it('asks to verify PI configuration when that catalog is empty', async () => {
    const fetcher: ThreadExecutionOptionsFetcher = async () => ({
      providers: [providerRow('pi', 'Pi')],
      models: [],
      selectedOnlyModels: [],
      permissionCeiling: 'full',
      modelLoadError: null
    });
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();

    render(<ThreadProviderCatalog providers={[{ id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' }]} />);
    expect(screen.getByText('No models available. Verify your PI configuration.')).toBeTruthy();
  });

  it('shows Loading on the closed row and disables Load while a fetch is in flight', async () => {
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      if (query?.providerId === 'pi') {
        await new Promise(() => undefined);
      }
      return {
        providers: [providerRow('pi', 'Pi')],
        models: [],
        selectedOnlyModels: [],
        permissionCeiling: 'full',
        modelLoadError: null
      };
    };
    resetThreadModelCatalog(fetcher);
    void reloadThreadProviderModels('pi');
    await vi.waitFor(() => {
      expect(getThreadModelCatalog().inflight.has('pi')).toBe(true);
    });

    render(<ThreadProviderCatalog providers={[{ id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' }]} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Models for Pi' }));
    expect((screen.getByRole('button', { name: 'Load' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('caps a long model list after the row is opened', async () => {
    const models = Array.from({ length: 14 }, (_, index) => modelRow(`model-${index}`, `Model ${index}`));
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => ({
      providers: [providerRow('pi', 'Pi')],
      models: query?.providerId === 'pi' ? models : [],
      selectedOnlyModels: [],
      permissionCeiling: 'full',
      modelLoadError: null
    });
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();

    render(<ThreadProviderCatalog providers={[{ id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' }]} />);
    expect(screen.getByText('14 models')).toBeTruthy();
    expect(screen.queryByText('Model 0')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Models for Pi' }));
    expect(screen.getByText('Model 0')).toBeTruthy();
    expect(screen.getByText('Model 11')).toBeTruthy();
    expect(screen.queryByText('Model 12')).toBeNull();
    expect(screen.getByText('and 2 more')).toBeTruthy();
  });
});

describe('HarnessSettingsTabs', () => {
  it('marks Modern selected by default and CLI Agent as the other tab', () => {
    const html = renderToStaticMarkup(
      <HarnessSettingsTabs pane="thread" onPaneChange={() => undefined} />
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Modern');
    expect(html).toContain('CLI Agent');
    expect(html).toContain('is-active');
  });

  it('marks CLI Agent selected when that pane is active', () => {
    const html = renderToStaticMarkup(
      <HarnessSettingsTabs pane="legacy" onPaneChange={() => undefined} />
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>\s*CLI Agent/);
  });
});
