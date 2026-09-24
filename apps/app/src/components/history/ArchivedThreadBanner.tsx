import { useState } from 'react';
import { product } from '../../lib/product-client.js';
import './history.css';

export function ArchivedThreadBanner({ threadId, onRestored }: { threadId: string; onRestored(): void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <div className="thread-archive-banner">
    <span>This conversation is archived. Restore it to continue.</span>
    <button className="btn" disabled={pending} onClick={async () => {
      setPending(true); setError('');
      try { await product.threads.unarchive(threadId); onRestored(); }
      catch (error) { setError(error instanceof Error ? error.message : 'Could not restore this conversation.'); }
      finally { setPending(false); }
    }}>{pending ? 'Restoring…' : 'Restore conversation'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
