// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCommandComposer, type ThreadCommandComposerProps } from './ThreadCommandComposer.js';
import { consumeVoiceDraft, voiceDraft } from './thread/voice/voice-drafts.js';

const h = vi.hoisted(() => {
  const provider = { id: 'codex', displayName: 'Codex', permissionModes: ['full'], composerActions: ['plan'] };
  return {
    project: { id: 'p1', name: 'Project', path: '/tmp/project' } as Project,
    text: 'Draft',
    images: [] as Array<{ id: string; name: string }>,
    attachments: [] as PromptInput[],
    editor: { isDestroyed: false },
    fieldArgs: null as null | { onSubmit: (options?: { modifierEnter?: boolean }) => void },
    voiceArgs: null as null | { onTranscript: (text: string) => void; ownerKey?: string },
    frozenSend: null as null | ((text: string) => Promise<void>),
    voice: { state: 'idle', stream: null, canRetry: false, isSupported: true, available: true, canStart: true,
      stop: vi.fn(), retry: vi.fn(), start: vi.fn(), cancel: vi.fn() },
    options: {
      providerId: 'codex', provider, providers: [provider], registeredProviderIds: ['codex'],
      providerOptions: [], model: 'model-a', reasoningLevel: 'high', acpMode: undefined as string | undefined,
      rosterReady: true, serviceTierOptions: undefined as undefined | Array<{ id: string; label: string }>,
      acpModeOptions: [], modelOptions: [], moreModelOptions: [], reasoningOptions: [], modelIsLoading: false,
      setProviderId: vi.fn(), setModel: vi.fn(), setReasoningLevel: vi.fn(), setAcpMode: vi.fn(),
      refreshAcpModeOptions: vi.fn(), refreshModels: vi.fn()
    },
    clear: vi.fn(), insertText: vi.fn(), removeAttachment: vi.fn(),
    send: vi.fn(async () => undefined),
    create: vi.fn(async (): Promise<{ ok: boolean; value: { id: string }; message?: string }> => ({ ok: true, value: { id: 'created' } })),
    upsert: vi.fn(), persistImages: vi.fn(async () => ['/tmp/uploaded.png']),
    loadProjects: vi.fn(), navigateOnCreate: false, hostBlocked: false, cliBlocked: false,
    threads: [] as Array<{ id: string; hostId: string; projectId: string }>
  };
});

vi.mock('../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({ projects: [h.project], lastProjectId: 'p1',
    loadProjects: h.loadProjects, defaultHarness: 'codex', composerSendMode: 'queue-if-active',
    setComposerSendMode: vi.fn(), nativeAgentDiscoveryEnabled: false }),
  useUi: (select: (state: unknown) => unknown) => select({ selectedProjectId: 'p1' })
}));
vi.mock('../thread-store.js', () => ({ useThreads: (select: (state: unknown) => unknown) => select({ threads: h.threads, upsert: h.upsert }) }));
vi.mock('../lib/product-client.js', () => ({ product: {
  threads: { send: h.send, create: h.create, promptHistory: async () => ({ entries: [] }), compact: vi.fn(), stop: vi.fn() }
} }));
vi.mock('../hooks/useHosts.js', () => ({ defaultHostId: () => 'host1', useHosts: () => [] }));
vi.mock('../hooks/useRouteState.js', () => ({ useRouteState: () => ({ isProjectFocused: false }) }));
vi.mock('../hooks/usePublicAppUrl.js', () => ({ usePublicAppUrl: () => null }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/use-boolean-preference.js', () => ({ useBooleanPreference: () => [h.navigateOnCreate] }));
vi.mock('../lib/prompt-attachments.js', () => ({ persistComposerImages: h.persistImages }));
vi.mock('./composer-host-status.js', () => ({
  composerHostsForProject: () => [], resolveComposerHostAction: () => ({ kind: 'ready' }),
  shouldBlockComposerSend: () => h.hostBlocked, shouldShowHostPicker: () => false,
  composerRemoteHostBadge: () => null, isForeignExecutionHost: () => false,
  bootstrapOutcome: vi.fn(), composerBootstrapErrorMessage: vi.fn()
}));
vi.mock('./thread/pickers/useThreadComposerOptions.js', () => ({ useThreadComposerOptions: () => h.options }));
vi.mock('./thread/pickers/useThreadPermissionMode.js', () => ({ useThreadPermissionMode: () => ({ permissionMode: 'full', setPermissionMode: vi.fn() }) }));
vi.mock('./composer/use-composer-provider-cli.js', () => ({ useComposerProviderCli: () => ({ blocked: h.cliBlocked }) }));
vi.mock('./composer/useMobileComposerExpansion.js', () => ({ useMobileComposerExpansion: () => undefined }));
vi.mock('./composer/use-composer-prompt-field.js', () => ({
  useComposerPromptField: (args: typeof h.fieldArgs) => {
    h.fieldArgs = args;
    return { editor: h.editor, text: h.text, images: h.images, restoredAttachments: h.attachments,
      serialize: () => ({ text: h.text, mentions: [] }), clear: h.clear, insertText: h.insertText,
      removeRestoredAttachment: h.removeAttachment, setText: vi.fn(), replacePrompt: vi.fn(), focus: vi.fn(),
      markRestoreFocus: vi.fn(), handleChromeKeyDown: vi.fn(), dropHandlers: {},
      suggestions: [], typeaheadOpen: false, canAttach: false };
  }
}));
vi.mock('./thread/voice/useVoiceInput.js', () => ({ useVoiceInput: (args: typeof h.voiceArgs) => { h.voiceArgs = args; return h.voice; } }));
vi.mock('./thread/voice/waveform.js', () => ({ startWaveform: () => () => undefined }));
vi.mock('../plugins/PluginComposerChrome.js', () => ({ PluginComposerChrome: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../plugins/PluginComposerSlots.js', () => ({ PluginComposerAdvanced: () => null, PluginComposerMeta: () => null }));
vi.mock('./composer/ComposerPromptField.js', () => ({ ComposerPromptField: () => <div /> }));
vi.mock('./EnvironmentPicker.js', () => ({ EnvironmentPicker: () => null, defaultWorkspaceChoice: () => ({ kind: 'unmanaged' }) }));
vi.mock('./HostMachinePicker.js', () => ({ HostMachinePicker: () => null }));
vi.mock('./HostSshIdentityDialog.js', () => ({ HostSshIdentityDialog: () => null }));
vi.mock('./ComposerHostActionChip.js', () => ({ ComposerHostActionChip: () => null }));
vi.mock('./ComposerRemoteHostBadge.js', () => ({ ComposerRemoteHostBadge: () => null }));
vi.mock('./ComposerProjectPicker.js', () => ({ ComposerProjectPicker: () => null }));
vi.mock('./thread/ThreadContextMeter.js', () => ({ ThreadContextMeter: () => null }));
vi.mock('./ui/PopoverPicklist.js', () => ({ PopoverPicklist: () => null }));
vi.mock('./thread/pickers/ComposerModePicker.js', () => ({ ComposerModePicker: ({ onChange }: { onChange: (mode: string) => void }) =>
  <button onClick={() => onChange('plan')}>Plan mode</button> }));
vi.mock('./thread/pickers/ModelReasoningPicker.js', () => ({ ModelReasoningPicker: ({ onReloadModels }: { onReloadModels: () => void }) =>
  <button onClick={onReloadModels}>Reload models</button> }));
vi.mock('./thread/pickers/ReasoningEffortPicker.js', () => ({ ReasoningEffortPicker: () => null }));
vi.mock('./thread/pickers/ComposerSendModePicker.js', () => ({ ComposerSendModePicker: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  h.text = 'Draft'; h.images = []; h.attachments = []; h.editor.isDestroyed = false;
  h.voice.state = 'idle'; h.voice.canRetry = false; h.frozenSend = null;
  h.options.rosterReady = true; h.options.serviceTierOptions = undefined; h.options.registeredProviderIds = ['codex'];
  h.navigateOnCreate = false; h.hostBlocked = false; h.cliBlocked = false;
  h.threads = [{ id: 't1', hostId: 'host1', projectId: 'p1' }];
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

  it('does not clear or navigate a different thread after a delayed recording submission', async () => {
    h.voice.state = 'recording';
    const onCreated = vi.fn();
    const view = render(composer({ threadId: undefined, onCreated }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    const frozen = h.frozenSend!;
    view.rerender(composer({ threadId: 't2', onCreated }));
    await act(async () => { await frozen('Spoken words'); });
    expect(h.upsert).toHaveBeenCalledWith({ id: 'created' });
    expect(onCreated).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
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
