import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { ArrowUp, Folder, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@zana-ai/zcc-domain/product';
import { product } from '../lib/product-client.js';
import { useData } from '../store.js';
import { useThreads } from '../thread-store.js';
import { getThreadRoutePath } from '../lib/route-paths.js';
import {
  CommandComposer,
  ComposerIconButton,
  ComposerToolbar
} from './ui/CommandComposer.js';
import { EnvironmentPicker, defaultWorkspaceChoice, type WorkspacePickerValue } from './EnvironmentPicker.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { ComposerTypeaheadMenu } from './composer/ComposerTypeaheadMenu.js';
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

export type ThreadSendMode = 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';

export interface ThreadProviderOption {
  id: string;
  displayName: string;
  permissionModes: string[];
  reasoningLevels: string[];
  composerActions: string[];
}

export interface ThreadCommandComposerProps {
  project?: Project;
  threadId?: string;
  onCreated?: (threadId: string) => void;
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
  onCreated
}: ThreadCommandComposerProps) {
  const navigate = useNavigate();
  const projects = useData((s) => s.projects);
  const upsertThread = useThreads((s) => s.upsert);
  const [providers, setProviders] = useState<ThreadProviderOption[]>([]);
  const [commands, setCommands] = useState<Array<{ name: string; description: string }>>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [projectId, setProjectId] = useState(pinnedProject?.id ?? '');
  const [providerId, setProviderId] = useState('claude-code');
  const [permissionMode, setPermissionMode] = useState('accept-edits');
  const [model, setModel] = useState('default');
  const [sendMode, setSendMode] = useState<ThreadSendMode>('auto');
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
    if (pinnedProject) setProjectId(pinnedProject.id);
  }, [pinnedProject]);

  useEffect(() => {
    if (pinnedProject || projectId || projects.length === 0) return;
    setProjectId(projects[0]!.id);
  }, [pinnedProject, projectId, projects]);

  useEffect(() => {
    void product.threads.providers().then((body) => {
      setProviders(body.providers);
      const fake = body.providers.find((row) => row.id === 'fake');
      const next = fake ?? body.providers[0];
      if (next && (providerId === 'claude-code' || !body.providers.some((row) => row.id === providerId))) {
        setProviderId(next.id);
      }
    }).catch(() => undefined);
  }, [providerId]);

  useEffect(() => {
    if (!projectId) return;
    setCommandsLoaded(false);
    void product.threads.commands(projectId).then((body) => {
      setCommands(body.commands.filter((row) => row.providerId === providerId));
      setCommandsLoaded(true);
    }).catch(() => {
      setCommands([]);
      setCommandsLoaded(true);
    });
  }, [projectId, providerId]);

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

  const provider = providers.find((row) => row.id === providerId);
  const permissionOptions = (provider?.permissionModes ?? ['accept-edits', 'full']).map((id) => ({
    id,
    label: permissionChipLabel(id)
  }));
  const modelOptions = [
    { id: 'default', label: 'Default' },
    ...(provider?.reasoningLevels ?? []).map((id) => ({ id, label: id }))
  ];

  const resolvedProviderId = providers.find((row) => row.id === 'fake')?.id
    ?? (providers.some((row) => row.id === providerId) ? providerId : providers[0]?.id);
  const resolvedProvider = providers.find((row) => row.id === resolvedProviderId);
  const canSend = Boolean(threadId || ((pinnedProject || projectId) && resolvedProviderId));

  useEffect(() => {
    const modes = resolvedProvider?.permissionModes ?? [];
    if (modes.length > 0 && !modes.includes(permissionMode)) {
      setPermissionMode(modes[0]!);
    }
  }, [permissionMode, resolvedProvider]);

  const submit = useCallback(async () => {
    if (busy || typeaheadRef.current.open) return;
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
    const input = [{ type: 'text' as const, text: serialized.text, mentions: serialized.mentions }];
    setError(null);
    setBusy(true);
    try {
      if (threadId) {
        await product.threads.send(threadId, input, sendMode);
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
        model
      });
      if (!created.ok) {
        setError(created.message ?? 'Could not create thread');
        return;
      }
      upsertThread(created.value);
      editor?.commands.clearContent();
      onCreated?.(created.value.id);
      navigate(getThreadRoutePath(created.value.id));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send message');
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    editor,
    model,
    navigate,
    onCreated,
    permissionMode,
    pinnedProject,
    projectId,
    projects,
    resolvedProvider,
    resolvedProviderId,
    sendMode,
    threadId,
    upsertThread,
    workspace
  ]);

  submitRef.current = () => {
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent) => {
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
      disabled={busy || !canSend}
      onClick={() => void submit()}
    >
      <ArrowUp size={16} />
    </ComposerIconButton>
  );

  return (
    <div className="thread-command-composer">
      <span id="thread-command-label" className="thread-command-label">Thread composer</span>
      {error ? (
        <p className="thread-command-error" data-testid="thread-command-error">{error}</p>
      ) : null}
      <CommandComposer className="home-agent-command thread-command-card" labelledBy="thread-command-label">
        <div className="thread-command-editor-slot" onKeyDown={onKeyDown}>
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
          <div className="thread-command-footer-start">
            {!threadId && (
              <>
                <PopoverPicklist
                  value={providerId}
                  options={providers.map((row) => ({ value: row.id, label: row.displayName }))}
                  onChange={setProviderId}
                  ariaLabel="Provider"
                />
                <PopoverPicklist
                  value={model}
                  options={modelOptions.map((row) => ({ value: row.id, label: row.label }))}
                  onChange={setModel}
                  ariaLabel="Model"
                />
              </>
            )}
            {threadId && (
              <PopoverPicklist
                value={sendMode}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'steer', label: 'Steer' },
                  { value: 'queue-if-active', label: 'Queue if active' },
                  { value: 'steer-if-active', label: 'Steer if active' }
                ]}
                onChange={(id) => setSendMode(id as ThreadSendMode)}
                ariaLabel="Send mode"
              />
            )}
          </div>
          <div className="thread-command-footer-end">
            {threadId && (
              <ComposerIconButton
                aria-label="Stop"
                title="Stop"
                onClick={() => void product.threads.stop(threadId)}
              >
                <Square size={14} />
              </ComposerIconButton>
            )}
            {sendButton}
          </div>
        </ComposerToolbar>
      </CommandComposer>
      {!threadId && (
        <div className="thread-command-composer-meta">
          <div className="thread-command-composer-meta-start">
            {!threadId && !pinnedProject && (
              <div className="thread-command-chip">
                <Folder size={14} aria-hidden="true" />
                <PopoverPicklist
                  value={projectId}
                  options={projects.map((row) => ({ value: row.id, label: row.name }))}
                  onChange={setProjectId}
                  ariaLabel="Project"
                />
              </div>
            )}
            <EnvironmentPicker projectId={projectId} value={workspace} onChange={setWorkspace} />
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
      )}
    </div>
  );
}
