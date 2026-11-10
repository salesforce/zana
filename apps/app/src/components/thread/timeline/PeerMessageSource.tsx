import type { peerMessageDisplay } from './peer-message.js';

export function PeerMessageSource({ peer }: { peer: NonNullable<ReturnType<typeof peerMessageDisplay>> }) {
  return <div data-testid="thread-peer-message-source" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
    <span>Peer message from</span>
    {peer.href ? <a href={peer.href} style={{ color: 'var(--accent)', fontWeight: 600, textUnderlineOffset: 2 }} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      history.pushState({}, '', peer.href!);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }}>{peer.label}</a> : <span>{peer.label} · CLI Agent</span>}
  </div>;
}
