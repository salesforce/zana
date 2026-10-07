// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { EffectiveHarnessDefaultResult, Project } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import type { ThreadModelCatalogSnapshot } from './thread/pickers/thread-model-catalog.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';

const h = vi.hoisted(() => ({
  projects: [] as Project[], hosts: [] as Array<{ id: string; status: string; isPrimary: boolean }>,
  personas: [], listeners: new Set<() => void>(),
  catalog: null as unknown as ThreadModelCatalogSnapshot,
  descriptors: [] as HarnessAdapterDescriptor[], remembered: null as string | null, rememberedModel: '',
  defaultHarness: 'claude', catalogScope: vi.fn(), ensure: vi.fn(), ensureProvider: vi.fn(), reloadProvider: vi.fn(),
  effectiveDefault: vi.fn(async (): Promise<EffectiveHarnessDefaultResult> => ({ ok: true, profile: 'claude', family: 'claude', source: 'global-default' })),
  createTerminal: vi.fn(async () => ({ id: 'terminal-1' })), selectTab: vi.fn(), pushToast: vi.fn(), clear: vi.fn(),
  remember: vi.fn(), loadProjects: vi.fn(),
  modelProps: null as null | { onSelectedProviderChange: (id: string) => void; onReloadModels?: () => void;
    selectedProviderId: string; modelLockedLabel?: string; modelIsLoading: boolean; providerOptions: Array<{ value: string }> }
}));

vi.mock('../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({ projects: h.projects, lastProjectId: h.projects[0]?.id,
    defaultHarness: h.defaultHarness, createTerminal: h.createTerminal, loadProjects: h.loadProjects, nativeAgentDiscoveryEnabled: true }),
  usePersonas: (select: (state: unknown) => unknown) => select({ personas: h.personas }),
  useUi: (select: (state: unknown) => unknown) => select({ selectTab: h.selectTab, pushToast: h.pushToast, selectedProjectId: null })
}));
vi.mock('../lib/product-client.js', () => ({ product: {
  harness: { descriptors: async () => h.descriptors, effectiveDefault: h.effectiveDefault }
} }));
vi.mock('../hooks/useHosts.js', () => ({
  useHosts: () => h.hosts,
  defaultHostId: (_hosts: unknown, project?: Project) => project?.hostId ?? 'primary-host'
}));
vi.mock('./thread/pickers/thread-model-catalog.js', () => ({ threadModelCatalogForHost: (hostId: string, projectId: string) => {
  h.catalogScope(hostId, projectId);
  return { subscribe: (listener: () => void) => { h.listeners.add(listener); return () => { h.listeners.delete(listener); }; },
    getSnapshot: () => h.catalog, ensure: h.ensure, ensureProvider: h.ensureProvider, reloadProvider: h.reloadProvider };
} }));
vi.mock('./thread/pickers/composer-selection-preference.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./thread/pickers/composer-selection-preference.js')>();
  return { ...actual, rememberedProviderId: () => h.remembered,
    rememberedSelectionFor: () => ({ model: h.rememberedModel }), rememberComposerSelection: h.remember };
});
vi.mock('./thread/pickers/useThreadPermissionMode.js', () => ({ useThreadPermissionMode: () => ({ permissionMode: 'accept-edits', setPermissionMode: vi.fn() }) }));
vi.mock('./composer/use-composer-prompt-field.js', () => ({ useComposerPromptField: () => ({
  text: 'Task', images: [], serialize: () => ({ text: 'Task', mentions: [] }), clear: h.clear,
  insertText: vi.fn(), setText: vi.fn(), focus: vi.fn(), handleChromeKeyDown: vi.fn(),
  dropHandlers: {}, canAttach: false, suggestions: [], typeaheadOpen: false
}) }));
vi.mock('./thread/voice/useVoiceInput.js', () => ({ useVoiceInput: () => ({ state: 'idle', isSupported: true, available: true, canStart: true, start: vi.fn() }) }));
vi.mock('./AgentLauncher.js', () => ({ buildLaunchArgs: (prompt: string) => ({ initialPrompt: prompt, title: 'Task' }) }));
vi.mock('./composer/ComposerPromptField.js', () => ({ ComposerPromptField: () => null }));
vi.mock('../plugins/PluginComposerChrome.js', () => ({ PluginComposerChrome: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../plugins/PluginComposerSlots.js', () => ({ PluginComposerAdvanced: () => null, PluginComposerMeta: () => null }));
vi.mock('./EnvironmentPicker.js', () => ({ EnvironmentPicker: () => null, defaultWorkspaceChoice: () => ({ kind: 'unmanaged' }) }));
vi.mock('./ComposerProjectPicker.js', () => ({ ComposerProjectPicker: () => null }));
vi.mock('./RemoteComposerConnection.js', () => ({ RemoteComposerConnection: () => null }));
vi.mock('./ui/PopoverPicklist.js', () => ({ PopoverPicklist: () => null }));
vi.mock('./thread/pickers/ComposerModePicker.js', () => ({ ComposerModePicker: () => null }));
vi.mock('./thread/pickers/ModelReasoningPicker.js', () => ({ ModelReasoningPicker: (props: NonNullable<typeof h.modelProps>) => {
  h.modelProps = props;
  return <><span data-testid="selected-provider">{props.selectedProviderId}</span>
    <span data-testid="model-status">{props.modelLockedLabel}</span>
    <button onClick={props.onReloadModels}>Reload models</button></>;
} }));

function catalog(providerIds: string[], missing: string[] = []): ThreadModelCatalogSnapshot {
  return {
    providers: providerIds.map(id => ({ id, displayName: id, permissionModes: ['accept-edits'], composerActions: [] })),
    byProvider: Object.fromEntries(providerIds.filter(id => !missing.includes(id)).map(id => [id, {
      models: [{ model: `${id}-live`, displayName: `${id} live` }], selectedOnlyModels: [], modelLoadError: null
    }])), inflight: new Set(missing)
  } as ThreadModelCatalogSnapshot;
}
const local = (): Project => ({ id: 'local', name: 'Local', path: '/tmp/local' } as Project);
const remote = (): Project => ({ id: 'remote', name: 'Remote', path: '/srv/project', hostId: 'remote-host',
  remote: { host: 'devbox', remotePath: '/srv/project' } } as Project);
function composer(project: Project) { return <MemoryRouter><LegacyAgentHomeComposer project={project} onLaunched={() => undefined} /></MemoryRouter>; }
function updateCatalog(next: ThreadModelCatalogSnapshot) {
  act(() => { h.catalog = next; for (const listener of [...h.listeners]) listener(); });
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  h.projects = [local(), remote()];
  h.hosts = [{ id: 'primary-host', status: 'connected', isPrimary: true }, { id: 'remote-host', status: 'connected', isPrimary: false }];
  h.catalog = catalog(['codex']); h.remembered = null; h.rememberedModel = '';
  h.effectiveDefault.mockReset().mockResolvedValue({ ok: true, profile: 'codex', family: 'codex', source: 'global-default' });
  h.descriptors = [{ id: 'codex', label: 'Codex', defaultProfileId: 'codex', profiles: [], targets: { models: [] } },
    { id: 'claude', label: 'Claude', defaultProfileId: 'claude', profiles: [], targets: { models: [] } }] as unknown as HarnessAdapterDescriptor[];
});
afterEach(cleanup);

describe('CLI Agent project-owned discovery', () => {
  it('uses the registered remote catalog and launches its offered harness through the primary SSH owner', async () => {
    render(composer(h.projects[1]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch agent' }).hasAttribute('disabled')).toBe(false));
    expect(h.catalogScope).toHaveBeenCalledWith('remote-host', 'remote');
    expect(h.effectiveDefault).not.toHaveBeenCalled();
    expect(h.modelProps!.providerOptions.map(row => row.value)).toEqual(['codex']);
    fireEvent.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(h.reloadProvider).toHaveBeenCalledWith('codex');
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(h.createTerminal).toHaveBeenCalledWith('remote', 'codex', 80, 24, expect.objectContaining({
      hostId: 'primary-host', harnessRouting: { schemaVersion: 1, byAdapter: { codex: { modelTargetId: 'codex-live', executionState: 'accept-edits' } } }
    })));
    expect(h.clear).toHaveBeenCalledOnce();
  });

  it('waits for a disconnected remote without fetching catalogs or substituting local providers', async () => {
    h.hosts = h.hosts.filter(host => host.id !== 'remote-host');
    const view = render(composer(h.projects[1]));
    expect(screen.getByRole('button', { name: 'Launch agent' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('model-status').textContent).toBe('Connect remote host to load models');
    expect(h.modelProps!.providerOptions).toEqual([]);
    expect(h.ensure).not.toHaveBeenCalled(); expect(h.ensureProvider).not.toHaveBeenCalled();
    h.hosts = [...h.hosts, { id: 'remote-host', status: 'connected', isPrimary: false }];
    view.rerender(composer(h.projects[1]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch agent' }).hasAttribute('disabled')).toBe(false));
    expect(h.ensure).toHaveBeenCalled();
  });

  it('keeps a remote launch disabled until the chosen provider has returned live models', async () => {
    h.catalog = catalog(['codex'], ['codex']);
    render(composer(h.projects[1]));
    await waitFor(() => expect(h.ensureProvider).toHaveBeenCalledWith('codex'));
    expect(h.modelProps!.modelIsLoading).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    expect(h.createTerminal).not.toHaveBeenCalled();
    updateCatalog(catalog(['codex']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch agent' }).hasAttribute('disabled')).toBe(false));
  });

  it('keeps a remembered offered harness and model on a remote project', async () => {
    h.remembered = 'codex'; h.rememberedModel = 'codex-live';
    h.catalog = catalog(['codex', 'claude-code']);
    render(composer(h.projects[1]));
    await waitFor(() => expect(screen.getByTestId('selected-provider').textContent).toBe('codex'));
    expect(h.effectiveDefault).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(h.createTerminal).toHaveBeenCalledWith('remote', 'codex', 80, 24, expect.objectContaining({ hostId: 'primary-host' })));
  });

  it('honors the offered project remote default and retains an explicit picker selection across roster refreshes', async () => {
    const project: Project = { ...h.projects[1], launchDefault: {
      schemaVersion: 1, kind: 'exact-profile', adapterId: 'claude', profileId: 'claude', source: 'project-canonical'
    } };
    h.catalog = catalog(['codex', 'claude-code']);
    render(composer(project));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch agent' }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByTestId('selected-provider').textContent).toBe('claude-code');
    act(() => h.modelProps!.onSelectedProviderChange('codex'));
    updateCatalog(catalog(['claude-code', 'codex']));
    expect(screen.getByTestId('selected-provider').textContent).toBe('codex');
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(h.createTerminal).toHaveBeenCalledWith('remote', 'codex', 80, 24, expect.any(Object)));
  });

  it('asks main for a local default and launches on the primary host', async () => {
    render(composer(h.projects[0]));
    await waitFor(() => expect(h.effectiveDefault).toHaveBeenCalledWith('local'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch agent' }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByTestId('selected-provider').textContent).toBe('codex');
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(h.createTerminal).toHaveBeenCalledWith('local', 'codex', 80, 24, expect.objectContaining({ hostId: 'primary-host' })));
  });

  it('lets a native-only harness own its model selection without offering model reload', async () => {
    h.remembered = 'codex'; h.rememberedModel = 'old-model';
    h.descriptors[0] = { ...h.descriptors[0], modelSelection: 'native-only' };
    render(composer(h.projects[0]));
    await waitFor(() => expect(h.modelProps!.onReloadModels).toBeUndefined());
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(h.createTerminal).toHaveBeenCalledWith('local', 'codex', 80, 24, expect.objectContaining({
      harnessRouting: { schemaVersion: 1, byAdapter: { codex: { executionState: 'accept-edits' } } }
    })));
    expect(h.reloadProvider).not.toHaveBeenCalled();
  });
});
