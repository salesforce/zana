import React, { useEffect, useRef, useState } from 'react';
import { definePluginApp, useComposer, useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { SavedPrompt } from './server.js';

export const STYLE_TAG_ID = 'prompt-library-plugin-styles';

export const PROMPT_LIBRARY_STYLES = `
.pl-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel, var(--bg-surface, transparent));
  color: var(--text-secondary, var(--text-primary));
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.pl-trigger-btn:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary);
  border-color: var(--border-strong, var(--border));
}
.pl-trigger-btn svg {
  flex-shrink: 0;
  color: var(--text-muted);
}
.pl-trigger-btn:hover svg {
  color: var(--accent, currentColor);
}

.pl-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.pl-dialog {
  width: min(680px, 100%);
  max-height: min(640px, 82vh);
  background: var(--bg-panel, var(--bg-elevated, var(--bg, #181818)));
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
}

.pl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.pl-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pl-title-group h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.pl-title-icon {
  color: var(--accent, currentColor);
  display: inline-flex;
}

.pl-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 14px;
  border-bottom: 1px solid var(--border);
}

.pl-select {
  height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-input, var(--bg-panel, var(--bg, transparent)));
  color: var(--text-primary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  outline: none;
}
.pl-select:focus {
  border-color: var(--accent);
}

.pl-search-wrap {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
}

.pl-search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-muted);
  pointer-events: none;
}

.pl-search-input {
  width: 100%;
  height: 34px;
  padding: 0 12px 0 32px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-input, var(--bg-panel, var(--bg, transparent)));
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.pl-search-input::placeholder {
  color: var(--text-muted);
}
.pl-search-input:focus {
  border-color: var(--accent);
}

.pl-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary, var(--text-muted));
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pl-close-btn:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary);
}

.pl-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 14px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pl-alert {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger, #ef4444) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger, #ef4444) 35%, transparent);
  color: var(--danger-text, var(--danger, #ef4444));
  font-size: 12.5px;
}

.pl-status {
  margin: 0;
  padding: 6px 0;
  color: var(--text-muted);
  font-size: 12.5px;
}

.pl-empty {
  margin: 28px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.pl-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-surface, var(--bg-panel, var(--bg, transparent)));
  transition: border-color 120ms ease;
}
.pl-card:hover {
  border-color: var(--border-strong, var(--border));
}

.pl-card-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  max-height: 160px;
  overflow-y: auto;
}

.pl-card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.pl-btn-primary,
.pl-btn-secondary,
.pl-btn-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.pl-btn-primary {
  background: var(--accent);
  border: 1px solid var(--accent, transparent);
  color: var(--accent-contrast, #fff);
}
.pl-btn-primary:hover {
  filter: brightness(1.08);
}

.pl-btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary, var(--text-primary));
}
.pl-btn-secondary:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary);
}

.pl-btn-more {
  align-self: center;
  margin-top: 6px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary, var(--text-primary));
}
.pl-btn-more:hover:not(:disabled) {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary);
}
.pl-btn-more:disabled {
  opacity: 0.5;
  cursor: default;
}
`;

export function BookMarkedIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2v8l3-3 3 3V2" />
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
    </svg>
  );
}

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== PROMPT_LIBRARY_STYLES) {
      existing.textContent = PROMPT_LIBRARY_STYLES;
    }
    return;
  }
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = PROMPT_LIBRARY_STYLES;
  document.head.appendChild(tag);
}

const textOf = (row: SavedPrompt) => row.input.filter(part => part.type === 'text').map(part => part.text).join('\n');

function PromptTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="pl-trigger-btn" onClick={onClick}>
      <BookMarkedIcon size={14} />
      <span>Prompt Library</span>
    </button>
  );
}

function PromptCard({
  row,
  scope,
  onUse,
  onToggleStar,
}: {
  row: SavedPrompt;
  scope: string;
  onUse: (row: SavedPrompt) => void;
  onToggleStar: (row: SavedPrompt) => void;
}) {
  return (
    <article className="pl-card">
      <p className="pl-card-text">{textOf(row).slice(0, 800) || 'Attachments'}</p>
      <div className="pl-card-actions">
        <button type="button" className="pl-btn-primary" onClick={() => onUse(row)}>Use prompt</button>
        <button type="button" className="pl-btn-secondary" onClick={() => onToggleStar(row)}>
          {scope === 'starred' ? 'Unstar' : 'Star'}
        </button>
      </div>
    </article>
  );
}

function PromptDialog({
  dialogRef,
  scope,
  setScope,
  threadId,
  projectId,
  query,
  setQuery,
  error,
  loading,
  filteredEntries,
  cursor,
  onClose,
  onUse,
  onToggleStar,
  onMore,
}: {
  dialogRef: React.RefObject<HTMLDivElement | null>;
  scope: string;
  setScope: (scope: string) => void;
  threadId?: string | null;
  projectId?: string | null;
  query: string;
  setQuery: (query: string) => void;
  error: string;
  loading: boolean;
  filteredEntries: SavedPrompt[];
  cursor: string | null;
  onClose: () => void;
  onUse: (row: SavedPrompt) => void;
  onToggleStar: (row: SavedPrompt) => void;
  onMore: () => void;
}) {
  return (
    <div className="pl-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="pl-dialog" role="dialog" aria-modal="true" aria-label="Prompt Library" onKeyDown={e => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Tab') {
          const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select') ?? [])];
          const first = elements[0], last = elements.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="pl-header">
          <div className="pl-title-group">
            <span className="pl-title-icon" aria-hidden="true">
              <BookMarkedIcon size={16} />
            </span>
            <h2>Prompt Library</h2>
          </div>
        </div>
        <div className="pl-toolbar">
          <select className="pl-select" aria-label="Prompt scope" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="starred">Starred</option>{threadId && <option value="thread">Thread</option>}
            {(projectId || threadId) && <option value="project">Project</option>}<option value="all">All</option>
          </select>
          <div className="pl-search-wrap">
            <svg className="pl-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input autoFocus className="pl-search-input" type="search" aria-label="Search prompts" placeholder="Search prompts…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <button type="button" className="pl-close-btn" onClick={onClose}>Close</button>
        </div>
        <div className="pl-body">
          {error && <p className="pl-alert" role="alert">{error}</p>}
          {loading && <p className="pl-status" role="status">Loading…</p>}
          {filteredEntries.map(row => (
            <PromptCard key={row.id} row={row} scope={scope} onUse={onUse} onToggleStar={onToggleStar} />
          ))}
          {!loading && !error && !filteredEntries.length && <p className="pl-empty">No prompts found.</p>}
          {cursor && <button type="button" className="pl-btn-more" disabled={loading} onClick={onMore}>Load more</button>}
        </div>
      </div>
    </div>
  );
}

export function PromptLibrary() {
  const composer = useComposer();
  const rpc = useRpc();
  const generation = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('starred');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ scope: string; entries: SavedPrompt[] }>({ scope: 'starred', entries: [] });
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Rows stay on screen while the next search loads or fails, but only within the scope that produced them:
  // another scope's rows would carry the wrong Star/Unstar action.
  const entries = results.scope === scope ? results.entries : [];
  const updateEntries = (update: (rows: SavedPrompt[]) => SavedPrompt[]) => setResults(current => ({ ...current, entries: update(current.entries) }));
  const context = composer.scope;
  const threadId = 'threadId' in context ? context.threadId : undefined;
  const projectId = 'projectId' in context ? context.projectId : undefined;

  useEffect(() => {
    if (!open) return;
    const version = ++generation.current;
    let cancelled = false;
    setLoading(true); setError(''); setCursor(null);
    const timer = setTimeout(() => {
      void rpc.call(scope === 'starred' ? 'list' : 'history', { scope, threadId, projectId, query }).then(result => {
        if (cancelled || version !== generation.current) return;
        const page = result as { entries: SavedPrompt[]; nextCursor?: string };
        setResults({ scope, entries: page.entries }); setCursor(page.nextCursor ?? null);
      }).catch(reason => { if (!cancelled) setError(String(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 150);
    return () => { cancelled = true; generation.current++; clearTimeout(timer); };
  }, [open, scope, query, threadId, projectId, rpc]);

  const more = async () => {
    const version = generation.current;
    setLoading(true);
    try {
      const page = await rpc.call('history', { scope, threadId, projectId, query, cursor }) as { entries: SavedPrompt[]; nextCursor?: string };
      if (version !== generation.current) return;
      updateEntries(rows => [...rows, ...page.entries]); setCursor(page.nextCursor ?? null);
    } catch (reason) { if (version === generation.current) setError(String(reason)); } finally { if (version === generation.current) setLoading(false); }
  };

  const handleUse = (row: SavedPrompt) => {
    if (composer.experimental_replacePrompt) composer.experimental_replacePrompt(row.input, row.threadId);
    else composer.setText(textOf(row));
    composer.focus();
    setOpen(false);
  };

  const handleToggleStar = (row: SavedPrompt) => {
    void rpc.call(scope === 'starred' ? 'remove' : 'star', row).then(() => {
      if (scope === 'starred') updateEntries(rows => rows.filter(item => item.id !== row.id));
    }).catch(reason => setError(String(reason)));
  };

  const filteredEntries = entries.filter(row => scope !== 'starred' || textOf(row).toLowerCase().includes(query.toLowerCase()));

  return <>
    <PromptTrigger onClick={() => setOpen(true)} />
    {open && <PromptDialog
      dialogRef={dialog}
      scope={scope}
      setScope={setScope}
      threadId={threadId}
      projectId={projectId}
      query={query}
      setQuery={setQuery}
      error={error}
      loading={loading}
      filteredEntries={filteredEntries}
      cursor={cursor}
      onClose={() => setOpen(false)}
      onUse={handleUse}
      onToggleStar={handleToggleStar}
      onMore={() => void more()}
    />}
  </>;
}

export default definePluginApp(app => {
  injectStyles();
  app.composer.customize({ id: 'library', scopes: ['thread', 'new-thread'], actions: [{ id: 'open', component: PromptLibrary }] });
});
