import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { useEditor } from '@tiptap/react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { apiJson } from '../../lib/fetch-with-app-surface.js';
import { COMPOSER_COMMANDS_RELOAD_EVENT } from '../../lib/composer-commands-reload.js';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
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
  providerId?: string;
  composerActions?: readonly string[];
  providerDisplayName?: string;
}

export interface UseComposerPromptFieldArgs {
  placeholder: string;
  testId: string;
  ariaLabel?: string;
  projectId: string;
  threadId?: string;
  projectRoot?: string | null;
  projects: readonly Project[];
  disabled?: boolean;
  autoFocus?: boolean;
  initialText?: string;
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
  threadId,
  projectRoot,
  projects,
  disabled = false,
  autoFocus = false,
  initialText,
  slashCatalog,
  onSubmit,
  interceptKeyDown,
  onError
}: UseComposerPromptFieldArgs) {
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
    applyCurrent: () => {},
    move: (_delta: number) => {},
    dismiss: () => {}
  });
  const insertDroppedMentionsRef = useRef<(event: DragEvent) => boolean>(() => false);
  const attachImagesRef = useRef<(files: File[]) => boolean>(() => false);
  const restoreFocusAfterSubmitRef = useRef(false);
  const [dropOver, setDropOver] = useState(false);
  const dropOverRef = useRef(false);
  dropOverRef.current = dropOver;
  const [images, setImages] = useState<ComposerImageAttachment[]>([]);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => {
    for (const image of imagesRef.current) URL.revokeObjectURL(image.previewSrc);
  }, []);

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
    const fallback = slashCatalog.kind === 'thread'
      ? commandsFromComposerActions(
        slashCatalog.composerActions ?? [],
        slashCatalog.providerDisplayName
      )
      : [];
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
    const fromPalette = product.commands.list(projectRoot ?? undefined).catch(() => []);

    void Promise.all([fromHttp, fromPlugins, fromPalette]).then(([httpRows, pluginRows, paletteRows]) => {
      if (cancelled) return;
      const threadRows = httpRows.map((row) => ({ name: row.name, description: row.description ?? '' }));
      setCommands(mergeCommandCatalogs([
        slashCatalog.kind === 'cli' ? filterCliComposerCommands(fallback) : fallback,
        pluginRows,
        slashCatalog.kind === 'cli' ? [] : threadRows,
        paletteRows.map((row) => ({ name: row.invocation, description: row.description ?? '' }))
      ]));
    });
    return () => {
      cancelled = true;
    };
  }, [
    commandsEpoch,
    projectId,
    projectRoot,
    slashCatalog.composerActions,
    slashCatalog.kind,
    slashCatalog.providerDisplayName,
    slashCatalog.providerId
  ]);

  const editor = useEditor({
    immediatelyRender: false,
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
      handlePaste: (_view, event) => {
        const files = imageFilesFromClipboard(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        attachImagesRef.current(files);
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
          onSubmitRef.current({ modifierEnter: false });
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: next }) => syncTrigger(next),
    onSelectionUpdate: ({ editor: next }) => syncTrigger(next)
  }, [ariaLabel, markdownInPrompt, placeholder, testId]);

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
    editor.setEditable(!disabled);
    if (disabled || !restoreFocusAfterSubmitRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      restoreFocusAfterSubmitRef.current = false;
      editor.commands.focus('end', { scrollIntoView: false });
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
  }, []);
  attachImagesRef.current = addImageFiles;

  const removeImage = useCallback((id: string) => {
    setImages((current) => {
      const found = current.find((row) => row.id === id);
      if (found) URL.revokeObjectURL(found.previewSrc);
      return current.filter((row) => row.id !== id);
    });
  }, []);

  const insertDroppedMentions = useCallback((event: DragEvent, atDropPoint: boolean): boolean => {
    const data = event.dataTransfer;
    if (!editor || !data) return false;
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
  }, [addImageFiles, editor, projectRoot]);

  const canAttach = hasDesktopBridge();
  const attachPickedFiles = useCallback(() => {
    if (!canAttach || !editor) return;
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

  const insertText = useCallback((text: string) => {
    editor?.chain().focus().insertContent(text.endsWith(' ') ? text : `${text} `).run();
  }, [editor]);

  const { suggestions, menuOpen } = useComposerSuggestions({
    trigger,
    projectId,
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

  const serialize = useCallback((): SerializedPrompt => {
    return serializePromptEditor(editor?.getJSON());
  }, [editor]);

  const clear = useCallback(() => {
    editor?.commands.clearContent();
    for (const image of imagesRef.current) URL.revokeObjectURL(image.previewSrc);
    setImages([]);
  }, [editor]);

  const setText = useCallback((next: string) => {
    editor?.commands.setContent(next);
  }, [editor]);

  const focus = useCallback(() => {
    editor?.commands.focus();
  }, [editor]);

  const markRestoreFocus = useCallback(() => {
    restoreFocusAfterSubmitRef.current = true;
  }, []);

  const typeaheadOpen = menuOpen;
  const submitIfIdle = useCallback((opts?: { modifierEnter?: boolean }) => {
    if (typeaheadRef.current.open) return;
    onSubmitRef.current(opts);
  }, []);

  const handleChromeKeyDown = useCallback((event: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault: () => void }) => {
    if (interceptKeyDownRef.current?.(event as Parameters<ComposerKeyInterceptor>[0])) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      if (typeaheadRef.current.open) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onSubmitRef.current({ modifierEnter: true });
    }
  }, []);

  const text = editor ? serializePromptEditor(editor.getJSON()).text : '';

  return {
    editor,
    images,
    removeImage,
    dropOver,
    dropHandlers,
    canAttach,
    attachPickedFiles,
    insertText,
    serialize,
    clear,
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
