import { useEffect, useId, useRef, useState } from 'react';
import { STUDIO_AGENT_ACTIONS, MAX_STUDIO_REQUEST_LENGTH } from '../../../lib/studio-agent-actions.js';

export interface AskAgentMenuProps {
  disabled?: boolean;
  busy?: boolean;
  /** Action ids that cannot run right now, with the reason shown as a tooltip. */
  unavailable?: Record<string, string>;
  onAsk(action: string | undefined, prompt?: string): void;
}

/** "Ask agent" button: opens a menu of one-click actions plus a free-form request. */
export function AskAgentMenu({ disabled, busy, unavailable = {}, onAsk }: AskAgentMenuProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const ask = (action?: string) => { onAsk(action, prompt.trim() || undefined); setPrompt(''); setOpen(false); };
  return <div className="sf-asst-menu" ref={root}>
    <button type="button" className="sf-asst-btn" aria-haspopup="true" aria-expanded={open} aria-controls={menuId} disabled={disabled || busy} onClick={() => setOpen(value => !value)}>{busy ? 'Starting…' : 'Ask agent'}</button>
    {open && <div className="sf-asst-pop" id={menuId} role="menu">
      {STUDIO_AGENT_ACTIONS.map(action => <button type="button" role="menuitem" key={action.id} className="sf-asst-item" disabled={Boolean(unavailable[action.id])} title={unavailable[action.id] ?? action.description} onClick={() => ask(action.id)}>
        <span>{action.label}</span><small>{action.description}</small>
      </button>)}
      <form className="sf-asst-custom" onSubmit={event => { event.preventDefault(); if (prompt.trim()) ask(); }}>
        <input value={prompt} maxLength={MAX_STUDIO_REQUEST_LENGTH} onChange={event => setPrompt(event.target.value)} placeholder="Or ask anything about this agent…" aria-label="Request for the agent" />
        <button type="submit" className="sf-asst-btn" disabled={!prompt.trim()}>Send</button>
      </form>
    </div>}
  </div>;
}
