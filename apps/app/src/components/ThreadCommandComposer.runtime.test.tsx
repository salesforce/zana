// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCommandComposer, type ThreadCommandComposerProps } from './ThreadCommandComposer.js';
import { bootstrapOutcome, composerBootstrapErrorMessage } from './composer-host-status.js';
import { consumeVoiceDraft, voiceDraft } from './thread/voice/voice-drafts.js';
import { composerSession, resetComposerSessions } from './composer/composer-session.js';
import { ComposerDraftProvider } from './composer/ComposerDraft.js';

const h = vi.hoisted(() => {
  const provider = { id: 'codex', displayName: 'Codex', permissionModes: ['full'], composerActions: ['plan'] };
  return {
    project: { id: 'p1', name: 'Project', path: '/tmp/project' } as Project,
    text: 'Draft',
    images: [] as Array<{ id: string; name: string }>,
    attachments: [] as PromptInput[],
    editor: { isDestroyed: false },
    fieldArgs: null as null | { onSubmit: (options?: { modifierEnter?: boolean }) => void; slashCatalog?: { composerActions?: string[] } },
    reloadCommands: vi.fn(),
    voiceArgs: null as null | { onTranscript: (text: string) => void; ownerKey?: string },
    frozenSend: null as null | ((text: string) => Promise<void>),
    voice: { state: 'idle', stream: null, canRetry: false, isSupported: true, available: true, canStart: true,
      stop: vi.fn(), retry: vi.fn(), start: vi.fn(), cancel: vi.fn() },
    options: {
      providerId: 'codex', provider: provider as typeof provider | undefined, providers: [provider], registeredProviderIds: ['codex'],
      providerOptions: [], model: 'model-a', reasoningLevel: 'high', acpMode: undefined as string | undefined,
      selectionError: undefined as string | undefined, catalogSettled: true,
      rosterReady: true, serviceTierOptions: undefined as undefined | Array<{ id: string; label: string }>,
      acpModeOptions: [], modelOptions: [], moreModelOptions: [], reasoningOptions: [], modelIsLoading: false,
      setProviderId: vi.fn(), setModel: vi.fn(), setReasoningLevel: vi.fn(), setAcpMode: vi.fn(),
      refreshAcpModeOptions: vi.fn(), refreshModels: vi.fn()
    },
    permissionError: undefined as string | undefined, rememberSendMode: vi.fn(),
    clear: vi.fn(), insertText: vi.fn(), removeAttachment: vi.fn(),
    send: vi.fn(async () => undefined),
    create: vi.fn(async (): Promise<{ ok: boolean; value: { id: string }; message?: string }> => ({ ok: true, value: { id: 'created' } })),
    upsert: vi.fn(), persistImages: vi.fn(async () => ['/tmp/uploaded.png']),
    loadProjects: vi.fn(), navigateOnCreate: false, hostBlocked: false, cliBlocked: false,
    threads: [] as Array<{ id: string; hostId: string; projectId: string; environmentId?: string }>,
    hostAction: { kind: 'ready' } as Record<string, unknown>,
    hosts: [] as Array<{ id: string; name?: string }>,
    drawer: vi.fn(), appendLogs: vi.fn(), setDrawerOpen: vi.fn(),
    bootstrap: vi.fn(async () => []), repair: vi.fn(async () => []),
    updateSsh: vi.fn(async () => undefined)
  };
});

vi.mock('../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({ projects: [h.project], lastProjectId: 'p1',
    loadProjects: h.loadProjects, defaultHarness: 'codex', composerSendMode: 'queue-if-active',
    setComposerSendMode: h.rememberSendMode, nativeAgentDiscoveryEnabled: false }),
  useUi: Object.assign((select: (state: unknown) => unknown) => select({ selectedProjectId: 'p1' }),
    { getState: () => ({ appendHostInstallLogs: h.appendLogs, setHostInstallDrawerOpen: h.setDrawerOpen }) })
}));
vi.mock('../lib/host-install-run.js', () => ({ runHostInstallWithDrawer: h.drawer }));
vi.mock('../thread-store.js', () => ({ useThreads: (select: (state: unknown) => unknown) => select({ threads: h.threads, upsert: h.upsert }) }));
vi.mock('../lib/product-client.js', () => ({ product: {
  hosts: { bootstrap: h.bootstrap, repair: h.repair, updateSshIdentity: h.updateSsh },
  threads: { send: h.send, create: h.create, promptHistory: async () => ({ entries: [] }), compact: vi.fn(), stop: vi.fn() }
} }));
vi.mock('../hooks/useHosts.js', () => ({ defaultHostId: () => 'host1', useHosts: () => h.hosts }));
vi.mock('../hooks/useRouteState.js', () => ({ useRouteState: () => ({ isProjectFocused: false }) }));
vi.mock('../hooks/usePublicAppUrl.js', () => ({ usePublicAppUrl: () => null }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/use-boolean-preference.js', () => ({ useBooleanPreference: () => [h.navigateOnCreate] }));
vi.mock('../lib/prompt-attachments.js', () => ({ persistComposerImages: h.persistImages }));
vi.mock('./composer-host-status.js', () => ({
  composerHostsForProject: () => [], resolveComposerHostAction: () => h.hostAction,
  shouldBlockComposerSend: () => h.hostBlocked, shouldShowHostPicker: () => false,
  composerRemoteHostBadge: () => null, isForeignExecutionHost: () => false,
  bootstrapOutcome: vi.fn(), composerBootstrapErrorMessage: vi.fn()
}));
vi.mock('./thread/pickers/useThreadComposerOptions.js', () => ({ useThreadComposerOptions: () => h.options }));
vi.mock('./thread/pickers/useThreadPermissionMode.js', () => ({ useThreadPermissionMode: () => ({ permissionMode: 'full', setPermissionMode: vi.fn(), selectionError: h.permissionError }) }));
vi.mock('./composer/use-composer-provider-cli.js', () => ({ useComposerProviderCli: () => ({ blocked: h.cliBlocked }) }));
vi.mock('./composer/useMobileComposerExpansion.js', () => ({ useMobileComposerExpansion: () => undefined }));
vi.mock('./composer/use-composer-prompt-field.js', () => ({
  useComposerPromptField: (args: typeof h.fieldArgs) => {
    useEffect(() => { h.reloadCommands(); }, [args?.slashCatalog?.composerActions]);
    h.fieldArgs = args;
    return { editor: h.editor, text: h.text, images: h.images, restoredAttachments: h.attachments,
      serialize: () => ({ text: h.text, mentions: [] }), clear: h.clear, insertText: h.insertText,
      captureRevision: () => JSON.stringify([h.text, h.images, h.attachments]),
      clearIfRevision: (revision: string) => {
        if (revision === JSON.stringify([h.text, h.images, h.attachments])) h.clear();
      },
      removeRestoredAttachment: h.removeAttachment, setText: vi.fn(), replacePrompt: vi.fn(), focus: vi.fn(),
      markRestoreFocus: vi.fn(), handleChromeKeyDown: vi.fn(), dropHandlers: {},
      suggestions: [], typeaheadOpen: false, canAttach: false };
  }
}));
vi.mock('./thread/voice/useVoiceInput.js', () => ({ useVoiceInput: (args: typeof h.voiceArgs) => { h.voiceArgs = args; return h.voice; } }));
vi.mock('./thread/voice/waveform.js', () => ({ startWaveform: () => () => undefined }));
vi.mock('../plugins/PluginComposerChrome.js', () => ({ PluginComposerChrome: ({ children, allowCreatePlugin }: { children: ReactNode; allowCreatePlugin?: boolean }) =>
  <div data-testid="plugin-chrome" data-create-plugin={String(allowCreatePlugin ?? true)}>{children}</div> }));
vi.mock('../plugins/PluginComposerSlots.js', () => ({ PluginComposerAdvanced: () => null, PluginComposerMeta: () => null }));
vi.mock('./composer/ComposerPromptField.js', () => ({ ComposerPromptField: () => <div /> }));
vi.mock('./EnvironmentPicker.js', () => ({ EnvironmentPicker: () => null, defaultWorkspaceChoice: () => ({ kind: 'unmanaged' }) }));
vi.mock('./HostMachinePicker.js', () => ({ HostMachinePicker: () => null }));
vi.mock('./HostSshIdentityDialog.js', () => ({ HostSshIdentityDialog: ({ onSubmit, onClose }: { onSubmit: (i: unknown) => Promise<void>; onClose: () => void }) =>
  <><button onClick={() => void onSubmit({ host: 'x' })}>Bind SSH</button><button onClick={onClose}>Close SSH</button></> }));
vi.mock('./ComposerHostActionChip.js', () => ({ ComposerHostActionChip: ({ onAction, onCopyPairing, pairingCommand, busyLabel }: any) =>
  <><button data-testid="host-action" onClick={onAction}>{busyLabel ?? 'act'}</button>
    {pairingCommand ? <span data-testid="pairing">{pairingCommand}</span> : null}
    {onCopyPairing ? <button onClick={onCopyPairing}>copy</button> : null}</> }));
vi.mock('./ComposerRemoteHostBadge.js', () => ({ ComposerRemoteHostBadge: () => null }));
vi.mock('./ComposerProjectPicker.js', () => ({ ComposerProjectPicker: () => null }));
vi.mock('./thread/ThreadContextMeter.js', () => ({ ThreadContextMeter: () => null }));
vi.mock('./ui/PopoverPicklist.js', () => ({ PopoverPicklist: () => null }));
vi.mock('./thread/pickers/ComposerModePicker.js', () => ({ ComposerModePicker: ({ onChange, value }: { onChange: (mode: string) => void; value: string }) =>
  <button data-mode={value} onClick={() => onChange('plan')}>Plan mode</button> }));
vi.mock('./thread/pickers/ModelReasoningPicker.js', () => ({ ModelReasoningPicker: ({ onReloadModels }: { onReloadModels: () => void }) =>
  <button onClick={onReloadModels}>Reload models</button> }));
vi.mock('./thread/pickers/ReasoningEffortPicker.js', () => ({ ReasoningEffortPicker: () => null }));
vi.mock('./thread/pickers/ComposerSendModePicker.js', () => ({ ComposerSendModePicker: ({ onChange, value }: { onChange: (mode: string) => void; value: string }) =>
  <button data-send-mode={value} onClick={() => onChange('steer')}>Send mode</button> }));

beforeEach(() => {
  resetComposerSessions();
  vi.clearAllMocks();
  h.text = 'Draft'; h.images = []; h.attachments = []; h.editor.isDestroyed = false;
  h.voice.state = 'idle'; h.voice.canRetry = false; h.frozenSend = null;
  h.options.provider = { id: 'codex', displayName: 'Codex', permissionModes: ['full'], composerActions: ['plan'] };
  h.options.providerId = 'codex';
  h.options.providers = [h.options.provider];
  h.permissionError = undefined; h.options.selectionError = undefined; h.options.catalogSettled = true;
  h.options.rosterReady = true; h.options.serviceTierOptions = undefined; h.options.registeredProviderIds = ['codex'];
  h.navigateOnCreate = false; h.hostBlocked = false; h.cliBlocked = false;
  h.threads = [{ id: 't1', hostId: 'host1', projectId: 'p1' }];
  h.hostAction = { kind: 'ready' }; h.hosts = []; h.project = { id: 'p1', name: 'Project', path: '/tmp/project' } as Project;
  h.voice.stop.mockImplementation((send?: (text: string) => Promise<void>) => { h.frozenSend = send ?? null; });
  for (const id of ['t1', 't2', null]) {
    const owner = JSON.stringify([id, 'p1', 'host1']);
    consumeVoiceDraft(owner, voiceDraft(owner));
  }
});
afterEach(cleanup);
function composer(props: Partial<ThreadCommandComposerProps> = {}) {
  return <MemoryRouter><ThreadCommandComposer project={h.project} threadId="t1" {...props} /></MemoryRouter>;
}
async function transcribeAndSend(text = 'Spoken words') {
  fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
  expect(h.frozenSend).not.toBeNull();
  await act(async () => { await h.frozenSend!(text); });
}

describe('Modern composer submission contracts', () => {
  it('keeps an unavailable custom provider catalogue stable until discovery recovers', () => {
    h.options.providerId = 'acp-custom';
    h.options.provider = undefined;
    h.options.providers = [];
    const view = render(composer());
    expect(h.reloadCommands).toHaveBeenCalledOnce();
    view.rerender(composer({ status: 'running' }));
    view.rerender(composer({ status: 'idle' }));
    expect(h.reloadCommands).toHaveBeenCalledOnce();
    h.options.provider = { id: 'acp-custom', displayName: 'Custom', permissionModes: ['full'], composerActions: ['plan'] };
    view.rerender(composer());
    expect(h.reloadCommands).toHaveBeenCalledTimes(2);
    h.options.providerId = 'another-custom'; h.options.provider = undefined;
    view.rerender(composer());
    expect(h.reloadCommands).toHaveBeenCalledTimes(3);
  });
  it('keeps a failed submission intact and reports its error', async () => {
    h.send.mockRejectedValueOnce(new Error('Send rejected'));
    render(composer());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('thread-command-error').textContent).toBe('Send rejected'));
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.text).toBe('Draft');
  });
  it.each([undefined, 'default', 'priority', 'unsupported'])('normalizes service tier %s against the live provider and sends restored attachments', async tier => {
    h.text = '';
    h.attachments = [{ type: 'localImage', path: '/tmp/restored.png' }];
    h.options.serviceTierOptions = [{ id: 'priority', label: 'Priority' }];
    render(composer({ serviceTier: tier }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(h.send).toHaveBeenCalledWith('t1', h.attachments, 'queue-if-active', expect.objectContaining({
      serviceTier: tier === 'unsupported' ? 'default' : tier
    })));
    expect(h.clear).toHaveBeenCalledOnce();
  });

  it('passes a tier to new threads and retains it until a provider roster can validate it', async () => {
    h.options.rosterReady = false;
    const view = render(composer({ threadId: undefined, serviceTier: 'priority' }));
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    h.options.rosterReady = true;
    view.rerender(composer({ threadId: undefined, serviceTier: 'priority' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ serviceTier: 'priority' })));
    expect(h.upsert).toHaveBeenCalledWith({ id: 'created' });
  });

  it('removes restored attachments and reloads provider models through the real composer', () => {
    h.attachments = [{ type: 'localImage', path: '/tmp/restored.png' }, { type: 'image', url: 'data:image/png;base64,YQ==' }];
    render(composer());
    expect(screen.getByText('restored.png')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove restored attachment' })[1]);
    expect(h.removeAttachment).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(h.options.refreshModels).toHaveBeenCalledOnce();
  });
});

describe('Modern composer catalogue scope', () => {
  it('scopes the prompt field to the thread record while the thread view has not pinned its project yet', () => {
    h.threads = [{ id: 't1', hostId: 'host2', projectId: 'p2', environmentId: 'env2' }];
    render(composer({ project: undefined }));
    expect(h.fieldArgs).toEqual(expect.objectContaining({
      projectId: 'p2', hostId: 'host2', environmentId: 'env2', projectRoot: undefined
    }));
  });

  it('falls back to the composer project when there is no thread record', () => {
    h.threads = [];
    render(composer({ threadId: undefined }));
    expect(h.fieldArgs).toEqual(expect.objectContaining({ projectId: 'p1', projectRoot: '/tmp/project' }));
  });
});

describe('Modern composer beside a plugin page', () => {
  const pluginPanel = { pluginId: 'salesforce', panel: 'salesforce' };

  it('fixes the page project and run target, and drops Create plugin', async () => {
    h.threads = [];
    const view = render(composer({ threadId: undefined, pluginPanel }));
    expect(view.container.querySelector('.thread-command-project')).toBeNull();
    expect(screen.queryByText('Working folder')).toBeNull();
    expect(screen.getByTestId('host-action')).toBeTruthy();
    expect(screen.getByTestId('plugin-chrome').dataset.createPlugin).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', pluginPanel })));
  });

  it('keeps the project and run pickers when the page has no project', () => {
    h.threads = [];
    const view = render(composer({ threadId: undefined, project: undefined, composerProjectId: 'p1', pluginPanel }));
    expect(view.container.querySelector('.thread-command-project')).not.toBeNull();
    expect(screen.getByText('Working folder')).toBeTruthy();
    expect(screen.getByTestId('plugin-chrome').dataset.createPlugin).toBe('false');
  });

  it('keeps Create plugin on an ordinary new-thread composer', () => {
    h.threads = [];
    render(composer({ threadId: undefined }));
    expect(screen.getByTestId('plugin-chrome').dataset.createPlugin).toBe('true');
  });
});

describe('Modern composer remote project binding', () => {
  it('sends new threads to the project\'s current host after it is rebound', async () => {
    const original = h.project;
    h.threads = [];
    h.project = { ...original, remote: { host: 'devbox' }, hostId: 'old-host' } as Project;
    const view = render(composer({ threadId: undefined, project: h.project }));
    h.project = { ...h.project, hostId: 'new-host' } as Project;
    view.rerender(composer({ threadId: undefined, project: h.project }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'new-host' })));
    h.project = original;
  });
});

describe('Modern composer voice submission', () => {
  it('delivers a normal transcript only to its owning thread, including after navigation', () => {
    const view = render(composer());
    const original = h.voiceArgs!.onTranscript;
    view.rerender(composer({ threadId: 't2' }));
    act(() => original('Transcript for first thread'));
    expect(h.insertText).not.toHaveBeenCalled();
    view.rerender(composer());
    expect(h.insertText).toHaveBeenCalledWith('Transcript for first thread');
    expect(voiceDraft(JSON.stringify(['t1', 'p1', 'host1']))).toBe('');
  });

  it('freezes the draft and restored attachments when recording is sent, preserving later edits', async () => {
    h.voice.state = 'recording';
    h.attachments = [{ type: 'localImage', path: '/tmp/restored.png' }];
    render(composer({ serviceTier: 'priority' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    h.text = 'New draft'; h.attachments = [];
    await act(async () => { await h.frozenSend!('Spoken words'); });
    expect(h.send).toHaveBeenCalledWith('t1', [
      { type: 'text', text: 'Draft\nSpoken words', mentions: [] },
      { type: 'localImage', path: '/tmp/restored.png' }
    ], 'queue-if-active', expect.objectContaining({ serviceTier: 'priority' }));
    expect(h.clear).not.toHaveBeenCalled();
  });

  it('uploads frozen images and clears an unchanged draft after a successful voice send', async () => {
    h.voice.state = 'recording'; h.images = [{ id: 'image', name: 'image.png' }];
    render(composer());
    await transcribeAndSend();
    expect(h.persistImages).toHaveBeenCalledWith('p1', h.images);
    expect(h.send).toHaveBeenCalledWith('t1', [
      { type: 'text', text: 'Draft\nSpoken words', mentions: [] },
      { type: 'localImage', path: '/tmp/uploaded.png' }
    ], 'queue-if-active', expect.any(Object));
    expect(h.clear).toHaveBeenCalledOnce();
  });

  it('creates a new thread from a recording and reports the created thread to its owner', async () => {
    h.voice.state = 'recording'; h.text = '';
    const onCreated = vi.fn();
    render(composer({ threadId: undefined, onCreated }));
    await transcribeAndSend();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', providerId: 'codex', hostId: 'host1',
      cwd: '/tmp/project', environment: { kind: 'unmanaged' }, input: [{ type: 'text', text: 'Spoken words', mentions: [] }] }));
    expect(onCreated).toHaveBeenCalledWith('created');
    expect(h.clear).toHaveBeenCalledOnce();
  });

  it.each([
    [undefined, '/threads/created'],
    [false, '/']
  ])('lets navigateOnCreate=%s override the open-on-create preference', async (navigateOnCreate, expected) => {
    h.navigateOnCreate = true;
    function LocationProbe() { return <output data-testid="location">{useLocation().pathname}</output>; }
    render(
      <MemoryRouter>
        <ThreadCommandComposer project={h.project} navigateOnCreate={navigateOnCreate} />
        <LocationProbe />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(expected));
  });

  it('clears the submitted session after navigation without navigating its replacement', async () => {
    h.voice.state = 'recording';
    const onCreated = vi.fn();
    const view = render(composer({ threadId: undefined, onCreated }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    const frozen = h.frozenSend!;
    view.rerender(composer({ threadId: 't2', onCreated }));
    await act(async () => { await frozen('Spoken words'); });
    expect(h.upsert).toHaveBeenCalledWith({ id: 'created' });
    expect(onCreated).not.toHaveBeenCalled();
    expect(h.clear).toHaveBeenCalledOnce();
  });

  it('keeps a failed voice submission retryable without inserting a duplicate transcript', async () => {
    h.voice.state = 'recording';
    h.send.mockRejectedValueOnce(new Error('Disconnected'));
    render(composer());
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    await act(async () => { await expect(h.frozenSend!('Spoken words')).rejects.toThrow('Disconnected'); });
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.insertText).not.toHaveBeenCalled();
    await act(async () => { await h.frozenSend!('Spoken words'); });
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[0]).toEqual(h.send.mock.calls[1]);
    expect(h.clear).toHaveBeenCalledOnce();
  });

  it('retains a failed new-thread recording and exposes transcription retry', async () => {
    h.voice.state = 'recording'; h.voice.canRetry = true;
    h.create.mockResolvedValueOnce({ ok: false, value: { id: '' }, message: 'Host unavailable' });
    render(composer({ threadId: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry voice transcription' }));
    expect(h.voice.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    await act(async () => { await expect(h.frozenSend!('Spoken words')).rejects.toThrow('Host unavailable'); });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop and transcribe recording' }));
    expect(h.voice.stop).toHaveBeenLastCalledWith();
  });

  it.each(['waiting', 'starting', 'waiting-for-host', 'stopping'])('does not send a recording when the existing thread is %s', status => {
    h.voice.state = 'recording';
    render(composer({ status }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    expect(h.voice.stop).not.toHaveBeenCalled();
  });
});

describe('Peer daemon install and repair from the composer', () => {
  const mockedOutcome = () => vi.mocked(bootstrapOutcome);
  /** Drive onSettled with a canned result; optionally run the real `run` callback too. */
  function settle(events: Array<Record<string, unknown>>, runCallback = false) {
    h.drawer.mockImplementation(async (input: any) => {
      if (runCallback) await input.run(() => undefined);
      await input.onSettled(events);
    });
  }
  const click = async () => { await act(async () => { fireEvent.click(screen.getByTestId('host-action')); }); };

  it('binds the host and reloads projects after a successful install', async () => {
    h.hostAction = { kind: 'install', reason: 'r' };
    settle([], true);
    mockedOutcome().mockReturnValue({ ok: true, hostId: 'hNew' });
    render(composer());
    await click();
    expect(h.drawer).toHaveBeenCalledWith(expect.objectContaining({ kind: 'install', target: 'remote machine' }));
    expect(h.bootstrap).toHaveBeenCalledWith('p1', expect.any(Function));
    expect(h.loadProjects).toHaveBeenCalled();
    expect(screen.queryByTestId('pairing')).toBeNull();
  });

  it('surfaces the failure message and pairing command, no ssh dialog for non-identity errors', async () => {
    h.hostAction = { kind: 'install', reason: 'r' };
    settle([]);
    vi.mocked(composerBootstrapErrorMessage).mockReturnValue('pairing door closed');
    mockedOutcome().mockReturnValue({ ok: false, code: 'join_expired', message: 'm', pairingCommand: 'ssh x' });
    render(composer());
    await click();
    expect(screen.getByTestId('pairing').textContent).toBe('ssh x');
    expect(screen.queryByText('Bind SSH')).toBeNull();
    expect(h.loadProjects).not.toHaveBeenCalled();
  });

  it('failure without pairing command leaves it unset and ignores ssh code when no target host', async () => {
    h.hostAction = { kind: 'install', reason: 'r' };
    settle([]);
    mockedOutcome().mockReturnValue({ ok: false, code: 'ssh_identity_required', message: 'm' });
    render(composer());
    await click();
    expect(screen.queryByTestId('pairing')).toBeNull();
    expect(screen.queryByText('Bind SSH')).toBeNull();
  });

  it.each([
    ['named host', [{ id: 'hR', name: 'Box' }]],
    ['unknown host', []]
  ])('opens the ssh identity dialog on ssh_identity_required for a %s, then repairs after binding', async (_n, roster) => {
    h.hosts = roster;
    h.hostAction = { kind: 'fix', hostId: 'hR', reason: 'r' };
    settle([], true);
    mockedOutcome().mockReturnValueOnce({ ok: false, code: 'ssh_identity_required', message: 'm' })
      .mockReturnValue({ ok: true, hostId: 'hR' });
    render(composer());
    await click();
    expect(h.repair).toHaveBeenCalledWith('hR', expect.any(Function));
    expect(screen.getByText('Bind SSH')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('Bind SSH')); });
    expect(h.updateSsh).toHaveBeenCalledWith('hR', { host: 'x' });
    expect(screen.queryByText('Bind SSH')).toBeNull();
    expect(h.loadProjects).toHaveBeenCalled();
  });

  it('uses user@host for a remote project target', async () => {
    h.project = { id: 'p1', name: 'P', path: '/x', remote: { host: 'devbox', user: 'me' } } as unknown as Project;
    h.hostAction = { kind: 'install', reason: 'r' };
    settle([], true);
    mockedOutcome().mockReturnValue({ ok: true, hostId: 'h1' });
    render(composer({ project: h.project }));
    await click();
    expect(h.drawer).toHaveBeenCalledWith(expect.objectContaining({ target: 'me@devbox' }));
    expect(h.bootstrap).toHaveBeenCalled();
  });

  it('uses the bare host for a remote project without user, and the thrown error message', async () => {
    h.project = { id: 'p1', name: 'P', path: '/x', remote: { host: 'devbox' } } as unknown as Project;
    h.hostAction = { kind: 'install', reason: 'r' };
    h.drawer.mockRejectedValue('boom');
    render(composer({ project: h.project }));
    await click();
    expect(h.drawer).toHaveBeenCalledWith(expect.objectContaining({ target: 'devbox' }));
    h.drawer.mockRejectedValue(new Error('drawer exploded'));
    await click();
    expect(h.drawer).toHaveBeenCalledTimes(2);
  });

  it('opens the drawer instead of restarting while busy', async () => {
    h.hostAction = { kind: 'fix', hostId: 'hR', reason: 'r' };
    let release!: () => void;
    h.drawer.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    render(composer());
    await click();
    await click();
    expect(h.setDrawerOpen).toHaveBeenCalledWith(true);
    await act(async () => { release(); });
  });

  it('asks for the ssh identity first when the fix needs a pick, and ignores non-actionable states', async () => {
    h.hostAction = { kind: 'fix', hostId: 'hR', needsSshPick: true, reason: 'r' };
    render(composer());
    await click();
    expect(h.drawer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Close SSH'));
    expect(screen.queryByText('Bind SSH')).toBeNull();
    cleanup();
    h.hostAction = { kind: 'blocked', reason: 'r' };
    render(composer());
    await click();
    expect(h.drawer).not.toHaveBeenCalled();
  });

  it('follows a remote project rebind and keeps the current host when the project has no binding', () => {
    const remote = { id: 'p1', name: 'P', path: '/x', remote: { host: 'devbox' }, hostId: 'hBound' } as unknown as Project;
    const view = render(composer({ project: remote }));
    view.rerender(composer({ project: { ...remote, hostId: 'hRebound' } as Project }));
    view.rerender(composer({ project: { ...remote, hostId: undefined } as Project }));
    expect(screen.getByTestId('host-action')).toBeTruthy();
  });
});

describe('Modern composer retained-draft guards', () => {
  const sendButton = () => screen.getByRole('button', { name: 'Send' });

  it.each([
    ['provider selection', (message: string) => { h.options.selectionError = message; }],
    ['permission selection', (message: string) => { h.permissionError = message; }]
  ])('refuses to send while the restored %s is unavailable, and says why', async (_name, arm) => {
    arm('Saved choice is unavailable.');
    render(composer());
    expect(screen.getByRole('status').textContent).toBe('Saved choice is unavailable.');
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByTestId('thread-command-error').textContent).toBe('Saved choice is unavailable.'));
    expect(h.send).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
    // The status line yields to the (identical) error rather than showing twice.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('blocks a send when the saved composer mode is gone once the catalogue settled', async () => {
    const view = render(composer({ threadId: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan mode' }));
    h.options.provider = { ...h.options.provider, composerActions: [] };
    h.options.catalogSettled = false;
    view.rerender(composer({ threadId: undefined }));
    // While the catalogue is still loading the saved mode is not judged.
    expect(screen.queryByRole('status')).toBeNull();
    h.options.catalogSettled = true;
    view.rerender(composer({ threadId: undefined }));
    expect(screen.getByRole('status').textContent).toBe('The saved composer mode is unavailable. Choose an available mode before sending.');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('thread-command-error').textContent).toContain('saved composer mode'));
    expect(h.create).not.toHaveBeenCalled();
  });

  it('does not start a voice send while a saved choice is unavailable', () => {
    h.voice.state = 'recording';
    h.permissionError = 'Saved permission mode is unavailable.';
    render(composer());
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    expect(h.voice.stop).not.toHaveBeenCalled();
    expect(screen.getByTestId('thread-command-error').textContent).toBe('Saved permission mode is unavailable.');
  });

  it.each([
    ['provider selection', () => { h.options.selectionError = 'Provider gone.'; }, 'Provider gone.'],
    ['composer mode', () => { /* arranged below */ }, 'saved composer mode']
  ])('does not start a voice send for an unavailable %s', (name, arm, expected) => {
    arm();
    const view = render(composer({ threadId: undefined }));
    if (name === 'composer mode') {
      fireEvent.click(screen.getByRole('button', { name: 'Plan mode' }));
      h.options.provider = { ...h.options.provider, composerActions: [] };
    }
    h.voice.state = 'recording';
    view.rerender(composer({ threadId: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    expect(h.voice.stop).not.toHaveBeenCalled();
    expect(screen.getByTestId('thread-command-error').textContent).toContain(expected);
  });

});

describe('Modern composer draft session', () => {
  it('uses the surrounding draft session for new threads so the surface retains its choices', () => {
    render(<MemoryRouter><ComposerDraftProvider sessionKey="surface:a"><ThreadCommandComposer project={h.project} /></ComposerDraftProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Plan mode' }));
    expect(composerSession('surface:a').getSnapshot().settings['modern.composerMode']).toBe('plan');
  });

  it('keys an existing thread to its own draft even inside another surface', () => {
    render(<MemoryRouter><ComposerDraftProvider sessionKey="surface:a"><ThreadCommandComposer project={h.project} threadId="t1" /></ComposerDraftProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Plan mode' }));
    expect(composerSession(JSON.stringify(['thread', 't1'])).getSnapshot().settings['modern.composerMode']).toBe('plan');
    expect(composerSession('surface:a').getSnapshot().settings['modern.composerMode']).toBeUndefined();
  });

  it('keeps a picked send mode in the draft and remembers it as the new default', () => {
    render(<MemoryRouter><ComposerDraftProvider sessionKey="surface:b"><ThreadCommandComposer project={h.project} /></ComposerDraftProvider></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Send mode' }).getAttribute('data-send-mode')).toBe('queue-if-active');
    fireEvent.click(screen.getByRole('button', { name: 'Send mode' }));
    expect(h.rememberSendMode).toHaveBeenCalledWith('steer');
    expect(screen.getByRole('button', { name: 'Send mode' }).getAttribute('data-send-mode')).toBe('steer');
  });

  it('falls back to the default mode when a hydrated thread mode stops being offered', () => {
    h.options.acpMode = 'plan';
    const view = render(composer());
    expect(document.querySelector('[data-mode]')?.getAttribute('data-mode')).toBe('plan');
    h.options.provider = { ...h.options.provider, composerActions: [] };
    view.rerender(composer());
    expect(document.querySelector('[data-mode]')?.getAttribute('data-mode')).toBe('agent');
    h.options.acpMode = undefined;
  });
});

describe('Modern composer terminal command and navigation', () => {
  it('runs a /terminal command through the host and clears the draft', async () => {
    h.text = '/terminal ls -la';
    const onRunTerminal = vi.fn(async () => undefined);
    render(composer({ onRunTerminal }));
    fireEvent.click(screen.getByRole('button', { name: 'Run terminal' }));
    await waitFor(() => expect(onRunTerminal).toHaveBeenCalledWith('ls -la'));
    expect(h.clear).toHaveBeenCalledOnce();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('keeps the draft and reports why a terminal command could not run', async () => {
    h.text = '/terminal ls';
    const onRunTerminal = vi.fn(async () => { throw new Error('No shell'); });
    render(composer({ onRunTerminal }));
    fireEvent.click(screen.getByRole('button', { name: 'Run terminal' }));
    await waitFor(() => expect(screen.getByTestId('thread-command-error').textContent).toBe('No shell'));
    expect(h.clear).not.toHaveBeenCalled();
  });

  it('does not report a created thread to a surface the user already left', async () => {
    let release!: (value: { ok: true; value: { id: string } }) => void;
    h.create.mockImplementationOnce(() => new Promise(resolve => { release = resolve as typeof release; }));
    const onCreated = vi.fn();
    const view = render(composer({ threadId: undefined, onCreated }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledOnce());
    view.rerender(composer({ threadId: 't2', onCreated }));
    await act(async () => { release({ ok: true, value: { id: 'created' } }); });
    expect(h.upsert).toHaveBeenCalledWith({ id: 'created' });
    expect(onCreated).not.toHaveBeenCalled();
  });
});
