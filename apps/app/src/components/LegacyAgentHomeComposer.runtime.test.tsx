// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { EffectiveHarnessDefaultResult, Project } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import type { ThreadModelCatalogSnapshot } from './thread/pickers/thread-model-catalog.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const h = vi.hoisted(() => ({
  projects: [] as Project[], hosts: [] as Array<{ id: string; status: string; isPrimary: boolean }>,
  personas: [], listeners: new Set<() => void>(),
  catalog: null as unknown as ThreadModelCatalogSnapshot,
  descriptors: [] as HarnessAdapterDescriptor[], remembered: null as string | null, rememberedModel: '',
  permissionError: undefined as string | undefined, voiceState: 'idle',
  defaultHarness: 'claude', catalogScope: vi.fn(), ensure: vi.fn(), ensureProvider: vi.fn(), refresh: vi.fn(),
  effectiveDefault: vi.fn(async (): Promise<EffectiveHarnessDefaultResult> => ({ ok: true, profile: 'claude', family: 'claude', source: 'global-default' })),
  createTerminal: vi.fn(async () => ({ id: 'terminal-1' })), selectTab: vi.fn(), pushToast: vi.fn(), clear: vi.fn(),
  remember: vi.fn(), loadProjects: vi.fn(), worktreeIsolationDefault: false,
  projectWorktreeIsolation: undefined as boolean | undefined, projectSettingsListeners: new Set<(projectId: string) => void>(),
  projectSettingsGet: vi.fn(async () => ({ worktreeIsolation: h.projectWorktreeIsolation })),
  environmentProps: null as null | { value: { kind: string }; onChange: (next: { kind: string }) => void },
  modelProps: null as null | { onModelChange: (value: string) => void; onSelectedProviderChange: (id: string) => void; onReloadModels?: () => void;
    selectedProviderId: string; modelLockedLabel?: string; modelIsLoading: boolean; providerOptions: Array<{ value: string }> },
  picklists: [] as Array<Array<{ value: string; label: string }>>
}));

vi.mock('../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({ projects: h.projects, lastProjectId: h.projects[0]?.id,
    defaultHarness: h.defaultHarness, createTerminal: h.createTerminal, loadProjects: h.loadProjects,
    worktreeIsolationDefault: h.worktreeIsolationDefault, nativeAgentDiscoveryEnabled: true }),
  usePersonas: (select: (state: unknown) => unknown) => select({ personas: h.personas }),
  useUi: (select: (state: unknown) => unknown) => select({ selectTab: h.selectTab, pushToast: h.pushToast, selectedProjectId: null })
}));
vi.mock('../lib/product-client.js', () => ({ product: {
  harness: { descriptors: async () => h.descriptors, effectiveDefault: h.effectiveDefault },
  projects: { ensureQuickAgent: async () => ({ ok: false as const }) },
  projectSettings: {
    get: (...args: [string]) => h.projectSettingsGet(...args),
    onChanged: (listener: (projectId: string) => void) => {
      h.projectSettingsListeners.add(listener);
      return () => h.projectSettingsListeners.delete(listener);
    }
  }
} }));
vi.mock('../hooks/useHosts.js', () => ({
  useHosts: () => h.hosts,
  defaultHostId: (_hosts: unknown, project?: Project) => project?.hostId ?? 'primary-host'
}));
vi.mock('./thread/pickers/thread-model-catalog.js', () => ({ threadModelCatalogForHost: (hostId: string, projectId: string) => {
  h.catalogScope(hostId, projectId);
  return { subscribe: (listener: () => void) => { h.listeners.add(listener); return () => { h.listeners.delete(listener); }; },
    getSnapshot: () => h.catalog, ensure: h.ensure, ensureProvider: h.ensureProvider, refresh: h.refresh };
} }));
vi.mock('./thread/pickers/composer-selection-preference.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./thread/pickers/composer-selection-preference.js')>();
  return { ...actual, rememberedProviderId: () => h.remembered,
    rememberedSelectionFor: () => ({ model: h.rememberedModel }), rememberComposerSelection: h.remember };
});
vi.mock('./thread/pickers/useThreadPermissionMode.js', () => ({ useThreadPermissionMode: () => ({ permissionMode: 'accept-edits', setPermissionMode: vi.fn(), selectionError: h.permissionError }) }));
vi.mock('./composer/use-composer-prompt-field.js', () => ({ useComposerPromptField: () => ({
  text: 'Task', images: [], serialize: () => ({ text: 'Task', mentions: [] }), clear: h.clear,
  captureRevision: () => 0, clearIfRevision: h.clear,
  insertText: vi.fn(), setText: vi.fn(), focus: vi.fn(), handleChromeKeyDown: vi.fn(),
  dropHandlers: {}, canAttach: false, suggestions: [], typeaheadOpen: false
}) }));
vi.mock('./thread/voice/useVoiceInput.js', () => ({ useVoiceInput: () => ({ state: h.voiceState, stream: null, visible: true, isSupported: true, available: true, canStart: true, start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }) }));
vi.mock('./AgentLauncher.js', () => ({ buildLaunchArgs: (prompt: string) => ({ initialPrompt: prompt, title: 'Task' }) }));
vi.mock('./composer/ComposerPromptField.js', () => ({ ComposerPromptField: () => null }));
vi.mock('../plugins/PluginComposerChrome.js', () => ({ PluginComposerChrome: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../plugins/PluginComposerSlots.js', () => ({ PluginComposerAdvanced: () => null, PluginComposerMeta: () => null }));
vi.mock('./EnvironmentPicker.js', () => ({
  EnvironmentPicker: (props: NonNullable<typeof h.environmentProps>) => {
    h.environmentProps = props;
    return <span data-testid="workspace-kind">{props.value.kind}</span>;
  },
  defaultWorkspaceChoice: (isolate: boolean) => ({ kind: isolate ? 'worktree' : 'unmanaged' })
}));
vi.mock('./ComposerProjectPicker.js', () => ({ ComposerProjectPicker: () => null }));
vi.mock('./RemoteComposerConnection.js', () => ({ RemoteComposerConnection: () => null }));
vi.mock('./ui/PopoverPicklist.js', () => ({ PopoverPicklist: ({ id, options }: { id?: string; options: Array<{ value: string; label: string }> }) => {
  h.picklists.push(options);
  return id ? <div data-testid={`picklist-${id}`} /> : null;
} }));
vi.mock('./thread/pickers/ComposerModePicker.js', () => ({ ComposerModePicker: (props: { onRefresh?: () => void }) => (
  props.onRefresh ? <button onClick={props.onRefresh}>Refresh modes</button> : null
) }));
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
  h.permissionError = undefined; h.voiceState = 'idle';
  h.worktreeIsolationDefault = false; h.projectWorktreeIsolation = undefined; h.projectSettingsListeners.clear(); h.environmentProps = null;
  h.projectSettingsGet.mockReset().mockImplementation(async () => ({ worktreeIsolation: h.projectWorktreeIsolation }));
  h.picklists = [];
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
    expect(h.refresh).toHaveBeenCalledWith('codex');
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

  it('refreshes the OpenCode provider catalog from the mode picker', async () => {
    h.catalog = catalog(['acp-opencode']);
    h.descriptors = [{ id: 'opencode', label: 'OpenCode', defaultProfileId: 'opencode', profiles: [], targets: { models: [] } }] as unknown as HarnessAdapterDescriptor[];
    h.effectiveDefault.mockResolvedValue({ ok: true, profile: 'opencode', family: 'opencode', source: 'global-default' });
    render(composer(h.projects[0]));
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh modes' }));
    expect(h.refresh).toHaveBeenCalledWith('acp-opencode');
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
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('renders project worktree override ahead of global default and reacts to setting changes', async () => {
    h.worktreeIsolationDefault = false;
    h.projectWorktreeIsolation = true;
    render(composer(h.projects[0]));
    await waitFor(() => expect(screen.getByTestId('workspace-kind').textContent).toBe('worktree'));

    h.projectWorktreeIsolation = false;
    act(() => { for (const listener of h.projectSettingsListeners) listener('local'); });
    await waitFor(() => expect(screen.getByTestId('workspace-kind').textContent).toBe('unmanaged'));
  });

  it('ignores a previous project settings read resolved after switching projects and cleans up listeners', async () => {
    const localSettings = deferred<{ worktreeIsolation: boolean }>();
    const secondSettings = deferred<{ worktreeIsolation: boolean }>();
    const secondProject: Project = { id: 'second', name: 'Second', path: '/tmp/second' } as Project;
    h.projectSettingsGet.mockImplementation((projectId: string) => (
      projectId === 'local' ? localSettings.promise : secondSettings.promise
    ));

    const view = render(composer(h.projects[0]));
    await waitFor(() => expect(h.projectSettingsListeners.size).toBe(1));
    view.rerender(composer(secondProject));
    await waitFor(() => expect(h.projectSettingsListeners.size).toBe(1));

    await act(async () => { secondSettings.resolve({ worktreeIsolation: false }); });
    await waitFor(() => expect(screen.getByTestId('workspace-kind').textContent).toBe('unmanaged'));
    await act(async () => { localSettings.resolve({ worktreeIsolation: true }); });
    expect(screen.getByTestId('workspace-kind').textContent).toBe('unmanaged');

    view.unmount();
    expect(h.projectSettingsListeners).toHaveLength(0);
  });

  it('keeps a user-picked workspace when project settings finish loading afterwards', async () => {
    const settings = deferred<{ worktreeIsolation: boolean }>();
    h.projectSettingsGet.mockImplementation(() => settings.promise);
    render(composer(h.projects[0]));
    await waitFor(() => expect(h.environmentProps).not.toBeNull());
    expect(screen.getByTestId('workspace-kind').textContent).toBe('unmanaged');

    act(() => h.environmentProps!.onChange({ kind: 'branch' }));
    expect(screen.getByTestId('workspace-kind').textContent).toBe('branch');
    await act(async () => { settings.resolve({ worktreeIsolation: true }); });
    expect(screen.getByTestId('workspace-kind').textContent).toBe('branch');
  });

  it('resets to the default workspace when switching to a project the user has not picked for', async () => {
    const second = { id: 'second', name: 'Second', path: '/tmp/second' } as Project;
    const view = render(composer(h.projects[0]));
    await waitFor(() => expect(h.environmentProps).not.toBeNull());
    act(() => h.environmentProps!.onChange({ kind: 'branch' }));
    expect(screen.getByTestId('workspace-kind').textContent).toBe('branch');
    view.rerender(composer(second));
    await waitFor(() => expect(screen.getByTestId('workspace-kind').textContent).toBe('unmanaged'));
  });

  it('forces the personal workspace for remote projects regardless of an earlier pick', async () => {
    const view = render(composer(h.projects[0]));
    await waitFor(() => expect(h.environmentProps).not.toBeNull());
    act(() => h.environmentProps!.onChange({ kind: 'branch' }));
    view.rerender(composer(h.projects[1]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch agent' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(h.createTerminal).toHaveBeenCalledWith('remote', 'codex', 80, 24,
      expect.objectContaining({ workspace: { kind: 'personal' } })));
  });

  it('clears the project worktree override and hides the workspace picker when no project resolves', async () => {
    h.projects = [];
    render(<MemoryRouter><LegacyAgentHomeComposer onLaunched={() => undefined} /></MemoryRouter>);
    await waitFor(() => expect(h.descriptors.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('workspace-kind')).toBeNull();
    expect(h.projectSettingsGet).not.toHaveBeenCalled();
  });

  it('falls back to the global default when the project settings read fails and ignores other-project changes', async () => {
    h.worktreeIsolationDefault = true;
    h.projectSettingsGet.mockRejectedValue(new Error('read failed'));
    render(composer(h.projects[0]));
    await waitFor(() => expect(h.projectSettingsGet).toHaveBeenCalledWith('local'));
    await waitFor(() => expect(screen.getByTestId('workspace-kind').textContent).toBe('worktree'));
    const calls = h.projectSettingsGet.mock.calls.length;
    act(() => { for (const listener of h.projectSettingsListeners) listener('someone-else'); });
    expect(h.projectSettingsGet.mock.calls.length).toBe(calls);
  });

  it('ignores a rejected settings read that settles after unmount', async () => {
    let reject!: (e: Error) => void;
    h.projectSettingsGet.mockImplementation(() => new Promise((_res, rej) => { reject = rej; }));
    const view = render(composer(h.projects[0]));
    await waitFor(() => expect(h.projectSettingsGet).toHaveBeenCalled());
    view.unmount();
    await act(async () => { reject(new Error('late')); });
  });
});

describe('CLI Agent retained launch choices', () => {
  const launchButton = () => screen.getByRole('button', { name: 'Launch agent' });
  const ready = () => waitFor(() => expect(launchButton().hasAttribute('disabled')).toBe(false));

  it('refuses to launch while the restored permission mode is unavailable', async () => {
    h.permissionError = 'The saved permission mode is unavailable.';
    render(composer(h.projects[1]));
    await ready();
    fireEvent.click(launchButton());
    expect((await screen.findByTestId('legacy-agent-command-error')).textContent).toBe('The saved permission mode is unavailable.');
    expect(h.createTerminal).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it('refuses a model the user chose that the live catalogue no longer offers, and launches once they pick an offered one', async () => {
    render(composer(h.projects[1]));
    await ready();
    act(() => h.modelProps!.onModelChange('retired-model'));
    fireEvent.click(launchButton());
    expect((await screen.findByTestId('legacy-agent-command-error')).textContent)
      .toBe('The saved model is unavailable. Choose an available model before launching.');
    expect(h.createTerminal).not.toHaveBeenCalled();
    act(() => h.modelProps!.onModelChange('codex-live'));
    fireEvent.click(launchButton());
    await waitFor(() => expect(h.createTerminal).toHaveBeenCalledWith('remote', 'codex', 80, 24, expect.objectContaining({
      harnessRouting: expect.objectContaining({ byAdapter: { codex: expect.objectContaining({ modelTargetId: 'codex-live' }) } })
    })));
  });

  it('keeps an explicitly chosen model when the roster refreshes with different defaults', async () => {
    h.catalog = catalog(['codex']);
    render(composer(h.projects[1]));
    await ready();
    act(() => h.modelProps!.onModelChange('codex-live'));
    updateCatalog({ ...catalog(['codex']), byProvider: { codex: { models: [{ model: 'codex-new', displayName: 'New' }, { model: 'codex-live', displayName: 'Live' }], selectedOnlyModels: [], modelLoadError: null } } } as ThreadModelCatalogSnapshot);
    fireEvent.click(launchButton());
    await waitFor(() => expect(h.createTerminal).toHaveBeenCalledWith('remote', 'codex', 80, 24, expect.objectContaining({
      harnessRouting: expect.objectContaining({ byAdapter: { codex: expect.objectContaining({ modelTargetId: 'codex-live' }) } })
    })));
  });

  it('shows the recording bar instead of the toolbar controls while dictating', async () => {
    h.voiceState = 'recording';
    render(composer(h.projects[1]));
    expect(await screen.findByTestId('thread-voice-bar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Launch agent' })).toBeNull();
  });
});

describe('CLI Agent persona picker', () => {
  it('keeps None first and sorts persona display options', async () => {
    h.personas = [
      { id: 'z', name: 'Zulu' },
      { id: 'a', name: 'Alpha' }
    ];
    render(composer(h.projects[0]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch agent' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('legacy-agent-customize-launch'));
    await waitFor(() => expect(h.picklists.some((options) => options[0]?.label === 'None')).toBe(true));
    const personaPicklist = h.picklists.find((options) => options[0]?.label === 'None');
    expect(personaPicklist).toEqual([
      { value: '', label: 'None' },
      { value: 'a', label: 'Alpha' },
      { value: 'z', label: 'Zulu' }
    ]);
  });
});
