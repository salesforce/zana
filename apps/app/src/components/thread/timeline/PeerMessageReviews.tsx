import { useCallback, useEffect, useState } from 'react';
import { product } from '../../../lib/product-client.js';
import { apiJson } from '../../../lib/fetch-with-app-surface.js';
import { PeerMessageSource } from './PeerMessageSource.js';

interface ReviewItem { id: string; text: string; updatedAt: number; status: string; from: string; senderThreadId: string | null; to: string; recipientKind: string }
interface ReviewList { items: ReviewItem[]; enabled: boolean; paused: boolean }

export function PeerMessageReviews({ threadId }: { threadId: string }) {
  const [view, setView] = useState<ReviewList & { threadId: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const value = await apiJson<ReviewList>(`/threads/${encodeURIComponent(threadId)}/peer-messages`);
    setView({ ...value, threadId });
  }, [threadId]);
  useEffect(() => {
    let live = true;
    const load = () => { if (live) void refresh().catch(() => {}); };
    setError(null); load();
    const stop = product.threads.onUpdated((value) => { if (value && typeof value === 'object' && 'id' in value && value.id === threadId) load(); });
    // Config changes can invalidate consent without a thread event.
    const timer = setInterval(load, 5000);
    return () => { live = false; stop(); clearInterval(timer); };
  }, [refresh, threadId]);
  if (view?.threadId !== threadId || !view.items.length) return null;
  const decide = async (item: ReviewItem, deliver: boolean) => {
    setWorking(item.id); setError(null);
    try {
      if (deliver) await product.threads.sendNextTurn(threadId, item.id);
      else await apiJson(`/threads/${encodeURIComponent(threadId)}/peer-messages/${encodeURIComponent(item.id)}`, {
        method: 'DELETE', body: JSON.stringify({ expectedUpdatedAt: item.updatedAt })
      });
    } catch (err) { setError(err instanceof Error ? err.message : 'Peer review failed'); }
    finally { await refresh().catch(() => {}); setWorking(null); }
  };
  return <section aria-label="Peer messages awaiting review" className="thread-queued-ghosts" data-testid="thread-peer-reviews">
    {view.items.map(item => <article key={item.id} style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
      <PeerMessageSource peer={{ label: item.from, kind: item.senderThreadId ? 'thread' : 'cli-agent', text: item.text,
        href: item.senderThreadId ? `/threads/${encodeURIComponent(item.senderThreadId)}` : null }} />
      <strong>{item.status === 'approved' ? 'Reviewed · waiting for delivery' : 'Peer message awaiting your review'}</strong>
      {item.recipientKind === 'cli-agent' && <p>To {item.to} · CLI Agent</p>}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto', font: 'inherit' }}>{item.text}</pre>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.status === 'approved' ? 'The recipient will receive this after its current turn.' : 'Not sent to the recipient. Delivery can start work using its existing tools and permissions.'}</p>
      {item.status === 'pending' && <div style={{ display: 'flex', gap: 8 }}>
        <button className="settings-btn" disabled={!!working || !view.enabled || view.paused} onClick={() => void decide(item, true)}>Deliver to {item.recipientKind === 'cli-agent' ? 'CLI Agent' : 'thread'}</button>
        <button className="settings-btn" disabled={!!working} onClick={() => void decide(item, false)}>Discard</button>
      </div>}
    </article>)}
    {!view.enabled && <p>Thread communication is off in Experimental settings. Pending messages remain held.</p>}
    {view.paused && <p>Recipient stopped. Resume it explicitly, then review the message again.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
