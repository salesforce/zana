import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { product } from '../../lib/product-client.js';
import { Modal } from '../../components/Modal.js';
import { useHosts } from '../../hooks/useHosts.js';
import {
  formatJoinCountdown,
  isLoopbackOrigin,
  pairingCommand,
  resolvePairingServerUrl,
  TAILSCALE_SERVE_HINT
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

export function AddMachineDialogView({
  command,
  copied,
  remainingMs,
  expired,
  mintError,
  loopbackWarning,
  pairedName,
  onCopy,
  onRetryMint,
  onClose
}: {
  command: string | null;
  copied: boolean;
  remainingMs: number | null;
  expired: boolean;
  mintError: string | null;
  loopbackWarning: boolean;
  pairedName: string | null;
  onCopy: () => void;
  onRetryMint: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Add a machine"
      onClose={onClose}
      className="add-machine-modal"
      footer={(
        <button type="button" className="settings-btn" onClick={onClose}>
          Done
        </button>
      )}
    >
      <p className="add-machine-lead">
        Run this on the machine you want to add. It pairs the machine to this
        server and keeps it available for your projects.
      </p>

      {mintError ? (
        <div className="add-machine-error">
          <p className="modal-error">{mintError}</p>
          <button type="button" className="settings-btn" onClick={onRetryMint}>
            Try again
          </button>
        </div>
      ) : command ? (
        <div className="add-machine-command">
          <pre className="machines-join-command" data-testid="machines-join-command">{command}</pre>
          <div className="add-machine-copy-row">
            <button
              type="button"
              className="settings-btn"
              disabled={expired}
              onClick={onCopy}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            {expired ? (
              <>
                <span className="add-machine-expiry">Code expired</span>
                <button type="button" className="settings-btn" onClick={onRetryMint}>
                  Generate a new code
                </button>
              </>
            ) : remainingMs !== null ? (
              <span className="add-machine-expiry">
                Code expires in {formatJoinCountdown(remainingMs)}
              </span>
            ) : null}
          </div>
          <p className="add-machine-help">
            This installs the host daemon, enrolls it, and configures it to
            reconnect automatically on the other machine.
          </p>
          {loopbackWarning ? (
            <p className="modal-warning">
              This address is only reachable on this computer. Set a public app URL
              (Tailscale Serve) to pair a remote machine. Example: {TAILSCALE_SERVE_HINT}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="add-machine-status">
          <Loader2 size={16} className="add-machine-spin" aria-hidden="true" />
          Creating a join code…
        </p>
      )}

      <div
        className={`add-machine-status${pairedName ? ' add-machine-status--ok' : ''}`}
        role="status"
        aria-live="polite"
      >
        {pairedName ? (
          <>
            <span className="machine-status-dot machine-status-dot--on" />
            <span className="add-machine-status-copy">{pairedName} connected</span>
          </>
        ) : (
          <>
            <Loader2 size={16} className="add-machine-spin" aria-hidden="true" />
            <span>Waiting for the machine to connect…</span>
          </>
        )}
      </div>
    </Modal>
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
  const [mintNonce, setMintNonce] = useState(0);
  const copiedTimer = useRef<number | null>(null);
  const baseline = useRef<Set<string> | null>(null);
  if (baseline.current === null && hosts.length > 0) {
    baseline.current = new Set(hosts.map((host) => host.id));
  }
  const serverUrl = resolvePairingServerUrl(publicAppUrl);

  const remint = useCallback(() => {
    setMintNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setJoin(null);
    setError(null);
    product.hosts.createJoinCode().then((issued) => {
      if (!cancelled) setJoin(issued);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not mint a join code');
    });
    return () => {
      cancelled = true;
    };
  }, [mintNonce]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  const paired = join
    ? hosts.find((host) => host.id === join.hostId && host.status === 'connected')
      ?? hosts.find((host) => !baseline.current?.has(host.id) && host.status === 'connected')
    : hosts.find((host) => baseline.current !== null && !baseline.current.has(host.id) && host.status === 'connected');

  const command = join
    ? pairingCommand({ publicAppUrl: serverUrl, joinCode: join.joinCode, hostId: join.hostId })
    : null;
  const remaining = join ? join.expiresAt - now : null;
  const expired = remaining !== null && remaining <= 0;

  const copy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AddMachineDialogView
      command={command}
      copied={copied}
      remainingMs={remaining}
      expired={expired}
      mintError={error}
      loopbackWarning={Boolean(serverUrl && isLoopbackOrigin(serverUrl))}
      pairedName={paired?.name ?? null}
      onCopy={() => void copy()}
      onRetryMint={remint}
      onClose={onClose}
    />
  );
}
