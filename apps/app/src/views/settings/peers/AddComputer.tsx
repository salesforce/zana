import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { copyText } from '../../../lib/copy-text.js';
import type { PeerConnection } from '@zana-ai/zcc-server-contract';
import { peerConnections } from '../../../lib/product-client.js';
import { ApproveConnection } from './ApproveConnection.js';
import { sshGuideFor } from './sshGuides.js';

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Request failed';
}

export interface AddComputerProps {
  /** Latest connections from the parent's poll; used to find this invitation's progress. */
  connections: PeerConnection[];
  /** Called after any change so the parent refreshes its list. */
  onChange?(): void;
  onClose?(): void;
}

type Phase = { kind: 'checking' } | { kind: 'blocked'; reason: string } | { kind: 'ready'; invitationId: string; token: string; expiresAt: number; approvalCode: string } | { kind: 'error'; message: string };

/** Add computer: this computer waits and the other one connects in through Zana's own connection service. */
export function AddComputer({ connections, onChange, onClose }: AddComputerProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const disposed = useRef(false);
  const running = useRef(false);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPhase({ kind: 'checking' });
    try {
      const check = await peerConnections.checkRemoteLogin();
      if (disposed.current) return;
      if (!check.ok) { setPhase({ kind: 'blocked', reason: check.reason }); return; }
      const created = await peerConnections.create();
      if (disposed.current) return;
      setPhase({ kind: 'ready', invitationId: created.invitationId, token: created.token, expiresAt: created.expiresAt, approvalCode: created.code });
      onChange?.();
    } catch (failure) {
      if (!disposed.current) setPhase({ kind: 'error', message: errorText(failure) });
    } finally {
      running.current = false;
    }
  }, [onChange]);

  useEffect(() => {
    disposed.current = false;
    void start();
    return () => { disposed.current = true; };
    // Run once on mount; "Check again" calls start explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    if (phase.kind !== 'ready') return;
    try {
      await copyText(phase.token);
      setCopied(true);
    } catch (failure) {
      setActionError(errorText(failure));
    }
  };

  const deny = async (invitationId: string) => {
    setBusy(true);
    try { await peerConnections.deny(invitationId); } catch (failure) { setActionError(errorText(failure)); } finally { setBusy(false); onChange?.(); }
  };

  const guide = phase.kind === 'blocked' ? sshGuideFor(phase.reason) : null;
  const mine = phase.kind === 'ready' ? connections.find((c) => c.invitationId === phase.invitationId && c.role === 'inviter') : undefined;

  return (
    <div className="peers-panel" data-testid="add-computer">
      {phase.kind === 'checking' && <p className="peers-loading" role="status">Getting this computer ready…</p>}
      {phase.kind === 'blocked' && (
        <>
          <div role="alert" className="peers-guide">
            <p><strong>{guide?.title ?? 'This computer cannot accept a connection yet'}</strong></p>
            {guide && <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
          </div>
          <div className="peers-actions">
            <button type="button" className="btn" onClick={() => void start()}>Check again</button>
            {onClose && <button type="button" className="btn" onClick={onClose}>Close</button>}
          </div>
        </>
      )}
      {phase.kind === 'error' && (
        <>
          <p className="peers-error" role="alert">{phase.message}</p>
          <div className="peers-actions">
            <button type="button" className="btn" onClick={() => void start()}>Try again</button>
            {onClose && <button type="button" className="btn" onClick={onClose}>Close</button>}
          </div>
        </>
      )}
      {phase.kind === 'ready' && (
        <>
          <p>Copy this invitation, then open Join computer on the other computer.</p>
          <label className="peers-approve-label">Invitation
            <textarea className="peers-token" readOnly rows={2} aria-label="Invitation" value={phase.token} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <div className="peers-actions"><button type="button" className="btn" aria-label="Copy invitation" onClick={() => void copy()}><Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}</button></div>
          <div className="peers-approval-code" data-testid="approval-code">
            <p>Read this approval code aloud to the person on the other computer. They type it to connect.</p>
            <strong className="peers-code" aria-label="Approval code">{phase.approvalCode}</strong>
          </div>
          <p className="peers-empty">Works once. Expires at {new Date(phase.expiresAt).toLocaleTimeString()}.</p>
          {actionError && <p className="peers-error" role="alert">{actionError}</p>}
          {mine?.state === 'reserved' && mine.awaitingApproval && mine.peer ? (
            <ApproveConnection
              hostname={mine.peer.name}
              fingerprint={mine.peer.fingerprint}
              busy={busy}
              onApprove={async (code) => { await peerConnections.approve(mine.invitationId, code); onChange?.(); onClose?.(); }}
              onDeny={() => void deny(mine.invitationId)}
            />
          ) : (
            <p className="peers-loading" role="status">{mine && mine.state !== 'open' ? `Status: ${mine.state}` : 'Waiting for the other computer to join…'}</p>
          )}
          {onClose && <div className="peers-dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>}
        </>
      )}
    </div>
  );
}
