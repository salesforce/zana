import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { copyText } from '../../../lib/copy-text.js';
import type { PeerConnection } from '@zana-ai/zcc-server-contract';
import { buildPeerJoinLink } from '../../../lib/peers-join-link.js';
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

type Phase = { kind: 'checking' } | { kind: 'blocked'; reason: string } | { kind: 'ready'; invitationId: string; token: string; expiresAt: number } | { kind: 'error'; message: string };

/** Add computer: this computer waits and the other one connects in, so Remote Login must be on here. */
export function AddComputer({ connections, onChange, onClose }: AddComputerProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [link, setLink] = useState<string | null>(null);
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
      setPhase({ kind: 'ready', invitationId: created.invitationId, token: created.token, expiresAt: created.expiresAt });
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

  useEffect(() => {
    if (phase.kind !== 'ready') return;
    let cancelled = false;
    void buildPeerJoinLink(phase.token).then((next) => { if (!cancelled) setLink(next); });
    return () => { cancelled = true; };
  }, [phase]);

  const copyLink = async () => {
    if (phase.kind !== 'ready') return;
    try {
      const next = link ?? await buildPeerJoinLink(phase.token);
      if (!next) return;
      await copyText(next);
      setCopiedLink(true);
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
      {phase.kind === 'checking' && <p className="peers-loading" role="status">Checking that Remote Login is on…</p>}
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
          <p>Copy either the invitation or the link, then open Accept invitation on the other computer.</p>
          <label className="peers-approve-label">Invitation
            <textarea className="peers-token" readOnly rows={2} aria-label="Invitation" value={phase.token} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <div className="peers-actions"><button type="button" className="btn" aria-label="Copy invitation" onClick={() => void copy()}><Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}</button></div>
          {link && <><label className="peers-approve-label">Link
            <input className="peers-token" readOnly aria-label="Invitation link" value={link} onFocus={(event) => event.currentTarget.select()} />
          </label><div className="peers-actions"><button type="button" className="btn" aria-label="Copy link" onClick={() => void copyLink()}><Copy size={14} aria-hidden="true" /> {copiedLink ? 'Copied' : 'Copy'}</button></div></>}
          <p className="peers-empty">Works once. Expires at {new Date(phase.expiresAt).toLocaleTimeString()}.</p>
          <p className="peers-remote-login">Remote Login is on for this computer.</p>
          {actionError && <p className="peers-error" role="alert">{actionError}</p>}
          {mine?.state === 'reserved' && mine.awaitingApproval && mine.peer ? (
            <ApproveConnection
              hostname={mine.peer.name}
              fingerprint={mine.peer.fingerprint}
              busy={busy}
              onApprove={async (code) => { await peerConnections.approve(mine.invitationId, code); onChange?.(); }}
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
