import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { GroupStatus, PeerLifecycleReason, RepairResult } from '../shared/peer-group.js';
import { NOT_CONNECTED, ownerText, stuckJob, syncedWith } from '../shared/peer-group.js';
import { experimental_requestApproval, useRealtime, useZccDeepLinks, type PluginApprovalResult } from '@zana-ai/zcc-plugin-sdk/app';
import { PEER_STATE_CHANNEL, PLUGIN_ID } from '../shared/contract.js';
import { errorMessage, toast, useApi, type InviteItem, type InviteView, type PeerLink, type PeerStatus } from './api.js';
import { copyText } from './clipboard.js';
import { buildInviteLink, parseInviteInput, parseJoinPayload, type JoinRequest } from './invite-format.js';
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

/** Computers currently syncing: this one plus every connected peer. */
export function syncingCount(peer: PeerStatus): number {
  return Math.max(1, peer.members.filter((member) => member.connected).length);
}

function syncingTitle(count: number): string {
  return count === 1 ? '1 computer syncing (this one)' : `${count} computers syncing (including this one)`;
}

/**
 * Sync now, only once a group is configured: a bordered button in the doc-list header (sized like New) carrying
 * the number of computers currently syncing, or a plain icon in the collapsed rail.
 */
export function SyncButton({ peerSync, compact = false }: { peerSync: PeerSync; compact?: boolean }) {
  const { peer, syncing, sync } = peerSync;
  if (!peer?.configured) return null;
  const count = syncingCount(peer);
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

/**
 * Plain-language setup help for each way the secure link between the two computers can fail. The first computer
 * (the one that clicked Add peer) hosts the link, so most fixes happen there.
 */
interface SshGuide { title: string; steps: string[] }
const SSH_GUIDES: Record<string, SshGuide> = {
  ssh_remote_login_off: {
    title: 'Remote Login is turned off on the computer that clicked Add peer',
    steps: [
      'On the computer that clicked Add peer (the first computer), open System Settings > General > Sharing.',
      'Turn on Remote Login. On Windows or Linux, start the OpenSSH Server service instead.',
      'Come back here and choose Add peer again to get a new invitation.'
    ]
  },
  ssh_unreachable: {
    title: 'The other computer cannot be reached',
    steps: [
      'Check that both computers are awake and on the same Wi-Fi or wired network.',
      'Check that Remote Login is on for the computer that clicked Add peer: System Settings > General > Sharing > Remote Login.',
      'If your network blocks computers from finding each other (some office and guest networks do), try a different network.',
      'Then choose Add peer again for a new invitation.'
    ]
  },
  ssh_auth_refused: {
    title: 'The first computer would not accept the connection',
    steps: [
      'On the computer that clicked Add peer, open System Settings > General > Sharing and make sure Remote Login is on and allows your user account.',
      'Zana needs to add a line to your ~/.ssh/authorized_keys file. If that folder or file is locked or owned by another user, fix its permissions.',
      'Then choose Add peer again for a new invitation.'
    ]
  },
  ssh_forwarding_refused: {
    title: 'Remote Login is on, but it does not allow the connection Zana needs',
    steps: [
      'On the computer that clicked Add peer, a security setting or an administrator policy is blocking port forwarding.',
      'Ask your administrator to allow TCP forwarding for your account in the Remote Login (sshd) settings.',
      'Then choose Add peer again for a new invitation.'
    ]
  },
  ssh_host_key_mismatch: {
    title: 'The computer you reached is not the one that made the invitation',
    steps: [
      'The invitation points at a different computer than the one that answered, or its security key changed.',
      'This can also mean someone else is on your network. Do not continue with this invitation.',
      'On the computer that wants to host, choose Add peer to make a new invitation and paste the new one here.'
    ]
  }
};

function sshGuideFor(text: string | null | undefined): SshGuide | null {
  return (text && SSH_GUIDES[text]) || null;
}

const REMOTE_LOGIN_PATH = 'System Settings > General > Sharing > Remote Login';
const SAME_NETWORK_NOTE = 'Both computers must be on the same network (for example the same Wi-Fi) and awake while you pair.';

function SshGuideCard({ guide }: { guide: SshGuide }) {
  return (
    <div role="alert" className="dd-banner dd-banner-error dd-ssh-guide">
      <p><strong>{guide.title}</strong></p>
      <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
    </div>
  );
}

const REASON_TEXT: Record<string, string> = {
  invalid_invitation: 'This invitation is not valid. Ask for a new one.',
  own_invitation: 'This invitation was created on this computer. Paste it on the other computer.',
  wrong_plugin: 'This invitation is for a different plugin.',
  expired: 'This invitation expired. Start a new invitation.',
  denied: 'Pairing was declined.',
  cancelled: 'Pairing was cancelled.',
  already_redeemed: 'This invitation was already used. Start a new invitation.',
  attempt_limit: 'This invitation was locked after too many attempts. Start a new invitation.',
  identity_mismatch: 'The other computer did not prove the identity in the invitation. Start a new invitation.',
  unreachable: 'The other computer is not reachable yet; retrying. Keep both computers open and online.',
  not_found: 'Invitation not found.',
  capacity: 'Too many open invitations. Cancel one and try again.',
  replay: 'That request was already processed.',
  stale_generation: 'The pairing attempt changed. Start a new invitation.',
  owner_proof_required: 'Owner approval is required.',
  not_ready: 'Pairing is not ready for that action.',
  fenced: 'Pairing consent is no longer valid. Start a new invitation.',
  unavailable: 'Pairing is unavailable right now. Check that both computers are on the same network and that Remote Login is on, then try again.'
};
const STATE_TEXT: Record<string, string> = {
  expired: REASON_TEXT.expired!, denied: REASON_TEXT.denied!, cancelled: REASON_TEXT.cancelled!, failed: 'Pairing failed. Start a new invitation.'
};
const LINK_REASON_TEXT: Record<NonNullable<PeerLink['reason']>, string> = {
  'ssh-down': 'the secure connection to the other computer is down',
  'credential-expired': 'the link credential expired',
  'peer-offline': 'the other computer is offline',
  paused: 'Disconnected on this computer. Reconnect from Settings → Peers.',
  revoked: 'the link was revoked'
};
/** Actionable sentence for why database sync cannot start, from the reason core reported (never a guess). */
export function lifecycleText(reason: PeerLifecycleReason | null | undefined): string {
  switch (reason) {
    case 'keychain-denied': return 'Zana could not use the system keychain. Allow Zana access to the keychain (or unlock it), then restart Zana.';
    case 'encryption-unavailable': return 'Secure key storage is not available on this computer. Unlock or enable the system keychain, then restart Zana.';
    case 'insecure-backend': return 'This computer only offers plain-text key storage, which Zana will not use. Install and unlock a keyring (libsecret or KWallet), then restart Zana.';
    case 'storage-permissions': return 'Zana cannot safely read its peer key folder. Make the Zana data folder private to your user (no group or world write access), then restart Zana.';
    case 'key-missing': return 'Zana has existing paired computers but its protected key is missing, so it will not create a new one. Remove the links and pair again.';
    case 'key-corrupt': return 'Zana\'s protected peer key could not be read. Remove the links and pair again.';
    case 'core-unsupported': return 'This Zana version does not support database sync between computers. Update Zana.';
    default: return 'Database sync cannot start on this app. The reason was not reported; see the Zana log for "[design-docs] peer lifecycle unavailable".';
  }
}

const TERMINAL = new Set(['ready', 'denied', 'cancelled', 'expired', 'failed']);
/** Terminal outcomes a fresh invitation fixes: offer it in one click. */
const RENEWABLE = new Set(['expired', 'attempt_limit', 'already_redeemed']);
/** Invite list polling: fast while a pairing is moving, slow while it waits on an owner (the host also throttles refresh). */
export const INVITE_POLL_MS = 5000;
export const INVITE_WAITING_POLL_MS = 30_000;

function renewable(item: InviteItem): boolean {
  return item.state === 'expired' || (item.state === 'failed' && !!item.reason && RENEWABLE.has(item.reason));
}

/** Local wall-clock time as HH:MM (24 h), stable across locales. */
function clockTime(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function blockedText(item: InviteItem): string {
  return (item.reason && REASON_TEXT[item.reason]) || STATE_TEXT[item.state] || 'Pairing could not continue.';
}

function countdown(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

type RequestApproval = (pluginId: string, request: Parameters<typeof experimental_requestApproval>[1]) => Promise<PluginApprovalResult>;

const APPROVAL_TEXT: Record<string, string | null> = {
  cancelled: null,
  unavailable: 'Approval needs the Zana desktop app on this computer.',
  busy: 'Another approval is already open on this window.',
  invalid: 'The approval could not be shown. Refresh and try again.'
};

/**
 * Pairing without Settings: Add peer (send the link or code) on one computer, Join peer (paste either) on the other,
 * then each owner confirms once. The invitation is the transport and database-sync consent.
 */
function InvitePanel({ invites, onChanged, requestApproval, joinRequest, onJoinRequestHandled }: { invites: InviteView | null; onChanged(): void; requestApproval: RequestApproval; joinRequest?: JoinRequest | null; onJoinRequestHandled?(): void }) {
  const api = useApi();
  const deepLinks = useZccDeepLinks();
  const [created, setCreated] = useState<{ invitationId: string; token: string; expiresAt: number } | null>(null);
  // Which format the field under the buttons shows: the one last copied; null until then (the automatic choice).
  const [shown, setShown] = useState<'link' | 'code' | null>(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const mounted = useMounted();
  const now = useNow(!!created);
  const unavailable = invites?.available === false;
  // A finished pairing clears itself once its link exists (the computer card carries it from there); Dismiss stays only
  // for a 'ready' row that has no link to take over.
  const linked = new Set((invites?.links ?? []).filter((link) => link.phase !== 'failed').map((link) => link.peerInstanceId));
  // A cancelled / denied / expired / failed attempt is history once that computer has a live linked connection.
  const connected = new Set((invites?.links ?? []).filter((link) => link.phase === 'linked').map((link) => link.peerInstanceId));
  const items = (invites?.invitations ?? []).filter((item) => !dismissed.includes(item.invitationId)
    && !(item.state === 'ready' && item.peer && linked.has(item.peer.instanceId))
    && !(TERMINAL.has(item.state) && item.state !== 'ready' && (item.peer ? connected.has(item.peer.instanceId) : connected.size > 0)));
  // The token is shown only while the invitation is open; any later state (or expiry) clears it.
  const live = created ? invites?.invitations.find((item) => item.invitationId === created.invitationId) : undefined;
  useEffect(() => { if (created && live && live.state !== 'open') setCreated(null); }, [created, live]);
  // The host returns the token once; after a remount or tab switch ask the plugin server (memory only) for the still-open one.
  const openId = invites?.invitations.find((item) => item.role === 'inviter' && item.state === 'open')?.invitationId;
  const shownId = created?.invitationId;
  useEffect(() => {
    if (!openId || shownId === openId) return;
    let active = true;
    void api.openInvitation().then((invitation) => { if (active && invitation?.invitationId === openId) setCreated(invitation); }).catch(() => undefined);
    return () => { active = false; };
  }, [api, openId, shownId]);
  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void work().catch((failure) => { if (mounted.current) setError(errorMessage(failure)); }).finally(() => { if (mounted.current) { setBusy(false); onChanged(); } });
  };
  const copy = async (text: string, toastMessage: string) => {
    // The desktop session denies navigator.clipboard, so copyText falls back to the legacy copy path.
    const ok = await copyText(text);
    if (ok) toast(toastMessage);
    if (!mounted.current) return;
    if (!ok) setError('Copy failed. Select the invitation text and copy it manually.');
  };
  const linkFor = (token: string) => buildInviteLink(deepLinks.base(), token);
  // The link is the automatic choice when this build has a scheme and the token fits a link; otherwise the code.
  const format = (token: string): 'link' | 'code' => (linkFor(token) ? 'link' : 'code');
  const copyInvitation = (token: string) => { setShown('code'); return copy(token, 'Invitation code copied to clipboard'); };
  const copyLink = (token: string) => { setShown('link'); return copy(linkFor(token)!, 'Invitation link copied to clipboard'); };
  // A received link only prefills the Join peer field; the user still has to read the confirmation and choose Join peer.
  useEffect(() => {
    if (!joinRequest) return;
    const parsed = parseJoinPayload(joinRequest.payload);
    if (parsed.kind === 'token') { setPaste(parsed.token); setError(null); }
    else if (parsed.kind === 'invalid') setError(parsed.message);
    onJoinRequestHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per received link
  }, [joinRequest]);
  const pasted = paste.trim() ? parseInviteInput(paste) : null;
  const addPeer = () => act(async () => {
    if (created) {
      // A live bearer token must be revoked before a second one is issued; an expired one is already dead, so a failed cancel is moot.
      try { await api.cancelInvitation(created.invitationId); }
      catch (failure) {
        if (!expired) throw new Error(`Could not cancel the current invitation, so no new one was created: ${errorMessage(failure)}`);
      }
    }
    setCreated(null);
    setShown(null);
    const invitation = await api.createInvitation();
    if (mounted.current) setCreated(invitation);
    await (format(invitation.token) === 'link' ? copyLink(invitation.token) : copyInvitation(invitation.token));
  });
  const joinPeer = () => act(async () => {
    const input = parseInviteInput(paste);
    if (input.kind === 'invalid') throw new Error(input.message);
    await api.redeemInvitation(input.token);
    setPaste('');
  });
  const approve = (item: InviteItem) => act(async () => {
    const result = await requestApproval(PLUGIN_ID, await api.invitationApproval(item.invitationId));
    if (!result.approved) {
      const message = APPROVAL_TEXT[result.reason];
      if (message) setError(message);
      return;
    }
    await api.decideInvitation({ invitationId: item.invitationId, decision: 'approved', ownerProof: result.token });
  });
  const expired = created ? created.expiresAt <= now : false;
  // Exactly one primary action in this panel at a time: Add peer without an open invitation, else the automatic copy button.
  const open = !!created && !expired;
  const copyButtons = (token: string) => {
    const linkFirst = format(token) === 'link';
    const code = <button key="code" type="button" className={linkFirst ? 'btn' : 'btn primary'} onClick={() => void copyInvitation(token)}>Copy code</button>;
    if (!linkFirst) return code;
    const link = <button key="link" type="button" className="btn primary" onClick={() => void copyLink(token)}>Copy link</button>;
    return [link, code];
  };
  const fieldValue = (token: string) => (shown ?? format(token)) === 'link' && linkFor(token) ? linkFor(token)! : token;
  return (
    <div className="dd-peers-guide" aria-label="Pair a peer">
      <h5 className="dd-peers-heading">Pair another computer</h5>
      <p>Pair two Zana apps without any machine setup. On one computer choose <strong>Add peer</strong>, then send the link (clickable) or the code to the other computer; there choose <strong>Join peer</strong> and paste either one. On the computer that clicked Add peer, Remote Login must be on (macOS: {REMOTE_LOGIN_PATH}). An invitation works once and must be pasted on the other computer within 10 minutes. After it is pasted, the owner of the computer that clicked Add peer has longer to approve; the pasting computer needs no approval. This invitation is only for setting up the pairing. Once paired, the connection stays up and reconnects by itself.</p>
      <p className="dd-peers-hint">{SAME_NETWORK_NOTE}</p>
      {unavailable ? <p role="note" className="dd-peers-hint">{invites?.reason ? `${invites.reason[0]!.toUpperCase()}${invites.reason.slice(1)}` : 'Host cannot invite peers'}. Your existing sync group keeps working.</p> : null}
      <div className="dd-actions">
        <button type="button" className={open ? 'btn' : 'btn primary'} disabled={busy || unavailable} onClick={addPeer}>Add peer</button>
      </div>
      {created ? (
        <div className="dd-peers-block">
          {expired ? (
            <p role="status">Invitation expired. Create a new one and paste it on the other computer within 10 minutes.</p>
          ) : (
            <>
              <p role="status">Invitation ready. Expires in {countdown(created.expiresAt, now)}. Paste it on the other computer before then.</p>
              <input className="dd-input" aria-label="Invitation" readOnly value={fieldValue(created.token)} onFocus={(event) => event.currentTarget.select()} />
            </>
          )}
          <div className="dd-actions">
            {!expired ? copyButtons(created.token) : null}
            <button type="button" className="btn" disabled={busy} onClick={addPeer}>{expired ? 'Create new invitation' : 'New invitation'}</button>
            <button type="button" className="btn dd-btn-remove" disabled={busy} onClick={() => act(async () => { await api.cancelInvitation(created.invitationId); setCreated(null); })}>Cancel invitation</button>
          </div>
        </div>
      ) : null}
      <div className="dd-actions">
        <input className="dd-input" aria-label="Paste invitation" placeholder="Paste an invitation from the other computer" autoComplete="off" spellCheck={false}
          value={paste} onChange={(event) => setPaste(event.target.value)} disabled={unavailable} />
        <button type="button" className={paste.trim() ? 'btn primary' : 'btn'} disabled={busy || unavailable || !paste.trim()} onClick={joinPeer}>Join peer</button>
      </div>
      <p className="dd-peers-hint">Paste an invitation code or link.</p>
      {pasted?.kind === 'token' ? (
        <p role="status" className="dd-peers-confirm">Join {pasted.summary.name}? Its fingerprint is <code className="dd-fp">{pasted.summary.fingerprint}</code> Check that it matches the other computer, then choose Join peer.</p>
      ) : null}
      {sshGuideFor(error) ? <SshGuideCard guide={sshGuideFor(error)!} /> : error ? <p role="alert" className="dd-banner dd-banner-error">{error}</p> : null}
      {items.length ? (
        <ul className="dd-peers-list" aria-label="Pairing">
          {items.map((item) => <InviteRow key={item.invitationId} item={item} busy={busy} cancelShown={!(item.state === 'open' && open)} canRenew={!unavailable}
            onRenew={() => { setDismissed((current) => [...current, item.invitationId]); addPeer(); }}
            onApprove={() => approve(item)}
            onDeny={() => act(() => api.decideInvitation({ invitationId: item.invitationId, decision: 'denied' }))}
            onCancel={() => act(() => api.cancelInvitation(item.invitationId))}
            onDismiss={() => { setDismissed((current) => [...current, item.invitationId]); void api.dismissInvitation(item.invitationId).catch(() => undefined); }} />)}
        </ul>
      ) : null}
    </div>
  );
}

function InviteRow({ item, busy, cancelShown, onApprove, onDeny, onCancel, onDismiss, onRenew, canRenew }: { item: InviteItem; busy: boolean; cancelShown: boolean; canRenew: boolean; onApprove(): void; onDeny(): void; onCancel(): void; onDismiss(): void; onRenew(): void }) {
  const name = item.peer?.name ?? 'the other computer';
  let text: string;
  let blocked = false;
  if (item.state === 'open') text = 'Pending: waiting for the other computer to paste the invitation.';
  else if (item.state === 'redeeming') text = 'Pending: contacting the other computer.';
  else if (item.state === 'reserved') text = item.awaitingMyApproval ? `Approve pairing with ${name}.` : `Awaiting the other owner's approval for ${name}.`;
  else if (item.state === 'consented' || item.state === 'connecting') text = `Approved. Connecting to ${name}.`;
  else if (item.state === 'ready') text = `Ready: paired with ${name}.`;
  else { text = blockedText(item); blocked = true; }
  const guide = blocked ? sshGuideFor(item.reason) : null;
  if (guide) text = guide.title;
  return (
    <li className="dd-peers-member" data-state={item.state}>
      <span className="dd-peers-member-name">
        <span role={blocked ? 'alert' : 'status'}>{text}</span>
        {item.state === 'reserved' && item.peer ? (
          <span className="dd-peers-hint"> {item.peer.name} fingerprint <code className="dd-fp">{item.peer.fingerprint}</code> Confirm this matches the other machine's screen.
            {item.awaitingMyApproval ? ' Approving allows Design Docs database sync with this peer only.' : ''}
            {item.consentExpiresAt ? ` Approve by ${clockTime(item.consentExpiresAt)}.` : ''}</span>
        ) : null}
        {guide ? <ol className="dd-peers-hint">{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol> : null}
      </span>
      <span className="dd-actions">
        {item.awaitingMyApproval ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={onApprove}>Approve</button>
            <button type="button" className="btn" disabled={busy} onClick={onDeny}>Deny</button>
          </>
        ) : null}
        {(item.state === 'open' && cancelShown) || item.state === 'redeeming' || item.state === 'reserved' ? (
          <button type="button" className="btn dd-btn-remove" disabled={busy} onClick={onCancel}>Cancel</button>
        ) : null}
        {renewable(item) ? <button type="button" className="btn" disabled={busy || !canRenew} onClick={onRenew}>Start new invitation</button> : null}
        {TERMINAL.has(item.state) ? <button type="button" className="btn dd-btn-secondary" disabled={busy} onClick={onDismiss}>Dismiss</button> : null}
      </span>
    </li>
  );
}

const isLiveLink = (link: PeerLink): boolean => link.phase !== 'removed' && link.phase !== 'failed';

const UNNAMED_COMPUTER = 'Unnamed computer';
type GroupMemberStatus = GroupStatus['members'][number];

/** One other computer: its invitation-founded link and its sync-group membership, joined on the same instance id. */
interface Computer { id: string; name: string; link?: PeerLink; member?: GroupMemberStatus }

/**
 * Join links (peerInstanceId) and group members (machineId) into one entry per computer. The name comes from the link
 * (learned while pairing), then the Machines enrollment, then the pairing invitation; an id is never a label.
 */
function computersOf(links: PeerLink[], status: GroupStatus | null, names: Map<string, string>, invitations: InviteItem[]): Computer[] {
  const invited = new Map(invitations.flatMap((item) => item.peer ? [[item.peer.instanceId, item.peer.name] as const] : []));
  const byId = new Map<string, Computer>();
  const nameOf = (id: string, link?: PeerLink) => link?.peerName || names.get(id) || invited.get(id) || UNNAMED_COMPUTER;
  // The newest live link wins (an older ended invitation must not shadow it). A failed attempt never carried sync.
  for (const link of links.filter(isLiveLink)) byId.set(link.peerInstanceId, { id: link.peerInstanceId, name: nameOf(link.peerInstanceId, link), link });
  // Roster entries only count while this computer is still in the group; after leaving, the leftover roster is history.
  for (const member of status?.configured ? status.members : []) {
    if (member.replicaId === status?.replicaId) continue;
    const link = byId.get(member.machineId)?.link;
    byId.set(member.machineId, { id: member.machineId, name: nameOf(member.machineId, link), link, member });
  }
  return [...byId.values()];
}

/** A computer card's status badge (dot + short label) and, when there is more to say, one detail line. */
interface ComputerBadge { state: 'unsynced' | 'connected' | 'reconnecting' | 'paused' | 'disconnected' | 'not-syncing' | 'offline' | 'removing'; label: string; detail?: string }

function computerStatus({ link, member }: Computer, status: GroupStatus | null): ComputerBadge {
  if (member?.retiring) return { state: 'removing', label: 'Being removed', detail: 'Waiting for committed frontier; data sync disabled' };
  if (link) {
    const reason = link.reason ? LINK_REASON_TEXT[link.reason] : '';
    const sentence = reason ? `${reason[0]!.toUpperCase()}${reason.slice(1)}` : '';
    // Core shows this link as Connected; say so, and say database sync is missing unless this computer actually syncs
    // with it (the same definition Repair and the server use, so the badge and Repair can never disagree).
    if (link.state === 'connected' && link.phase === 'linked' && status && !syncedWith(status, link.peerInstanceId)) {
      return { state: 'unsynced', label: 'Connected, sync not set up',
        detail: status.lifecycleAvailable ? 'The connection works but database sync is not set up with this computer. Repair retries setup.' : lifecycleText(status.lifecycleReason) };
    }
    if (link.state === 'connected') return { state: 'connected', label: 'Connected' };
    if (link.state === 'reconnecting') return { state: 'reconnecting', label: 'Reconnecting', detail: sentence || undefined };
    if (link.reason === 'paused') return { state: 'paused', label: 'Paused', detail: sentence };
    if (link.reason === 'revoked') return { state: 'disconnected', label: 'Disconnected', detail: 'The link was revoked. Add peer to pair again.' };
    return { state: 'disconnected', label: 'Disconnected', detail: `${sentence ? `${sentence}. ` : ''}Sync resumes when the link is back.` };
  }
  if (!member) return { state: 'disconnected', label: 'Disconnected' };
  if (!member.authorized) return { state: 'not-syncing', label: 'Not syncing', detail: 'Remove it, or add the peer again to pair.' };
  return member.connected ? { state: 'connected', label: 'Connected' } : { state: 'offline', label: 'Offline' };
}

/**
 * One bordered card per other computer, whatever mix of pairing link and group membership it has: name, status badge
 * and actions on one row. Reconnect re-keys the link; Remove ends the pairing (the whole group once there are three or
 * more computers). A summary row below states the group size and carries Leave Group.
 */
function ComputerCards({ computers, status, busy, notes, onReconnect, onRepair, onRemove }: {
  computers: Computer[]; status: GroupStatus | null; notes: Record<string, { text: string; ok: boolean }>; busy: boolean; onReconnect(id: string): void; onRepair(id: string): void; onRemove(computer: Computer, scope: 'group' | 'link'): void;
}) {
  const self = status?.members.find((member) => member.replicaId === status.replicaId);
  const groupSize = status?.configured ? status.members.length : 0;
  if (!computers.length && groupSize < 2) return null;
  // Leave Group needs a third computer to stay; with two, Remove on the other computer ends the pairing (the server turns it
  // into this computer leaving) so no roster entry is left behind.
  const roster = !!status?.configured && status.members.length >= 3;
  const grouped = !!status?.configured;
  const lifecycle = !status || status.lifecycleAvailable;
  return (
    <>
      {computers.length ? (
        <ul className="dd-peers-list dd-peers-cards" aria-label="Computers">
          {computers.map((computer) => {
            const { id, name, link, member } = computer;
            const badge = computerStatus(computer, status);
            const reconnect = !!link && link.state !== 'connected' && link.reason !== 'revoked' && link.reason !== 'paused';
            // Every card carries an action: a roster entry without a live link is cleared by Remove, never left as a dead card.
            const removable = !member?.retiring;
            const scope = grouped && member ? 'group' : 'link';
            return (
              <li key={id} className="dd-peers-card" data-state={link?.state ?? 'member'}>
                <div className="dd-peers-card-head">
                  <strong className="dd-peers-card-name" title={`Computer id ${id}`}>{name}</strong>
                  <span className="dd-peers-badge" data-state={badge.state} role="status">{badge.label}</span>
                  <span className="dd-peers-card-actions">
                    {badge.state === 'unsynced' ? <button type="button" className="btn dd-btn-secondary" disabled={busy} onClick={() => onRepair(id)}
                      title="Retry sync setup with this computer; re-links only this connection if needed.">Repair</button> : null}
                    {reconnect ? <button type="button" className="btn" disabled={busy} onClick={() => onReconnect(id)}>Reconnect</button> : null}
                    {removable ? (
                      <button type="button" className="btn dd-btn-remove" disabled={busy || !lifecycle} onClick={() => onRemove(computer, scope)}
                        title={scope === 'group' ? (roster ? 'Remove this computer from the sync group for everyone.' : 'Stop syncing with this computer and end the pairing.') : 'Stop syncing with this computer and delete the link.'}>
                        Remove
                      </button>
                    ) : null}
                  </span>
                </div>
                {badge.detail ? <p className="dd-peers-hint dd-peers-status">{badge.detail}</p> : null}
                {notes[id] ? <p className="dd-peers-hint dd-peers-status dd-peers-note" data-ok={notes[id]!.ok} data-testid="repair-note">{notes[id]!.text}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {groupSize > 1 ? (
        <div className="dd-peers-summary">
          <span>{`Sync group: ${groupSize} of 8 computers`}</span>
          <span className="dd-peers-hint">· includes this computer</span>
          {roster && self && !self.retiring ? (
            <button type="button" className="btn dd-btn-remove" disabled={busy || !lifecycle} title="Remove this computer from the sync group."
              onClick={() => onRemove({ id: self.machineId, name: 'This computer', member: self }, 'group')}>
              Leave Group
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Database sync peers: pairing, group status, and lifecycle actions.
 * Self-contained (no router), so it renders in the Peers view or on its own.
 */
export function PeerSettings({ requestApproval = experimental_requestApproval, joinRequest, onJoinRequestHandled }: { requestApproval?: RequestApproval; joinRequest?: JoinRequest | null; onJoinRequestHandled?(): void } = {}) {
  const api = useApi();
  const [status, setStatus] = useState<GroupStatus | null>(null);
  const [invites, setInvites] = useState<InviteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [peerId, setPeerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [outOfSync, setOutOfSync] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mounted = useMounted();
  const inviteSeq = useRef(0);
  // Latest request wins, and a failure keeps the last good view so the "host cannot invite" note and controls stay correct.
  const loadInvites = useCallback(() => {
    const seq = ++inviteSeq.current;
    void api.inviteState().then((value) => { if (mounted.current && seq === inviteSeq.current) setInvites(value); }).catch(() => undefined);
  }, [api, mounted]);
  // Once every live pairing is reserved (waiting on an owner's approval) there is nothing to hurry: back off.
  const waiting = !!invites?.invitations.length && invites.invitations.every((item) => TERMINAL.has(item.state) || item.state === 'reserved')
    && invites.invitations.some((item) => item.state === 'reserved');
  useEffect(() => {
    let active = true;
    const load = () => {
      void api
        .groupStatus()
        .then((value) => { if (active) setStatus(value); })
        .catch((failure) => { if (active) setError(errorMessage(failure)); });
      loadInvites();
    };
    load();
    const timer = setInterval(load, waiting ? INVITE_WAITING_POLL_MS : INVITE_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [api, waiting, loadInvites]);
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
      .finally(() => { if (mounted.current) { setBusy(false); loadInvites(); } });
  };
  const repairComputer = (id: string) => {
    setBusy(true);
    setError(null);
    const note = (text: string, ok: boolean) => { if (mounted.current) setNotes((current) => ({ ...current, [id]: { text, ok } })); };
    note('Repairing...', true);
    void api.repairPeer(id).then((result: RepairResult) => {
      if (!mounted.current) return;
      if (result.outcome === 'unavailable') {
        const cause = result.reason ? lifecycleText(result.reason) : result.detail ?? 'The reason was not reported.';
        const text = `Repair could not finish: ${cause}${result.reason || /Add peer|offline|add the peer again/.test(cause) ? '' : ' Next step: use Reconnect, or remove this computer and add the peer again.'}`;
        setError(text); note(text, false);
      } else if (result.outcome === 'pending') {
        const text = `Repair started but sync is not set up yet. ${result.detail ?? ''}`.trim();
        setError(text); note(text, false);
      } else {
        const text = result.outcome === 'relinked' ? 'Connection re-linked and sync set up' : result.outcome === 'already-synced' ? 'Already syncing' : 'Sync set up';
        toast(text); note(text, true);
      }
    }).catch((failure) => { if (mounted.current) { const text = errorMessage(failure); setError(text); note(`Repair failed: ${text}`, false); } })
      .finally(() => { if (mounted.current) { setBusy(false); loadInvites(); void api.groupStatus().then((value) => { if (mounted.current) setStatus(value); }).catch(() => undefined); } });
  };
  const removeComputer = (computer: Computer, scope: 'group' | 'link') => {
    const leaving = !!status && computer.member?.replicaId === status.replicaId;
    const message = leaving ? 'Leave the sync group? This computer stops syncing with every other computer in it. If they are offline, leaving finishes when they reconnect.'
      : scope === 'group' && (status?.members.length ?? 0) < 3 ? `Remove ${computer.name}? This computer stops syncing with it and the pairing ends. To sync again, pair with Add peer.`
      : scope === 'group' ? `Remove ${computer.name} from the sync group for everyone? Syncing with it stops on this computer now. If it is offline, removal finishes when it reconnects.`
      : `Remove ${computer.name}? This computer stops syncing with it and the link is deleted. To sync again, pair with Add peer.`;
    if (!window.confirm(message)) return;
    run(() => scope === 'group' ? api.removePeer(computer.member!.replicaId) : api.revokePeer(computer.id));
  };
  const syncNow = () => {
    setBusy(true);
    void api.syncNow()
      .then((result) => { toast(result.blocked ? `Synced ${result.synced}/${result.attempted}; ${result.blocked} blocked` : `Synced ${result.synced} peers`); if (mounted.current) checkDrift(); })
      .catch((failure) => { if (mounted.current) setError(errorMessage(failure)); })
      .finally(() => { if (mounted.current) setBusy(false); });
  };
  const pendingJobs = status?.jobs.filter((job) => job.state !== 'done') ?? [];
  const links = invites?.links ?? [];
  const invited = new Set(links.filter(isLiveLink).map((link) => link.peerInstanceId));
  // Invitation-founded peers enable themselves; the button is only for peers enrolled through the older Machines flow.
  const legacy = status?.enrolled.filter((peer) => !invited.has(peer.id)) ?? [];
  const names = new Map((status?.enrolled ?? []).map((peer) => [peer.id, peer.name]));
  const nameOf = (id: string) => links.find((link) => link.peerInstanceId === id && link.peerName)?.peerName || names.get(id)
    || status?.peers.find((peer) => peer.id === id)?.name || UNNAMED_COMPUTER;
  // Work for another computer that stopped making progress; local-revoke rows target this computer's own grants.
  const stuckPeers = [...new Set(pendingJobs.filter((job) => stuckJob(job) && job.kind !== 'local-revoke')
    .map((job) => job.peerId))];
  // An unfinished setup can be abandoned whatever its state, so it never sits there with nothing to press.
  const setupPeer = status?.setup?.state === 'pending' ? status.setup.peerId : null;
  const setupOnly = (id: string) => id === setupPeer && !stuckPeers.includes(id);
  const resettable = setupPeer && setupOnly(setupPeer) ? [...stuckPeers, setupPeer] : stuckPeers;
  const resetComputer = (id: string) => {
    const name = nameOf(id);
    const message = setupOnly(id)
      ? `Cancel the unfinished setup with ${name}? Nothing is deleted: documents and their history stay. You can pair with ${name} again afterwards.`
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
      .finally(() => { if (mounted.current) { setBusy(false); loadInvites(); } });
  };
  // Why the setup waits, in owner words. Core's "no enrollment" error only means there is no link to that computer.
  const setupReason = (setup: NonNullable<GroupStatus['setup']>): string => {
    const reason = ownerText(setup.error);
    if (setup.state !== 'pending' || (reason && reason !== NOT_CONNECTED)) return reason ? `: ${reason}` : '';
    const name = nameOf(setup.peerId);
    if (invites?.available && !links.some((link) => link.peerInstanceId === setup.peerId && isLiveLink(link))) return `: No connection to ${name}. Cancel setup, or pair again.`;
    return reason ? `: waiting for ${name} to connect; no link to this computer right now` : '';
  };
  const computers = computersOf(links, status, names, invites?.invitations ?? []);
  return (
    <section className="dd-peers" aria-label="Database sync peers">
      <p>Sync this entire Design Docs database with other Zana apps. Existing documents stay local until you use Sync.</p>
      <InvitePanel invites={invites} onChanged={() => { loadInvites(); void api.groupStatus().then((value) => { if (mounted.current) setStatus(value); }).catch(() => undefined); }} requestApproval={requestApproval} joinRequest={joinRequest} onJoinRequestHandled={onJoinRequestHandled} />
      {invites?.enableError ? <p role="alert" className="dd-banner dd-banner-error">{invites.enableError}</p> : null}
      <ComputerCards computers={computers} status={status} busy={busy} notes={notes} onRemove={removeComputer} onRepair={repairComputer}
        onReconnect={(id) => { setBusy(true); setError(null); void api.reconnectPeer(id).catch((failure) => { if (mounted.current) setError(errorMessage(failure)); }).finally(() => { if (mounted.current) { setBusy(false); loadInvites(); } }); }} />
      {outOfSync && !dismissed ? (
        <div className="dd-peers-block">
          <p role="status">This database and a paired peer are out of sync.</p>
          <div className="dd-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={syncNow}>Sync Now</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setDismissed(true)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {sshGuideFor(error) ? <SshGuideCard guide={sshGuideFor(error)!} /> : error ? <p role="alert" className="dd-banner dd-banner-error">{error}</p> : null}
      {status ? (
        <>
          <div className="dd-peers-block">
            {!status.configured ? <p>No sync group configured.</p> : null}
            {status.setup ? (
              <p role="status">Setup {status.setup.state}: {nameOf(status.setup.peerId)}{setupReason(status.setup)}</p>
            ) : null}
          </div>
          {pendingJobs.length ? (
            <ul className="dd-peers-list" aria-label="Pending work">
              {pendingJobs.map((job) => (
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
          {!status.lifecycleAvailable ? (
            <p className="dd-peers-hint" role="status">{lifecycleText(status.lifecycleReason)} Pairing and Enable Database Sync stay off until it is ready.</p>
          ) : !status.introductionsAvailable ? (
            <p className="dd-peers-hint">Automatic introductions are unavailable on this app, so new members are not introduced to the rest of the group.</p>
          ) : null}
        </>
      ) : error ? null : <Spinner label="Loading peers" />}
      <div className="dd-actions">
        {status ? (
          <>
            {legacy.length ? (
              <button type="button" className="btn primary" disabled={busy || !peerId || !status.lifecycleAvailable} onClick={() => run(() => api.enablePeer(peerId))}>Enable Database Sync</button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
