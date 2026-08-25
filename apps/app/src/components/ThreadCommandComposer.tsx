import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { ArrowUp, Folder, Laptop, Maximize2, Mic, Minimize2, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadContextWindowUsage } from '@zana-ai/zcc-server-contract';
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
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { ComposerModePicker } from './thread/pickers/ComposerModePicker.js';
import { ModelReasoningPicker } from './thread/pickers/ModelReasoningPicker.js';
import { ReasoningEffortPicker } from './thread/pickers/ReasoningEffortPicker.js';
import {
  applyComposerModePrefix,
  composerModesForActions,
  nextComposerWorkMode,
  type ComposerWorkMode
} from './thread/pickers/composer-mode.js';
import { useThreadComposerOptions } from './thread/pickers/useThreadComposerOptions.js';
import { ComposerTypeaheadMenu } from './composer/ComposerTypeaheadMenu.js';
import { VoiceRecordingBar } from './thread/voice/VoiceRecordingBar.js';
import { useVoiceInput } from './thread/voice/useVoiceInput.js';
import { findActiveTrigger } from './composer/find-active-trigger.js';
import { mentionAttrsForSuggestion } from './composer/mention-attrs.js';
import { serializePromptEditor } from './composer/serialize-prompt-editor.js';
import {
  nextSuggestionIndex,
  typeaheadKeyAction
} from './composer/typeahead-keyboard.js';
import { PromptMentionExtension } from './composer/prompt-mention-extension.js';
import { COMPOSER_TRIGGERS, type ActiveTrigger, type TypeaheadSuggestion } from './composer/types.js';
import { useComposerSuggestions } from './composer/use-composer-suggestions.js';
import { shouldShowThreadStop } from './thread/thread-timeline-model.js';
import { ThreadContextMeter } from './thread/ThreadContextMeter.js';
import {
  composerProjectLabel,
  composerProjectOptions,
  DEFAULT_COMPOSER_WORKSPACE_LABEL,
  resolveComposerProjectId
} from './composer-project-default.js';

export type ThreadSendMode = 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';

export interface ThreadCommandComposerProps {
  project?: Project;
  threadId?: string;
  status?: string;
  environmentLabel?: string;
  sendBlocked?: boolean;
  contextWindowUsage?: ThreadContextWindowUsage | null;
  providerId?: string;
  model?: string | null;
  reasoningLevel?: string | null;
  initialText?: string;
  onCreated?: (threadId: string) => void;
  onOpenExplorer?: () => void;
}

function permissionChipLabel(id: string): string {
  if (id === 'full') return 'Full';
  if (id === 'accept-edits') return 'Edits';
  if (id === 'auto') return 'Auto';
  return id;
}

export function ThreadCommandComposer({
  project: pinnedProject,
  threadId,
  status,
  environmentLabel,
  sendBlocked = false,
  contextWindowUsage,
  providerId: lockedProviderId,
  model: initialModel,
  reasoningLevel: initialReasoningLevel,
  initialText,
  onCreated,
  onOpenExplorer
}: ThreadCommandComposerProps) {
  const navigate = useNavigate();
  const route = useRouteState();
  const projects = useData((s) => s.projects);
  const loadProjects = useData((s) => s.loadProjects);
  const upsertThread = useThreads((s) => s.upsert);
  const [commands, setCommands] = useState<Array<{ name: string; description: string }>>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
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
  const sendMode: ThreadSendMode = 'auto';
  const [expanded, setExpanded] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePickerValue>(() => defaultWorkspaceChoice(false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const submitRef = useRef<() => void>(() => undefined);
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
    if (!projectId) return;
    setCommandsLoaded(false);
    void product.threads.commands(projectId).then((body) => {
      setCommands(body.commands.filter((row) => row.providerId === options.providerId));
      setCommandsLoaded(true);
    }).catch(() => {
      setCommands([]);
      setCommandsLoaded(true);
    });
  }, [projectId, options.providerId]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: threadId
          ? 'Ask for a follow-up. @ to mention files, folders, or threads'
          : 'Ask anything. @ to mention files, folders, or threads'
      }),
      PromptMentionExtension
    ],
    editorProps: {
      attributes: {
        class: 'ui-command-composer-input thread-command-editor',
        'data-testid': 'thread-command-input'
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
          submitRef.current();
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: next }) => syncTrigger(next),
    onSelectionUpdate: ({ editor: next }) => syncTrigger(next)
  });

  const seededInitialText = useRef(false);
  useEffect(() => {
    if (!editor || seededInitialText.current || !initialText) return;
    seededInitialText.current = true;
    editor.chain().insertContent(initialText).run();
  }, [editor, initialText]);

  const insertVoiceTranscript = useCallback((text: string) => {
    editor?.chain().focus().insertContent(text.endsWith(' ') ? text : `${text} `).run();
  }, [editor]);
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

  const permissionOptions = (options.provider?.permissionModes ?? ['accept-edits', 'full']).map((id) => ({
    id,
    label: permissionChipLabel(id)
  }));
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

  const submit = useCallback(async () => {
    if (busy || sendBlocked || typeaheadRef.current.open) return;
    const serialized = serializePromptEditor(editor?.getJSON());
    if (!serialized.text.trim()) {
      setError('Enter a message first');
      return;
    }
    const selected = pinnedProject ?? projects.find((row) => row.id === projectId);
    if (!threadId && !selected) {
      setError('Select a project first');
      return;
    }
    if (!threadId && !resolvedProviderId) {
      setError('No thread provider is available');
      return;
    }
    const text = applyComposerModePrefix(serialized.text, composerMode);
    const input = [{ type: 'text' as const, text, mentions: serialized.mentions }];
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
      navigate(getThreadRoutePath(
        created.value.id,
        route.isProjectWorkspace ? route.focusedProjectId : undefined
      ));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send message');
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    sendBlocked,
    composerMode,
    editor,
    navigate,
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
    sendMode,
    threadId,
    upsertThread,
    workspace
  ]);

  submitRef.current = () => {
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (cycleComposerModeRef.current(event)) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      if (typeaheadRef.current.open) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      void submit();
    }
  };

  const sendButton = (
    <ComposerIconButton
      className="thread-command-send"
      aria-label="Send"
      title="Send"
      data-testid="thread-command-send"
      disabled={busy || sendBlocked || !canSend}
      onClick={() => void submit()}
    >
      <ArrowUp size={16} />
    </ComposerIconButton>
  );

  return (
    <div
      className={`thread-command-composer${expanded ? ' is-expanded' : ''}`}
      onKeyDown={onKeyDown}
    >
      <span id="thread-command-label" className="thread-command-label">Thread composer</span>
      {error ? (
        <p className="thread-command-error" data-testid="thread-command-error">{error}</p>
      ) : null}
      <CommandComposer className="home-agent-command thread-command-card" labelledBy="thread-command-label">
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
          {menuOpen && (
            <ComposerTypeaheadMenu
              suggestions={suggestions}
              selectedIndex={highlighted}
              triggerKind={trigger?.kind === 'command' ? 'command' : 'mention'}
              onApply={applySuggestion}
            />
          )}
        </div>
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
                {threadId && shouldShowThreadStop(threadId, status) && (
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
            <button
              type="button"
              className="thread-command-chip"
              data-testid="thread-env-label"
              onClick={onOpenExplorer}
            >
              <Laptop size={14} aria-hidden="true" />
              {environmentLabel ?? 'Local'}
            </button>
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
            </>
          )}
        </div>
        <div className="thread-command-composer-meta-end">
          <PopoverPicklist
            value={permissionMode}
            options={permissionOptions.map((row) => ({ value: row.id, label: row.label }))}
            onChange={setPermissionMode}
            ariaLabel="Permission mode"
          />
        </div>
      </div>
    </div>
  );
}
