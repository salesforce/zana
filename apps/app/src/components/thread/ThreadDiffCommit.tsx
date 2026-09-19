import { useState } from 'react';
import { GitCommit, X } from 'lucide-react';
import { product } from '../../lib/product-client.js';

export function ThreadDiffCommit({ environmentId, onCommitted }: { environmentId: string; onCommitted: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="thread-diff-commit" aria-expanded={open} onClick={() => setOpen(!open)}>
        <GitCommit size={14} aria-hidden="true" /> Commit
      </button>
      {open ? (
        <form className="thread-diff-commit-form" aria-label="Commit changes" onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !message.trim()) return;
          setBusy(true);
          setError(null);
          try {
            await product.environments.action(environmentId, { action: 'commit', message: message.trim() });
            setOpen(false);
            setMessage('');
            onCommitted();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not commit changes');
          } finally {
            setBusy(false);
          }
        }}>
          <div className="thread-diff-commit-heading">
            <strong>Commit changes</strong>
            <button type="button" className="thread-diff-toolbar-btn" aria-label="Cancel commit" disabled={busy} onClick={() => setOpen(false)}><X size={14} /></button>
          </div>
          <p>Commit all uncommitted changes in this project.</p>
          <textarea aria-label="Commit message" placeholder="Describe your changes…" autoFocus required maxLength={2000}
            value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} />
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" className="thread-diff-commit" disabled={busy || !message.trim()}>{busy ? 'Committing…' : 'Commit changes'}</button>
        </form>
      ) : null}
    </>
  );
}
