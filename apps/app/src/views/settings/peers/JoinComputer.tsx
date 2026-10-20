import { useEffect, useState } from 'react';
import type { PeerConnection } from '@zana-ai/zcc-server-contract';
import { peerConnections } from '../../../lib/product-client.js';

export interface JoinComputerProps {
  /** Latest connections from the parent's poll. */
  connections: PeerConnection[];
  onChange?(): void;
  onClose?(): void;
}

function connectionStatusText(current: PeerConnection): string {
  if (current.reason === 'already_redeemed') return 'A previous attempt already used this invitation but did not connect. Create a new invitation on the other computer and try again.';
  if (current.reason === 'expired') return 'This invitation expired. Create a new invitation on the other computer.';
  return current.reason ?? `Status: ${current.state}`;
}

/** Join computer: this computer connects out to the other one. No Remote Login check belongs here. */
export function JoinComputer({ connections, onChange, onClose }: JoinComputerProps) {
  const [token, setToken] = useState('');
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const [joined, setJoined] = useState<PeerConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    const trimmed = token.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const connection = await peerConnections.join(trimmed);
      setJoined(connection);
      setJoinedId(connection.invitationId);
      setToken('');
      onChange?.();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const current = (joinedId && connections.find((c) => c.invitationId === joinedId)) || joined;
  const code = current?.pairingCode;

  useEffect(() => {
    if (current?.state === 'ready') onClose?.();
  }, [current?.state, onClose]);

  return (
    <div className="peers-panel" data-testid="join-computer">
      {!current && (
        <>
          <p>Paste the invitation from the other computer.</p>
          <label className="peers-approve-label">
            Invitation
            <textarea className="peers-token" rows={3} value={token} disabled={busy} spellCheck={false} onChange={(event) => setToken(event.target.value)} />
          </label>
          {error && <p className="peers-error" role="alert">{error}</p>}
          <div className="peers-dialog-actions">
            <button type="button" className="btn primary" disabled={busy || !token.trim()} onClick={() => void join()}>Join</button>
            {onClose && <button type="button" className="btn" onClick={onClose}>Close</button>}
          </div>
        </>
      )}
      {current && (
        <>
          {code ? (
            <>
              <p>Tell the other computer this code.</p>
              <p className="peers-pairing-code" data-testid="pairing-code">{code}</p>
              <p className="peers-loading" role="status">Waiting for approval on the other computer…</p>
            </>
          ) : (
            <p className="peers-loading" role="status">{connectionStatusText(current)}</p>
          )}
          <p className="peers-empty">This computer connects out to the other one; Remote Login is not needed here.</p>
          {onClose && <div className="peers-dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>}
        </>
      )}
    </div>
  );
}
