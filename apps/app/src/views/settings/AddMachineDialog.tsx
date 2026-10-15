import { apiJson } from '../../lib/fetch-with-app-surface.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { HostBootstrapEvent } from '@zana-ai/zcc-desktop-contract';
import { product, requestPreferredJoinCode } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { copyText } from '../../lib/copy-text.js';
import { Modal } from '../../components/Modal.js';
import { useHosts } from '../../hooks/useHosts.js';
import { HostInstallStages } from '../../components/HostInstallStages.js';
import {
  capHostInstallLogs,
  splitHostInstallLogText,
  upsertStage,
  type HostInstallStageEntry
} from '../../lib/host-install-drawer.js';
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
  REMOTE_MACHINE_CONNECTION_HINT,
  type PairingSshHostOption,
  type RelayStatus
} from './machine-pairing.js';

interface AddMachineDialogProps {
  open: boolean;
  onClose: () => void;
  publicAppUrl?: string | null;
  sshHosts?: PairingSshHostOption[];
  defaultSshHost?: string;
  repairHost?: { id: string; name: string };
}

export function AddMachineDialog({
  open,
  onClose,
  publicAppUrl,
  sshHosts,
  defaultSshHost,
  repairHost
}: AddMachineDialogProps) {
  if (!open) return null;
  return (
    <AddMachineDialogContent
      onClose={onClose}
      publicAppUrl={publicAppUrl}
      sshHosts={sshHosts}
      defaultSshHost={defaultSshHost}
      repairHost={repairHost}
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

const RELAY_UNAVAILABLE_MESSAGE = 'Relay unavailable — use Connect via SSH';

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
  tunnelIssued = false,
  pairingMethod = 'command',
  relayUnavailable = false,
  showMethodToggle = false,
  sshHost,
  sshHosts,
  pairedName,
  canRun = false,
  pairingRunning = false,
  pairingVisible = false,
  pairingError = null,
  pairingExitCode = null,
  pairingSlot = null,
  connectMode = false,
  canConnect = false,
  connectBusy = false,
  connectStages = [],
  connectLogs = [],
  connectError = null,
  hostsRefreshing = false,
  hostsWarning = null,
  onConnect,
  onRetryConnect,
  onRefreshHosts,
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
  /** Relay offline: the code redeems through a reverse tunnel, so the command needs an SSH host. */
  tunnelIssued?: boolean;
  pairingMethod?: PairingMethod;
  /** Relay refused to mint a code: Copy stays disabled, Connect is unaffected. */
  relayUnavailable?: boolean;
  showMethodToggle?: boolean;
  sshHost: string;
  sshHosts: PairingSshHostOption[];
  pairedName: string | null;
  canRun?: boolean;
  pairingRunning?: boolean;
  pairingVisible?: boolean;
  pairingError?: string | null;
  pairingExitCode?: number | null;
  pairingSlot?: ReactNode;
  /** SSH host with the desktop bridge: Connect is primary, the command panel is secondary. */
  connectMode?: boolean;
  canConnect?: boolean;
  connectBusy?: boolean;
  connectStages?: HostInstallStageEntry[];
  connectLogs?: string[];
  connectError?: string | null;
  hostsRefreshing?: boolean;
  hostsWarning?: string | null;
  onConnect?: () => void;
  onRetryConnect?: () => void;
  onRefreshHosts?: () => void;
  onSshHostChange: (value: string) => void;
  onPairingMethodChange?: (method: PairingMethod) => void;
  onCopy: () => void;
  onRun?: () => void;
  onStopPairing?: () => void;
  onRetryMint: () => void;
  onClose: () => void;
}) {
  const pairingDiagnostics = (
    <>
      {pairingError ? <p className="modal-error">{pairingError}</p> : null}
      {pairingExitCode !== null ? (
        <p className="modal-error" role="alert">
          Pairing exited with code {pairingExitCode} — see output above.
        </p>
      ) : null}
      {pairingVisible ? (
        <div className="add-machine-pairing">{pairingSlot}</div>
      ) : null}
    </>
  );
  const commandPanel = (
    <>
      {relayUnavailable ? (
        <div className="add-machine-error" data-testid="add-machine-relay-unavailable">
          <p className="modal-error" role="alert">{RELAY_UNAVAILABLE_MESSAGE}</p>
          <div className="add-machine-copy-row">
            <button type="button" className="settings-btn" disabled>
              Copy
            </button>
            <button type="button" className="settings-btn" onClick={onRetryMint}>
              Try again
            </button>
          </div>
        </div>
      ) : mintError ? (
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
            {pairingRunning && !connectMode ? (
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
            {pairingMethod === 'ssh' || tunnelIssued
              ? viaSsh
                ? 'Run it here, or copy and paste it locally (not on the remote). Leave the tunnel open so the reverse forward stays up.'
                : 'Run SSHs to the selected host and executes this installer there. Copy is a fallback if you prefer to paste it yourself.'
              : 'This installs the host daemon, enrolls it, and configures it to reconnect automatically on the other machine.'}
          </p>
          {connectMode ? null : pairingDiagnostics}
          {loopbackWarning && !viaSsh ? (
            <p className="modal-warning">
              This address is only reachable on this computer. Enter an SSH host
              from ~/.ssh/config, or configure the machine-pairing relay.{' '}
              {REMOTE_MACHINE_CONNECTION_HINT}
            </p>
          ) : null}
        </div>
      ) : tunnelIssued ? (
        <p className="add-machine-help" data-testid="add-machine-tunnel-pick-host">
          Pick an SSH host above to get a command you can run on this computer.
        </p>
      ) : (
        <p className="add-machine-status">
          <Loader2 size={16} className="add-machine-spin" aria-hidden="true" />
          Creating a join code…
        </p>
      )}
    </>
  );
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
        {tunnelIssued && pairingMethod === 'command'
          ? 'The relay is offline, so the remote cannot reach this computer directly. Run the command below in a terminal on this computer: it SSHs to the machine with a reverse tunnel and installs the host daemon there.'
          : pairingMethod === 'ssh'
          ? connectMode
            ? 'Pick an SSH host and Connect. This computer installs the host daemon there and keeps it connected.'
            : viaSsh
              ? 'Run this on this computer. It SSHs to the workspace with a reverse tunnel and installs the host daemon there.'
              : 'Pick an SSH host. Run executes the installer on that machine from here.'
          : 'Run this on the machine you want to add. It pairs the machine to this server and keeps it available for your projects.'}
      </p>

      {pairingMethod === 'ssh' || tunnelIssued ? (
        <div className="add-machine-ssh settings-field">
          <div className="add-machine-copy-row">
            <span className="settings-label" id="add-machine-ssh-label">SSH host</span>
            {onRefreshHosts ? (
              <button
                type="button"
                className="remote-host-refresh"
                data-testid="add-machine-refresh-hosts"
                disabled={hostsRefreshing}
                onClick={onRefreshHosts}
                aria-label="Refresh SSH hosts"
              >
                <RefreshCw size={12} className={hostsRefreshing ? 'spinning' : undefined} />
                <span>{hostsRefreshing ? 'Refreshing…' : 'Refresh'}</span>
              </button>
            ) : null}
          </div>
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
          {hostsWarning ? <p className="modal-warning">{hostsWarning}</p> : null}
        </div>
      ) : null}

      {connectMode ? (
        <div className="add-machine-connect" data-testid="add-machine-connect-panel">
          <div className="add-machine-copy-row">
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              data-testid="add-machine-connect"
              disabled={!canConnect || connectBusy || pairingRunning}
              onClick={onConnect}
            >
              {connectBusy ? 'Connecting…' : 'Connect'}
            </button>
            {pairingRunning ? (
              <button
                type="button"
                className="settings-btn"
                data-testid="add-machine-stop-tunnel"
                onClick={onStopPairing}
              >
                Stop
              </button>
            ) : null}
          </div>
          <HostInstallStages stages={connectStages} onRetry={connectBusy ? undefined : onRetryConnect} />
          {connectError ? (
            <div className="add-machine-error">
              <p className="modal-error" role="alert" data-testid="add-machine-connect-error">{connectError}</p>
              {!connectBusy && !connectStages.some((entry) => entry.status === 'failed') ? (
                <button
                  type="button"
                  className="settings-btn"
                  data-testid="add-machine-connect-retry"
                  onClick={onRetryConnect}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          {connectLogs.length > 0 ? (
            <details className="add-machine-connect-log" data-testid="add-machine-connect-log">
              <summary className="host-install-log-toggle">Raw output</summary>
              <pre className="machines-join-command">{connectLogs.join('\n')}</pre>
            </details>
          ) : null}
          {pairingDiagnostics}
        </div>
      ) : null}

      {connectMode ? (
        <details className="add-machine-other-ways" data-testid="add-machine-other-ways">
          <summary className="settings-label">Other ways to connect</summary>
          {commandPanel}
        </details>
      ) : commandPanel}

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
        ) : (connectMode ? !connectBusy : relayUnavailable) ? null : (
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
  defaultSshHost = '',
  repairHost
}: {
  onClose: () => void;
  publicAppUrl?: string | null;
  sshHosts?: PairingSshHostOption[];
  defaultSshHost?: string;
  repairHost?: { id: string; name: string };
}) {
  const hosts = useHosts();
  const [join, setJoin] = useState<{ enrollmentId?: string; joinCode: string; hostId: string; expiresAt: number; installCommand?: string; pairingServerUrl?: string; pairingMode?: 'relay' | 'tunnel' } | null>(null);
  const [relayUnavailable, setRelayUnavailable] = useState(false);
  const issueGen = useRef(0);
  const [enrollmentConnected, setEnrollmentConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [pairingRunning, setPairingRunning] = useState(false);
  const [pairingVisible, setPairingVisible] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingExitCode, setPairingExitCode] = useState<number | null>(null);
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
  const [hostsRefreshing, setHostsRefreshing] = useState(false);
  const [hostsWarning, setHostsWarning] = useState<string | null>(null);
  const hostsSeq = useRef(0);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectStages, setConnectStages] = useState<HostInstallStageEntry[]>([]);
  const [connectLogs, setConnectLogs] = useState<string[]>([]);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(null);
  const connectSeq = useRef(0);
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
  const issuedUrl = join?.installCommand ? null : join?.pairingServerUrl ?? null;
  const loopbackBase = issuedUrl ?? serverUrl;
  const loopbackWarning = Boolean(loopbackBase && isLoopbackOrigin(loopbackBase));
  const tunnelIssued = join?.pairingMode === 'tunnel';
  const viaSsh = Boolean(
    (pairingMethod === 'ssh' || tunnelIssued) && loopbackWarning && issuedUrl && sanitizeSshHost(sshHost)
  );

  useEffect(() => {
    if (methodTouched.current) return;
    if (loopbackWarning && !join?.installCommand) setPairingMethod('ssh');
  }, [loopbackWarning, join?.installCommand]);

  const remint = useCallback(() => {
    void product.relay.renewJoinWindow().then((row) => {
      setRelay(row);
    }).catch(() => undefined);
    setMintNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    const gen = ++issueGen.current;
    const current = () => gen === issueGen.current;
    setJoin(null);
    setError(null);
    setRelayUnavailable(false);
    const issue: Promise<
      | { ok: true; join: NonNullable<typeof join> }
      | { ok: false; error: 'relay_unavailable' | 'relay_changed' }
    > = repairHost
      ? apiJson<{ enrollmentId: string; code: string; hostId: string; expiresAt: number; installCommand: string }>('/hosts/connect-code', { method: 'POST', body: JSON.stringify({ hostId: repairHost.id, name: repairHost.name }) }).then(row => ({ ok: true as const, join: { ...row, joinCode: row.code } }))
      : requestPreferredJoinCode();
    issue.then((issued) => {
      if (!current()) return;
      if (!issued.ok) {
        if (issued.error === 'relay_unavailable') setRelayUnavailable(true);
        else setError('The relay changed while creating the code.');
        return;
      }
      if (!issued.join.installCommand && !issued.join.pairingServerUrl) {
        setError('The server did not return a pairing address.');
        return;
      }
      setJoin(issued.join);
      if (issued.join.installCommand) setPairingMethod('command');
    }).catch((err: unknown) => {
      if (current()) setError(err instanceof Error ? err.message : 'Could not mint a join code');
    });
    return () => {
      if (issueGen.current === gen) issueGen.current++;
    };
  }, [mintNonce, repairHost?.id, repairHost?.name]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshHosts = useCallback(() => {
    if (!hasDesktopBridge()) return;
    const seq = ++hostsSeq.current;
    setHostsRefreshing(true);
    product.ssh.syncHosts().then(({ hosts: rows, warning }) => {
      if (seq !== hostsSeq.current) return;
      setConfigHosts(rows.map((row) => ({
        alias: row.alias,
        hostname: row.hostname,
        user: row.user
      })));
      setHostsWarning(warning ?? null);
    }).catch(() => {
      if (seq !== hostsSeq.current) return;
      setConfigHosts([]);
      setHostsWarning('Could not read SSH hosts.');
    }).finally(() => {
      if (seq === hostsSeq.current) setHostsRefreshing(false);
    });
  }, []);

  useEffect(() => {
    refreshHosts();
    return () => {
      hostsSeq.current++;
      connectSeq.current++;
    };
  }, [refreshHosts]);

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
    const offExit = product.hosts.pairing.onExit((code) => {
      if (cancelled) return;
      setPairingRunning(false);
      setPairingExitCode(code === 0 ? null : code);
    });
    return () => {
      cancelled = true;
      offExit();
    };
  }, []);

  useEffect(() => {
    setEnrollmentConnected(false);
    if (!join?.enrollmentId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await apiJson<{ status: string }>(`/hosts/enrollments/${join.enrollmentId}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        if (result.status === 'connected') { setEnrollmentConnected(true); return; }
        if (result.status === 'expired') return;
      } catch { if (abort.signal.aborted) return; }
      timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [join?.enrollmentId]);

  const paired = connectedName !== null ? { name: connectedName } : join ? hosts.find((host) => host.id === join.hostId && host.status === 'connected' && (!join.enrollmentId || enrollmentConnected)) : undefined;

  // A machine paired through a laptop-run ssh command is the machine behind that SSH host:
  // record it so remote projects on that host find it.
  const identityRecorded = useRef<string | null>(null);
  const pairedHostId = paired && 'id' in paired ? (paired as { id: string }).id : null;
  useEffect(() => {
    const ssh = sanitizeSshHost(sshHost);
    if (!pairedHostId || !ssh || !viaSsh || identityRecorded.current === pairedHostId) return;
    identityRecorded.current = pairedHostId;
    void product.hosts.updateSshIdentity(pairedHostId, { host: ssh }).catch(() => undefined);
  }, [pairedHostId, viaSsh, sshHost]);

  const command = join?.installCommand ?? (join
    ? tunnelIssued && !viaSsh
      ? null
      : (pairingMethod === 'ssh' || tunnelIssued) && sanitizeSshHost(sshHost)
      ? viaSsh
        ? sshPairingCommand({
          sshHost,
          localServerUrl: issuedUrl!,
          joinCode: join.joinCode,
          hostId: join.hostId
        })
        : (() => {
          const argv = issuedUrl
            ? sshPublicPairingArgv({
              sshHost,
              serverUrl: issuedUrl,
              joinCode: join.joinCode,
              hostId: join.hostId
            })
            : null;
          return argv ? formatSshPairingCommand(argv) : pairingCommand({
            publicAppUrl: issuedUrl,
            joinCode: join.joinCode,
            hostId: join.hostId
          });
        })()
      : pairingCommand({ publicAppUrl: issuedUrl, joinCode: join.joinCode, hostId: join.hostId })
    : null);
  const remaining = join
    ? joinCountdownMs(join.expiresAt, now)
    : null;
  const expired = (!join?.installCommand && joinWindowClosed) || (remaining !== null && remaining <= 0);

  const connectMode = pairingMethod === 'ssh' && hasDesktopBridge() && !join?.installCommand;

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

  const bootstrapOverSsh = async (host: string) => {
    const seq = ++connectSeq.current;
    const user = configHosts.find((entry) => entry.alias === host)?.user?.trim();
    setConnectBusy(true);
    setConnectStages([]);
    setConnectLogs([]);
    setConnectError(null);
    setConnectedName(null);
    const onEvent = (event: HostBootstrapEvent) => {
      if (seq !== connectSeq.current) return;
      if (event.type === 'stage') setConnectStages((stages) => upsertStage(stages, event));
      else if (event.type === 'log') {
        const lines = splitHostInstallLogText(event.text);
        if (lines.length > 0) setConnectLogs((logs) => capHostInstallLogs([...logs, ...lines]));
      } else if (event.type === 'error') setConnectError(event.message);
    };
    try {
      const events = await product.hosts.bootstrapBySsh(user ? { host, user } : { host }, onEvent);
      if (seq !== connectSeq.current) return;
      const done = events.find((event): event is Extract<HostBootstrapEvent, { type: 'done' }> => event.type === 'done');
      if (!done) {
        const failure = events.find((event): event is Extract<HostBootstrapEvent, { type: 'error' }> => event.type === 'error');
        setConnectError(failure?.message ?? 'The machine did not finish connecting.');
        return;
      }
      const roster = await product.hosts.list().catch(() => [] as typeof hosts);
      if (seq !== connectSeq.current) return;
      setConnectedName(roster.find((row) => row.id === done.hostId)?.name ?? host);
    } catch (err) {
      if (seq !== connectSeq.current) return;
      setConnectError(err instanceof Error ? err.message : 'Could not connect the machine');
    } finally {
      if (seq === connectSeq.current) setConnectBusy(false);
    }
  };

  const run = async () => {
    const host = sanitizeSshHost(sshHost);
    if (pairingMethod !== 'ssh' || !host || connectBusy) return;
    setPairingError(null);
    setPairingExitCode(null);
    if (!join || expired) {
      await bootstrapOverSsh(host);
      return;
    }
    const result = await product.hosts.pairing.start({
      sshHost: host,
      joinCode: join.joinCode,
      hostId: join.hostId,
      cols: 80,
      rows: 24
    });
    if (result.ok === false) {
      setPairingError(result.message);
      return;
    }
    if (result.handoff === 'tunnel') {
      await bootstrapOverSsh(host);
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
      joinWindowClosed={!join?.installCommand && joinWindowClosed}
      loopbackWarning={!join?.installCommand && loopbackWarning}
      viaSsh={viaSsh}
      tunnelIssued={tunnelIssued}
      pairingMethod={pairingMethod}
      relayUnavailable={relayUnavailable}
      showMethodToggle={hasDesktopBridge() && !join?.installCommand}
      sshHost={sshHost}
      sshHosts={sshOptions}
      pairedName={paired?.name ?? null}
      canRun={pairingMethod === 'ssh' && hasDesktopBridge() && Boolean(sanitizeSshHost(sshHost))}
      pairingRunning={pairingRunning}
      pairingVisible={pairingVisible && pairingMethod === 'ssh'}
      pairingError={pairingError}
      pairingExitCode={pairingExitCode}
      pairingSlot={pairingVisible && pairingMethod === 'ssh' ? <PairingTerminal /> : null}
      connectMode={connectMode}
      canConnect={connectMode && Boolean(sanitizeSshHost(sshHost))}
      connectBusy={connectBusy}
      connectStages={connectStages}
      connectLogs={connectLogs}
      connectError={connectError}
      hostsRefreshing={hostsRefreshing}
      hostsWarning={hostsWarning}
      onConnect={() => void run()}
      onRetryConnect={() => void run()}
      onRefreshHosts={hasDesktopBridge() ? refreshHosts : undefined}
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
