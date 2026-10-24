import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { GroupStatus, PeerLifecycleReason, RepairResult } from '../shared/peer-group.js';
import { NOT_CONNECTED, ownerText, stuckJob } from '../shared/peer-group.js';
import { useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { PEER_STATE_CHANNEL } from '../shared/contract.js';
import { errorMessage, toast, useApi, type ConnectionView, type PeerStatus } from './api.js';
import { IconButton, Spinner } from './ui.js';

export interface PeerSync {
  /** Sync group status, null until loaded or when it cannot be read. */
  peer: PeerStatus | null;
  syncing: boolean;
  /** Sync the whole database with every group member now; reports the result as a toast. */
  sync(): void;
  /** Re-read the group status, e.g. after leaving the Peers view. */
  refresh(): void;
}

/** True until the component unmounts; async completions check it before touching state. */
function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}

/** How often the Sync badge re-reads which computers are connected. */
export const PEER_STATUS_POLL_MS = 15_000;

/** One sync implementation shared by the doc-list header and the collapsed rail. */
export function usePeerSync(): PeerSync {
  const api = useApi();
  const [peer, setPeer] = useState<PeerStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const mounted = useMounted();
  // A failed re-read keeps the last good view: a transient error must not hide the Sync button.
  const refresh = useCallback(() => {
    void api.peerStatus().then((value) => { if (mounted.current) setPeer(value); }).catch(() => undefined);
  }, [api, mounted]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, PEER_STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  const sync = () => {
    if (syncing) return;
    setSyncing(true);
    void api
      .syncNow()
      .then((result) => toast(result.blocked ? `Synced ${result.synced}/${result.attempted}; ${result.blocked} blocked` : `Synced ${result.synced} peers`))
      .catch((error) => toast(errorMessage(error), 'error'))
      .finally(() => { if (mounted.current) { setSyncing(false); refresh(); } });
  };
  return { peer, syncing, sync, refresh };
}

/** Computers currently syncing: this one only counts when at least one remote peer is connected. */
export function syncingCount(peer: PeerStatus): number {
  const remote = peer.members.filter((member) => member.replicaId !== peer.replicaId && member.connected).length;
  return remote ? remote + 1 : 0;
}

function syncingTitle(count: number): string {
  return `${count} computers syncing (including this one)`;
}

/**
 * Sync now, only once a group is configured: a bordered button in the doc-list header (sized like New) carrying
 * the number of computers currently syncing, or a plain icon in the collapsed rail.
 */
export function SyncButton({ peerSync, compact = false }: { peerSync: PeerSync; compact?: boolean }) {
  const { peer, syncing, sync } = peerSync;
  if (!peer?.configured) return null;
  const count = syncingCount(peer);
  if (count < 2) return null;
  if (compact) return <IconButton icon={RefreshCw} label={`${syncing ? 'Syncing peers' : 'Sync peers'}: ${syncingTitle(count)}`} disabled={syncing} onClick={sync} />;
  return (
    <button
      type="button"
      className="btn dd-head-btn dd-sync"
      disabled={syncing}
      onClick={sync}
      aria-label={syncing ? 'Syncing' : 'Sync'}
      title={syncingTitle(count)}
    >
      <RefreshCw size={13} aria-hidden className={syncing ? 'spin' : undefined} />
      <span className="dd-head-count">{count}</span>
    </button>
  );
}

/** Actionable sentence for why database sync cannot start, from the reason core reported (never a guess). */
export function lifecycleText(reason: PeerLifecycleReason | null | undefined): string {
  switch (reason) {
    case 'keychain-denied': return 'Zana could not use the system keychain. Allow Zana access to the keychain (or unlock it), then restart Zana.';
    case 'encryption-unavailable': return 'Secure key storage is not available on this computer. Unlock or enable the system keychain, then restart Zana.';
    case 'insecure-backend': return 'This computer only offers plain-text key storage, which Zana will not use. Install and unlock a keyring (libsecret or KWallet), then restart Zana.';
    case 'storage-permissions': return 'Zana cannot safely read its peer key folder. Make the Zana data folder private to your user (no group or world write access), then restart Zana.';
    case 'key-missing': return 'Zana has existing paired computers but its protected key is missing, so it will not create a new one. Remove the connections in Settings → Peers and connect again.';
    case 'key-corrupt': return 'Zana\'s protected peer key could not be read. Remove the connections in Settings → Peers and connect again.';
    case 'core-unsupported': return 'This Zana version does not support database sync between computers. Update Zana.';
    default: return 'Database sync cannot start on this app. The reason was not reported; see the Zana log for "[design-docs] peer lifecycle unavailable".';
  }
}

/** Connection list polling: steady, and fast while a Use request waits on the approval sheets (core owns that sheet). */
export const PEER_CONNECTIONS_POLL_MS = PEER_STATUS_POLL_MS;
export const PEER_PENDING_POLL_MS = 3000;

const UNNAMED_COMPUTER = 'Unnamed computer';

/** Display names: the hostname, with a short id suffix only where two computers share a name. An id is never the label. */
export function labelsOf(connections: readonly ConnectionView[]): Map<string, string> {
  const base = (c: ConnectionView) => c.hostname.trim() || UNNAMED_COMPUTER;
  const counts = new Map<string, number>();
  for (const c of connections) counts.set(base(c).toLowerCase(), (counts.get(base(c).toLowerCase()) ?? 0) + 1);
  return new Map(connections.map((c) => [c.computerId, (counts.get(base(c).toLowerCase()) ?? 0) > 1 ? `${base(c)} (${c.computerId.slice(-4)})` : base(c)]));
}

/** A computer row's status badge (dot + short label) and, when there is more to say, one detail line. */
interface ComputerBadge { state: 'setting-up' | 'unsynced' | 'connected' | 'reconnecting' | 'disconnected' | 'removing'; label: string; detail?: string; working?: boolean }

function computerStatus(c: ConnectionView, status: GroupStatus | null): ComputerBadge {
  if (c.retiring) return { state: 'removing', label: 'Being removed', detail: 'Waiting for committed frontier; data sync disabled' };
  if (c.usedByThisPlugin && status?.lifecycleChecking) {
    return { state: 'setting-up', label: 'Checking sync status', detail: 'Sync status is updating. Keep both computers open; no action needed.' };
  }
  if (c.usedByThisPlugin && status?.setup?.peerId === c.computerId) {
    return { state: 'setting-up', label: 'Setting up sync', detail: 'Waiting for the other computer to finish setup.' };
  }
  // Core shows this connection as Connected; say database sync is missing unless this computer actually syncs with it.
  if (c.usedByThisPlugin && c.state === 'connected' && !c.syncing) {
    // Setup is talking to the other computer right now: show progress, not an idle "not set up" that invites Repair.
    if (c.settingUp && (!status || status.lifecycleAvailable)) {
      return { state: 'unsynced', label: 'Connected, setting up sync', working: true,
        detail: 'Setting up database sync with this computer. Keep both computers open; no action needed.' };
    }
    return { state: 'unsynced', label: 'Connected, sync not set up',
      detail: !status || status.lifecycleAvailable ? 'The connection works but database sync is not set up with this computer. Repair retries setup.' : lifecycleText(status.lifecycleReason) };
  }
  if (c.state === 'connected') return { state: 'connected', label: 'Connected' };
  if (c.state === 'reconnecting') return { state: 'reconnecting', label: 'Reconnecting' };
  return { state: 'disconnected', label: 'Disconnected', detail: c.usedByThisPlugin ? 'Sync resumes when the connection is back.' : undefined };
}

interface RowNote { text: string; ok: boolean }

/**
 * One bordered row per connected computer, used or not. Core owns the connection (add, remove, reconnect in Settings →
 * Peers); this row only chooses whether Design Docs syncs with it.
 */
function ComputerRow({ c, label, status, busy, note, denied, onUse, onStop, onRepair }: {
  c: ConnectionView; label: string; status: GroupStatus | null; busy: boolean; note?: RowNote; denied: boolean; onUse(): void; onStop(): void; onRepair(): void;
}) {
  const badge = computerStatus(c, status);
  const pending = c.use === 'pending';
  const settingUp = badge.state === 'setting-up';
  return (
    <li className="dd-peers-card" data-state={c.state}>
      <div className="dd-peers-card-head">
        <strong className="dd-peers-card-name">{label}</strong>
        <span className="dd-peers-badge" data-state={badge.state} data-working={badge.working || undefined} role="status">
          {badge.label}{badge.working ? <Loader2 size={12} className="dd-spin" aria-hidden data-testid="setup-spinner" /> : null}
        </span>
        <span className="dd-peers-card-actions">
          {badge.state === 'unsynced' ? <button type="button" className="btn dd-btn-secondary" disabled={busy || !!badge.working} onClick={onRepair}
            title="Retry Design Docs sync setup. Reconnect the computer from Settings → Peers if its connection needs repair.">Repair</button> : null}
          {c.usedByThisPlugin ? (
            <button type="button" className="btn dd-btn-remove" disabled={busy || settingUp} onClick={onStop}>Stop using</button>
          ) : (
            <button type="button" className="btn primary" disabled={busy || pending} onClick={onUse}>Use for Design Docs</button>
          )}
        </span>
      </div>
      {badge.detail ? <p className="dd-peers-hint dd-peers-status">{badge.detail}</p> : null}
      {!c.usedByThisPlugin && pending ? <p role="status" className="dd-peers-hint dd-peers-status">Requesting approval on both computers</p> : null}
      {!c.usedByThisPlugin && !pending && (denied || c.use === 'denied') ? <p role="alert" className="dd-peers-hint dd-peers-status">Use was denied. You can ask again.</p> : null}
      {note ? <p className="dd-peers-hint dd-peers-status dd-peers-note" data-ok={note.ok} data-testid="repair-note">{note.text}</p> : null}
    </li>
  );
}

/**
 * Database sync peers: which connected computers Design Docs uses, group status, and lifecycle actions.
 * Self-contained (no router), so it renders in the Peers view or on its own.
 */
export function PeerSettings() {
  const api = useApi();
  const [status, setStatus] = useState<GroupStatus | null>(null);
  const [connections, setConnections] = useState<ConnectionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, RowNote>>({});
  const [denied, setDenied] = useState<string[]>([]);
  const [peerId, setPeerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [outOfSync, setOutOfSync] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mounted = useMounted();
  const connectionSeq = useRef(0);
  // Latest request wins, and a failure keeps the last good view: a transient error must not blank the list.
  const loadConnections = useCallback(() => {
    const seq = ++connectionSeq.current;
    void api.connections()
      .then((value) => { if (mounted.current && seq === connectionSeq.current) setConnections(value); })
      .catch((failure) => { if (mounted.current && seq === connectionSeq.current) setError((current) => current ?? errorMessage(failure)); });
  }, [api, mounted]);
  const loadStatus = useCallback(() => {
    void api.groupStatus().then((value) => { if (mounted.current) setStatus(value); }).catch(() => undefined);
  }, [api, mounted]);
  // Core's approval sheet decides a Use request, and setup finishes on its own: poll quickly while any row waits on either.
  const waiting = !!connections?.some((c) => c.use === 'pending' || c.settingUp);
  useEffect(() => {
    let active = true;
    const load = () => {
      void api
        .groupStatus()
        .then((value) => { if (active) setStatus(value); })
        .catch((failure) => { if (active) setError(errorMessage(failure)); });
      loadConnections();
    };
    load();
    const timer = setInterval(load, waiting || status?.lifecycleChecking ? PEER_PENDING_POLL_MS : PEER_CONNECTIONS_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [api, waiting, status?.lifecycleChecking, loadConnections]);
  const configured = !!status?.configured;
  // Boolean only. A dismissed (Cancel) notice stays away until the sides converge once, so a later drift shows it again.
  const checkDrift = useCallback((isActive: () => boolean = () => true) => {
    void api.peersOutOfSync()
      .then((value) => { if (!isActive()) return; setOutOfSync(value.outOfSync); if (!value.outOfSync) setDismissed(false); })
      .catch(() => { if (isActive()) setOutOfSync(false); });
  }, [api]);
  useEffect(() => {
    if (!configured) { setOutOfSync(false); setDismissed(false); return; }
    let active = true;
    const check = () => checkDrift(() => active);
    check();
    const timer = setInterval(check, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [checkDrift, configured]);
  // A paired peer finished a Sync Now: re-check right away instead of waiting for the next poll.
  useRealtime(PEER_STATE_CHANNEL, () => { if (configured) checkDrift(); });
  const run = (action: () => Promise<GroupStatus>) => {
    setBusy(true);
    setError(null);
    void action().then((value) => { if (mounted.current) setStatus(value); }).catch((failure) => { if (mounted.current) setError(errorMessage(failure)); })
      .finally(() => { if (mounted.current) { setBusy(false); loadConnections(); } });
  };
  const list = connections ?? [];
  const labels = labelsOf(list);
  const requestUse = (id: string) => {
    setBusy(true);
    setError(null);
    setDenied((current) => current.filter((item) => item !== id));
    void api.useConnection(id)
      .then((result) => { if (mounted.current && result.status === 'denied') setDenied((current) => [...current, id]); })
      .catch((failure) => { if (mounted.current) setError(errorMessage(failure)); })
      .finally(() => { if (mounted.current) { setBusy(false); loadConnections(); loadStatus(); } });
  };
  const stopUsing = (id: string) => run(() => api.stopUsingConnection(id));
  const repairComputer = (id: string) => {
    setBusy(true);
    setError(null);
    const note = (text: string, ok: boolean) => { if (mounted.current) setNotes((current) => ({ ...current, [id]: { text, ok } })); };
    note('Repairing...', true);
    void api.repairPeer(id).then((result: RepairResult) => {
      if (!mounted.current) return;
      if (result.outcome === 'unavailable') {
        const cause = result.reason ? lifecycleText(result.reason) : result.detail ?? 'The reason was not reported.';
        const text = `Repair could not finish: ${cause}${result.reason || /Settings|offline/.test(cause) ? '' : ' Next step: remove this computer in Settings → Peers and connect it again.'}`;
        setError(text); note(text, false);
      } else if (result.outcome === 'pending') {
        const text = `Repair started but sync is not set up yet. ${result.detail ?? ''}`.trim();
        setError(text); note(text, false);
      } else {
        const text = result.outcome === 'relinked' ? 'Connection re-linked and sync set up' : result.outcome === 'already-synced' ? 'Already syncing' : 'Sync set up';
        toast(text); note(text, true);
      }
    }).catch((failure) => { if (mounted.current) { const text = errorMessage(failure); setError(text); note(`Repair failed: ${text}`, false); } })
      .finally(() => { if (mounted.current) { setBusy(false); loadConnections(); loadStatus(); } });
  };
  const leaveGroup = (self: GroupStatus['members'][number]) => {
    if (!window.confirm('Leave the sync group? This computer stops syncing with every other computer in it. If they are offline, leaving finishes when they reconnect.')) return;
    run(() => api.removePeer(self.replicaId));
  };
  const syncNow = () => {
    setBusy(true);
    void api.syncNow()
      .then((result) => { toast(result.blocked ? `Synced ${result.synced}/${result.attempted}; ${result.blocked} blocked` : `Synced ${result.synced} peers`); if (mounted.current) checkDrift(); })
      .catch((failure) => { if (mounted.current) setError(errorMessage(failure)); })
      .finally(() => { if (mounted.current) setBusy(false); });
  };
  const pendingJobs = status?.jobs.filter((job) => job.state !== 'done') ?? [];
  const connected = new Set(list.map((c) => c.computerId));
  // Peers enrolled through the older Machines flow have no connection; the button enables those.
  const legacy = status?.enrolled.filter((peer) => !connected.has(peer.id)) ?? [];
  const names = new Map((status?.enrolled ?? []).map((peer) => [peer.id, peer.name]));
  const nameOf = (id: string) => labels.get(id) || names.get(id) || status?.peers.find((peer) => peer.id === id)?.name || UNNAMED_COMPUTER;
  // Work for another computer that stopped making progress; local-revoke rows target this computer's own grants.
  const stuckPeers = [...new Set(pendingJobs.filter((job) => stuckJob(job) && job.kind !== 'local-revoke')
    .map((job) => job.peerId))];
  // An unfinished setup can be abandoned whatever its state, so it never sits there with nothing to press.
  const setupPeer = status?.setup?.state === 'pending' ? status.setup.peerId : null;
  const setupOnly = (id: string) => id === setupPeer && !stuckPeers.includes(id);
  const resettable = (setupPeer && setupOnly(setupPeer) ? [...stuckPeers, setupPeer] : stuckPeers)
    .filter((id) => !connected.has(id) || list.some((connection) => connection.computerId === id && connection.usedByThisPlugin));
  const resetComputer = (id: string) => {
    const name = nameOf(id);
    const message = setupOnly(id)
      ? `Cancel the unfinished setup with ${name}? Nothing is deleted: documents and their history stay. You can use ${name} again afterwards.`
      : `Reset sync with ${name}? This discards this computer's undelivered sync work for ${name} only. Documents and their history are not deleted. Afterwards, use Repair on ${name}.`;
    if (!window.confirm(message)) return;
    const cancelling = setupOnly(id);
    setBusy(true);
    setError(null);
    void api.resetPeerSync(id).then((result) => {
      if (!mounted.current) return;
      setStatus(result.status);
      toast(result.discarded ? (cancelling ? `Cancelled the setup with ${name}` : `Discarded ${result.discarded} stuck ${result.discarded === 1 ? 'item' : 'items'} for ${name}`) : `Nothing stuck for ${name}`);
    }).catch((failure) => { if (mounted.current) setError(errorMessage(failure)); })
      .finally(() => { if (mounted.current) { setBusy(false); loadConnections(); } });
  };
  // Why the setup waits, in owner words. Core's "no enrollment" error only means there is no connection to that computer.
  const setupReason = (setup: NonNullable<GroupStatus['setup']>): string => {
    const reason = ownerText(setup.error);
    if (setup.state !== 'pending' || (reason && reason !== NOT_CONNECTED)) return reason ? `: ${reason}` : '';
    const name = nameOf(setup.peerId);
    if (connections && !connected.has(setup.peerId)) return `: No connection to ${name}. Cancel setup, or connect it in Settings → Peers.`;
    return reason ? `: waiting for ${name} to connect; no link to this computer right now` : '';
  };
  const self = status?.members.find((member) => member.replicaId === status.replicaId);
  // Each connected computer owns its setup state in its card. Keep global work only for computers no longer in the list.
  const connectionIds = new Set(list.map((connection) => connection.computerId));
  const jobNotes = new Map<string, RowNote>();
  for (const job of pendingJobs) {
    if (!connectionIds.has(job.peerId) || jobNotes.has(job.peerId)) continue;
    const detail = ownerText(job.error) ?? 'waiting for this computer';
    jobNotes.set(job.peerId, { text: `${job.state === 'failed' ? 'Sync setup stopped' : 'Sync setup waiting'}: ${detail}`, ok: false });
  }
  if (status?.setup && connectionIds.has(status.setup.peerId) && !jobNotes.has(status.setup.peerId)) {
    jobNotes.set(status.setup.peerId, { text: `Sync setup waiting${setupReason(status.setup)}`, ok: false });
  }
  const backgroundJobs = pendingJobs.filter((job) => !connectionIds.has(job.peerId));
  // The roster is authoritative for the group count: members with no live core connection still belong to the group
  // (and a member stays counted while retiring, until every computer seals its retirement).
  const groupSize = status?.configured ? status.members.length : 0;
  // Leave Group needs a third computer to stay; with two, Stop using on the other computer ends the sync.
  const roster = !!status?.configured && groupSize >= 3;
  const lifecycle = !status || status.lifecycleAvailable;
  return (
    <section className="dd-peers" aria-label="Database sync peers">
      {/* Core owns connections; this panel only points at them and lists what Design Docs may use. */}
      <a className="dd-peers-core-link" href="/settings/peers">Add or remove computers in Settings → Peers</a>
      {connections ? (
        list.length ? (
          <section className="dd-peers-block dd-peers-computers" aria-label="Computers">
            <h4>Computers</h4>
            <ul className="dd-peers-list dd-peers-cards" aria-label="Computers">
              {list.map((c) => (
                <ComputerRow key={c.computerId} c={c} label={labels.get(c.computerId)!} status={status} busy={busy}
                  note={c.usedByThisPlugin ? notes[c.computerId] ?? jobNotes.get(c.computerId) : undefined} denied={denied.includes(c.computerId)}
                  onUse={() => requestUse(c.computerId)} onStop={() => stopUsing(c.computerId)} onRepair={() => repairComputer(c.computerId)} />
              ))}
            </ul>
          </section>
        ) : (
          <div className="dd-peers-block" role="status">
            <p>No computers are connected. Connect a computer first to enable Design Docs sync with it.</p>
            <button type="button" className="btn primary dd-peers-connect" onClick={() => window.location.assign('/settings/peers')}>Connect a computer</button>
          </div>
        )
      ) : null}
      {groupSize > 1 ? (
        <div className="dd-peers-summary">
          <span>{`Sync group: ${groupSize} of 8 computers`}</span>
          <span className="dd-peers-hint">· includes this computer</span>
          {roster && self && !self.retiring ? (
            <button type="button" className="btn dd-btn-remove" disabled={busy || !lifecycle} title="Remove this computer from the sync group." onClick={() => leaveGroup(self)}>
              Leave Group
            </button>
          ) : null}
        </div>
      ) : null}
      {outOfSync && !dismissed ? (
        <div className="dd-peers-block">
          <p role="status">This database and a paired peer are out of sync.</p>
          <div className="dd-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={syncNow}>Sync Now</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setDismissed(true)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="dd-banner dd-banner-error">{error}</p> : null}
      {status ? (
        <>
          <div className="dd-peers-block">
            {!status.configured && !status.lifecycleChecking ? <p>No sync group configured.</p> : null}
            {status.setup && !connectionIds.has(status.setup.peerId) ? (
              <p role="status">Setup {status.setup.state}: {nameOf(status.setup.peerId)}{setupReason(status.setup)}</p>
            ) : null}
          </div>
          {backgroundJobs.length ? (
            <ul className="dd-peers-list" aria-label="Pending work">
              {backgroundJobs.map((job) => (
                <li key={job.id}>{job.kind === 'local-revoke' ? 'This computer' : nameOf(job.peerId)}: {job.state === 'failed' ? 'stopped' : job.state}{job.error ? `: ${ownerText(job.error)}` : ''}</li>
              ))}
            </ul>
          ) : null}
          {resettable.length ? (
            <div className="dd-actions">
              {resettable.map((id) => (
                <button key={id} type="button" className="btn" disabled={busy} onClick={() => resetComputer(id)}>{setupOnly(id) ? 'Cancel setup with' : 'Reset sync with'} {nameOf(id)}</button>
              ))}
            </div>
          ) : null}
          {legacy.length ? (
            <label className="dd-field-inline">
              Enrolled peer
              <select className="dd-input dd-select" aria-label="Enrolled peer" value={peerId} onChange={(event) => setPeerId(event.target.value)}>
                <option value="">Choose one peer</option>
                {legacy.map((peer) => (
                  <option key={peer.id} value={peer.id} disabled={!peer.connected}>{peer.name}{peer.connected ? '' : ' - offline'}</option>
                ))}
              </select>
            </label>
          ) : null}
          {status.lifecycleChecking ? (
            !list.some((connection) => connection.usedByThisPlugin) && <p className="dd-peers-hint" role="status">Checking sync status. This updates automatically; no action needed.</p>
          ) : !status.lifecycleAvailable ? (
            <p className="dd-peers-hint" role="status">{lifecycleText(status.lifecycleReason)} Using a computer and Enable Database Sync stay off until it is ready.</p>
          ) : !status.introductionsAvailable ? (
            <p className="dd-peers-hint">Automatic introductions are unavailable on this app, so new members are not introduced to the rest of the group.</p>
          ) : null}
        </>
      ) : error || connections ? null : <Spinner label="Loading peers" />}
      <div className="dd-actions">
        {status && legacy.length ? (
          <button type="button" className="btn primary" disabled={busy || !peerId || !status.lifecycleAvailable} onClick={() => run(() => api.enablePeer(peerId))}>Enable Database Sync</button>
        ) : null}
      </div>
    </section>
  );
}
