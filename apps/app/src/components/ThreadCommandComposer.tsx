import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Folder, Laptop, Loader2, Mic, Paperclip, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadContextWindowUsage } from '@zana-ai/zcc-server-contract';
import { product } from '../lib/product-client.js';
import { runHostInstallWithDrawer } from '../lib/host-install-run.js';
import { copyText } from '../lib/copy-text.js';
import { useData, useUi } from '../store.js';
import { useThreads } from '../thread-store.js';
import { getThreadRoutePath } from '../lib/route-paths.js';
import { useRouteState } from '../hooks/useRouteState.js';
import {
  CommandComposer,
  ComposerIconButton,
  ComposerToolbar
} from './ui/CommandComposer.js';
import { EnvironmentPicker, defaultWorkspaceChoice, type WorkspacePickerValue } from './EnvironmentPicker.js';
import { HostMachinePicker } from './HostMachinePicker.js';
import { HostSshIdentityDialog } from './HostSshIdentityDialog.js';
import { ComposerHostActionChip } from './ComposerHostActionChip.js';
import { ComposerRemoteHostBadge } from './ComposerRemoteHostBadge.js';
import {
  bootstrapOutcome,
  composerBootstrapErrorMessage,
  composerHostsForProject,
  composerRemoteHostBadge,
  isForeignExecutionHost,
  resolveComposerHostAction,
  shouldBlockComposerSend,
  shouldShowHostPicker
} from './composer-host-status.js';
import { defaultHostId, useHosts } from '../hooks/useHosts.js';
import { usePublicAppUrl } from '../hooks/usePublicAppUrl.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { ComposerModePicker } from './thread/pickers/ComposerModePicker.js';
import { ModelReasoningPicker } from './thread/pickers/ModelReasoningPicker.js';
import { ReasoningEffortPicker } from './thread/pickers/ReasoningEffortPicker.js';
import { ComposerSendModePicker } from './thread/pickers/ComposerSendModePicker.js';
import { permissionModeOptionsFor } from './thread/pickers/permission-mode-options.js';
import {
  applyComposerWorkMode,
  consumeComposerModeCycle,
  type ComposerWorkMode
} from './thread/pickers/composer-mode.js';
import {
  composerWorkModeFromNativeMode,
  nativeModeForComposerWorkMode,
  portableWorkIntent,
  type PortableWorkMode
} from '@zana-ai/zcc-domain/thread-runtime';
import { fallbackProviderOption, isOfferedModernProvider } from './thread/pickers/fallback-models.js';
import { useThreadComposerOptions } from './thread/pickers/useThreadComposerOptions.js';
import { VoiceRecordingBar } from './thread/voice/VoiceRecordingBar.js';
import { useVoiceInput } from './thread/voice/useVoiceInput.js';
import { persistComposerImages } from '../lib/prompt-attachments.js';
import { isBusyThreadStatus, shouldShowThreadStop } from './thread/thread-timeline-model.js';
import { resolveThreadSubmitMode } from './thread/thread-submit-mode.js';
import { promptHistoryTexts, stepPromptHistory } from './thread/prompt-history-step.js';
import { ThreadContextMeter } from './thread/ThreadContextMeter.js';
import { ComposerProjectPicker } from './ComposerProjectPicker.js';
import { resolveComposerProjectId, type ComposerProjectSelectionProps } from './composer-project-default.js';
import { useBooleanPreference } from '../lib/use-boolean-preference.js';
import { PluginComposerChrome } from '../plugins/PluginComposerChrome.js';
import {
  NAVIGATE_TO_THREAD_ON_CREATE_DEFAULT,
  NAVIGATE_TO_THREAD_ON_CREATE_KEY,
  resolveThreadSendMode
} from '../lib/thread-composer-preferences.js';
import { COMPOSER_INSERT_EVENT } from './thread/secondary-panel/SecondaryPanelSelectionActions.js';
import { dispatchOptimisticUserMessage, dispatchThreadStopRequested } from './thread/timeline/thread-optimistic-events.js';
import { ComposerPromptField } from './composer/ComposerPromptField.js';
import { useComposerPromptField } from './composer/use-composer-prompt-field.js';

export type ThreadSendMode = 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';

export interface ThreadCommandComposerProps extends ComposerProjectSelectionProps {
  project?: Project;
  threadId?: string;
  status?: string;
  /** Provider is retrying a transient error; keep Stop available even if status is `error`. */
  inFlightRetry?: boolean;
  environmentLabel?: string;
  sendBlocked?: boolean;
  contextWindowUsage?: ThreadContextWindowUsage | null;
  providerId?: string;
  model?: string | null;
  reasoningLevel?: string | null;
  /** Persisted native role/mode of an existing thread, for honest picker display. */
  acpMode?: string | null;
  initialText?: string;
  /** Focus the prompt after mounting (hub/browse create-plugin seed). */
  autoFocus?: boolean;
  onCreated?: (threadId: string) => void;
  /** Sticky requested mode from `thread_execution_state` (plan/goal/agent or native ACP id). */
  executionModeRequested?: string | null;
}

export function ThreadCommandComposer({
  project: pinnedProject,
  composerProjectId,
  onComposerProjectIdChange,
  threadId,
  status,
  inFlightRetry = false,
  environmentLabel,
  sendBlocked = false,
  contextWindowUsage,
  providerId: lockedProviderId,
  model: initialModel,
  reasoningLevel: initialReasoningLevel,
  acpMode: initialAcpMode,
  initialText,
  autoFocus = false,
  onCreated,
  executionModeRequested = null
}: ThreadCommandComposerProps) {
  const navigate = useNavigate();
  const route = useRouteState();
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const lastProjectId = useData((s) => s.lastProjectId);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const upsertThread = useThreads((s) => s.upsert);
  const [internalProjectId, setInternalProjectId] = useState(
    pinnedProject?.id ?? composerProjectId ?? ''
  );
  const projectId = pinnedProject?.id
    ?? (onComposerProjectIdChange ? (composerProjectId || internalProjectId) : internalProjectId);
  const setProjectId = (nextProjectId: string | ((current: string) => string)) => {
    const resolved = typeof nextProjectId === 'function' ? nextProjectId(projectId) : nextProjectId;
    if (!onComposerProjectIdChange) setInternalProjectId(resolved);
    onComposerProjectIdChange?.(resolved);
  };
  const preferredProjectId = selectedProjectId ?? lastProjectId;
  const ensureScratchRef = useRef(false);
  const selectedProject = pinnedProject ?? projects.find((row) => row.id === projectId);
  const hosts = useHosts();
  const threads = useThreads((s) => s.threads);
  const currentThread = threadId ? threads.find((row) => row.id === threadId) : undefined;
  const [hostId, setHostId] = useState(() => defaultHostId(hosts, pinnedProject));
  const options = useThreadComposerOptions({
    threadId,
    lockedProviderId,
    initialModel,
    initialReasoningLevel,
    initialAcpMode: executionModeRequested ?? initialAcpMode,
    hostId: currentThread?.hostId ?? selectedProject?.hostId ?? hostId
  });
  const [permissionMode, setPermissionMode] = useState('accept-edits');
  const [composerMode, setComposerMode] = useState<PortableWorkMode>('agent');
  const hydratedRequestedRef = useRef<string | null>(null);
  const composerSendMode = useData((s) => s.composerSendMode);
  const setComposerSendMode = useData((s) => s.setComposerSendMode);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [navigateOnCreate] = useBooleanPreference(
    NAVIGATE_TO_THREAD_ON_CREATE_KEY,
    NAVIGATE_TO_THREAD_ON_CREATE_DEFAULT
  );
  const [expanded, setExpanded] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePickerValue>(() => defaultWorkspaceChoice(false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitRef = useRef<(opts?: { modifierEnter?: boolean }) => void>(() => undefined);
  const promptHistoryRef = useRef<string[]>([]);
  const promptHistoryIndexRef = useRef(-1);
  const promptHistoryDraftRef = useRef('');
  const promptHistoryHandlerRef = useRef<(event: {
    key: string;
    preventDefault?: () => void;
  }) => boolean>(() => false);
  const pickerHosts = useMemo(
    () => composerHostsForProject(hosts, selectedProject),
    [hosts, selectedProject]
  );
  const publicAppUrl = usePublicAppUrl();
  const displayStatus = currentThread?.runtime?.displayStatus ?? status ?? 'idle';
  const submitMode = resolveThreadSubmitMode({
    displayStatus,
    waitingOnUser: sendBlocked
  });
  const followUpSubmitBlocked = Boolean(threadId) && (submitMode.kind === 'blocked' || submitMode.kind === 'stop-only');
  const [hostBusy, setHostBusy] = useState<string | null>(null);
  const [pairingCommand, setPairingCommand] = useState<string | null>(null);
  const [sshPick, setSshPick] = useState<{ hostId: string; name: string } | null>(null);

  useEffect(() => {
    setHostId(defaultHostId(hosts, selectedProject));
  }, [hosts, selectedProject]);

  const hostAction = useMemo(
    () => resolveComposerHostAction({
      hosts,
      project: selectedProject,
      selectedHostId: currentThread?.hostId ?? hostId,
      publicAppUrl
    }),
    [currentThread?.hostId, hostId, hosts, publicAppUrl, selectedProject]
  );
  const hostSendBlocked = shouldBlockComposerSend(hostAction, selectedProject);
  const showHostPicker = shouldShowHostPicker(hosts, selectedProject);
  const remoteHostBadge = composerRemoteHostBadge({
    project: selectedProject,
    host: selectedProject?.hostId
      ? hosts.find((row) => row.id === selectedProject.hostId)
      : undefined
  });
  const foreignHost = isForeignExecutionHost(selectedProject, hosts, hostId);

  useEffect(() => {
    if (pinnedProject) {
      setProjectId(pinnedProject.id);
      return;
    }
    const nextId = resolveComposerProjectId(projects, projectId, undefined, preferredProjectId);
    if (nextId && nextId !== projectId) {
      setProjectId(nextId);
      return;
    }
    if (nextId || ensureScratchRef.current) return;
    ensureScratchRef.current = true;
    let cancelled = false;
    void product.projects.ensureQuickAgent().then(async (result) => {
      if (cancelled || !result.ok) return;
      if (!useData.getState().projects.some((row) => row.id === result.value.id)) {
        await loadProjects();
      }
      if (!cancelled) setProjectId((current) => current || result.value.id);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadProjects, pinnedProject, preferredProjectId, projectId, projects]);

  const permissionOptions = permissionModeOptionsFor(
    options.provider?.permissionModes ?? ['accept-edits', 'full']
  );
  const resolvedProviderId = threadId
    ? options.providerId
    : options.providers.find((row) => row.id === 'fake')?.id
      ?? (options.providers.some((row) => row.id === options.providerId) ? options.providerId : options.providers[0]?.id);
  const canSend = Boolean(
    threadId
    || ((pinnedProject || projectId) && resolvedProviderId && options.rosterReady)
  );

  const workIntent = useMemo(
    () => portableWorkIntent({
      acpModeOptions: options.acpModeOptions,
      composerActions: options.provider?.composerActions ?? []
    }),
    [options.acpModeOptions, options.provider]
  );
  const composerModes = workIntent.modes;

  useEffect(() => {
    const modes = options.provider?.permissionModes ?? [];
    if (modes.length > 0 && !modes.includes(permissionMode)) {
      setPermissionMode(modes[0]!);
    }
  }, [permissionMode, options.provider]);

  useEffect(() => {
    hydratedRequestedRef.current = null;
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const native = options.acpMode ?? executionModeRequested;
    const next = composerWorkModeFromNativeMode(native);
    if (!composerModes.includes(next)) return;
    if (workIntent.usesSlashPlan && !workIntent.planNativeValue) {
      if (next !== 'plan') return;
    }
    if (hydratedRequestedRef.current === next) return;
    hydratedRequestedRef.current = next;
    setComposerMode(next);
  }, [
    composerModes,
    executionModeRequested,
    options.acpMode,
    threadId,
    workIntent.planNativeValue,
    workIntent.usesSlashPlan
  ]);

  useEffect(() => {
    if (composerModes.includes(composerMode)) return;
    setComposerMode('agent');
  }, [composerMode, composerModes]);

  const setComposerWorkMode = useCallback((next: ComposerWorkMode) => {
    if (next !== 'agent' && next !== 'plan') return;
    setComposerMode(next);
    const native = nativeModeForComposerWorkMode(next, workIntent);
    if (native !== undefined) {
      options.setAcpMode(native);
      return;
    }
    if (next === 'agent' && workIntent.planNativeValue && options.acpMode === workIntent.planNativeValue) {
      options.setAcpMode(undefined);
    }
  }, [options, workIntent]);
  const provider = options.provider ?? fallbackProviderOption(options.providerId);
  const field = useComposerPromptField({
    placeholder: threadId
      ? 'Ask for a follow-up. @ to mention files, folders, or threads'
      : 'Ask anything. @ to mention files, folders, or threads',
    testId: 'thread-command-input',
    projectId,
    threadId,
    projectRoot: selectedProject?.path,
    projects,
    disabled: busy,
    autoFocus,
    initialText,
    slashCatalog: {
      kind: 'thread',
      providerId: options.providerId,
      composerActions: provider.composerActions,
      providerDisplayName: provider.displayName
    },
    onSubmit: (opts) => {
      void submitRef.current(opts);
    },
    interceptKeyDown: (event) => {
      if (consumeComposerModeCycle(
        event,
        {
          kind: 'work',
          modes: composerModes,
          current: composerMode,
          onChange: setComposerWorkMode
        }
      )) return true;
      return promptHistoryHandlerRef.current(event);
    },
    onError: setError
  });
  promptHistoryHandlerRef.current = (event) => {
    if (!threadId || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false;
    const stepped = stepPromptHistory({
      key: event.key,
      entries: promptHistoryRef.current,
      index: promptHistoryIndexRef.current,
      currentText: field.text,
      draft: promptHistoryDraftRef.current
    });
    if (!stepped) return false;
    promptHistoryIndexRef.current = stepped.index;
    promptHistoryDraftRef.current = stepped.draft;
    field.setText(stepped.text);
    event.preventDefault?.();
    return true;
  };

  useEffect(() => {
    if (!threadId) {
      promptHistoryRef.current = [];
      promptHistoryIndexRef.current = -1;
      return;
    }
    promptHistoryIndexRef.current = -1;
    void product.threads.promptHistory(threadId).then((body) => {
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      promptHistoryRef.current = promptHistoryTexts(entries);
    }).catch(() => {
      promptHistoryRef.current = [];
    });
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const onInsert = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; text?: string }>).detail;
      if (!detail?.text || detail.threadId !== threadId) return;
      field.insertText(detail.text);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, onInsert);
    return () => window.removeEventListener(COMPOSER_INSERT_EVENT, onInsert);
  }, [field.insertText, threadId]);
  const voice = useVoiceInput({ onTranscript: field.insertText });
  const voiceBusy = voice.state === 'recording' || voice.state === 'transcribing';

  const runPeerDaemon = useCallback(async (kind: 'install' | 'fix', targetHostId?: string) => {
    const project = pinnedProject ?? projects.find((row) => row.id === projectId);
    setPairingCommand(null);
    setError(null);
    const remote = project?.remote;
    const target = remote
      ? (remote.user ? `${remote.user}@${remote.host}` : remote.host)
      : (hosts.find((row) => row.id === targetHostId)?.name ?? 'remote machine');
    try {
      if (kind === 'install' || kind === 'fix') setHostBusy('Renewing pairing…');
      const events = await runHostInstallWithDrawer({
        kind,
        target,
        startLogs: ['Renewing pairing…'],
        run: async (onEvent) => {
          try {
            await product.relay.renewJoinWindow();
          } catch {
            // Bootstrap/repair still auto-renew; the chip stays the retry.
          }
          if (kind === 'install') {
            useUi.getState().appendHostInstallLogs(['Installing…']);
            setHostBusy('Installing…');
            return product.hosts.bootstrap(project!.id, onEvent);
          }
          useUi.getState().appendHostInstallLogs(['Reconnecting…']);
          setHostBusy('Reconnecting…');
          return product.hosts.repair(targetHostId!, onEvent);
        }
      });
      const outcome = bootstrapOutcome(events);
      if (!outcome.ok) {
        setError(composerBootstrapErrorMessage(outcome));
        if (outcome.pairingCommand) setPairingCommand(outcome.pairingCommand);
        if (outcome.code === 'ssh_identity_required' && targetHostId) {
          const host = hosts.find((row) => row.id === targetHostId);
          setSshPick({ hostId: targetHostId, name: host?.name ?? 'machine' });
        }
        return;
      }
      setHostId(outcome.hostId);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update host daemon');
    } finally {
      setHostBusy(null);
    }
  }, [hosts, loadProjects, pinnedProject, projectId, projects]);

  const onHostAction = useCallback(() => {
    if (hostBusy) {
      useUi.getState().setHostInstallDrawerOpen(true);
      return;
    }
    if (hostAction.kind === 'install') {
      void runPeerDaemon('install');
      return;
    }
    if (hostAction.kind !== 'fix') return;
    if (hostAction.needsSshPick) {
      const host = hosts.find((row) => row.id === hostAction.hostId);
      setSshPick({ hostId: hostAction.hostId, name: host?.name ?? 'machine' });
      return;
    }
    void runPeerDaemon('fix', hostAction.hostId);
  }, [hostAction, hostBusy, hosts, runPeerDaemon]);

  const submit = useCallback(async (opts?: { modifierEnter?: boolean }) => {
    if (busy || sendBlocked || hostSendBlocked || followUpSubmitBlocked || field.typeaheadOpen) return;
    const serialized = field.serialize();
    if (!serialized.text.trim() && field.images.length === 0) {
      setError('Enter a message first');
      field.focus();
      return;
    }
    const selected = pinnedProject ?? projects.find((row) => row.id === projectId);
    if (!threadId && !selected) {
      setError('Select a project first');
      field.focus();
      return;
    }
    if (!threadId && !resolvedProviderId) {
      setError('No agent provider is available');
      field.focus();
      return;
    }
    if (!threadId && !options.rosterReady) {
      setError('Still loading providers');
      field.focus();
      return;
    }
    if (!threadId && !isOfferedModernProvider(options.registeredProviderIds, resolvedProviderId)) {
      setError('That harness is not available for Modern threads.');
      field.focus();
      return;
    }
    const persistProjectId = selected?.id ?? projectId;
    if (field.images.length > 0 && !persistProjectId) {
      setError('Select a project first');
      field.focus();
      return;
    }
    const sendMode = resolveThreadSendMode({
      pickerMode: composerSendMode,
      threadRunning: isBusyThreadStatus(status ?? '') || inFlightRetry,
      modifierEnter: opts?.modifierEnter === true
    });
    const applied = applyComposerWorkMode(
      serialized,
      workIntent.planNativeValue ? 'agent' : composerMode
    );
    const text = applied.text;
    field.markRestoreFocus();
    setError(null);
    setBusy(true);
    try {
      const imagePaths = field.images.length === 0
        ? []
        : await persistComposerImages(persistProjectId!, field.images, (ratio) => {
          setUploadProgress(ratio);
        });
      const input = [
        ...(text.trim() ? [{ type: 'text' as const, text, mentions: applied.mentions }] : []),
        ...imagePaths.map((path) => ({ type: 'localImage' as const, path }))
      ];
      if (input.length === 0) {
        setError('Enter a message first');
        return;
      }
      if (threadId) {
        dispatchOptimisticUserMessage(threadId, text, imagePaths);
        try {
          await product.threads.send(threadId, input, sendMode, {
            model: options.model,
            reasoningLevel: options.reasoningLevel,
            acpMode: workIntent.usesSlashPlan ? undefined : options.acpMode
          });
          field.clear();
        } catch (error) {
          dispatchOptimisticUserMessage(threadId, null);
          throw error;
        }
        return;
      }
      const created = await product.threads.create({
        projectId: selected!.id,
        providerId: resolvedProviderId!,
        input,
        hostId,
        environment: selected!.quickAgent && foreignHost ? { kind: 'personal' } : workspace,
        cwd: foreignHost ? undefined : selected!.path,
        permissionMode: permissionMode as 'accept-edits' | 'auto' | 'full',
        model: options.model,
        reasoningLevel: options.reasoningLevel,
        acpMode: workIntent.usesSlashPlan ? undefined : options.acpMode
      });
      if (!created.ok) {
        setError(created.message ?? 'Could not create thread');
        return;
      }
      upsertThread(created.value);
      field.clear();
      onCreated?.(created.value.id);
      if (navigateOnCreate) {
        navigate(getThreadRoutePath(
          created.value.id,
          route.isProjectFocused ? route.focusedProjectId : undefined
        ));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send message');
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }, [
    busy,
    sendBlocked,
    hostSendBlocked,
    field,
    composerMode,
    workIntent,
    navigate,
    navigateOnCreate,
    onCreated,
    options.model,
    options.reasoningLevel,
    options.acpMode,
    options.rosterReady,
    options.providers,
    permissionMode,
    pinnedProject,
    projectId,
    projects,
    resolvedProviderId,
    route.focusedProjectId,
    route.isProjectFocused,
    status,
    inFlightRetry,
    composerSendMode,
    threadId,
    upsertThread,
    workspace,
    hostId,
    foreignHost
  ]);

  submitRef.current = (opts) => {
    void submit(opts);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    field.handleChromeKeyDown(event);
  };

  const sendButton = (
    <ComposerIconButton
      className={`thread-command-send${busy ? ' is-sending' : ''}`}
      aria-label={busy ? 'Sending' : submitMode.kind === 'queue' ? 'Queue' : 'Send'}
      title={
        hostSendBlocked && hostAction.kind !== 'ready'
          ? hostAction.reason
          : followUpSubmitBlocked
            ? (submitMode.kind === 'blocked' ? submitMode.reason : 'Stop the agent to send')
            : busy ? 'Sending' : submitMode.kind === 'queue' ? 'Queue' : 'Send'
      }
      aria-busy={busy}
      data-testid="thread-command-send"
      disabled={busy || sendBlocked || hostSendBlocked || followUpSubmitBlocked || !canSend}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void submit()}
    >
      {busy ? (
        <Loader2 size={16} className="thread-command-send-spin" aria-hidden="true" />
      ) : (
        <ArrowUp size={16} />
      )}
    </ComposerIconButton>
  );

  return (
    <>
    <PluginComposerChrome
      scope={threadId ? { kind: 'thread', threadId } : { kind: 'new-thread', projectId: projectId ?? null }}
      text={field.text}
      setText={field.setText}
      focus={field.focus}
    >
    <div
      className={`thread-command-composer${expanded ? ' is-expanded' : ''}${field.dropOver ? ' is-drop-over' : ''}${busy ? ' is-sending' : ''}`}
      onKeyDown={onKeyDown}
      {...field.dropHandlers}
    >
      <span id="thread-command-label" className="thread-command-label">Agent composer</span>
      {error ? (
        <p className="thread-command-error" data-testid="thread-command-error">{error}</p>
      ) : null}
      {uploadProgress != null ? (
        <p className="thread-command-upload" data-testid="thread-command-upload-progress">
          Uploading {Math.round(uploadProgress * 100)}%
        </p>
      ) : null}
      <CommandComposer
        className={`home-agent-command thread-command-card${field.dropOver ? ' is-drop-over' : ''}`}
        labelledBy="thread-command-label"
        aria-busy={busy}
      >
        <ComposerPromptField
          editor={field.editor}
          images={field.images}
          onRemoveImage={field.removeImage}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((current) => !current)}
          expandTestId="thread-command-expand"
          menuOpen={field.menuOpen}
          suggestions={field.suggestions}
          selectedIndex={field.highlighted}
          triggerKind={field.triggerKind}
          onApply={field.applySuggestion}
        />
        <ComposerToolbar>
          {voiceBusy ? (
            <VoiceRecordingBar
              state={voice.state === 'transcribing' ? 'transcribing' : 'recording'}
              stream={voice.stream}
              onConfirm={voice.stop}
              onCancel={voice.cancel}
            />
          ) : (
            <>
              <div className="thread-command-footer-start">
                <ComposerModePicker
                  value={composerMode}
                  modes={composerModes}
                  onChange={setComposerWorkMode}
                />
                <ModelReasoningPicker
                  providerOptions={options.providerOptions}
                  selectedProviderId={resolvedProviderId ?? options.providerId}
                  onSelectedProviderChange={threadId ? undefined : options.setProviderId}
                  modelValue={options.model}
                  modelOptions={options.modelOptions}
                  moreModelOptions={options.moreModelOptions}
                  modelIsLoading={options.modelIsLoading}
                  modelLoadError={options.modelLoadError}
                  onModelChange={options.setModel}
                />
                <ReasoningEffortPicker
                  value={options.reasoningLevel}
                  options={options.reasoningOptions}
                  onChange={options.setReasoningLevel}
                />
                <ComposerSendModePicker
                  value={composerSendMode}
                  onChange={(mode) => { void setComposerSendMode(mode); }}
                />
              </div>
              <div className="thread-command-footer-end">
                <ThreadContextMeter
                  usage={contextWindowUsage}
                  onCompact={
                    threadId && (displayStatus === 'idle' || displayStatus === 'error')
                      ? () => {
                          void product.threads.compact(threadId).catch((err) => {
                            setError(err instanceof Error ? err.message : 'Compact failed');
                          });
                        }
                      : undefined
                  }
                />
                <ComposerIconButton
                  onClick={() => { if (!field.canAttach) return; field.attachPickedFiles(); }}
                  disabled={!field.canAttach}
                  title={field.canAttach ? 'Attach files' : 'File attachments require the desktop app'}
                  aria-label="Attach files"
                >
                  <Paperclip size={14} aria-hidden="true" />
                </ComposerIconButton>
                <ComposerIconButton
                  className="voice-input-btn voice-input-btn--icon"
                  aria-label={
                    !voice.isSupported
                      ? 'Voice input is not supported in this browser'
                      : !voice.available
                        ? 'Host daemon is not connected'
                        : 'Start voice input'
                  }
                  title={
                    !voice.isSupported
                      ? 'Voice input is not supported in this browser'
                      : !voice.available
                        ? 'Host daemon is not connected'
                        : 'Start voice input'
                  }
                  disabled={!voice.canStart}
                  onClick={() => void voice.start()}
                >
                  <Mic size={14} />
                </ComposerIconButton>
                {threadId && shouldShowThreadStop(threadId, status, inFlightRetry) && (
                  <ComposerIconButton
                    className="thread-command-stop"
                    aria-label="Stop"
                    title="Stop"
                    data-testid="thread-command-stop"
                    onClick={() => {
                      dispatchThreadStopRequested(threadId);
                      void product.threads.stop(threadId);
                    }}
                  >
                    <Square size={14} fill="currentColor" />
                  </ComposerIconButton>
                )}
                {sendButton}
              </div>
            </>
          )}
        </ComposerToolbar>
      </CommandComposer>
      <div className="thread-command-composer-meta">
        <div className="thread-command-composer-meta-start">
          {threadId ? (
            <>
              <span className="thread-command-chip thread-command-env" data-testid="thread-env-label">
                <Laptop size={14} aria-hidden="true" />
                {remoteHostBadge
                  ? <ComposerRemoteHostBadge {...remoteHostBadge} />
                  : (environmentLabel ?? 'Local')}
              </span>
              <ComposerHostActionChip
                action={hostAction}
                busyLabel={hostBusy}
                pairingCommand={pairingCommand}
                onAction={onHostAction}
                onCopyPairing={pairingCommand
                  ? () => void copyText(pairingCommand)
                  : undefined}
              />
            </>
          ) : (
            <>
              <div className="thread-command-chip">
                <Folder size={14} aria-hidden="true" />
                <ComposerProjectPicker
                  projects={projects}
                  value={projectId}
                  onChange={setProjectId}
                  disabled={Boolean(pinnedProject)}
                  title={pinnedProject ? 'Locked to this project' : undefined}
                />
              </div>
              {!selectedProject?.remote && !foreignHost && (
                <EnvironmentPicker projectId={projectId} value={workspace} onChange={setWorkspace} />
              )}
              {showHostPicker && pickerHosts.length > 0 && (
                <div className="thread-command-chip">
                  <Laptop size={14} aria-hidden="true" />
                  <HostMachinePicker
                    hosts={pickerHosts}
                    project={selectedProject}
                    value={hostId}
                    onChange={setHostId}
                    includeDisconnected
                    alwaysShow
                  />
                </div>
              )}
              <ComposerHostActionChip
                action={hostAction}
                busyLabel={hostBusy}
                pairingCommand={pairingCommand}
                onAction={onHostAction}
                onCopyPairing={pairingCommand
                  ? () => void copyText(pairingCommand)
                  : undefined}
              />
              {remoteHostBadge ? <ComposerRemoteHostBadge {...remoteHostBadge} /> : null}
            </>
          )}
        </div>
        <div className="thread-command-composer-meta-end">
          {permissionOptions.length > 1 && (
            <PopoverPicklist
              value={permissionMode}
              options={permissionOptions.map((row) => ({
                value: row.value,
                label: row.label,
                compactLabel: row.compactLabel,
                description: row.description,
                ...(row.tone ? { tone: row.tone } : {})
              }))}
              onChange={setPermissionMode}
              ariaLabel="Permission mode"
              searchable={false}
              minWidth={280}
            />
          )}
        </div>
      </div>
    </div>
    </PluginComposerChrome>
    {sshPick && (
      <HostSshIdentityDialog
        hostName={sshPick.name}
        onClose={() => setSshPick(null)}
        onSubmit={async (identity) => {
          const hostIdToRepair = sshPick.hostId;
          await product.hosts.updateSshIdentity(hostIdToRepair, identity);
          setSshPick(null);
          await runPeerDaemon('fix', hostIdToRepair);
        }}
      />
    )}
    </>
  );
}
