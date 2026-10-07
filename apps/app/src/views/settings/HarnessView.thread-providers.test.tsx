/**
 * @vitest-environment happy-dom
 */
import { useState } from 'react';
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
  { id: 'acp-opencode', displayName: 'OpenCode', pluginId: 'provider-acp' },
  { id: 'acp-afcode', displayName: 'Agentforce Code', pluginId: 'provider-afcode' }
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
  it('leads with readable names and keeps plugin details inside the disclosure', () => {
    render(<ThreadProviderCatalog providers={catalog} />);
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.queryByText('provider-claude-code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load', exact: true })).toBeNull();
    expect(screen.getAllByText('Not loaded')).toHaveLength(catalog.length);
    const row = screen.getByRole('button', { name: 'Models for Claude Code' });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    // The name itself is part of the full-row button.
    fireEvent.click(screen.getByText('Claude Code'));
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('provider-claude-code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load', exact: true })).toBeTruthy();
    fireEvent.click(row);
    expect(screen.queryByText('provider-claude-code')).toBeNull();
  });

  it('inserts OpenCode when a stale catalog omits it', () => {
    const merged = mergeBuiltinThreadProviders([
      { id: 'claude-code', displayName: 'Claude Code', pluginId: 'provider-claude-code' },
      { id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' },
      { id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' },
      { id: 'acp-cursor', displayName: 'Cursor', pluginId: 'provider-acp' }
    ]);
    expect(merged.map((row) => row.id)).toContain('acp-opencode');
    expect(merged.map((row) => row.id)).toEqual(expect.arrayContaining([
      'acp-omp',
      'acp-grok',
      'acp-mastracode',
      'acp-hermes-agent'
    ]));
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
    expect(html).toContain('A provider for Modern conversations.');
    expect(html).not.toContain('provider-other');
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
      modelLoadError: { providerId: 'acp-cursor', code: 'timeout' , detail: null }
    });
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();

    render(
      <ThreadProviderCatalog
        providers={[{ id: 'acp-cursor', displayName: 'Cursor', pluginId: 'provider-acp' }]}
      />
    );
    expect(screen.getByText('Timed out loading models (timeout)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Models for Cursor' }));
    expect(screen.getByRole('button', { name: 'Load' })).toBeTruthy();
  });

  it('asks to sign in with pi when that catalog is empty', async () => {
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
    expect(screen.getByText('Sign in with pi')).toBeTruthy();
  });

  it('asks to sign in with opencode auth login when listing reports auth_required', async () => {
    const fetcher: ThreadExecutionOptionsFetcher = async () => ({
      providers: [providerRow('acp-opencode', 'OpenCode')],
      models: [],
      selectedOnlyModels: [],
      permissionCeiling: 'full',
      modelLoadError: { providerId: 'acp-opencode', code: 'auth_required' , detail: null }
    });
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();

    render(
      <ThreadProviderCatalog
        providers={[{ id: 'acp-opencode', displayName: 'OpenCode', pluginId: 'provider-acp' }]}
      />
    );
    expect(screen.getByText('Sign in with opencode auth login')).toBeTruthy();
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

  it('pages a long model list and searches by name or ID without losing later models', async () => {
    const models = Array.from({ length: 14 }, (_, index) => modelRow(`model-${index}`, `Model ${index}`));
    models[0].isDefault = true;
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
    expect(screen.getByText('Provider default')).toBeTruthy();
    expect(screen.getByText('1–12 of 14 models')).toBeTruthy();
    const previous = screen.getByRole('button', { name: 'Previous Pi models' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Next Pi models' }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    fireEvent.click(next);
    expect(screen.getByText('Model 12')).toBeTruthy();
    expect(screen.getByText('13–14 of 14 models')).toBeTruthy();
    expect(next.disabled).toBe(true);
    expect(screen.queryByText('Model 0')).toBeNull();
    fireEvent.click(previous);
    expect(screen.getByText('Model 0')).toBeTruthy();
    fireEvent.click(next);
    const search = screen.getByRole('searchbox', { name: 'Search Pi models' });
    fireEvent.change(search, { target: { value: ' MODEL-3 ' } });
    expect(screen.getByText('Model 3')).toBeTruthy();
    expect(screen.getByText('1–1 of 1 model')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next Pi models' })).toBeNull();
    fireEvent.change(search, { target: { value: 'Model 1' } });
    expect(screen.getByText('1–5 of 5 models')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'absent' } });
    expect(screen.getByRole('status').textContent).toBe('No models match your search.');
    expect(screen.queryByText(/of \d+ model/)).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('1–12 of 14 models')).toBeTruthy();
  });

  it('clamps the current page when a refreshed catalogue gets smaller', async () => {
    let models = Array.from({ length: 14 }, (_, index) => modelRow(`model-${index}`, `Model ${index}`));
    resetThreadModelCatalog(async () => ({
      providers: [providerRow('pi', 'Pi')], models, selectedOnlyModels: [],
      permissionCeiling: 'full', modelLoadError: null
    }));
    await prefetchThreadModelCatalog();
    render(<ThreadProviderCatalog providers={[catalog[2]]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Models for Pi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next Pi models' }));
    models = [modelRow('new-model', 'New model')];
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await screen.findByText('New model');
    expect(screen.getByText('1–1 of 1 model')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Previous Pi models' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Pi models' }), { target: { value: 'New model' } });
    models = [];
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await screen.findByRole('button', { name: 'Load' });
    expect(screen.getByRole('status').textContent).toBe('Sign in with pi');
    expect(screen.queryByText('No models match your search.')).toBeNull();
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

  it('connects the selected tab with its panel and supports clicks and keyboard navigation', () => {
    function Tabs() {
      const [pane, setPane] = useState<'thread' | 'legacy'>('thread');
      return <HarnessSettingsTabs pane={pane} onPaneChange={setPane} />;
    }
    render(<Tabs />);
    const modern = screen.getByRole('tab', { name: 'Modern' });
    const cli = screen.getByRole('tab', { name: 'CLI Agent' });
    expect(modern.getAttribute('aria-controls')).toBe('settings-anchor-harness-thread');
    expect(cli.getAttribute('aria-controls')).toBe('settings-anchor-harness-legacy');
    expect(modern.tabIndex).toBe(0);
    expect(cli.tabIndex).toBe(-1);
    fireEvent.click(cli);
    expect(cli.getAttribute('aria-selected')).toBe('true');
    cli.focus();
    fireEvent.keyDown(cli, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(modern);
    expect(modern.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(modern, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cli);
    fireEvent.keyDown(cli, { key: 'Home' });
    expect(document.activeElement).toBe(modern);
    fireEvent.keyDown(modern, { key: 'End' });
    expect(document.activeElement).toBe(cli);
    fireEvent.keyDown(cli, { key: 'Tab' });
    expect(cli.getAttribute('aria-selected')).toBe('true');
  });
});

it('shows stale models, the error and the last success time after a failed refresh', async () => {
  let fail = false;
  resetThreadModelCatalog(async () => ({
    providers: [providerRow('codex')], models: fail ? [] : [modelRow('working')], selectedOnlyModels: [],
    permissionCeiling: 'full', modelLoadError: fail ? { providerId: 'codex', code: 'auth_required', detail: null } : null
  }));
  await prefetchThreadModelCatalog();
  fail = true;
  await reloadThreadProviderModels('codex');
  render(<ThreadProviderCatalog providers={[catalog[1]]} />);
  expect(screen.getByText('1 model · Refresh failed')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Models for Codex'));
  expect(screen.getByRole('status').textContent).toContain('Sign in with codex login');
  expect(screen.getByText(/^Last loaded:/)).toBeTruthy();
  expect(screen.getByText('working', { selector: 'code' })).toBeTruthy();
});
