import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { ArrowUp, Folder, Laptop, Loader2, Maximize2, Mic, Minimize2, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadContextWindowUsage } from '@zana-ai/zcc-server-contract';
import { apiJson } from '../lib/fetch-with-app-surface.js';
import { COMPOSER_COMMANDS_RELOAD_EVENT } from '../lib/composer-commands-reload.js';
import { product } from '../lib/product-client.js';
import { useData } from '../store.js';
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
import {
  bootstrapOutcome,
  composerRemoteToolsMark,
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
import { permissionModeOptionsFor } from './thread/pickers/permission-mode-options.js';
import {
  applyComposerModePrefix,
  composerModesForActions,
  nextComposerWorkMode,
  type ComposerWorkMode
} from './thread/pickers/composer-mode.js';
import { fallbackProviderOption } from './thread/pickers/fallback-models.js';
import { useThreadComposerOptions } from './thread/pickers/useThreadComposerOptions.js';
import { ComposerTypeaheadMenu } from './composer/ComposerTypeaheadMenu.js';
import {
  commandsFromComposerActions,
  commandsFromPluginSkills,
  mergeCommandCatalogs
} from './composer/filter-composer-suggestions.js';
import { VoiceRecordingBar } from './thread/voice/VoiceRecordingBar.js';
import { useVoiceInput } from './thread/voice/useVoiceInput.js';
import {
  droppedPathsFromDataTransfer,
  isComposerPathDrag,
  mentionContentForDroppedPaths
} from './composer/composer-file-drop.js';
import { findActiveTrigger } from './composer/find-active-trigger.js';
import { mentionAttrsForSuggestion } from './composer/mention-attrs.js';
import { serializePromptEditor } from './composer/serialize-prompt-editor.js';
import {
  nextSuggestionIndex,
  typeaheadKeyAction
} from './composer/typeahead-keyboard.js';
import { COMPOSER_TRIGGERS, type ActiveTrigger, type TypeaheadSuggestion } from './composer/types.js';
import { useComposerSuggestions } from './composer/use-composer-suggestions.js';
import { isBusyThreadStatus, shouldShowThreadStop } from './thread/thread-timeline-model.js';
import { ThreadContextMeter } from './thread/ThreadContextMeter.js';
import {
  composerProjectLabel,
  composerProjectOptions,
  DEFAULT_COMPOSER_WORKSPACE_LABEL,
  resolveComposerProjectId
} from './composer-project-default.js';
import { useBooleanPreference } from '../lib/use-boolean-preference.js';
import { PluginComposerChrome } from '../plugins/PluginComposerChrome.js';
import {
  composerPromptExtensions,
  MARKDOWN_IN_PROMPT_DEFAULT,
  MARKDOWN_IN_PROMPT_KEY,
  NAVIGATE_TO_THREAD_ON_CREATE_DEFAULT,
  NAVIGATE_TO_THREAD_ON_CREATE_KEY,
  resolveThreadSendMode
} from '../lib/thread-composer-preferences.js';
import { COMPOSER_INSERT_EVENT } from './thread/secondary-panel/SecondaryPanelSelectionActions.js';

export type ThreadSendMode = 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';

export interface ThreadCommandComposerProps {
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
  initialText?: string;
  /** Focus the prompt after mounting (hub/browse create-plugin seed). */
  autoFocus?: boolean;
  onCreated?: (threadId: string) => void;
}

export function ThreadCommandComposer({
  project: pinnedProject,
  threadId,
  status,
  inFlightRetry = false,
  environmentLabel,
  sendBlocked = false,
  contextWindowUsage,
  providerId: lockedProviderId,
  model: initialModel,
  reasoningLevel: initialReasoningLevel,
  initialText,
  autoFocus = false,
  onCreated
}: ThreadCommandComposerProps) {
  const navigate = useNavigate();
  const route = useRouteState();
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const upsertThread = useThreads((s) => s.upsert);
  const [commands, setCommands] = useState<Array<{ name: string; description: string }>>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [commandsEpoch, setCommandsEpoch] = useState(0);
  const [projectId, setProjectId] = useState(pinnedProject?.id ?? '');
  const ensureScratchRef = useRef(false);
  const projectOptions = useMemo(() => composerProjectOptions(projects), [projects]);
  const options = useThreadComposerOptions({
    threadId,
    lockedProviderId,
    initialModel,
    initialReasoningLevel
  });
  const [permissionMode, setPermissionMode] = useState('accept-edits');
  const [composerMode, setComposerMode] = useState<ComposerWorkMode>('agent');
  const steerOnEnter = useData((s) => s.steerActiveThreadOnEnter);
  const [navigateOnCreate] = useBooleanPreference(
    NAVIGATE_TO_THREAD_ON_CREATE_KEY,
    NAVIGATE_TO_THREAD_ON_CREATE_DEFAULT
  );
  const [markdownInPrompt] = useBooleanPreference(
    MARKDOWN_IN_PROMPT_KEY,
    MARKDOWN_IN_PROMPT_DEFAULT
  );
  const [expanded, setExpanded] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePickerValue>(() => defaultWorkspaceChoice(false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const submitRef = useRef<(opts?: { modifierEnter?: boolean }) => void>(() => undefined);
  const dismissedRef = useRef<{ from: number; to: number } | null>(null);
  const typeaheadRef = useRef({
    open: false,
    applyCurrent: () => {},
    move: (_delta: number) => {},
    dismiss: () => {}
  });
  const cycleComposerModeRef = useRef<(event: {
    key: string;
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => boolean>(() => false);
  const insertDroppedMentionsRef = useRef<(event: DragEvent) => boolean>(() => false);
  const restoreFocusAfterSubmitRef = useRef(false);
  const [dropOver, setDropOver] = useState(false);
  const dropOverRef = useRef(false);
  dropOverRef.current = dropOver;
  const selectedProject = pinnedProject ?? projects.find((row) => row.id === projectId);
  const hosts = useHosts();
  const publicAppUrl = usePublicAppUrl();
  const threads = useThreads((s) => s.threads);
  const currentThread = threadId ? threads.find((row) => row.id === threadId) : undefined;
  const [hostId, setHostId] = useState(() => defaultHostId(hosts, pinnedProject?.hostId));
  const [hostBusy, setHostBusy] = useState<string | null>(null);
  const [pairingCommand, setPairingCommand] = useState<string | null>(null);
  const [sshPick, setSshPick] = useState<{ hostId: string; name: string } | null>(null);
  const [remoteToolProxy, setRemoteToolProxy] = useState(false);

  useEffect(() => {
    setHostId(defaultHostId(hosts, selectedProject?.hostId));
  }, [hosts, selectedProject?.hostId]);

  useEffect(() => {
    if (!selectedProject?.remote || selectedProject.hostId) {
      setRemoteToolProxy(false);
      return;
    }
    let cancelled = false;
    product.projectSettings.get(selectedProject.id)
      .then((settings) => {
        if (!cancelled) setRemoteToolProxy(settings.remoteToolProxy === true);
      })
      .catch(() => {
        if (!cancelled) setRemoteToolProxy(false);
      });
    return () => { cancelled = true; };
  }, [selectedProject?.id, selectedProject?.remote, selectedProject?.hostId]);

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
  const remoteToolsMark = composerRemoteToolsMark(selectedProject, remoteToolProxy);

  const syncTrigger = useCallback((editor: Parameters<typeof findActiveTrigger>[0]) => {
    const next = findActiveTrigger(editor, COMPOSER_TRIGGERS);
    if (
      next
      && dismissedRef.current
      && next.from === dismissedRef.current.from
      && next.to === dismissedRef.current.to
    ) {
      return;
    }
    dismissedRef.current = null;
    setTrigger(next);
  }, []);

  useEffect(() => {
    if (pinnedProject) {
      setProjectId(pinnedProject.id);
      return;
    }
    const nextId = resolveComposerProjectId(projects, projectId);
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
  }, [loadProjects, pinnedProject, projectId, projects]);

  useEffect(() => {
    const bump = () => setCommandsEpoch((current) => current + 1);
    const offApps = product.pluginApps.onChanged(() => bump());
    const offSkills = product.skills.onChanged(() => bump());
    window.addEventListener(COMPOSER_COMMANDS_RELOAD_EVENT, bump);
    return () => {
      offApps();
      offSkills();
      window.removeEventListener(COMPOSER_COMMANDS_RELOAD_EVENT, bump);
    };
  }, []);

  useEffect(() => {
    const provider = options.provider ?? fallbackProviderOption(options.providerId);
    const fallback = commandsFromComposerActions(provider.composerActions, provider.displayName);
    setCommands(fallback);
    setCommandsLoaded(true);

    let cancelled = false;
    const fromHttp = projectId
      ? product.threads.commands(projectId)
        .then((body) => body.commands.filter((row) => !row.providerId || row.providerId === options.providerId))
        .catch(() => [])
      : Promise.resolve([]);
    const fromPlugins = apiJson<{
      pluginSkills?: Array<{ name: string; enabled?: boolean; skillNames?: string[] }>;
    }>('/plugins/contributions')
      .then((body) => commandsFromPluginSkills(body.pluginSkills ?? []))
      .catch(() => []);
    const fromPalette = product.commands.list(selectedProject?.path).catch(() => []);

    void Promise.all([fromHttp, fromPlugins, fromPalette]).then(([httpRows, pluginRows, paletteRows]) => {
      if (cancelled) return;
      setCommands(mergeCommandCatalogs([
        fallback,
        pluginRows,
        httpRows.map((row) => ({ name: row.name, description: row.description ?? '' })),
        paletteRows.map((row) => ({ name: row.invocation, description: row.description ?? '' }))
      ]));
    });
    return () => {
      cancelled = true;
    };
  }, [options.provider, options.providerId, projectId, selectedProject?.path, commandsEpoch]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: composerPromptExtensions(
      markdownInPrompt,
      threadId
        ? 'Ask for a follow-up. @ to mention files, folders, or threads'
        : 'Ask anything. @ to mention files, folders, or threads'
    ),
    editorProps: {
      attributes: {
        class: 'ui-command-composer-input thread-command-editor',
        'data-testid': 'thread-command-input'
      },
      handleDrop: (_view, event) => {
        if (!insertDroppedMentionsRef.current(event)) return false;
        event.stopPropagation();
        return true;
      },
      handleDOMEvents: {
        dragover: (_view, event) => {
          if (!isComposerPathDrag(Array.from(event.dataTransfer?.types ?? []))) return false;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
          if (!dropOverRef.current) {
            dropOverRef.current = true;
            setDropOver(true);
          }
          return false;
        }
      },
      handleKeyDown: (_view, event) => {
        if (cycleComposerModeRef.current(event)) return true;
        const menu = typeaheadRef.current;
        if (menu.open) {
          const action = typeaheadKeyAction(event);
          if (action === 'next') {
            event.preventDefault();
            menu.move(1);
            return true;
          }
          if (action === 'prev') {
            event.preventDefault();
            menu.move(-1);
            return true;
          }
          if (action === 'apply') {
            event.preventDefault();
            menu.applyCurrent();
            return true;
          }
          if (action === 'dismiss') {
            event.preventDefault();
            menu.dismiss();
            return true;
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            return true;
          }
        }
        if (
          event.key === 'Enter'
          && !event.shiftKey
          && !event.altKey
          && !event.metaKey
          && !event.ctrlKey
          && !event.isComposing
        ) {
          event.preventDefault();
          submitRef.current({ modifierEnter: false });
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: next }) => syncTrigger(next),
    onSelectionUpdate: ({ editor: next }) => syncTrigger(next)
  }, [markdownInPrompt, threadId]);

  const seededInitialText = useRef(false);
  useEffect(() => {
    if (!editor || seededInitialText.current || !initialText) return;
    seededInitialText.current = true;
    const chain = editor.chain().insertContent(initialText);
    if (autoFocus) chain.focus();
    chain.run();
  }, [autoFocus, editor, initialText]);

  useEffect(() => {
    if (!editor || !autoFocus || initialText) return;
    editor.commands.focus();
  }, [autoFocus, editor, initialText]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!busy);
    if (busy || !restoreFocusAfterSubmitRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      restoreFocusAfterSubmitRef.current = false;
      editor.commands.focus('end', { scrollIntoView: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, editor]);

  const insertDroppedMentions = useCallback((event: DragEvent, atDropPoint: boolean): boolean => {
    const data = event.dataTransfer;
    if (!editor || !data) return false;
    const paths = droppedPathsFromDataTransfer({
      types: Array.from(data.types),
      files: Array.from(data.files),
      items: data.items,
      getData: (type) => data.getData(type),
      pathForFile: (file) => product.files.pathForFile(file),
      projectRoot: selectedProject?.path
    });
    if (paths.length === 0) return false;
    event.preventDefault();
    const chain = editor.chain().focus();
    if (atDropPoint) {
      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      if (typeof pos === 'number') chain.setTextSelection(pos);
    }
    return chain.insertContent(mentionContentForDroppedPaths(paths)).run();
  }, [editor, selectedProject?.path]);

  insertDroppedMentionsRef.current = (event) => {
    const inserted = insertDroppedMentions(event, true);
    if (inserted) {
      dropOverRef.current = false;
      setDropOver(false);
    }
    return inserted;
  };

  const dropHandlers = {
    onDragOver: (event: ReactDragEvent) => {
      if (!isComposerPathDrag(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      if (!dropOverRef.current) {
        dropOverRef.current = true;
        setDropOver(true);
      }
    },
    onDragLeave: (event: ReactDragEvent) => {
      if (event.currentTarget === event.target) {
        dropOverRef.current = false;
        setDropOver(false);
      }
    },
    onDrop: (event: ReactDragEvent) => {
      if (!insertDroppedMentions(event.nativeEvent, false)) return;
      event.preventDefault();
      dropOverRef.current = false;
      setDropOver(false);
    }
  };

  const insertVoiceTranscript = useCallback((text: string) => {
    editor?.chain().focus().insertContent(text.endsWith(' ') ? text : `${text} `).run();
  }, [editor]);
  useEffect(() => {
    if (!editor || !threadId) return;
    const onInsert = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; text?: string }>).detail;
      if (!detail?.text || detail.threadId !== threadId) return;
      insertVoiceTranscript(detail.text);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, onInsert);
    return () => window.removeEventListener(COMPOSER_INSERT_EVENT, onInsert);
  }, [editor, insertVoiceTranscript, threadId]);
  const voice = useVoiceInput({ onTranscript: insertVoiceTranscript });
  const voiceBusy = voice.state === 'recording' || voice.state === 'transcribing';

  const { suggestions, menuOpen } = useComposerSuggestions({
    trigger,
    projectId,
    projects,
    commands,
    commandsLoaded
  });
  const highlighted = suggestions.length === 0 ? 0 : Math.min(selectedIndex, suggestions.length - 1);

  useEffect(() => {
    setSelectedIndex(0);
  }, [trigger?.from, trigger?.kind, trigger?.query]);

  const applySuggestion = useCallback((item: TypeaheadSuggestion) => {
    if (!editor || !trigger) return;
    dismissedRef.current = null;
    editor.chain().focus().deleteRange({ from: trigger.from, to: trigger.to }).insertContent([
      { type: 'mention', attrs: mentionAttrsForSuggestion(item) },
      { type: 'text', text: ' ' }
    ]).run();
    setTrigger(null);
  }, [editor, trigger]);

  typeaheadRef.current = {
    open: menuOpen,
    applyCurrent: () => {
      const item = suggestions[highlighted];
      if (item) applySuggestion(item);
    },
    move: (delta) => {
      setSelectedIndex(nextSuggestionIndex(highlighted, suggestions.length, delta));
    },
    dismiss: () => {
      if (trigger) dismissedRef.current = { from: trigger.from, to: trigger.to };
      setTrigger(null);
    }
  };

  const permissionOptions = permissionModeOptionsFor(
    options.provider?.permissionModes ?? ['accept-edits', 'full']
  );
  const resolvedProviderId = threadId
    ? options.providerId
    : options.providers.find((row) => row.id === 'fake')?.id
      ?? (options.providers.some((row) => row.id === options.providerId) ? options.providerId : options.providers[0]?.id);
  const canSend = Boolean(threadId || ((pinnedProject || projectId) && resolvedProviderId));

  const composerModes = useMemo(
    () => composerModesForActions(options.provider?.composerActions ?? []),
    [options.provider]
  );
  cycleComposerModeRef.current = (event) => {
    if (event.key !== 'Tab' || !event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (composerModes.length <= 1) return false;
    event.preventDefault();
    event.stopPropagation();
    setComposerMode((current) => nextComposerWorkMode(composerModes, current));
    return true;
  };

  useEffect(() => {
    const modes = options.provider?.permissionModes ?? [];
    if (modes.length > 0 && !modes.includes(permissionMode)) {
      setPermissionMode(modes[0]!);
    }
  }, [permissionMode, options.provider]);

  useEffect(() => {
    if (!composerModes.includes(composerMode)) setComposerMode('agent');
  }, [composerMode, composerModes]);

  const runPeerDaemon = useCallback(async (kind: 'install' | 'fix', targetHostId?: string) => {
    const project = pinnedProject ?? projects.find((row) => row.id === projectId);
    setPairingCommand(null);
    setHostBusy(kind === 'install' ? 'Installing…' : 'Reconnecting…');
    setError(null);
    try {
      const events = kind === 'install'
        ? await product.hosts.bootstrap(project!.id)
        : await product.hosts.repair(targetHostId!);
      const outcome = bootstrapOutcome(events);
      if (!outcome.ok) {
        setError(outcome.message);
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
  }, [hostAction, hosts, runPeerDaemon]);

  const submit = useCallback(async (opts?: { modifierEnter?: boolean }) => {
    if (busy || sendBlocked || hostSendBlocked || typeaheadRef.current.open) return;
    const serialized = serializePromptEditor(editor?.getJSON());
    if (!serialized.text.trim()) {
      setError('Enter a message first');
      editor?.commands.focus();
      return;
    }
    const selected = pinnedProject ?? projects.find((row) => row.id === projectId);
    if (!threadId && !selected) {
      setError('Select a project first');
      editor?.commands.focus();
      return;
    }
    if (!threadId && !resolvedProviderId) {
      setError('No thread provider is available');
      editor?.commands.focus();
      return;
    }
    const sendMode = resolveThreadSendMode({
      steerOnEnter,
      threadRunning: isBusyThreadStatus(status ?? '') || inFlightRetry,
      modifierEnter: opts?.modifierEnter === true
    });
    const text = applyComposerModePrefix(serialized.text, composerMode);
    const input = [{ type: 'text' as const, text, mentions: serialized.mentions }];
    restoreFocusAfterSubmitRef.current = true;
    setError(null);
    setBusy(true);
    try {
      if (threadId) {
        await product.threads.send(threadId, input, sendMode, {
          model: options.model,
          reasoningLevel: options.reasoningLevel
        });
        editor?.commands.clearContent();
        return;
      }
      const created = await product.threads.create({
        projectId: selected!.id,
        providerId: resolvedProviderId!,
        input,
        hostId,
        environment: workspace,
        cwd: selected!.path,
        permissionMode: permissionMode as 'accept-edits' | 'auto' | 'full',
        model: options.model,
        reasoningLevel: options.reasoningLevel
      });
      if (!created.ok) {
        setError(created.message ?? 'Could not create thread');
        return;
      }
      upsertThread(created.value);
      editor?.commands.clearContent();
      onCreated?.(created.value.id);
      if (navigateOnCreate) {
        navigate(getThreadRoutePath(
          created.value.id,
          route.isProjectWorkspace ? route.focusedProjectId : undefined
        ));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send message');
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    sendBlocked,
    hostSendBlocked,
    composerMode,
    editor,
    navigate,
    navigateOnCreate,
    onCreated,
    options.model,
    options.reasoningLevel,
    permissionMode,
    pinnedProject,
    projectId,
    projects,
    resolvedProviderId,
    route.focusedProjectId,
    route.isProjectWorkspace,
    status,
    inFlightRetry,
    steerOnEnter,
    threadId,
    upsertThread,
    workspace,
    hostId
  ]);

  submitRef.current = (opts) => {
    void submit(opts);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (cycleComposerModeRef.current(event)) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      if (typeaheadRef.current.open) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      void submit({ modifierEnter: true });
    }
  };

  const sendButton = (
    <ComposerIconButton
      className={`thread-command-send${busy ? ' is-sending' : ''}`}
      aria-label={busy ? 'Sending' : 'Send'}
      title={
        hostSendBlocked && hostAction.kind !== 'ready'
          ? hostAction.reason
          : busy ? 'Sending' : 'Send'
      }
      aria-busy={busy}
      data-testid="thread-command-send"
      disabled={busy || sendBlocked || hostSendBlocked || !canSend}
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

  const composerText = editor ? serializePromptEditor(editor.getJSON()).text : '';
  const setComposerText = useCallback((next: string) => {
    editor?.commands.setContent(next);
  }, [editor]);
  const composerFocus = useCallback(() => {
    editor?.commands.focus();
  }, [editor]);

  return (
    <>
    <PluginComposerChrome
      scope={threadId ? { kind: 'thread', threadId } : { kind: 'new-thread', projectId: projectId ?? null }}
      text={composerText}
      setText={setComposerText}
      focus={composerFocus}
    >
    <div
      className={`thread-command-composer${expanded ? ' is-expanded' : ''}${dropOver ? ' is-drop-over' : ''}${busy ? ' is-sending' : ''}`}
      onKeyDown={onKeyDown}
      {...dropHandlers}
    >
      <span id="thread-command-label" className="thread-command-label">Thread composer</span>
      {error ? (
        <p className="thread-command-error" data-testid="thread-command-error">{error}</p>
      ) : null}
      <CommandComposer
        className={`home-agent-command thread-command-card${dropOver ? ' is-drop-over' : ''}`}
        labelledBy="thread-command-label"
        aria-busy={busy}
      >
        <div className="thread-command-editor-slot">
          <ComposerIconButton
            className="thread-command-expand"
            aria-label={expanded ? 'Make prompt box smaller' : 'Make prompt box larger'}
            title={expanded ? 'Make prompt box smaller' : 'Make prompt box larger'}
            data-testid="thread-command-expand"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </ComposerIconButton>
          <EditorContent editor={editor} />
        </div>
        {menuOpen && (
          <ComposerTypeaheadMenu
            suggestions={suggestions}
            selectedIndex={highlighted}
            triggerKind={trigger?.kind === 'command' ? 'command' : 'mention'}
            onApply={applySuggestion}
          />
        )}
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
                  onChange={setComposerMode}
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
              </div>
              <div className="thread-command-footer-end">
                <ThreadContextMeter usage={contextWindowUsage} />
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
                    onClick={() => void product.threads.stop(threadId)}
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
                {environmentLabel ?? 'Local'}
              </span>
              <ComposerHostActionChip
                action={hostAction}
                busyLabel={hostBusy}
                pairingCommand={pairingCommand}
                onAction={onHostAction}
                onCopyPairing={pairingCommand
                  ? () => void navigator.clipboard.writeText(pairingCommand)
                  : undefined}
              />
              {remoteToolsMark ? (
                <span className="thread-command-chip" data-testid="composer-remote-tools-mark">
                  {remoteToolsMark}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <div className="thread-command-chip">
                <Folder size={14} aria-hidden="true" />
                <PopoverPicklist
                  value={projectId}
                  options={projectOptions.map((row) => ({ value: row.id, label: composerProjectLabel(row) }))}
                  onChange={setProjectId}
                  ariaLabel="Project"
                  placeholder={DEFAULT_COMPOSER_WORKSPACE_LABEL}
                  disabled={Boolean(pinnedProject)}
                  title={pinnedProject ? 'Workspace is locked to this project' : undefined}
                />
              </div>
              <EnvironmentPicker projectId={projectId} value={workspace} onChange={setWorkspace} />
              {showHostPicker && hosts.length > 0 && (
                <div className="thread-command-chip">
                  <Laptop size={14} aria-hidden="true" />
                  <HostMachinePicker
                    hosts={hosts}
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
                  ? () => void navigator.clipboard.writeText(pairingCommand)
                  : undefined}
              />
              {remoteToolsMark ? (
                <span className="thread-command-chip" data-testid="composer-remote-tools-mark">
                  {remoteToolsMark}
                </span>
              ) : null}
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
