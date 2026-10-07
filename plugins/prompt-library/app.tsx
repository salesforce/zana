import React, { useEffect, useRef, useState } from 'react';
import { definePluginApp, useComposer, useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { SavedPrompt } from './server.js';
export function PromptLibrary() {
  const composer = useComposer();
  const rpc = useRpc();
  const generation = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('starred');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<SavedPrompt[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const context = composer.scope;
  const threadId = 'threadId' in context ? context.threadId : undefined;
  const projectId = 'projectId' in context ? context.projectId : undefined;
  useEffect(() => {
    if (!open) return;
    const version = ++generation.current;
    let cancelled = false;
    setLoading(true); setError(''); setEntries([]); setCursor(null);
    const timer = setTimeout(() => {
      void rpc.call(scope === 'starred' ? 'list' : 'history', { scope, threadId, projectId, query }).then(result => {
        if (cancelled || version !== generation.current) return;
        const page = result as { entries: SavedPrompt[]; nextCursor?: string };
        setEntries(page.entries); setCursor(page.nextCursor ?? null);
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
      setEntries(rows => [...rows, ...page.entries]); setCursor(page.nextCursor ?? null);
    } catch (reason) { if (version === generation.current) setError(String(reason)); } finally { if (version === generation.current) setLoading(false); }
  };
  const textOf = (row: SavedPrompt) => row.input.filter(part => part.type === 'text').map(part => part.text).join('\n');
  return <>
    <button type="button" className="icon-btn" onClick={() => setOpen(true)}>Prompt Library</button>
    {open && <div ref={dialog} role="dialog" aria-modal="true" aria-label="Prompt Library" onKeyDown={e => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab') {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select') ?? [])];
        const first=elements[0], last=elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {e.preventDefault();last?.focus();}
        else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first?.focus();}
      }
    }}
      style={{ position: 'fixed', inset: '10% 15%', zIndex: 2000, padding: 24, background: 'var(--bg-panel, var(--bg))', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <h2>Prompt Library</h2>
      <div style={{display:'flex', gap:8}}>
        <select aria-label="Prompt scope" value={scope} onChange={e => setScope(e.target.value)}>
          <option value="starred">Starred</option>{threadId && <option value="thread">Thread</option>}
          {(projectId || threadId) && <option value="project">Project</option>}<option value="all">All</option>
        </select>
        <input autoFocus type="search" aria-label="Search prompts" value={query} onChange={e => setQuery(e.target.value)} />
        <button type="button" onClick={() => setOpen(false)}>Close</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {entries.filter(row => scope !== 'starred' || textOf(row).toLowerCase().includes(query.toLowerCase())).map(row => <article key={row.id} style={{padding:'12px 0', borderBottom:'1px solid var(--border)'}}>
        <p style={{whiteSpace:'pre-wrap'}}>{textOf(row).slice(0,800) || 'Attachments'}</p>
        <button type="button" onClick={() => {
          if (composer.experimental_replacePrompt) composer.experimental_replacePrompt(row.input, row.threadId);
          else composer.setText(textOf(row));
          composer.focus(); setOpen(false);
        }}>Use prompt</button>
        <button type="button" onClick={() => { void rpc.call(scope === 'starred' ? 'remove' : 'star', row).then(() => { if (scope === 'starred') setEntries(rows => rows.filter(item => item.id !== row.id)); }).catch(reason => setError(String(reason))); }}>{scope === 'starred' ? 'Unstar' : 'Star'}</button>
      </article>)}
      {!loading && !entries.length && <p>No prompts found.</p>}
      {loading && <p role="status">Loading…</p>}
      {cursor && <button type="button" disabled={loading} onClick={() => void more()}>Load more</button>}
    </div>}
  </>;
}
export default definePluginApp(app => {
  app.composer.customize({ id:'library', scopes:['thread','new-thread'], actions:[{id:'open', component:PromptLibrary}] });
});
