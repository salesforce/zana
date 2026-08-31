import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { copyText } from '../../lib/copy-text.js';
import { Modal } from '../../components/Modal.js';
import { useHosts } from '../../hooks/useHosts.js';
import { PairingTerminal } from './PairingTerminal.js';
import {
  formatJoinCountdown,
  formatSshPairingCommand,
  isLoopbackOrigin,
  joinCountdownMs,
  mergePairingSshHosts,
  pairingCommand,
  resolvePairingServerUrl,
  resolveRelayPairingServerUrl,
  sanitizeSshHost,
  sshPairingCommand,
  sshPublicPairingArgv,
  TAILSCALE_SERVE_HINT,
  type PairingSshHostOption,
  type RelayStatus
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

export type PairingMethod = 'ssh' | 'command';

export function AddMachineDialogView({
  command,
  copied,
  remainingMs,
  expired,
  mintError,
  joinWindowClosed,
  loopbackWarning,
  viaSsh,
  pairingMethod = 'command',
  showMethodToggle = false,
  sshHost,
  sshHosts,
  pairedName,
  canRun = false,
  pairingRunning = false,
  pairingVisible = false,
  pairingError = null,
  pairingSlot = null,
  onSshHostChange,
  onPairingMethodChange,
  onCopy,
  onRun,
  onStopPairing,
  onRetryMint,
  onClose
}: {
  command: string | null;
  copied: boolean;
  remainingMs: number | null;
  expired: boolean;
  mintError: string | null;
  joinWindowClosed?: boolean;
  loopbackWarning: boolean;
  viaSsh: boolean;
  pairingMethod?: PairingMethod;
  showMethodToggle?: boolean;
  sshHost: string;
  sshHosts: PairingSshHostOption[];
  pairedName: string | null;
  canRun?: boolean;
  pairingRunning?: boolean;
  pairingVisible?: boolean;
  pairingError?: string | null;
  pairingSlot?: ReactNode;
  onSshHostChange: (value: string) => void;
  onPairingMethodChange?: (method: PairingMethod) => void;
  onCopy: () => void;
  onRun?: () => void;
  onStopPairing?: () => void;
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
      {showMethodToggle ? (
        <div className="add-machine-method" role="tablist" aria-label="How to add the machine">
          <button
            type="button"
            role="tab"
            aria-selected={pairingMethod === 'ssh'}
            className={pairingMethod === 'ssh' ? 'active' : undefined}
            data-testid="add-machine-method-ssh"
            onClick={() => onPairingMethodChange?.('ssh')}
          >
            SSH
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pairingMethod === 'command'}
            className={pairingMethod === 'command' ? 'active' : undefined}
            data-testid="add-machine-method-command"
            onClick={() => onPairingMethodChange?.('command')}
          >
            Installer command
          </button>
        </div>
      ) : null}

      <p className="add-machine-lead">
        {pairingMethod === 'ssh'
          ? viaSsh
            ? 'Run this on this computer. It SSHs to the workspace with a reverse tunnel and installs the host daemon there.'
            : 'Pick an SSH host. Run executes the installer on that machine from here.'
          : 'Run this on the machine you want to add. It pairs the machine to this server and keeps it available for your projects.'}
      </p>

      {pairingMethod === 'ssh' ? (
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
            {canRun ? (
              <button
                type="button"
                className="settings-btn"
                disabled={expired || pairingRunning}
                data-testid="add-machine-run"
                onClick={onRun}
              >
                {pairingRunning ? 'Running' : 'Run'}
              </button>
            ) : null}
            {pairingRunning ? (
              <button
                type="button"
                className="settings-btn"
                data-testid="add-machine-stop-tunnel"
                onClick={onStopPairing}
              >
                Stop{viaSsh ? ' tunnel' : ''}
              </button>
            ) : null}
            {expired ? (
              <>
                <span className="add-machine-expiry">
                  {joinWindowClosed ? 'Join window closed' : 'Code expired'}
                </span>
                <button type="button" className="settings-btn" onClick={onRetryMint}>
                  {joinWindowClosed ? 'Renew join window' : 'Generate a new code'}
                </button>
              </>
            ) : remainingMs !== null ? (
              <span className="add-machine-expiry">
                Code expires in {formatJoinCountdown(remainingMs)}
              </span>
            ) : null}
          </div>
          <p className="add-machine-help">
            {pairingMethod === 'ssh'
              ? viaSsh
                ? 'Run it here, or copy and paste it locally (not on the remote). Leave the tunnel open so the reverse forward stays up.'
                : 'Run SSHs to the selected host and executes this installer there. Copy is a fallback if you prefer to paste it yourself.'
              : 'This installs the host daemon, enrolls it, and configures it to reconnect automatically on the other machine.'}
          </p>
          {pairingError ? <p className="modal-error">{pairingError}</p> : null}
          {pairingVisible ? (
            <div className="add-machine-pairing">{pairingSlot}</div>
          ) : null}
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
  const [pairingRunning, setPairingRunning] = useState(false);
  const [pairingVisible, setPairingVisible] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingMethod, setPairingMethod] = useState<PairingMethod>('command');
  const methodTouched = useRef(false);
  const [mintNonce, setMintNonce] = useState(0);
  const [sshHost, setSshHost] = useState(defaultSshHost);
  const [relay, setRelay] = useState<RelayStatus | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    product.relay.status().then((row) => {
      if (!cancelled) setRelay(row);
    }).catch(() => undefined);
    const unsub = product.relay.onChanged((row) => {
      if (!cancelled) setRelay(row);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const resolved = resolveRelayPairingServerUrl({ publicAppUrl, relay, now });
  const serverUrl = resolved.url ?? resolvePairingServerUrl(publicAppUrl);
  const joinWindowClosed = resolved.error === 'join_expired';
  const loopbackWarning = Boolean(serverUrl && isLoopbackOrigin(serverUrl));
  const viaSsh = Boolean(
    pairingMethod === 'ssh' && loopbackWarning && serverUrl && join && sanitizeSshHost(sshHost)
  );

  useEffect(() => {
    if (methodTouched.current) return;
    if (loopbackWarning) setPairingMethod('ssh');
  }, [loopbackWarning]);

  const remint = useCallback(() => {
    void product.relay.renewJoinWindow().then((row) => {
      setRelay(row);
    }).catch(() => undefined);
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

  useEffect(() => {
    if (!hasDesktopBridge()) return;
    let cancelled = false;
    void product.hosts.pairing.status().then((status) => {
      if (cancelled) return;
      setPairingRunning(status.running);
      if (status.running || status.backlog) setPairingVisible(true);
    }).catch(() => undefined);
    const offExit = product.hosts.pairing.onExit(() => {
      if (!cancelled) setPairingRunning(false);
    });
    return () => {
      cancelled = true;
      offExit();
    };
  }, []);

  const paired = join
    ? hosts.find((host) => host.id === join.hostId && host.status === 'connected')
      ?? hosts.find((host) => !baseline.current?.has(host.id) && host.status === 'connected')
    : hosts.find((host) => baseline.current !== null && !baseline.current.has(host.id) && host.status === 'connected');

  const command = join
    ? pairingMethod === 'ssh' && sanitizeSshHost(sshHost)
      ? viaSsh
        ? sshPairingCommand({
          sshHost,
          localServerUrl: serverUrl!,
          joinCode: join.joinCode,
          hostId: join.hostId
        })
        : (() => {
          const argv = serverUrl
            ? sshPublicPairingArgv({
              sshHost,
              serverUrl,
              joinCode: join.joinCode,
              hostId: join.hostId
            })
            : null;
          return argv ? formatSshPairingCommand(argv) : pairingCommand({
            publicAppUrl: serverUrl,
            joinCode: join.joinCode,
            hostId: join.hostId
          });
        })()
      : pairingCommand({ publicAppUrl: serverUrl, joinCode: join.joinCode, hostId: join.hostId })
    : null;
  const remaining = join
    ? joinCountdownMs(join.expiresAt, relay?.joinUntil, now)
    : null;
  const expired = joinWindowClosed || (remaining !== null && remaining <= 0);

  const copy = async () => {
    if (!command) return;
    try {
      await copyText(command);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const run = async () => {
    if (!join || pairingMethod !== 'ssh' || !sanitizeSshHost(sshHost) || expired) return;
    setPairingError(null);
    const result = await product.hosts.pairing.start({
      sshHost,
      joinCode: join.joinCode,
      hostId: join.hostId,
      cols: 80,
      rows: 24
    });
    if (result.ok === false) {
      setPairingError(result.message);
      return;
    }
    setPairingRunning(true);
    setPairingVisible(true);
  };

  const stopPairing = async () => {
    await product.hosts.pairing.stop();
    setPairingRunning(false);
  };

  return (
    <AddMachineDialogView
      command={command}
      copied={copied}
      remainingMs={remaining}
      expired={expired}
      mintError={error}
      joinWindowClosed={joinWindowClosed}
      loopbackWarning={loopbackWarning}
      viaSsh={viaSsh}
      pairingMethod={pairingMethod}
      showMethodToggle={hasDesktopBridge()}
      sshHost={sshHost}
      sshHosts={sshOptions}
      pairedName={paired?.name ?? null}
      canRun={pairingMethod === 'ssh' && hasDesktopBridge() && Boolean(sanitizeSshHost(sshHost))}
      pairingRunning={pairingRunning}
      pairingVisible={pairingVisible && pairingMethod === 'ssh'}
      pairingError={pairingError}
      pairingSlot={pairingVisible && pairingMethod === 'ssh' ? <PairingTerminal /> : null}
      onSshHostChange={setSshHost}
      onPairingMethodChange={(method) => {
        methodTouched.current = true;
        setPairingMethod(method);
      }}
      onCopy={() => void copy()}
      onRun={() => void run()}
      onStopPairing={() => void stopPairing()}
      onRetryMint={remint}
      onClose={onClose}
    />
  );
}
