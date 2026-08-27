import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { Modal } from '../../components/Modal.js';
import { useHosts } from '../../hooks/useHosts.js';
import {
  formatJoinCountdown,
  isLoopbackOrigin,
  mergePairingSshHosts,
  pairingCommand,
  resolvePairingServerUrl,
  sanitizeSshHost,
  sshPairingCommand,
  TAILSCALE_SERVE_HINT,
  type PairingSshHostOption
} from './machine-pairing.js';

interface AddMachineDialogProps {
  open: boolean;
  onClose: () => void;
  publicAppUrl?: string | null;
  sshHosts?: PairingSshHostOption[];
  defaultSshHost?: string;
}

export function AddMachineDialog({
  open,
  onClose,
  publicAppUrl,
  sshHosts,
  defaultSshHost
}: AddMachineDialogProps) {
  if (!open) return null;
  return (
    <AddMachineDialogContent
      onClose={onClose}
      publicAppUrl={publicAppUrl}
      sshHosts={sshHosts}
      defaultSshHost={defaultSshHost}
    />
  );
}

function PairingSshHostRow({
  host,
  label,
  detail,
  selected,
  onSelect
}: {
  host: string;
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: (host: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`remote-host-row${selected ? ' active' : ''}`}
      onClick={() => onSelect(host)}
    >
      <span className="remote-host-alias">{label}</span>
      {detail ? <span className="remote-host-target">{detail}</span> : null}
    </button>
  );
}

function PairingSshHostGroup({
  label,
  options,
  selectedHost,
  onSelect
}: {
  label: string;
  options: PairingSshHostOption[];
  selectedHost: string;
  onSelect: (host: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="add-machine-ssh-group" role="group" aria-label={label}>
      <div className="add-machine-ssh-group-label">{label}</div>
      {options.map((option) => (
        <PairingSshHostRow
          key={option.host}
          host={option.host}
          label={option.label}
          detail={option.detail}
          selected={selectedHost === option.host}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function AddMachineDialogView({
  command,
  copied,
  remainingMs,
  expired,
  mintError,
  loopbackWarning,
  viaSsh,
  sshHost,
  sshHosts,
  pairedName,
  onSshHostChange,
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
  viaSsh: boolean;
  sshHost: string;
  sshHosts: PairingSshHostOption[];
  pairedName: string | null;
  onSshHostChange: (value: string) => void;
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
        {viaSsh
          ? 'Run this in a terminal on this computer. It SSHs to the workspace with a reverse tunnel and installs the host daemon there.'
          : 'Run this on the machine you want to add. It pairs the machine to this server and keeps it available for your projects.'}
      </p>

      {loopbackWarning ? (
        <div className="add-machine-ssh settings-field">
          <span className="settings-label" id="add-machine-ssh-label">SSH host</span>
          <div
            className="remote-host-list add-machine-ssh-list"
            role="listbox"
            aria-labelledby="add-machine-ssh-label"
            data-testid="add-machine-ssh-host"
          >
            {sshHost && !sshHosts.some((option) => option.host === sshHost) ? (
              <PairingSshHostRow
                host={sshHost}
                label={sshHost}
                selected
                onSelect={onSshHostChange}
              />
            ) : null}
            <PairingSshHostGroup
              label="Remote projects"
              options={sshHosts.filter((option) => option.group === 'project')}
              selectedHost={sshHost}
              onSelect={onSshHostChange}
            />
            <PairingSshHostGroup
              label="SSH config"
              options={sshHosts.filter((option) => option.group === 'ssh-config')}
              selectedHost={sshHost}
              onSelect={onSshHostChange}
            />
            {sshHosts.length === 0 && !sshHost ? (
              <div className="list-empty">No remote projects or SSH hosts found.</div>
            ) : null}
          </div>
          <span className="settings-help">
            Registered remotes, plus other hosts from ~/.ssh/config.
          </span>
        </div>
      ) : null}

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
            {viaSsh
              ? 'Paste it locally (not on the remote). The installer finds Node 22+ on PATH, nix, or nvm. Leave the terminal open so the reverse tunnel stays up.'
              : 'This installs the host daemon, enrolls it, and configures it to reconnect automatically on the other machine.'}
          </p>
          {loopbackWarning && !viaSsh ? (
            <p className="modal-warning">
              This address is only reachable on this computer. Enter an SSH host
              from ~/.ssh/config, or set a public app URL (Tailscale Serve). Example:{' '}
              {TAILSCALE_SERVE_HINT}
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
  publicAppUrl,
  sshHosts = [],
  defaultSshHost = ''
}: {
  onClose: () => void;
  publicAppUrl?: string | null;
  sshHosts?: PairingSshHostOption[];
  defaultSshHost?: string;
}) {
  const hosts = useHosts();
  const [join, setJoin] = useState<{ joinCode: string; hostId: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [mintNonce, setMintNonce] = useState(0);
  const [sshHost, setSshHost] = useState(defaultSshHost);
  const [configHosts, setConfigHosts] = useState<Array<{
    alias: string;
    hostname?: string;
    user?: string;
  }>>([]);
  const copiedTimer = useRef<number | null>(null);
  const baseline = useRef<Set<string> | null>(null);
  if (baseline.current === null && hosts.length > 0) {
    baseline.current = new Set(hosts.map((host) => host.id));
  }
  const serverUrl = resolvePairingServerUrl(publicAppUrl);
  const loopbackWarning = Boolean(serverUrl && isLoopbackOrigin(serverUrl));
  const viaSsh = Boolean(loopbackWarning && serverUrl && join && sanitizeSshHost(sshHost));

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

  useEffect(() => {
    if (!hasDesktopBridge()) return;
    let cancelled = false;
    product.ssh.listHosts().then((rows) => {
      if (!cancelled) {
        setConfigHosts(rows.map((row) => ({
          alias: row.alias,
          hostname: row.hostname,
          user: row.user
        })));
      }
    }).catch(() => {
      if (!cancelled) setConfigHosts([]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sshOptions = useMemo(
    () => mergePairingSshHosts(sshHosts, configHosts),
    [configHosts, sshHosts]
  );

  useEffect(() => {
    if (sanitizeSshHost(sshHost)) return;
    const first = sshOptions[0]?.host;
    if (first) setSshHost(first);
  }, [sshHost, sshOptions]);

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  const paired = join
    ? hosts.find((host) => host.id === join.hostId && host.status === 'connected')
      ?? hosts.find((host) => !baseline.current?.has(host.id) && host.status === 'connected')
    : hosts.find((host) => baseline.current !== null && !baseline.current.has(host.id) && host.status === 'connected');

  const command = join
    ? viaSsh
      ? sshPairingCommand({
        sshHost,
        localServerUrl: serverUrl!,
        joinCode: join.joinCode,
        hostId: join.hostId
      })
      : pairingCommand({ publicAppUrl: serverUrl, joinCode: join.joinCode, hostId: join.hostId })
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
      loopbackWarning={loopbackWarning}
      viaSsh={viaSsh}
      sshHost={sshHost}
      sshHosts={sshOptions}
      pairedName={paired?.name ?? null}
      onSshHostChange={setSshHost}
      onCopy={() => void copy()}
      onRetryMint={remint}
      onClose={onClose}
    />
  );
}
