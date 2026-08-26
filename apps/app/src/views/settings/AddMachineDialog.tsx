import { useEffect, useRef, useState } from 'react';
import { product } from '../../lib/product-client.js';
import { useHosts } from '../../hooks/useHosts.js';
import {
  formatJoinCountdown,
  isLoopbackOrigin,
  pairingCommand
} from './machine-pairing.js';

interface AddMachineDialogProps {
  open: boolean;
  onClose: () => void;
  publicAppUrl?: string | null;
}

export function AddMachineDialog({ open, onClose, publicAppUrl }: AddMachineDialogProps) {
  if (!open) return null;
  return (
    <AddMachineDialogContent onClose={onClose} publicAppUrl={publicAppUrl} />
  );
}

function AddMachineDialogContent({
  onClose,
  publicAppUrl
}: {
  onClose: () => void;
  publicAppUrl?: string | null;
}) {
  const hosts = useHosts();
  const [join, setJoin] = useState<{ joinCode: string; hostId: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const baseline = useRef<Set<string> | null>(null);
  if (baseline.current === null && hosts.length > 0) {
    baseline.current = new Set(hosts.map((host) => host.id));
  }

  useEffect(() => {
    let cancelled = false;
    product.hosts.createJoinCode().then((issued) => {
      if (!cancelled) setJoin(issued);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not mint a join code');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const paired = join
    ? hosts.find((host) => host.id === join.hostId && host.status === 'connected')
      ?? hosts.find((host) => !baseline.current?.has(host.id) && host.status === 'connected')
    : undefined;

  const command = join
    ? pairingCommand({ publicAppUrl, joinCode: join.joinCode, hostId: join.hostId })
    : null;
  const remaining = join ? join.expiresAt - now : 0;
  const originMissing = !publicAppUrl || isLoopbackOrigin(publicAppUrl);

  const copy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add machine">
        <div className="modal-header">
          <h3>Add machine</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {paired ? (
            <p className="modal-hint">
              <span className="machine-status-dot machine-status-dot--on" />
              {paired.name} is connected.
            </p>
          ) : originMissing ? (
            <p className="modal-error">
              Set a public app URL (Tailscale Serve) before pairing a remote machine.
              A loopback address cannot enroll another computer.
            </p>
          ) : error ? (
            <p className="modal-error">{error}</p>
          ) : !join ? (
            <p className="modal-hint">Minting a join code…</p>
          ) : remaining <= 0 ? (
            <p className="modal-error">This join code expired. Close and add the machine again.</p>
          ) : (
            <>
              <p className="modal-hint">
                Run this on the other computer. It downloads the host daemon and
                outbound-connects here. Expires in {formatJoinCountdown(remaining)}.
              </p>
              <pre className="machines-join-command" data-testid="machines-join-command">{command}</pre>
              <button type="button" className="btn" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy command'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
