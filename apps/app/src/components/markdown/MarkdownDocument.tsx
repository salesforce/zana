import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefCallback } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { MarkdownContent } from '../MarkdownContent.js';
import { DocumentLinkBoundary } from '../DocumentLinkBoundary.js';
import type { DocumentLink } from '../document-links.js';
import { useMonacoTheme } from '../../hooks/useMonacoTheme.js';
import { markdownBlocks, markdownBody, replaceMarkdownBlock, toggleMarkdownTask, type MarkdownBlock } from './markdown-source.js';
import { documentSearchRanges } from './document-search.js';
import './markdown-document.css';

const SourceEditor = lazy(() => import('../explorer/ExplorerEditor.js'));
const BlockEditor = lazy(() => import('../../views/library/library/LibraryMarkdownEditor.js').then(module => ({ default: module.LibraryMarkdownEditor })));
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
}

/** One source buffer. Preview operations patch source; mode changes never save or discard. */
export default function MarkdownDocument({ value, savedValue, documentPath, onChange, onSave, saving = false, readOnlyReason, initialMode = 'read', threadId, projectId, storage, fragment, onOpenDocument, onSourceMount, previewRef, localImages = true }: MarkdownDocumentProps) {
  const [mode, setMode] = useState<MarkdownMode>(initialMode);
  const [find, setFind] = useState(false);
  const [query, setQuery] = useState('');
  const [occurrence, setOccurrence] = useState(0);
  const [count, setCount] = useState(0);
  const [active, setActive] = useState<MarkdownBlock | null>(() => initialMode === 'edit' ? markdownBlocks(value).find(block => block.editable) ?? null : null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const undo = useRef<string[]>([]); const redo = useRef<string[]>([]);
  const valueRef = useRef(value); valueRef.current = value;
  const contentRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceEditor = useRef<Parameters<OnMount>[0] | null>(null);
  const sourceOffset = useRef<number | null>(null);
  const scrollPositions = useRef<{ read?: number; edit?: number }>({});
  const sourceViewState = useRef<ReturnType<Parameters<OnMount>[0]['saveViewState']>>(null);
  const id = `md-find-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const theme = useMonacoTheme();
  const writable = !!onChange && !readOnlyReason;
  const dirty = value !== savedValue;
  const body = useMemo(() => markdownBody(value).body, [value]);
  const blocks = useMemo(() => mode === 'edit' ? markdownBlocks(value) : [], [value, mode]);
  const visibleBlocks = active ? [...blocks.filter(block => block.end <= active.start), active, ...blocks.filter(block => block.start >= active.end)] : blocks;
  useLayoutEffect(() => {
    // A reviewed replacement or discard invalidates the previous block editor.
    if (active && value.slice(active.start, active.end) !== active.source) setActive(null);
  }, [value, active]);
  useLayoutEffect(() => {
    const preview = rootRef.current?.querySelector('.md-document-preview');
    if (preview && mode !== 'source' && scrollPositions.current[mode] !== undefined) preview.scrollTop = scrollPositions.current[mode]!;
  }, [mode]);

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
    setActive(null);
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
  const preview = (text: string, tasks = true) => <MarkdownContent text={text} documentLinks={!threadId} localDocumentImages={localImages} documentPath={documentPath} threadId={threadId} projectId={projectId} storage={storage} exportable
    onTaskChange={tasks && writable ? (start, checked) => change(toggleMarkdownTask(valueRef.current, start, checked)) : undefined} />;
  const selectMode = (next: MarkdownMode) => {
    if (next === mode) return;
    if (mode === 'source') sourceViewState.current = sourceEditor.current?.saveViewState() ?? null;
    else scrollPositions.current[mode] = rootRef.current?.querySelector('.md-document-preview')?.scrollTop ?? 0;
    setActive(next === 'edit' ? markdownBlocks(value).find(block => block.editable) ?? null : null);
    setMode(next);
  };

  return <div className="md-document" ref={rootRef} tabIndex={0} data-own-find aria-label="Markdown document" onKeyDownCapture={event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.shiftKey && event.key.toLowerCase() !== 'z') return;
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); openFind(); }
    if (event.key.toLowerCase() === 's' && writable) { event.preventDefault(); event.stopPropagation(); if (dirty && !saving) onSave?.(); }
    if (event.key.toLowerCase() === 'z' && writable) {
      if (event.target instanceof Element && event.target.closest('.md-document-find, .monaco-findInput')) return;
      event.preventDefault(); event.stopPropagation(); moveHistory(!event.shiftKey);
    }
  }}>
    <style>{`::highlight(${id}){background:#e9c44866}::highlight(${id}-current){background:#eea54bcc;color:#171717}`}</style>
    <div className="md-document-toolbar" role="toolbar" aria-label="Markdown tools">
      <div className="md-document-modes" role="group" aria-label="Markdown view">
        {(['read', 'edit', 'source'] as const).map(item => <button type="button" key={item} aria-pressed={mode === item} disabled={item === 'edit' && !writable} title={item === 'edit' ? readOnlyReason : undefined} onClick={() => selectMode(item)}>{item === 'read' ? 'Read' : item === 'edit' ? 'Edit' : 'Source'}</button>)}
      </div>
      <button type="button" onClick={openFind} title="Find in document (⌘F / Ctrl+F)">Find</button>
      {writable && <>
        <button type="button" aria-label="Undo document change" disabled={!undo.current.length} onClick={() => moveHistory(true)}>↶</button>
        <button type="button" aria-label="Redo document change" disabled={!redo.current.length} onClick={() => moveHistory(false)}>↷</button>
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
    {mode === 'source' ? <div className="md-document-source"><Suspense fallback={<p>Loading source editor…</p>}><SourceEditor height="100%" path={`document-${id}.md`} language="markdown" theme={theme} value={value} onChange={next => {
      if (next !== undefined) change(valueRef.current.startsWith('\uFEFF') && !next.startsWith('\uFEFF') ? `\uFEFF${next}` : next);
    }} onMount={(editor, monaco) => {
      sourceEditor.current = editor;
      onSourceMount?.(editor, monaco);
      if (sourceViewState.current) editor.restoreViewState(sourceViewState.current);
      if (sourceOffset.current !== null) {
        const position = editor.getModel()?.getPositionAt(sourceOffset.current);
        if (position) { editor.setPosition(position); editor.revealPositionInCenter(position); editor.focus(); }
        sourceOffset.current = null;
      }
    }} options={{ readOnly: !writable, wordWrap: 'on', minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true }} /></Suspense></div> :
      <DocumentLinkBoundary className="explorer-md-preview md-document-preview" documentPath={documentPath} fragment={fragment} onOpenDocument={onOpenDocument} interceptLinks={!threadId} elementRef={previewRef}>
        <div ref={contentRef}>
          {mode === 'read' ? preview(body) : <>
            <p className="md-document-hint" data-document-search-skip>Choose a block to edit. Use Source for comments, references, diagrams, and other advanced Markdown.</p>
            {visibleBlocks.map(block => {
              const editing = active?.start === block.start;
              return <section className={`md-document-block${editing ? ' editing' : ''}`} key={block.start}>
                <button type="button" className="md-document-block-action" aria-label={block.editable ? 'Edit block' : 'Edit block in source'} onClick={() => { if (block.editable) setActive(block); else { sourceOffset.current = block.start; selectMode('source'); } }}>{block.editable ? 'Edit' : 'Source'}</button>
                {editing ? <Suspense fallback={<p>Loading formatted editor…</p>}><BlockEditor value={active!.source} autofocus onChange={replacement => {
                  const current = active!;
                  const next = replaceMarkdownBlock(valueRef.current, current, replacement);
                  if (next === null) { setActive(null); return; }
                  const length = next.length - valueRef.current.length + current.source.length;
                  setActive({ ...current, end: current.start + length, source: next.slice(current.start, current.start + length) });
                  change(next);
                }} /></Suspense> : preview(block.source, false)}
              </section>;
            })}
            <button type="button" className="md-document-add" onClick={() => {
              const newline = value.includes('\r\n') ? '\r\n' : '\n';
              const separator = value.endsWith(`${newline}${newline}`) || !value ? '' : value.endsWith(newline) ? newline : `${newline}${newline}`;
              const next = `${value}${separator}New paragraph`;
              change(next);
              setActive({ start: value.length + separator.length, end: next.length, source: 'New paragraph', editable: true });
            }}>Add paragraph</button>
          </>}
        </div>
      </DocumentLinkBoundary>}
  </div>;
}
