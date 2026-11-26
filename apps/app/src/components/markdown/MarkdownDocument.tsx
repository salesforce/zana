import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { dispatchThreadOpenFile } from '../thread/secondary-panel/useThreadOpenFileSignal.js';
import type { OnMount } from '@monaco-editor/react';
import type { ProjectFileScope } from '@zana-ai/zcc-desktop-contract';
import { MarkdownContent } from '../MarkdownContent.js';
import { DocumentLinkBoundary } from '../DocumentLinkBoundary.js';
import type { DocumentLink } from '../document-links.js';
import { useMonacoTheme } from '../../hooks/useMonacoTheme.js';
import { markdownBody, toggleMarkdownTask } from './markdown-source.js';
import { documentSearchRanges } from './document-search.js';
import './markdown-document.css';

const SourceEditor = lazy(() => import('../explorer/ExplorerEditor.js'));
const RichEditor = lazy(() => import('../../views/library/library/LibraryMarkdownEditor.js').then(module => ({ default: module.LibraryMarkdownEditor })));
export type MarkdownMode = 'read' | 'edit' | 'source';
const HISTORY_LIMIT = 100;
const HISTORY_BYTES = 8 * 1024 * 1024;

export interface MarkdownDocumentProps {
  value: string;
  savedValue: string;
  documentPath: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  saving?: boolean;
  readOnlyReason?: string;
  initialMode?: MarkdownMode;
  threadId?: string;
  projectId?: string | null;
  storage?: boolean;
  fragment?: string;
  onOpenDocument?: (link: DocumentLink) => void;
  onSourceMount?: OnMount;
  previewRef?: RefCallback<HTMLDivElement>;
  localImages?: boolean;
  fileScope?: ProjectFileScope;
}

/** One source buffer. Preview operations patch source; mode changes never save or discard. */
export default function MarkdownDocument({ value, savedValue, documentPath, onChange, onSave, saving = false, readOnlyReason, initialMode = 'read', threadId, projectId, storage, fragment, onOpenDocument, onSourceMount, previewRef, localImages = true, fileScope }: MarkdownDocumentProps) {
  const [mode, setMode] = useState<MarkdownMode>(initialMode);
  const [find, setFind] = useState(false);
  const [query, setQuery] = useState('');
  const [occurrence, setOccurrence] = useState(0);
  const [count, setCount] = useState(0);
  const [hasEdited, setHasEdited] = useState(initialMode === 'edit');
  const [richEditor, setRichEditor] = useState<Editor | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const undo = useRef<string[]>([]); const redo = useRef<string[]>([]);
  const valueRef = useRef(value); valueRef.current = value;
  const contentRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceEditor = useRef<Parameters<OnMount>[0] | null>(null);
  const scrollPositions = useRef<{ read?: number; edit?: number }>({});
  const sourceViewState = useRef<ReturnType<Parameters<OnMount>[0]['saveViewState']>>(null);
  const id = `md-find-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const theme = useMonacoTheme();
  const writable = !!onChange && !readOnlyReason;
  const dirty = value !== savedValue;
  const body = useMemo(() => markdownBody(value).body, [value]);
  useLayoutEffect(() => {
    const preview = rootRef.current?.querySelector('.md-document-preview');
    if (preview && mode !== 'source' && scrollPositions.current[mode] !== undefined) preview.scrollTop = scrollPositions.current[mode]!;
  }, [mode]);

  useEffect(() => {
    if (!richEditor || richEditor.isDestroyed) return;
    let previous = '';
    const update = () => {
      if (richEditor.isDestroyed) return;
      const next = `${richEditor.can().undo()}:${richEditor.can().redo()}`;
      if (next !== previous) { previous = next; setHistoryVersion(version => version + 1); }
    };
    update();
    richEditor.on('transaction', update);
    return () => { richEditor.off('transaction', update); };
  }, [richEditor]);
  useEffect(() => {
    if (mode === 'edit' && writable && richEditor && !richEditor.isDestroyed) richEditor.commands.focus();
  }, [mode, writable, richEditor]);

  const change = (next: string) => {
    if (!writable || next === valueRef.current) return;
    undo.current.push(valueRef.current);
    let bytes = undo.current.reduce((sum, item) => sum + item.length * 2, 0);
    while (undo.current.length > HISTORY_LIMIT || bytes > HISTORY_BYTES) bytes -= undo.current.shift()!.length * 2;
    redo.current = [];
    valueRef.current = next;
    onChange?.(next);
    setHistoryVersion(version => version + 1);
  };
  const moveHistory = (back: boolean) => {
    const from = back ? undo.current : redo.current;
    const to = back ? redo.current : undo.current;
    const next = from.pop();
    if (next === undefined || !writable) return;
    to.push(valueRef.current);
    valueRef.current = next;
    onChange?.(next);
    setHistoryVersion(version => version + 1);
  };
  // History belongs to this mounted document, never to another file. Parents key by trusted source identity.
  void historyVersion;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  useLayoutEffect(() => {
    if (!find || mode === 'source' || !contentRef.current) { setCount(0); return; }
    const content = contentRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const api = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
    const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const paint = () => {
      const ranges = documentSearchRanges(content, query);
      setCount(ranges.length);
      const current = ranges.length ? ranges[((occurrence % ranges.length) + ranges.length) % ranges.length] : undefined;
      if (api && Highlight) {
        api.set(id, new Highlight(...ranges));
        api.set(`${id}-current`, new Highlight(...(current ? [current] : [])));
      }
      current?.startContainer.parentElement?.scrollIntoView?.({ block: 'nearest' });
    };
    paint();
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(paint, 80); });
    observer.observe(content, { childList: true, characterData: true, subtree: true });
    return () => { observer.disconnect(); clearTimeout(timer); api?.delete(id); api?.delete(`${id}-current`); };
  }, [find, query, occurrence, mode, value, id]);

  const openFind = () => {
    if (mode === 'source') { void sourceEditor.current?.getAction('actions.find')?.run(); return; }
    setFind(true);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  };
  const preview = (text: string, tasks = true) => <MarkdownContent text={text} documentLinks={!threadId} localDocumentImages={localImages} fileScope={fileScope} documentPath={documentPath} threadId={threadId} projectId={projectId} storage={storage} exportable
    onTaskChange={tasks && writable ? (start, checked) => change(toggleMarkdownTask(valueRef.current, start, checked)) : undefined} />;
  const selectMode = (next: MarkdownMode) => {
    if (next === mode) return;
    if (mode === 'source') sourceViewState.current = sourceEditor.current?.saveViewState() ?? null;
    else scrollPositions.current[mode] = rootRef.current?.querySelector('.md-document-preview')?.scrollTop ?? 0;
    if (next === 'edit') setHasEdited(true);
    setMode(next);
  };

  return <div className="md-document" ref={rootRef} tabIndex={0} data-own-find aria-label="Markdown document" onKeyDownCapture={event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.shiftKey && event.key.toLowerCase() !== 'z') return;
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); openFind(); }
    if (event.key.toLowerCase() === 's' && writable) { event.preventDefault(); event.stopPropagation(); if (dirty && !saving) onSave?.(); }
    if (event.key.toLowerCase() === 'z' && writable) {
      if (event.target instanceof Element && event.target.closest('.md-document-find, .monaco-editor, .tiptap')) return;
      event.preventDefault(); event.stopPropagation();
      if (mode === 'edit' && richEditor && !richEditor.isDestroyed) {
        if (event.shiftKey) richEditor.chain().focus().redo().run(); else richEditor.chain().focus().undo().run();
      } else moveHistory(!event.shiftKey);
    }
  }}>
    <style>{`::highlight(${id}){background:#e9c44866}::highlight(${id}-current){background:#eea54bcc;color:#171717}`}</style>
    <div className="md-document-toolbar" role="toolbar" aria-label="Markdown tools">
      <div className="md-document-modes" role="group" aria-label="Markdown view">
        {(['read', 'edit', 'source'] as const).map(item => <button type="button" key={item} aria-pressed={mode === item} disabled={item === 'edit' && !writable} title={item === 'edit' ? readOnlyReason : undefined} onClick={() => selectMode(item)}>{item === 'read' ? 'Read' : item === 'edit' ? 'Edit' : 'Source'}</button>)}
      </div>
      <button type="button" onClick={openFind} title="Find in document (⌘F / Ctrl+F)">Find</button>
      {writable && <>
        <button type="button" aria-label="Undo document change" disabled={mode === 'edit' && richEditor && !richEditor.isDestroyed ? !richEditor.can().undo() : !undo.current.length} onClick={() => { if (mode === 'edit' && richEditor && !richEditor.isDestroyed) richEditor.chain().focus().undo().run(); else moveHistory(true); }}>↶</button>
        <button type="button" aria-label="Redo document change" disabled={mode === 'edit' && richEditor && !richEditor.isDestroyed ? !richEditor.can().redo() : !redo.current.length} onClick={() => { if (mode === 'edit' && richEditor && !richEditor.isDestroyed) richEditor.chain().focus().redo().run(); else moveHistory(false); }}>↷</button>
      </>}
      <span className="md-document-status" role="status">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : writable ? 'Saved' : 'Read only'}</span>
      {writable && onSave && <button type="button" className="md-document-save" disabled={!dirty || saving} onClick={onSave}>Save</button>}
    </div>
    {readOnlyReason && <p className="md-document-notice">{readOnlyReason}</p>}
    {find && mode !== 'source' && <div className="md-document-find" role="search" aria-label="Find in document">
      <input ref={inputRef} aria-label="Find in document" maxLength={500} value={query} onChange={event => { setQuery(event.target.value); setOccurrence(0); }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFind(false); rootRef.current?.focus(); }
        if (event.key === 'Enter') { event.preventDefault(); setOccurrence(index => index + (event.shiftKey ? -1 : 1)); }
      }} />
      <span role="status">{count ? `${((occurrence % count) + count) % count + 1} of ${count}${count === 1000 ? '+' : ''}` : 'No matches'}</span>
      <button type="button" aria-label="Previous match" disabled={!count} onClick={() => setOccurrence(index => index - 1)}>↑</button>
      <button type="button" aria-label="Next match" disabled={!count} onClick={() => setOccurrence(index => index + 1)}>↓</button>
      <button type="button" aria-label="Close document search" onClick={() => setFind(false)}>×</button>
    </div>}
    {mode === 'source' && <div className="md-document-source"><Suspense fallback={<p>Loading source editor…</p>}><SourceEditor height="100%" path={`document-${id}.md`} language="markdown" theme={theme} value={value} onChange={next => {
      if (next !== undefined) change(valueRef.current.startsWith('\uFEFF') && !next.startsWith('\uFEFF') ? `\uFEFF${next}` : next);
    }} onMount={(editor, monaco) => {
      sourceEditor.current = editor;
      onSourceMount?.(editor, monaco);
      if (sourceViewState.current) editor.restoreViewState(sourceViewState.current);
    }} options={{ readOnly: !writable, wordWrap: 'on', minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true }} /></Suspense></div>}
    <div className="md-document-reading-pane" hidden={mode === 'source'}>
      <DocumentLinkBoundary className="explorer-md-preview md-document-preview" documentPath={documentPath} fragment={fragment}
        onOpenDocument={onOpenDocument ?? (threadId ? link => dispatchThreadOpenFile(threadId, link.path, null) : undefined)}
        interceptLinks={mode === 'edit' || !threadId} elementRef={previewRef}>
        <div ref={contentRef}>
          <div hidden={mode !== 'read'}>{mode === 'read' && preview(body)}</div>
          <div hidden={mode !== 'edit'}>
            {hasEdited && <Suspense fallback={<p>Loading formatted editor…</p>}>
              <RichEditor value={value} onChange={change} editable={writable} onEditor={setRichEditor}
                imageScope={{ documentPath, threadId, storage, localImages, fileScope }} />
            </Suspense>}
          </div>
        </div>
      </DocumentLinkBoundary>
    </div>
  </div>;
}
