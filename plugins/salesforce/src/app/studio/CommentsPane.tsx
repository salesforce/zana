import { useState } from 'react';
import type { StudioComment } from '../../../lib/studio-contract.js';

/** Review comments for the open file: open/resolved tabs, jump to line, resolve with a note, hand off to the agent. */
export interface CommentsPaneProps {
  pluginId: string;
  projectId?: string;
  path: string | null;
  comments: StudioComment[];
  onReveal?(line: number): void;
  onResolve?(id: string, note: string): void;
  onAddressWithAgent?(): void;
}

const STYLES = `
.sf-cm { display: flex; flex-direction: column; gap: 8px; padding: 10px; color: var(--sf-text); font-size: 12px; min-height: 0; overflow: auto; }
.sf-cm-tabs { display: flex; gap: 4px; align-items: center; }
.sf-cm-tab, .sf-cm-btn { border: 1px solid var(--sf-border); background: transparent; color: var(--sf-text); border-radius: 6px; padding: 2px 8px; font: inherit; cursor: pointer; }
.sf-cm-tab[aria-selected="true"] { border-color: var(--sf-accent); color: var(--sf-accent); }
.sf-cm-btn.is-primary { border-color: var(--sf-accent); color: var(--sf-accent); }
.sf-cm-btn:disabled { opacity: 0.5; cursor: default; }
.sf-cm-spacer { flex: 1; }
.sf-cm-card { border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.sf-cm-card.is-resolved { opacity: 0.75; }
.sf-cm-meta { color: var(--sf-muted); display: flex; gap: 6px; align-items: center; }
.sf-cm-line { background: none; border: 0; color: var(--sf-accent); cursor: pointer; padding: 0; font: inherit; }
.sf-cm-quote { margin: 0; padding: 2px 6px; border-left: 2px solid var(--sf-border); color: var(--sf-muted); white-space: pre-wrap; font-family: ui-monospace, monospace; }
.sf-cm-body { white-space: pre-wrap; }
.sf-cm-note { color: var(--sf-success); }
.sf-cm-actions { display: flex; gap: 4px; }
.sf-cm-input { flex: 1; min-width: 0; border: 1px solid var(--sf-border); background: transparent; color: var(--sf-text); border-radius: 6px; padding: 2px 6px; font: inherit; }
.sf-cm-empty { color: var(--sf-muted); padding: 12px 4px; }
`;

export function CommentsPane({ path, comments, onReveal, onResolve, onAddressWithAgent }: CommentsPaneProps) {
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const scoped = comments.filter(row => !path || row.path === path);
  const open = scoped.filter(row => !row.resolved);
  const resolved = scoped.filter(row => row.resolved);
  const shown = (tab === 'open' ? open : resolved).slice().sort((a, b) => a.line - b.line);
  const submit = (id: string) => {
    const text = note.trim();
    if (!text) return;
    onResolve?.(id, text);
    setResolving(null);
    setNote('');
  };
  return (
    <section className="sf-cm" aria-label="Review comments" data-testid="studio-comments-pane">
      <style>{STYLES}</style>
      <div className="sf-cm-tabs" role="tablist">
        <button type="button" role="tab" className="sf-cm-tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>Open ({open.length})</button>
        <button type="button" role="tab" className="sf-cm-tab" aria-selected={tab === 'resolved'} onClick={() => setTab('resolved')}>Resolved ({resolved.length})</button>
        <span className="sf-cm-spacer" />
        <button type="button" className="sf-cm-btn is-primary" disabled={open.length === 0 || !onAddressWithAgent} onClick={() => onAddressWithAgent?.()}>Address with agent</button>
      </div>
      {shown.length === 0 && <div className="sf-cm-empty">{tab === 'open' ? 'No open comments. Click the editor gutter or select text to add one.' : 'Nothing resolved yet.'}</div>}
      {shown.map(comment => (
        <article key={comment.id} className={`sf-cm-card${comment.resolved ? ' is-resolved' : ''}`}>
          <div className="sf-cm-meta">
            <span>{comment.author.name}</span>
            <button type="button" className="sf-cm-line" onClick={() => onReveal?.(comment.line)} aria-label={`Jump to line ${comment.line}`}>
              {comment.endLine > comment.line ? `L${comment.line}-${comment.endLine}` : `L${comment.line}`}
            </button>
          </div>
          {comment.quote && <blockquote className="sf-cm-quote">{comment.quote.split('\n').slice(0, 3).join('\n')}</blockquote>}
          <div className="sf-cm-body">{comment.body}</div>
          {comment.resolved && <div className="sf-cm-note">Resolved by {comment.resolved.by}: {comment.resolved.note}</div>}
          {!comment.resolved && resolving !== comment.id && (
            <div className="sf-cm-actions"><button type="button" className="sf-cm-btn" onClick={() => { setResolving(comment.id); setNote(''); }}>Resolve</button></div>
          )}
          {resolving === comment.id && (
            <div className="sf-cm-actions">
              <input className="sf-cm-input" autoFocus aria-label="Resolution note" placeholder="What changed?" value={note}
                onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit(comment.id); if (event.key === 'Escape') setResolving(null); }} />
              <button type="button" className="sf-cm-btn is-primary" disabled={!note.trim()} onClick={() => submit(comment.id)}>Resolve</button>
              <button type="button" className="sf-cm-btn" onClick={() => setResolving(null)}>Cancel</button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
