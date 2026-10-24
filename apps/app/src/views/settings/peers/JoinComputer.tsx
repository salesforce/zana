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
  if (current.reason === 'already_connected') return `This computer is already connected to ${current.peer?.name ?? 'that computer'}. Remove it under Computers, then join again.`;
  if (current.reason === 'already_redeemed') return 'A previous attempt already used this invitation but did not connect. Create a new invitation on the other computer and try again.';
  if (current.reason === 'expired') return 'This invitation expired. Create a new invitation on the other computer.';
  return current.reason ?? `Status: ${current.state}`;
}

/** Join computer: this computer connects out to the other one. No Remote Login check belongs here. */
export function JoinComputer({ connections, onChange, onClose }: JoinComputerProps) {
  const [token, setToken] = useState('');
  const [approvalCode, setApprovalCode] = useState('');
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const [joined, setJoined] = useState<PeerConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    const trimmed = token.trim();
    const trimmedCode = approvalCode.trim();
    if (!trimmed || !trimmedCode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const connection = await peerConnections.join(trimmed, trimmedCode);
      setJoined(connection);
      setJoinedId(connection.invitationId);
      setToken('');
      setApprovalCode('');
      onChange?.();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const current = (joinedId && connections.find((c) => c.invitationId === joinedId)) || joined;
  const code = current?.pairingCode;
  const failed = current && ['failed', 'denied', 'cancelled', 'expired'].includes(current.state);

  useEffect(() => {
    if (current?.state === 'ready') onClose?.();
  }, [current?.state, onClose]);

  return (
    <div className="peers-panel" data-testid="join-computer">
      {!current && !busy && (
        <>
          <p>Paste the invitation from the other computer.</p>
          <label className="peers-approve-label">
            Invitation
            <textarea className="peers-token" rows={3} value={token} disabled={busy} spellCheck={false} onChange={(event) => setToken(event.target.value)} />
          </label>
          <label className="peers-approve-label">
            Approval code
            <input className="peers-code-input" type="text" inputMode="text" autoComplete="off" spellCheck={false} aria-label="Approval code" placeholder="XXXX-XXXX" value={approvalCode} disabled={busy} onChange={(event) => setApprovalCode(event.target.value)} />
          </label>
          <p className="peers-empty">Ask the person on the other computer to read you the approval code shown there.</p>
          {error && <p className="peers-error" role="alert">{error}</p>}
          <div className="peers-dialog-actions">
            <button type="button" className="btn primary" disabled={busy || !token.trim() || !approvalCode.trim()} onClick={() => void join()}>Join</button>
            {onClose && <button type="button" className="btn" onClick={onClose}>Close</button>}
          </div>
        </>
      )}
      {(current || busy) && (
        <>
          {!failed ? (
            <>
              <p>Enter this code on the other computer to finish connecting.</p>
              <p className="peers-pairing-code" data-testid="pairing-code" aria-busy={!code} aria-label={code ? 'Approval code' : 'Approval code pending'}>{code ?? '---- ----'}</p>
              <p className="peers-loading" role="status">{code ? 'Waiting for approval on the other computer…' : 'Waiting for the other computer. Your approval code will appear here…'}</p>
            </>
          ) : (
            <p className="peers-error" role="alert">{connectionStatusText(current)}</p>
          )}
          {onClose && <div className="peers-dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>}
        </>
      )}
    </div>
  );
}
