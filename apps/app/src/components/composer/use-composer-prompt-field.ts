import { closeHistory } from '@tiptap/pm/history';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { parseEditorSelection, contextReferenceFromEditorSelection, type EditorSelection, contextReferenceFromClipboard, parseContextReferences, parseContextReference, type ContextReference } from '@zana-ai/zcc-plugin-sdk/app';
import { nativeCapabilities } from '../../lib/native-capabilities.js';
import { canAutomaticallyFocus } from '../../lib/automatic-focus.js';
import { promptEditorDocument } from './restore-prompt-editor.js';
import { promptInputSchema, type PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type DragEvent as ReactDragEvent, type SetStateAction } from 'react';
import { useEditor } from '@tiptap/react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { apiJson } from '../../lib/fetch-with-app-surface.js';
import { COMPOSER_COMMANDS_RELOAD_EVENT } from '../../lib/composer-commands-reload.js';
import { isHostUnavailableError } from '../../lib/host-unavailable.js';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { PROJECT_DRAG_MIME, projectFromDrag } from '../../lib/project-drag.js';
import {
  composerPromptExtensions,
  MARKDOWN_IN_PROMPT_DEFAULT,
  MARKDOWN_IN_PROMPT_KEY
} from '../../lib/thread-composer-preferences.js';
import { useBooleanPreference } from '../../lib/use-boolean-preference.js';
import {
  commandsFromComposerActions,
  commandsFromPluginSkills,
  filterCliComposerCommands,
  mergeCommandCatalogs
} from './filter-composer-suggestions.js';
import {
  droppedPathsFromAbsolutePaths,
  droppedPathsFromDataTransfer,
  isComposerPathDrag,
  mentionContentForDroppedPaths
} from './composer-file-drop.js';
import {
  COMPOSER_IMAGE_MAX_COUNT,
  composerImageRejectReason,
  imageFilesFromClipboard,
  imageFilesFromList,
  mentionPathsAfterImageAttach,
  nextComposerImageId,
  type ComposerImageAttachment
} from './composer-image-attachments.js';
import { findActiveTrigger } from './find-active-trigger.js';
import { mentionAttrsForSuggestion } from './mention-attrs.js';
import { serializePromptEditor, type SerializedPrompt } from './serialize-prompt-editor.js';
import { nextSuggestionIndex, typeaheadKeyAction } from './typeahead-keyboard.js';
import { composerTriggersForMentionProviders } from './composer-mention-triggers.js';
import { type ActiveTrigger, type TypeaheadSuggestion } from './types.js';
import { useComposerSuggestions, useMentionProviderRows } from './use-composer-suggestions.js';
import { useComposerSession } from './ComposerDraft.js';
import { MAX_COMPOSER_IMAGE_BYTES, isEmptyComposerDocument, retainedComposerImageBytes, type ComposerSession } from './composer-session.js';

export type ComposerSlashKind = 'thread' | 'cli';

export type ComposerKeyInterceptor = (event: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}) => boolean;

export interface ComposerSlashCatalog {
  kind: ComposerSlashKind;
  localCommands?: readonly { name: string; description: string; source?: 'command' | 'skill' }[];
  providerId?: string;
  composerActions?: readonly string[];
  providerDisplayName?: string;
}

export interface UseComposerPromptFieldArgs {
  placeholder: string;
  testId: string;
  ariaLabel?: string;
  projectId: string;
  hostId?: string;
  /** Host roster status; a flip back to connected reloads the native catalogue. */
  hostConnected?: boolean;
  environmentId?: string;
  threadId?: string;
  projectRoot?: string | null;
  projects: readonly Project[];
  disabled?: boolean;
  autoFocus?: boolean;
  initialText?: string;
  initialSelection?: EditorSelection;
  initialReferences?: readonly ContextReference[];
  slashCatalog: ComposerSlashCatalog;
  onSubmit: (opts?: { modifierEnter?: boolean }) => void;
  interceptKeyDown?: ComposerKeyInterceptor;
  onError?: (message: string | null) => void;
}

export function useComposerPromptField({
  placeholder,
  testId,
  ariaLabel,
  projectId,
  hostId,
  hostConnected,
  environmentId,
  threadId,
  projectRoot,
  projects,
  disabled = false,
  autoFocus = false,
  initialText,
  initialSelection,
  initialReferences,
  slashCatalog,
  onSubmit,
  interceptKeyDown,
  onError
}: UseComposerPromptFieldArgs) {
  const draft = useComposerSession(threadId ? JSON.stringify(['thread', threadId]) : undefined);
  const snapshot = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const restoredAttachments = snapshot.attachments;
  const setRestoredAttachments = useCallback((next: SetStateAction<PromptInput[]>) => {
    draft.setContent({ attachments: typeof next === 'function' ? next(draft.getSnapshot().attachments) : next });
  }, [draft]);
  const [markdownInPrompt] = useBooleanPreference(
    MARKDOWN_IN_PROMPT_KEY,
    MARKDOWN_IN_PROMPT_DEFAULT
  );
  const [commands, setCommands] = useState<Array<{ name: string; description: string }>>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [commandsEpoch, setCommandsEpoch] = useState(0);
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const mentionProviders = useMentionProviderRows();
  const composerTriggers = useMemo(
    () => composerTriggersForMentionProviders(mentionProviders),
    [mentionProviders]
  );
  const composerTriggersRef = useRef(composerTriggers);
  composerTriggersRef.current = composerTriggers;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const interceptKeyDownRef = useRef(interceptKeyDown);
  interceptKeyDownRef.current = interceptKeyDown;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const dismissedRef = useRef<{ from: number; to: number } | null>(null);
  const typeaheadRef = useRef({
    open: false,
    applyCurrent: () => false as boolean,
    move: (_delta: number) => {},
    dismiss: () => {}
  });
  const insertDroppedMentionsRef = useRef<(event: DragEvent) => boolean>(() => false);
  const attachImagesRef = useRef<(files: File[]) => boolean>(() => false);
  const restoreFocusAfterSubmitRef = useRef(false);
  const pastePlainTextRef = useRef(false);
  const [dropOver, setDropOver] = useState(false);
  const [, setEditorRevision] = useState(0);
  const dropOverRef = useRef(false);
  dropOverRef.current = dropOver;
  const images = snapshot.images;
  const setImages = useCallback((next: SetStateAction<ComposerImageAttachment[]>) => {
    draft.setContent({ images: typeof next === 'function' ? next(draft.getSnapshot().images) : next });
  }, [draft]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => {
    if (draft.retentionError) onErrorRef.current?.(draft.retentionError);
  }, [draft]);

  const syncTrigger = useCallback((editor: Parameters<typeof findActiveTrigger>[0]) => {
    const next = findActiveTrigger(editor, composerTriggersRef.current);
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
    const providerCommands = slashCatalog.kind === 'thread'
      ? commandsFromComposerActions(
        slashCatalog.composerActions ?? [],
        slashCatalog.providerDisplayName
      )
      : [];
    const fallback = mergeCommandCatalogs([slashCatalog.localCommands ?? [], providerCommands]);
    setCommands(slashCatalog.kind === 'cli' ? filterCliComposerCommands(fallback) : fallback);
    setCommandsLoaded(true);

    let cancelled = false;
    const fromHttp = slashCatalog.kind === 'thread' && projectId
      ? product.threads.commands(projectId)
        .then((body) => body.commands.filter((row) => !row.providerId || row.providerId === slashCatalog.providerId))
        .catch(() => [])
      : Promise.resolve([]);
    const fromPlugins = apiJson<{
      pluginSkills?: Array<{ name: string; enabled?: boolean; skillNames?: string[] }>;
    }>('/plugins/contributions')
      .then((body) => commandsFromPluginSkills(body.pluginSkills ?? []))
      .catch(() => []);
    const fromNative = projectId && slashCatalog.providerId
      ? nativeCapabilities({ projectId, providerId: slashCatalog.providerId, hostId, environmentId })
        // Discovery diagnostics (e.g. a skill with broken frontmatter) are non-fatal and
        // listed in the Skills view; only a failed discovery request is a composer error.
        // An offline host is already shown by the composer and reloads on reconnect.
        .then(body => body.commands)
        .catch(error => {
          if (!cancelled && !isHostUnavailableError(error)) onErrorRef.current?.(error instanceof Error ? error.message : String(error));
          return [];
        })
      : Promise.resolve([]);

    void Promise.all([fromHttp, fromPlugins, fromNative]).then(([httpRows, pluginRows, paletteRows]) => {
      if (cancelled) return;
      const threadRows = httpRows.map((row) => ({ name: row.name, description: row.description ?? '' }));
      setCommands(mergeCommandCatalogs([
        slashCatalog.kind === 'cli' ? filterCliComposerCommands(fallback) : fallback,
        pluginRows,
        slashCatalog.kind === 'cli' ? [] : threadRows,
        paletteRows.map((row) => ({ name: row.name, description: row.description ?? '' }))
      ]));
    });
    return () => {
      cancelled = true;
    };
  }, [
    commandsEpoch,
    hostId,
    hostConnected,
    environmentId,
    projectId,
    projectRoot,
    slashCatalog.composerActions,
    slashCatalog.kind,
    slashCatalog.localCommands,
    slashCatalog.providerDisplayName,
    slashCatalog.providerId
  ]);

  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  // A node view can flush React effects before TipTap emits onUpdate. Ignore
  // snapshots already superseded by the transaction currently being rendered.
  const localTransaction = useRef<{ draft: ComposerSession; editor: ReturnType<typeof useEditor>; revision: number } | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    content: snapshot.document,
    extensions: composerPromptExtensions(markdownInPrompt, placeholder),
    editorProps: {
      attributes: {
        class: 'ui-command-composer-input thread-command-editor',
        'data-testid': testId,
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {})
      },
      handleDrop: (_view, event) => {
        if (!insertDroppedMentionsRef.current(event)) return false;
        event.stopPropagation();
        return true;
      },
      handlePaste: (view, event) => {
        const plain = pastePlainTextRef.current;
        pastePlainTextRef.current = false;
        const selection = plain ? null : contextReferenceFromClipboard(event.clipboardData);
        if (!disabled && selection) {
          const current = serializePromptEditor(editorRef.current?.getJSON()).references?.map(ref => ref.reference) ?? [];
          if (!parseContextReferences([...current, selection])) {
            onErrorRef.current?.('Too much copied context. Remove a reference or paste as plain text.');
            event.preventDefault(); return true;
          }
          const node = view.state.schema.nodes.editorSelection!.create({ reference: selection });
          view.dispatch(closeHistory(view.state.tr).replaceSelectionWith(node).scrollIntoView());
          view.dispatch(closeHistory(view.state.tr));
          event.preventDefault();
          return true;
        }
        const files = imageFilesFromClipboard(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        attachImagesRef.current(files);
        return true;
      },
      handleDOMEvents: {
        keyup: () => { pastePlainTextRef.current = false; return false; },
        dragover: (_view, event) => {
          const types = Array.from(event.dataTransfer?.types ?? []);
          if (!types.includes(PROJECT_DRAG_MIME) && !isComposerPathDrag(types)) return false;
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
        // Electron may consume the V accelerator; Shift itself still reaches the editor.
        pastePlainTextRef.current = event.shiftKey || event.key === 'Shift';
        if (interceptKeyDownRef.current?.(event)) return true;
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
            if (menu.applyCurrent()) {
              event.preventDefault();
              return true;
            }
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
        // Cmd/Ctrl+Enter submits through the composer chrome (handleChromeKeyDown).
        // Claim it here so the editor's hard-break shortcut does not also insert a
        // line break, which stayed in the prompt whenever the submit was refused.
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
          event.preventDefault();
          return true;
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
          onSubmitRef.current({ modifierEnter: false });
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: next }) => {
      draft.setContent({ document: next.getJSON() });
      syncTrigger(next);
      setEditorRevision((current) => current + 1);
    },
    onSelectionUpdate: ({ editor: next }) => {
      draft.setSelection({ from: next.state.selection.from, to: next.state.selection.to });
      syncTrigger(next);
    }
  }, [ariaLabel, markdownInPrompt, placeholder, testId, draft]);

  useEffect(() => {
    if (!editor) return;
    const before = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      if (transaction.docChanged) localTransaction.current = { draft, editor, revision: draft.getSnapshot().revision };
    };
    editor.on('beforeTransaction', before);
    return () => { editor.off('beforeTransaction', before); };
  }, [draft, editor]);

  // Other mounted panes and late send completions can update this same session.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const local = localTransaction.current;
    if (local?.draft === draft && local.editor === editor && snapshot.revision <= local.revision) return;
    if (snapshot.document && JSON.stringify(editor.getJSON()) !== JSON.stringify(snapshot.document)) {
      editor.commands.setContent(snapshot.document, { emitUpdate: false });
      syncTrigger(editor);
      setEditorRevision(current => current + 1);
    }
  }, [draft, editor, snapshot.document, snapshot.revision, syncTrigger]);
  useEffect(() => {
    if (!editor || draft.getSnapshot().document !== undefined) return;
    // Even an untouched empty composer is initialized; a later seed must not
    // overwrite it after navigation. Initial text is inserted below on mount.
    if (!initialText) draft.setContent({ document: editor.getJSON() });
  }, [draft, editor, initialText]);
  const selectionRestoredFor = useRef<ComposerSession | null>(null);
  useEffect(() => {
    if (!editor || selectionRestoredFor.current === draft) return;
    selectionRestoredFor.current = draft;
    const selection = draft.getSelection();
    if (selection) editor.commands.setTextSelection({ from: Math.min(selection.from, editor.state.doc.content.size), to: Math.min(selection.to, editor.state.doc.content.size) });
  }, [draft, editor]);

  editorRef.current = editor;

  // A surface session outlives one seed (Inbox/Library "Spawn agent" reuse the
  // project's launcher). A new seed replaces an empty or unedited earlier seed;
  // the same seed, or anything the user typed, is kept across navigation.
  const seededFor = useRef<{ draft: ComposerSession; text: string } | null>(null);
  useEffect(() => {
    if (!editor || (!initialText && !initialReferences?.length && !initialSelection)) return;
    const selection = parseEditorSelection(initialSelection);
    const references = parseContextReferences([...(initialReferences ?? []), ...(selection ? [contextReferenceFromEditorSelection(selection)] : [])]);
    if (!references) { onErrorRef.current?.('Invalid copied context.'); return; }
    const seed = references.length ? JSON.stringify([initialText ?? '', references]) : initialText!;
    if (seededFor.current?.draft === draft && seededFor.current.text === seed) return;
    seededFor.current = { draft, text: seed };
    const current = draft.getSnapshot();
    if (draft.getSeed()?.text === seed && current.document !== undefined) return;
    const replaceable = current.document === undefined
      || isEmptyComposerDocument(current.document)
      || draft.getSeed()?.revision === current.revision;
    if (!replaceable) return;
    const chain = editor.chain().clearContent().insertContent(initialText ?? '');
    for (const reference of references) chain.insertContent({ type: 'editorSelection', attrs: { reference } }).insertContent(' ');
    chain.run();
    draft.setSeed({ text: seed, revision: draft.getSnapshot().revision });
  }, [autoFocus, draft, editor, initialText, initialReferences, initialSelection]);

  useEffect(() => {
    if (!editor || !autoFocus) return;
    const frame = requestAnimationFrame(() => {
      // Check at the moment of focus, including late mounts and pane updates.
      // Tiptap's focus command defers again, leaving a race with another input.
      if (!editor.isDestroyed && canAutomaticallyFocus(editor.view.dom)) editor.view.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, editor, initialText]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
    if (disabled || !restoreFocusAfterSubmitRef.current) return;
    const frame = requestAnimationFrame(() => {
      restoreFocusAfterSubmitRef.current = false;
      if (editor.isDestroyed || !canAutomaticallyFocus(editor.view.dom)) return;
      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.view.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [disabled, editor]);

  const addImageFiles = useCallback((files: File[]): boolean => {
    if (files.length === 0) return false;
    let firstReason: string | null = null;
    const current = imagesRef.current;
    const next = [...current];
    for (const file of files) {
      const reason = composerImageRejectReason(file);
      if (reason) {
        firstReason ??= reason;
        continue;
      }
      if (next.length >= COMPOSER_IMAGE_MAX_COUNT) {
        firstReason ??= `You can attach up to ${COMPOSER_IMAGE_MAX_COUNT} images.`;
        break;
      }
      const addedBytes = next.slice(current.length).reduce((sum, image) => sum + image.sizeBytes, 0);
      if (retainedComposerImageBytes() + addedBytes + file.size > MAX_COMPOSER_IMAGE_BYTES) {
        firstReason ??= 'Draft attachment storage is full. Remove or send existing attachments first.';
        break;
      }
      let path = '';
      try {
        path = product.files.pathForFile(file);
      } catch {
        path = '';
      }
      if (path && next.some((row) => row.path === path)) continue;
      next.push({
        id: nextComposerImageId(),
        name: file.name || 'image.png',
        mimeType: file.type || 'image/png',
        sizeBytes: file.size,
        path: path || null,
        previewSrc: URL.createObjectURL(file),
        file
      });
    }
    if (next.length === current.length && !firstReason) return false;
    setImages(next);
    if (firstReason) onErrorRef.current?.(firstReason);
    return next.length > current.length || Boolean(firstReason);
  }, [setImages]);
  attachImagesRef.current = addImageFiles;

  const removeImage = useCallback((id: string) => {
    setImages((current) => {
      return current.filter((row) => row.id !== id);
    });
  }, [setImages]);

  const insertDroppedMentions = useCallback((event: DragEvent, atDropPoint: boolean): boolean => {
    const data = event.dataTransfer;
    if (!editor || !data || disabled) return false;
    if (Array.from(data.types).includes(PROJECT_DRAG_MIME)) {
      // Consume stale/unknown project drags too, so their text fallback cannot
      // turn into a misleading mention or an accidental editor move.
      event.preventDefault();
      const project = projectFromDrag(data, projects);
      if (!project) return true;
      const chain = editor.chain().focus();
      if (atDropPoint) {
        const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (typeof pos === 'number') chain.setTextSelection(pos);
      }
      return chain.insertContent([
        { type: 'mention', attrs: mentionAttrsForSuggestion({ kind: 'project', projectId: project.id, name: project.name }) },
        { type: 'text', text: ' ' }
      ]).run();
    }
    const imageFiles = imageFilesFromList(Array.from(data.files));
    const attachedImages = addImageFiles(imageFiles);
    const paths = mentionPathsAfterImageAttach(droppedPathsFromDataTransfer({
      types: Array.from(data.types),
      files: Array.from(data.files),
      items: data.items,
      getData: (type) => data.getData(type),
      pathForFile: (file) => product.files.pathForFile(file),
      projectRoot
    }), imageFiles);
    if (!attachedImages && paths.length === 0) return false;
    event.preventDefault();
    if (paths.length === 0) return true;
    const chain = editor.chain().focus();
    if (atDropPoint) {
      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      if (typeof pos === 'number') chain.setTextSelection(pos);
    }
    return chain.insertContent(mentionContentForDroppedPaths(paths)).run();
  }, [addImageFiles, editor, projectRoot, projects, disabled]);

  const canAttach = !disabled && !!editor;
  const attachPickedFiles = useCallback(() => {
    if (!canAttach || !editor) return;
    if (!hasDesktopBridge()) {
      // Keep the picker in the tap handler so mobile browsers retain user activation.
      imageInputRef.current?.click();
      return;
    }
    void product.fs.pickFiles().then((picked) => {
      const paths = droppedPathsFromAbsolutePaths(picked, projectRoot);
      if (paths.length === 0) return;
      editor.chain().focus().insertContent(mentionContentForDroppedPaths(paths)).run();
    });
  }, [canAttach, editor, projectRoot]);

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
      const types = Array.from(event.dataTransfer.types);
      if (disabled || (!types.includes(PROJECT_DRAG_MIME) && !isComposerPathDrag(types))) return;
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

  const insertContextReference = useCallback((value: ContextReference): boolean => {
    const reference = parseContextReference(value);
    if (!editor || disabled || !reference) return false;
    const current = serializePromptEditor(editor.getJSON()).references?.map(ref => ref.reference) ?? [];
    if (!parseContextReferences([...current, reference])) {
      onErrorRef.current?.('Too much copied context. Remove a reference or paste as plain text.');
      return false;
    }
    const node = editor.state.schema.nodes.editorSelection!.create({ reference });
    const tr = closeHistory(editor.state.tr);
    // Inspecting an inline badge can select its atom. A source toolbar adds
    // context after that badge instead of replacing the inspected snapshot.
    if (tr.selection instanceof NodeSelection) tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.to)));
    editor.view.dispatch(tr.replaceSelectionWith(node).scrollIntoView());
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.focus();
    return true;
  }, [editor, disabled]);

  const updateContextReference = useCallback((pluginId:string,resourceId:string,value:ContextReference|null):boolean => {
    const reference=value===null ? null : parseContextReference(value);
    if (!editor || disabled || (value!==null && !reference)) return false;
    const refs=serializePromptEditor(editor.getJSON()).references?.map(row=>row.reference)??[];
    const matches=(ref:ContextReference)=>ref.source?.kind==='plugin' && ref.source.pluginId===pluginId && ref.source.resourceId===resourceId;
    if (reference && !parseContextReferences(refs.map(ref=>matches(ref)?reference:ref)))return false;
    const tr=closeHistory(editor.state.tr); let found=false;
    editor.state.doc.descendants((node,pos)=>{const ref=parseContextReference(node.attrs.reference);if(node.type.name==='editorSelection' && ref && matches(ref)){found=true;if(reference)tr.setNodeMarkup(pos,undefined,{...node.attrs,reference});else tr.delete(tr.mapping.map(pos),tr.mapping.map(pos+node.nodeSize));}});
    if(found){editor.view.dispatch(tr);editor.view.dispatch(closeHistory(editor.state.tr));}
    return found;
  },[editor,disabled]);

  const insertText = useCallback((text: string) => {
    editor?.chain().focus().insertContent(text.endsWith(' ') ? text : `${text} `).run();
  }, [editor]);

  const { suggestions, menuOpen } = useComposerSuggestions({
    trigger,
    projectId,
    hostId,
    threadId,
    projects,
    commands,
    commandsLoaded,
    mentionProviders
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
      if (item) {
        applySuggestion(item);
        return true;
      }
      return false;
    },
    move: (delta) => {
      setSelectedIndex(nextSuggestionIndex(highlighted, suggestions.length, delta));
    },
    dismiss: () => {
      if (trigger) dismissedRef.current = { from: trigger.from, to: trigger.to };
      setTrigger(null);
    }
  };

  const serialize = useCallback((): SerializedPrompt => {
    return serializePromptEditor(editor?.getJSON());
  }, [editor]);

  const clear = useCallback(() => {
    draft.clearIfRevision(draft.getSnapshot().revision);
    if (editor && !editor.isDestroyed) editor.commands.clearContent(false);
  }, [draft, editor]);

  const captureRevision = useCallback(() => draft.getSnapshot().revision, [draft]);
  const clearIfRevision = useCallback((revision: number) => draft.clearIfRevision(revision), [draft]);

  const setText = useCallback((next: string) => {
    editor?.commands.setContent(next);
  }, [editor]);

  const restoreText = useCallback((input: readonly PromptInput[]) => {
    const parts = input.map(part => promptInputSchema.parse(part));
    const document = promptEditorDocument(parts);
    draft.setContent({ document });
    if (editor && !editor.isDestroyed) editor.commands.setContent(document, { emitUpdate: false });
  }, [draft, editor]);

  const replacePrompt = useCallback((input: readonly PromptInput[]) => {
    const parts = input.map(part => promptInputSchema.parse(part));
    restoreText(parts);
    draft.setContent({ images: [], attachments: parts.filter(part => part.type !== 'text') });
  }, [draft, restoreText]);

  const focus = useCallback(() => {
    editor?.commands.focus();
  }, [editor]);

  const markRestoreFocus = useCallback(() => {
    restoreFocusAfterSubmitRef.current = true;
  }, []);

  const typeaheadOpen = menuOpen;
  const submitIfIdle = useCallback((opts?: { modifierEnter?: boolean }) => {
    if (typeaheadRef.current.open && suggestions.length > 0) return;
    onSubmitRef.current(opts);
  }, [suggestions.length]);

  const handleChromeKeyDown = useCallback((event: Parameters<ComposerKeyInterceptor>[0]) => {
    if (interceptKeyDownRef.current?.(event)) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      if (typeaheadRef.current.open && suggestions.length > 0) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onSubmitRef.current({ modifierEnter: true });
    }
  }, [suggestions.length]);

  const text = editor ? serializePromptEditor(editor.getJSON()).text : '';

  return {
    editor,
    imageInputProps: {
      ref: imageInputRef,
      type: 'file' as const,
      accept: 'image/*',
      multiple: true,
      hidden: true,
      disabled: !canAttach,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.currentTarget.files ?? []);
        // Allow selecting the same screenshot again after removing it or sending.
        event.currentTarget.value = '';
        if (canAttach) addImageFiles(files);
      }
    },
    images,
    restoredAttachments,
    replacePrompt,
    restoreText,
    removeRestoredAttachment: (index: number) => setRestoredAttachments(rows => rows.filter((_,i) => i !== index)),
    removeImage,
    dropOver,
    dropHandlers,
    canAttach,
    attachPickedFiles,
    insertText,
    insertContextReference,
    updateContextReference,
    serialize,
    clear,
    captureRevision,
    clearIfRevision,
    setText,
    focus,
    text,
    markRestoreFocus,
    typeaheadOpen,
    submitIfIdle,
    handleChromeKeyDown,
    menuOpen,
    suggestions,
    highlighted,
    triggerKind: trigger?.kind === 'command' ? 'command' as const : 'mention' as const,
    applySuggestion
  };
}
